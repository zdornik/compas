#!/usr/bin/env python3
"""Resumable official GRLS instruction archive, never a clinical decision engine.
Source-specific search -> exact registration card -> its own instruction manifest.
All registration targets are queued; --limit is available for explicit small runs.
"""
from pathlib import Path
from html.parser import HTMLParser
from html import unescape
from urllib.parse import urlencode,urljoin,urlparse,quote
import urllib.request,http.cookiejar,json,re,hashlib,datetime,time,concurrent.futures,threading,shutil,argparse
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'knowledge';BASE='https://grls.minzdrav.gov.ru/'
LOCK=threading.Lock();LOCAL=threading.local()

def atomic(path,data):
 path.parent.mkdir(parents=True,exist_ok=True);temp=path.with_suffix(path.suffix+'.tmp');temp.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8');temp.replace(path)
class Form(HTMLParser):
 def __init__(self):super().__init__();self.values={};self.fields={}
 def handle_starttag(self,tag,attrs):
  d=dict(attrs)
  if tag=='input':
   if d.get('type','').lower()=='hidden' and d.get('name'):self.values[d['name']]=d.get('value','')
   if d.get('id'):self.fields[d['id']]=d.get('value','')

def fetch(url,body=None,kind='application/x-www-form-urlencoded'):
 if not hasattr(LOCAL,'opener'):LOCAL.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
 last=None
 for attempt in range(3):
  try:
   request=urllib.request.Request(url,data=body,headers={'User-Agent':'CompassResearch/0.1 (local reference archive)','Content-Type':kind,'Referer':BASE})
   with LOCAL.opener.open(request,timeout=45) as response:
    host=urlparse(response.geturl()).hostname
    if host not in ('grls.minzdrav.gov.ru','grls.rosminzdrav.ru'):raise ValueError('Unexpected instruction source redirect')
    content=response.read(100*1024*1024+1)
    if len(content)>100*1024*1024:raise ValueError('Instruction exceeds 100 MB limit')
    return content
  except Exception as error:last=error;time.sleep(1+attempt*2)
 raise last

def search(inn,registration=None):
 if not hasattr(LOCAL,'form'):
  form=Form();form.feed(fetch(BASE+'grls.aspx').decode());LOCAL.form=form
 data=dict(LOCAL.form.values)
 data.update({'ctl00$plate$isFS':'0','ctl00$plate$txtMNN':inn if registration is None else '',
 'ctl00$plate$txtRegNm':registration or '', 'ctl00$plate$txtRecordOnPageCount':'99',
 'ctl00$plate$hfRegType':'1,5,6,8','ctl00$plate$ddlRegType':['1','5','6','8'],'ctl00$plate$bSeek':'Найти'})
 html=unescape(fetch(BASE+'grls.aspx',urlencode(data,doseq=True).encode()).decode())
 form=Form();form.feed(html);LOCAL.form=form
 rows=[]
 for row in re.findall(r'<tr[^>]*onclick="det\([^\"]+"[^>]*>.*?</tr>',html,re.S):
  guid=re.search(r"det\('([0-9a-f-]+)'",row)
  cells=[re.sub(r'\s+',' ',re.sub('<[^>]+>',' ',x)).strip() for x in re.findall(r'<td[^>]*>(.*?)</td>',row,re.S)]
  if guid and len(cells)>=7:rows.append({'guid':guid.group(1),'registrationNumber':cells[6],'tradeName':cells[1],'inn':cells[2]})
 return rows

def archive_one(target):
 reg=target['registrationNumber'];target_key=hashlib.sha256(reg.encode()).hexdigest()[:24]
 result_path=OUT/'raw/instructions/results'/f'{target_key}.json'
 if result_path.exists():
  old=json.loads(result_path.read_text())
  if old.get('status') in ('downloaded','no_documents') and not old.get('imageReferences'):return old
 cache=OUT/'raw/instructions/search'/f"{hashlib.sha256(target['inn'].encode()).hexdigest()[:24]}.json"
 # Search caches may be safely shared; write serialized to avoid duplicate work on each INN.
 with LOCK:
  if cache.exists():rows=json.loads(cache.read_text())
  else:rows=search(target['inn']);atomic(cache,rows)
 found=next((x for x in rows if x['registrationNumber']==reg),None)
 if found is None:
  rows=search('',reg);found=next((x for x in rows if x['registrationNumber']==reg),None)
 if found is None:
  result={'registrationNumber':reg,'inn':target['inn'],'status':'registration_not_found','documents':[]}
  atomic(result_path,result);return result
 card_url=BASE+'Grls_View_v2.aspx?routingGuid='+found['guid']
 card_path=OUT/'raw/instructions/cards'/(found['guid']+'.html')
 if card_path.exists():card=card_path.read_text()
 else:
  card=fetch(card_url).decode();card_path.parent.mkdir(parents=True,exist_ok=True);card_path.write_text(card)
 form=Form();form.feed(card)
 if form.fields.get('ctl00_plate_RegNr')!=reg:raise ValueError('Registration mismatch in official card')
 payload={'regNumber':reg,'idReg':form.fields['ctl00_plate_hfIdReg']}
 manifest_path=OUT/'raw/instructions/manifests'/f'{target_key}.json'
 if manifest_path.exists():data=json.loads(manifest_path.read_text())
 else:
  response=json.loads(fetch(BASE+'GRLS_View_V2.aspx/AddInstrImg',json.dumps(payload).encode(),'application/json; charset=utf-8'))
  data=json.loads(response['d']);atomic(manifest_path,data)
 docs=[];images=[]
 for source in data.get('Sources',[]):
  for instruction in source.get('Instructions',[]):
   for image in instruction.get('Images',[]):
    raw=image.get('Url','').replace('\\','/')
    if not raw:continue
    url=raw if raw.startswith('https://') else urljoin(BASE,re.sub('/+','/',raw).lstrip('/'))
    url=quote(url,safe=':/?&=%+(),-_.~')
    if urlparse(url).hostname not in ('grls.minzdrav.gov.ru','grls.rosminzdrav.ru'):raise ValueError('Unapproved source host')
    is_pdf=urlparse(url).path.lower().endswith('.pdf')
    file_key=hashlib.sha256(url.encode()).hexdigest()[:32]
    path=OUT/'raw/instructions/pdf'/(file_key+('.pdf' if is_pdf else '.image'));processed=OUT/'processed/instructions'/(file_key+'.json')
    if not path.exists():
     if shutil.disk_usage(ROOT).free<10*1024**3:raise RuntimeError('Disk reserve reached; archive paused')
     content=fetch(url)
     if is_pdf and not content.startswith(b'%PDF-'):raise ValueError('Instruction URL did not return PDF')
     if not is_pdf and not (content.startswith(b'\xff\xd8\xff') or content.startswith(b'\x89PNG\r\n\x1a\n')):raise ValueError('Instruction image format not supported')
     path.parent.mkdir(parents=True,exist_ok=True);temp=path.with_suffix('.tmp');temp.write_bytes(content);temp.replace(path)
    if not processed.exists():
     if is_pdf:
      reader=PdfReader(path);pages=[{'page':index+1,'text':re.sub(r'[\ud800-\udfff\x00]','\ufffd',page.extract_text() or '')} for index,page in enumerate(reader.pages)]
     else:pages=[{'page':1,'text':''}]
     chars=sum(len(x['text'].strip()) for x in pages)
     record={'id':'grls-doc:'+file_key,'sourceId':'grls','kind':'drug_instruction','externalId':file_key,
      'title':f"{found['tradeName']} · {target['inn']}", 'version':instruction.get('Label') or file_key,
      'sourceUrl':url,'landingUrl':card_url,'sourceStatus':'Источник ГРЛС; актуальность конкретной инструкции требует проверки',
      'mimeType':'application/pdf' if is_pdf else 'image/jpeg' if path.read_bytes().startswith(b'\xff\xd8\xff') else 'image/png',
      'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'filePath':str(path.relative_to(ROOT)),
      'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'icd10':[],'pages':pages,
      'metadata':{'registrationNumber':reg,'inn':target['inn'],'tradeName':found['tradeName'],'sourceInstructionLabel':instruction.get('Label'),
                  'sourceImageLabel':image.get('Label'),'originalFormat':'pdf' if is_pdf else 'scan_image','sourceManifest':str(manifest_path.relative_to(ROOT)),
                  'extractionStatus':'text_extracted' if chars>100 else 'ocr_required','clinicalUseApproved':False}}
     atomic(processed,record)
    docs.append('grls-doc:'+file_key)
 result={'registrationNumber':reg,'inn':target['inn'],'status':'downloaded' if docs else 'image_only' if images else 'no_documents',
         'documents':sorted(set(docs)),'imageReferences':images,'cardUrl':card_url}
 atomic(result_path,result);return result

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--scope',choices=['psychiatry','chronic'],default='psychiatry');parser.add_argument('--limit',type=int);parser.add_argument('--workers',type=int,default=2,choices=[1,2]);args=parser.parse_args()
 targets_path=OUT/('processed/instruction-targets-chronic.json' if args.scope=='chronic' else 'processed/instruction-targets.json')
 manifest_path=OUT/('instructions-chronic-manifest.json' if args.scope=='chronic' else 'instructions-manifest.json')
 targets=json.loads(targets_path.read_text())
 scope=json.loads((OUT/(args.scope+'-scope.json')).read_text())
 if scope.get('scope')!=args.scope or any(item.get('collectionScope')!=args.scope for item in targets):raise ValueError('Only an explicit matching collection scope is allowed')
 if args.limit is not None and args.limit<1:raise ValueError('Limit must be positive')
 def sort_date(item):
  try:return datetime.datetime.strptime(item['registeredAt'],'%d.%m.%Y')
  except ValueError:return datetime.datetime.min
 if args.scope=='psychiatry':targets.sort(key=sort_date,reverse=True)
 # First registration for every INN is processed before additional brands/forms, without claiming equivalence.
 first={};rest=[]
 for target in targets:
  if target['inn'] not in first:first[target['inn']]=target
  else:rest.append(target)
 targets=list(first.values())+rest
 if args.limit is not None:targets=targets[:args.limit]
 manifest={'source':'grls','scope':args.scope,'scopeId':scope['id'],'scopeRegistryNames':scope['registryNames'],
  'targetRegistrations':len(targets),'allTargetRegistrations':len(json.loads(targets_path.read_text())),
  'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'running','results':[],'errors':[]}
 atomic(manifest_path,manifest)
 print('Queued registrations',len(targets),'scope',args.scope,flush=True)
 with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
  # executor.map keeps memory bounded to a small future window on Python 3.14+; this corpus has only ~6k small targets.
  pending={pool.submit(archive_one,item):item for item in targets}
  for future in concurrent.futures.as_completed(pending):
   target=pending[future]
   try:
    result=future.result();manifest['results'].append(result)
   except Exception as error:manifest['errors'].append({'registrationNumber':target['registrationNumber'],'error':str(error)})
   finished=len(manifest['results'])+len(manifest['errors'])
   atomic(manifest_path,manifest)
   if finished<=8 or finished%10==0 or finished==len(targets):
    print('Processed',finished,'of',len(targets),'errors',len(manifest['errors']),flush=True);atomic(manifest_path,manifest)
 manifest['status']='completed' if not manifest['errors'] else 'partial';manifest['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
 atomic(manifest_path,manifest)
 print(manifest['status'],len(manifest['results']),'registrations',flush=True)
if __name__=='__main__':main()
