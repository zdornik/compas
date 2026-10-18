#!/usr/bin/env python3
"""Read official PDFs using glyph positions, real grid cells and original image crops.
No clinical prose is generated. Every joining change and table bbox retains source provenance.
"""
from pathlib import Path
import json,re,hashlib,argparse,collections,statistics,datetime,concurrent.futures,math,logging,time,shutil
import pdfplumber
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'knowledge';VERSION='pdfplumber-0.11.9-layout-v3'
logging.getLogger('pdfminer').setLevel(logging.ERROR)
def atomic(path,value):
 path.parent.mkdir(parents=True,exist_ok=True);temp=path.with_suffix('.tmp');temp.write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8');temp.replace(path)
def clean(value):return re.sub(r'[\ud800-\udfff\x00]','\ufffd',value)
def compact(value):return re.sub(r'\s+',' ',clean(value)).strip()
def normalized(value):return value.lower().replace('ё','е')
def vocabulary():
 words=set()
 for path in (OUT/'processed/clinical').glob('*.json'):
  item=json.loads(path.read_text());words.update(normalized(x) for page in item['pages'] for x in re.findall(r'[А-Яа-яЁё]{4,}',page['text']))
 for item in json.loads((OUT/'processed/grls-substances.json').read_text()):words.update(normalized(x) for x in re.findall(r'[А-Яа-яЁё]{4,}',item['nameRu']))
 return words
def rounded_bbox(box):return [round(float(x),2) for x in box]
def valid_bbox(box,page):return all(math.isfinite(x) for x in box) and 0<=box[0]<box[2]<=page.width+.01 and 0<=box[1]<box[3]<=page.height+.01
def margin_number(line,page):return re.fullmatch(r'\d{1,4}',compact(line['text'])) and (line['top']<page.height*.06 or line['bottom']>page.height*.93)
def inside(char,box):return box[0]-.5<=(char['x0']+char['x1'])/2<=box[2]+.5 and box[1]-.5<=(char['top']+char['bottom'])/2<=box[3]+.5
def image_asset(page,box,key,assets):
 box=(max(0,box[0]-2),max(0,box[1]-2),min(page.width,box[2]+2),min(page.height,box[3]+2))
 asset_id=hashlib.sha256((key+':'+str(page.page_number)+':'+str(rounded_bbox(box))).encode()).hexdigest()[:32]
 path=OUT/'processed/layout/assets'/f'{asset_id}.png';path.parent.mkdir(parents=True,exist_ok=True)
 if not path.exists():
  if shutil.disk_usage(ROOT).free<10*1024**3:raise RuntimeError('Disk reserve reached; layout paused')
  page.crop(box).to_image(resolution=144,antialias=True).save(path,format='PNG',quantize=False)
 assets.append({'id':asset_id,'page':page.page_number,'filePath':str(path.relative_to(ROOT)),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'mimeType':'image/png'})
 return asset_id
def join_lines(lines,known,changes):
 result=''
 for line in lines:
  text=compact(line)
  if not text:continue
  if result.endswith('\u00ad'):
   changes.append({'before':result[-35:]+' / '+text[:35],'after':'soft_hyphen_removed'});result=result[:-1]+text
  elif re.search(r'[А-Яа-яЁё]-$',result) and re.match(r'^[а-яё]',text):
   left=re.search(r'([А-Яа-яЁё]+)-$',result)[1];right=re.match(r'[А-Яа-яЁё]+',text)[0];word=left+right
   # Remove an end-of-line hyphen only when the joined spelling occurs elsewhere in the source corpus.
   if normalized(word) in known:
    changes.append({'before':left+'- / '+right,'after':word,'method':'source_corpus_word'});result=result[:-1]+text
   else:result+=text  # preserve a lexical/ambiguous hyphen, but remove the PDF line boundary
  else:result+=(' ' if result else '')+text
 return result
def styled_runs(lines,text,body_size):
 runs=[];cursor=0
 for line in lines:
  chars=line['chars'];baseline=statistics.median([c['bottom'] for c in chars if c['text'].strip()]) if chars else 0
  words=pdfplumber.utils.extract_words(chars,x_tolerance_ratio=.15,return_chars=True)
  for word in words:
   value=clean(word['text']);start=text.find(value,cursor)
   if start<0:continue
   cursor=start+len(value);offset=0
   if ''.join(c['text'] for c in word['chars'])!=word['text']:continue
   for char in word['chars']:
    value=clean(char['text']);font=char['fontname'].lower();style={'bold':'bold' in font,'italic':'italic' in font or 'oblique' in font,'superscript':char['size']<body_size*.87 and char['bottom']<baseline-body_size*.13}
    if any(style.values()):
     segment={'start':start+offset,'end':start+offset+len(value),**style}
     if runs and runs[-1]['end']==segment['start'] and all(runs[-1][k]==style[k] for k in style):runs[-1]['end']=segment['end']
     else:runs.append(segment)
    offset+=len(value)
 return runs
def table_block(page,table,key,assets,known,changes):
 xs=sorted({round(c[0],1) for c in table.cells}|{round(c[2],1) for c in table.cells});ys=sorted({round(c[1],1) for c in table.cells}|{round(c[3],1) for c in table.cells})
 cells=[];text='';occupied=set();valid=len(xs)>2 and len(ys)>2
 for box in sorted(set(table.cells),key=lambda c:(c[1],c[0])):
  x0,y0,x1,y1=[round(x,1) for x in box];row,col=ys.index(y0),xs.index(x0);rowspan,colspan=ys.index(y1)-row,xs.index(x1)-col
  slots={(r,c) for r in range(row,row+rowspan) for c in range(col,col+colspan)}
  if occupied&slots or not rowspan or not colspan:valid=False
  occupied.update(slots)
  crop=page.crop(box);value=join_lines((crop.extract_text(x_tolerance_ratio=.15) or '').splitlines(),known,changes)
  chars=[c for c in page.chars if inside(c,box) and c['text'].strip()]
  header=bool(chars) and sum('bold' in c['fontname'].lower() for c in chars)/len(chars)>.7
  if text:text+='\n'
  start=len(text);text+=value;cells.append({'row':row,'col':col,'rowspan':rowspan,'colspan':colspan,'text':value,'start':start,'end':len(text),'header':header,'bbox':rounded_bbox(box)})
 if len(occupied)!=(len(xs)-1)*(len(ys)-1):valid=False
 asset=image_asset(page,table.bbox,key,assets)
 return {'type':'table','text':text,'cells':cells,'rowCount':len(ys)-1,'columnCount':len(xs)-1,'structured':valid,'assetId':asset,'bbox':rounded_bbox(table.bbox),'top':table.bbox[1]}
def process_document(path_string,known):
 path=Path(path_string);original=json.loads(path.read_text());key=original['externalId'];target=OUT/'processed/layout'/f'{key}.json'
 if target.exists():
  old=json.loads(target.read_text())
  if old.get('extractor')==VERSION and old.get('sourceSha256')==original['sha256']:return {'document':key,'cached':True,'tables':old['counts']['tables'],'notes':old['counts']['notes']}
 pages=[];assets=[];changes=[];counts=collections.Counter()
 with pdfplumber.open(ROOT/original['filePath'],unicode_norm='NFC') as pdf:
  for page in pdf.pages:
   full_lines=page.extract_text_lines(x_tolerance_ratio=.15,return_chars=True)
   raw=clean('\n'.join(line['text'] for line in full_lines))
   grids=[t for t in page.find_tables() if len(t.rows)>=2 and max(len(row.cells) for row in t.rows)>=2 and valid_bbox(t.bbox,page) and all(valid_bbox(c,page) for c in t.cells)]
   tables=[table_block(page,t,key,assets,known,changes) for t in grids]
   # Dotted contents leaders can look like incomplete grids. Do not turn these into tables.
   tables=[t for t in tables if t['structured'] or re.search(r'Таблиц[аы]\s*\d',page.crop((0,max(0,t['bbox'][1]-75),page.width,t['bbox'][1])).extract_text() or '',re.I)]
   boxes=[t['bbox'] for t in tables]
   available=page.filter(lambda obj:obj.get('object_type')!='char' or not any(inside(obj,b) for b in boxes))
   lines=available.extract_text_lines(x_tolerance_ratio=.15,return_chars=True)
   sizes=[c['size'] for c in available.chars if c['text'].strip()];body_size=statistics.median(sizes) if sizes else 12
   chunks=[];pending=[];pending_type='paragraph';previous=None
   def flush():
    nonlocal pending,pending_type
    if not pending:return
    text=join_lines([line['text'] for line in pending],known,changes)
    chunks.append({'type':pending_type,'text':text,'runs':styled_runs(pending,text,body_size),'bbox':[round(min(x['x0'] for x in pending),2),round(pending[0]['top'],2),round(max(x['x1'] for x in pending),2),round(pending[-1]['bottom'],2)],'top':pending[0]['top']})
    pending=[];pending_type='paragraph'
   for line in lines:
    value=compact(line['text']);chars=[c for c in line['chars'] if c['text'].strip()]
    if not value or margin_number(line,page):continue
    size=statistics.median([c['size'] for c in chars]) if chars else body_size
    bold=bool(chars) and sum('bold' in c['fontname'].lower() for c in chars)/len(chars)>.8
    note_marker=bool(re.match(r'^(?:\d{1,2}[.\s]|[*#]{1,3}\s|Примечани[ея]\s*[:.])',value))
    note_continuation=pending_type=='footnote' and previous and line['top']-previous['bottom']<body_size
    kind='footnote' if size<body_size*.87 and line['top']>page.height*.65 and (note_marker or note_continuation) else 'heading' if bold and not re.match(r'^(?:•|Уровень)',value) else 'paragraph'
    if re.match(r'^Уровень (?:убедительности|достоверности)',value):kind='evidence'
    elif re.match(r'^[•●▪\uf0b7]|^\d{1,2}\)\s|^[-–—]\s',value):kind='list'
    elif re.match(r'^Комментарии?\s*:',value):kind='comment'
    split=not previous or line['top']-previous['bottom']>body_size*.55 or kind not in ('paragraph',pending_type) or (pending_type=='heading' and kind!='heading') or (pending_type=='footnote' and kind!='footnote')
    if previous and pending and kind=='paragraph' and pending_type=='paragraph' and line['x0']-previous['x0']>body_size*1.1:split=True
    if pending and any(previous['bottom']<=b[1] and line['top']>=b[3] for b in boxes):split=True
    if split:flush();pending_type=kind
    pending.append({**line,'text':value});previous=line
   flush()
   blocks=sorted(chunks+tables,key=lambda block:(block['top'],block['bbox'][0]))
   # Numeric values, negatives and source words must not vanish during cell/paragraph segmentation.
   content=lambda text:collections.Counter(re.findall(r'[\w]',normalized(text),re.UNICODE))
   expected=content(' '.join(line['text'] for line in full_lines if not margin_number(line,page)))
   actual=content(' '.join(block['text'] for block in blocks))
   if actual!=expected:
    asset=image_asset(page,(0,0,page.width,page.height),key,assets)
    blocks=[{'type':'figure','text':raw,'assetId':asset,'bbox':[0,0,page.width,page.height],'reason':'source_character_coverage_mismatch'}]
    counts['originalPageFallbacks']+=1
   # Keep graph/scan-only pages usable through a faithful source image rather than invented text.
   if not blocks and page.images:
    asset=image_asset(page,(0,0,page.width,page.height),key,assets);blocks=[{'type':'figure','text':'','assetId':asset,'bbox':[0,0,page.width,page.height]}]
   counts['tables']+=len(tables);counts['notes']+=sum(b['type']=='footnote' for b in blocks)
   pages.append({'page':page.page_number,'text':raw,'layout':{'version':1,'width':page.width,'height':page.height,'blocks':blocks}})
   page.close()
 # Exact registry mentions are reindexed against the improved extraction, never interpreted as recommendations.
 substances=json.loads((OUT/'processed/grls-substances.json').read_text());trie={};token=re.compile(r'\w+|[^\w\s]',re.UNICODE)
 for item in substances:
  name=item['normalizedName']
  if not 3<=len(name)<=140:continue
  node=trie
  for word in token.findall(name):node=node.setdefault(word,{})
  node[None]=item['id']
 mentions=[]
 for page in pages:
  text=page['text'];tokens=list(token.finditer(normalized(text)))
  for index,t in enumerate(tokens):
   node=trie.get(t[0]);last=None;j=index
   while node is not None:
    if None in node:last=(node[None],j)
    j+=1
    if j>=len(tokens):break
    node=node.get(tokens[j][0])
   if last:
    substance,last_token=last;start,end=t.start(),tokens[last_token].end();mentions.append({'page':page['page'],'substanceId':substance,'startOffset':start,'matchedText':text[start:end],'context':text[max(0,start-180):end+240]})
 used={b['assetId'] for page in pages for b in page['layout']['blocks'] if b.get('assetId')}
 assets=[asset for asset in assets if asset['id'] in used]
 record={'documentId':original['id'],'externalId':key,'sourceSha256':original['sha256'],'extractor':VERSION,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'pages':pages,'assets':assets,'joiningChanges':changes,'counts':dict(counts),'mentions':mentions}
 atomic(target,record);return {'document':key,'pages':len(pages),'tables':counts['tables'],'notes':counts['notes'],'joins':len(changes)}
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--documents',nargs='*');parser.add_argument('--workers',type=int,default=2);parser.add_argument('--kind',choices=['clinical','instructions'],default='clinical');parser.add_argument('--follow',action='store_true');args=parser.parse_args()
 paths=list((OUT/'processed'/args.kind).glob('*.json'))
 if args.kind=='instructions':
  registrations={item['registrationNumber'] for item in json.loads((OUT/'processed/instruction-targets.json').read_text())}
  paths=[path for path in paths if (item:=json.loads(path.read_text())).get('mimeType','application/pdf')=='application/pdf' and item['metadata'].get('registrationNumber') in registrations]
 if args.documents:paths=[p for p in paths if p.stem in args.documents]
 paths.sort(key=lambda p:(p.stem not in ('1073_1','301_3'),p.stem))
 known=vocabulary();print('Enriching',len(paths),'documents',flush=True)
 with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
  futures={pool.submit(process_document,str(path),known):path.stem for path in paths};results=[];errors=[]
  for f in concurrent.futures.as_completed(futures):
   try:result=f.result();results.append(result);print(json.dumps(result,ensure_ascii=False),flush=True)
   except Exception as error:errors.append({'document':futures[f],'error':str(error)});print(json.dumps(errors[-1],ensure_ascii=False),flush=True)
  atomic(OUT/('layout-manifest.json' if args.kind=='clinical' else 'instruction-layout-manifest.json'),{'extractor':VERSION,'selected':len(paths),'completed':results,'errors':errors})
if __name__=='__main__':
 while True:
  main()
  if '--follow' not in __import__('sys').argv:break
  manifest=OUT/'instructions-manifest.json'
  if '--kind' in __import__('sys').argv and 'instructions' in __import__('sys').argv and manifest.exists() and json.loads(manifest.read_text()).get('status') in ('completed','partial'):break
  time.sleep(60)
