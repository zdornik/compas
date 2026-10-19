#!/usr/bin/env python3
"""Validate the user-supplied public NSI naming snapshot; preserve source IDs."""
import csv,hashlib,io,json,re,shutil,sys,zipfile
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[2]/'knowledge'
OID='1.2.643.5.1.13.13.11.1367'
path=Path(sys.argv[1]) if len(sys.argv)>1 else Path.home()/'Downloads'/f'{OID}_5.18_csv.zip'
version=re.fullmatch(re.escape(OID)+r'_(\d+\.\d+)_csv.zip',path.name).group(1)
raw=path.read_bytes();target=ROOT/'raw/nsi';target.mkdir(exist_ok=True)
shutil.copy2(path,target/path.name)
with zipfile.ZipFile(io.BytesIO(raw)) as archive:
    name=f'{OID}_{version}.csv';data=archive.read(name)
rows=list(csv.DictReader(io.StringIO(data.decode('utf-8-sig')),delimiter=';'))
assert list(rows[0])==['ID','NAME_RUS','NAME_ALTERNATIVE','NAME_LAT','NAME_LAT_GENETIVUS','NAME_ENG','GROUP','INN_RF','ATC','SCTID'],'Changed NSI schema'
assert len({r['ID'] for r in rows})==len(rows),'Duplicate source IDs'
for row in rows:
    assert re.fullmatch(r'\d+',row['ID']) and row['NAME_RUS'].strip() and row['GROUP'] in ['1','2','3','4','5']
    assert row['SCTID']=='' or re.fullmatch(r'\d+',row['SCTID'])
terms=[{'code':r['ID'],'name_ru':r['NAME_RUS'],'name_en':r['NAME_ENG'] or None,'name_la':r['NAME_LAT'] or None,'name_la_genitive':r['NAME_LAT_GENETIVUS'] or None,'alternatives':[s.strip() for s in r['NAME_ALTERNATIVE'].split(';') if s.strip()],'group':r['GROUP'],'inn_rf':r['INN_RF'],'atc':[s.strip() for s in r['ATC'].split(';') if s.strip()],'sctid':r['SCTID'] or None,'sourceRow':i+2} for i,r in enumerate(rows)]
out=ROOT/'processed/nsi-drug-terms.json';out.write_text(json.dumps(terms,ensure_ascii=False,separators=(',',':'))+'\n')
hash=lambda value:hashlib.sha256(value).hexdigest()
manifest={'id':'nsi-drug-ingredients','oid':OID,'version':version,'sourceUrl':f'https://nsi.rosminzdrav.ru/#!/refbook/{OID}','archiveName':path.name,'archiveSha256':hash(raw),'csvFile':name,'csvSha256':hash(data),'preparedFile':'processed/nsi-drug-terms.json','preparedSha256':hash(out.read_bytes()),'records':len(rows),'englishNames':sum(bool(t['name_en']) for t in terms),'latinNames':sum(bool(t['name_la']) for t in terms),'alternativeNameRecords':sum(bool(t['alternatives']) for t in terms),'receivedAt':datetime.now(timezone.utc).isoformat(),'acquisition':'user_supplied_official_named_export','status':'complete_file','clinicalUseApproved':False,'limitation':'Source fields preserved, including empty names and group codes. Names and SNOMED/ATC codes do not themselves approve a DDI provider identity.'}
(ROOT/'nsi-drug-terms-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:manifest[k] for k in ['records','englishNames','latinNames','alternativeNameRecords','version']}))
