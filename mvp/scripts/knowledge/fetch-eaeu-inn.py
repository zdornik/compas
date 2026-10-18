#!/usr/bin/env python3
"""Official EAEU catalog 1016; public reference data only, no DB credentials."""
from pathlib import Path
from datetime import datetime, timezone
import json, hashlib, urllib.request, urllib.parse, concurrent.futures, time
ROOT=Path(__file__).resolve().parents[2]; K=ROOT/'knowledge';RAW=K/'raw/eaeu';RAW.mkdir(parents=True,exist_ok=True)
DATE='2026-10-19';EXPECTED=9578;PAGE=1500
base='https://nsi.eaeunion.org/api/v1/dictionaries/1016/elements'
def get_page(offset):
 url=base+'?'+urllib.parse.urlencode({'dateActual':DATE,'limit':PAGE,'offset':offset,'code':'Code','sortOrder':'asc'})
 path=RAW/f'1016-{offset:05d}.json'
 if path.exists():data=path.read_bytes()
 else:
  for attempt in range(3):
   try:
    with urllib.request.urlopen(urllib.request.Request(url,headers={'Accept':'application/json','User-Agent':'Compass-local-research'}),timeout=15) as response:data=response.read()
    break
   except (OSError,ValueError):
    if attempt==2:raise
    time.sleep(attempt+1)
  parsed=json.loads(data)
  if parsed.get('dictionaryCode')!='1016':raise ValueError('Unexpected source catalog')
  path.write_bytes(data)
 page=json.loads(data)
 assert page['dictionaryCode']=='1016' and page['pagination']['offset']==offset
 expected=min(PAGE,EXPECTED-offset);assert len(page['elements'])==expected,(offset,len(page['elements']),expected)
 return page['elements'],{'file':path.name,'url':url,'sha256':hashlib.sha256(data).hexdigest(),'records':expected}
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:pages=list(pool.map(get_page,range(0,EXPECTED,PAGE)))
rows=[]
for elements,_ in pages:
 for row in elements:
  item=row['data'];assert all(isinstance(item[key],str) and item[key].strip() for key in ['Code','Value_RUS','Value_ENG'])
  rows.append({'code':item['Code'],'name_ru':item['Value_RUS'].strip(),'name_en':item['Value_ENG'].strip(),'name_la':item.get('Value_LAT','').strip() or None,'metadata':{key:row[key] for key in ['id','dateTimeFrom','dateTimeTo','dateTimeUpdated']}})
assert len(rows)==EXPECTED and len({r['code'] for r in rows})==EXPECTED
payload=(json.dumps(rows,ensure_ascii=False,indent=2)+'\n').encode();out=K/'processed/eaeu-inn.json';out.write_bytes(payload)
manifest={'catalogCode':'1016','sourceUrl':'https://nsi.eaeunion.org/portal/1016','apiDocs':'https://nsi.eaeunion.org/portal/info/api','snapshotDate':DATE,'sourceLastUpdated':'2025-11-26','retrievedAt':datetime.now(timezone.utc).isoformat(),'status':'complete','records':len(rows),'missingLatinNames':sum(r['name_la'] is None for r in rows),'sha256':hashlib.sha256(payload).hexdigest(),'pages':[p[1] for p in pages],'purpose':'Official RU/EN/Latin display and search names; not automatic clinical provider identity approval','clinicalUseApproved':False}
(K/'eaeu-inn-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'complete':True,'records':len(rows),'missingLatinNames':sum(r['name_la'] is None for r in rows),'sha256':manifest['sha256']}))
