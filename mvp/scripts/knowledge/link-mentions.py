#!/usr/bin/env python3
"""Exact-name candidates only: an occurrence never means a recommended treatment."""
from pathlib import Path
import json,re
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'knowledge'
substances=json.loads((OUT/'processed/grls-substances.json').read_text())
names={x['normalizedName']:x for x in substances if 3<=len(x['normalizedName'])<=140}
TOKEN=re.compile(r'\w+|[^\w\s]',re.UNICODE)
trie={}
for name,item in names.items():
 node=trie
 for token in TOKEN.findall(name): node=node.setdefault(token,{})
 node[None]=item
count=0; seen=set(); docs=0
with (OUT/'processed/mentions.jsonl').open('w',encoding='utf-8') as output:
 for path in sorted((OUT/'processed/clinical').glob('*.json')):
  document=json.loads(path.read_text());docs+=1
  for page in document['pages']:
   text=page['text']; norm=text.lower().replace('ё','е')
   tokens=list(TOKEN.finditer(norm))
   for index,token in enumerate(tokens):
    node=trie.get(token.group())
    if node is None:continue
    last=(node.get(None), index)
    cursor=index+1
    while cursor<len(tokens) and tokens[cursor].group() in node:
     node=node[tokens[cursor].group()]
     if None in node:last=(node[None],cursor)
     cursor+=1
    item,end_index=last
    if item is None:continue
    start,end=token.start(),tokens[end_index].end()
    row={'documentId':document['id'],'page':page['page'],'substanceId':item['id'],'startOffset':start,
         'matchedText':text[start:end], 'context':text[max(0,start-180):min(len(text),end+240)],
         'method':'exact_registry_name_tokenized','reviewStatus':'unreviewed_mention'}
    output.write(json.dumps(row,ensure_ascii=False)+'\n');count+=1;seen.add(item['id'])
  print(document['id'], 'linked',flush=True)
manifest={'documents':docs,'occurrences':count,'matchedRegistryNames':len(seen),'classification':'unreviewed_mention',
 'limitation':'Exact registry-name matching only. Inflected names, abbreviations and unavailable registry names may be missed. Occurrence does not imply endorsement, recommendation or current registration.'}
(OUT/'mentions-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(manifest,ensure_ascii=False),flush=True)
