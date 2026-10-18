#!/usr/bin/env python3
"""Download pinned public references only. Never send patient data or execute source files."""
from pathlib import Path
import urllib.request,json,hashlib,base64
ROOT=Path(__file__).resolve().parents[2]
K=ROOT/'knowledge'
def get(url):
 request=urllib.request.Request(url,headers={'User-Agent':'Compass-local-research','Accept':'application/vnd.github+json'})
 with urllib.request.urlopen(request,timeout=60) as response:return response.read()
def save(path,data,expected=None):
 if expected and hashlib.sha256(data).hexdigest()!=expected:raise ValueError('Source checksum changed: '+str(path))
 path.parent.mkdir(parents=True,exist_ok=True);temp=path.with_suffix(path.suffix+'.tmp');temp.write_bytes(data);temp.replace(path)
m=json.loads((K/'openmrs-manifest.json').read_text());base='https://raw.githubusercontent.com/pbiondich/openmrs-ddi-knowledge-base/'+m['commit']+'/'
for name in ['kb.json','README.md','LICENSE','ATTRIBUTION.md','HEALTHCARE_DISCLAIMER.md','schema.json']:
 save(K/'raw/openmrs'/name,get(base+name),m['sha256'] if name=='kb.json' else None)
i=json.loads((K/'icd10-manifest.json').read_text());blob=json.loads(get(i['mirrorBlobUrl']));data=base64.b64decode(blob['content']);assert hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()==i['gitBlobSha'];save(K/'raw/icd10/ru.csv',data,i['sha256']);save(K/'raw/icd10/who-2019-en.zip',get(i['englishSource']),i['englishSha256'])
print('Pinned OpenMRS and ICD source files verified. Run prepare-conditions.py, then the offline reference importer.')
