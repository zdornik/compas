#!/usr/bin/env python3
"""Build explicit single-INN source links. Does not infer translations or write the DB."""
import concurrent.futures, hashlib, html, json, re, urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]; K=ROOT/'knowledge'
# Individually selected exact INNs; route-specific products, herbs, salts and combinations excluded.
SELECTED={'Алпразолам','Габапентин','Дексмедетомидин','Донепезил','Дроперидол','Зипрасидон','Золпидем','Кломипрамин','Клоназепам','Мелатонин','Мемантин','Налтрексон','Нитразепам','Оксазепам','Палиперидон','Промазин','Топирамат','Тригексифенидил','Трифлуоперазин','Фенитоин','Фенобарбитал','Циталопрам','Этосуксимид','Алимемазин'}
manifest=json.loads((K/'openmrs-manifest.json').read_text());raw=(K/'raw/openmrs/kb.json').read_bytes()
assert hashlib.sha256(raw).hexdigest()==manifest['sha256']
kb=json.loads(raw);drugs={r['id']:r for r in kb['drugs']}
rows=json.loads((K/'ingredient-atc-candidates.json').read_text())
def make(row):
 code=row['atc'];target=K/'raw/atc'/f'{code}.html';url='https://atcddd.fhi.no/atc_ddd_index/?code='+code
 if target.exists():data=target.read_bytes()
 else:
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Compass-local-research'}),timeout=20) as response:data=response.read()
  target.write_bytes(data)
 match=re.search(r'<tr><td>'+code+r'&nbsp;</td><td><a[^>]*>([^<]+)</a>',data.decode('latin-1'))
 if not match:raise ValueError('No exact WHO code row: '+code)
 english=html.unescape(match[1]).strip().lower()
 exact=[r for r in row['providers'] if r['name'].lower()==english and code in drugs[r['id']]['atc']]
 if len(exact)!=1:raise ValueError('WHO/provider exact-name ambiguity: '+row['nameRu'])
 source=row['evidence'];provider=exact[0]
 return {'nameRu':row['nameRu'],'nameEn':english,'atc':code,'providerId':provider['id'],'chemicalForm':'active_moiety','relation':'reviewed_active_moiety','evidence':[
 {'kind':'grls_inn_and_atc',**{k:source[k] for k in ['documentId','sourceUrl','sha256']},'inn':row['nameRu'],'atc':code},
 {'kind':'who_atc_identity','sourceUrl':url,'name':english,'atc':code,'sha256':hashlib.sha256(data).hexdigest()},
 {'kind':'provider_exact_name_and_atc','commit':manifest['commit'],'externalId':provider['id'],'name':provider['name'],'atc':code}]}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:additional=list(pool.map(make,[r for r in rows if r['nameRu'] in SELECTED]))
assert {r['nameRu'] for r in additional}==SELECTED
links=json.loads((K/'ingredient-source-links.json').read_text());by_name={r['nameRu']:r for r in links}
by_name.update({r['nameRu']:r for r in additional})
(K/'ingredient-source-links.json').write_text(json.dumps(list(by_name.values()),ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'sourceVerifiedNames':len(by_name),'newlyChecked':len(additional),'clinicalUseApproved':False}))
