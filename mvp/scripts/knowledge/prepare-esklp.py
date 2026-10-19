#!/usr/bin/env python3
"""Read the supplied ESKLP Excel snapshot without editing it or guessing identities.

The official bundled instructions recommend XML for automated refreshes. This
one-off research import validates the fixed Excel schema, retains rows and hashes,
and does not treat a standardized purchasing group as a clinical ingredient ID.
"""
import hashlib, io, json, re, sys, unicodedata, zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT=Path(__file__).resolve().parents[2]/'knowledge'
NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
TAG=lambda value:'{'+NS+'}'+value
digest=lambda value:hashlib.sha256(value).hexdigest()
clean=lambda value:re.sub(r'\s+',' ',unicodedata.normalize('NFC',str(value or ''))).strip()
CODE=re.compile(r'^\d{2}\.\d{2}\.\d{2}\.\d{3}-\d{6}-\d-\d{5}-\d{13}$')

def sheet_rows(workbook, number):
    strings=[]
    if 'xl/sharedStrings.xml' in workbook.namelist():
        with workbook.open('xl/sharedStrings.xml') as stream:
            for _,node in ET.iterparse(stream,events=['end']):
                if node.tag==TAG('si'):
                    strings.append(''.join(t.text or '' for t in node.iter(TAG('t'))));node.clear()
    with workbook.open(f'xl/worksheets/sheet{number}.xml') as stream:
        for _,node in ET.iterparse(stream,events=['end']):
            if node.tag==TAG('row'):
                values={}
                for cell in node:
                    col=re.match(r'[A-Z]+',cell.get('r','')).group(0)
                    raw=cell.find(TAG('v'));inline=cell.find(TAG('is'))
                    if cell.find(TAG('f')) is not None:raise ValueError('Formula in source data; cached values are not an identity source')
                    value=strings[int(raw.text)] if cell.get('t')=='s' and raw is not None else ''.join(t.text or '' for t in inline.iter(TAG('t'))) if inline is not None else raw.text if raw is not None else ''
                    if value:values[col]=value
                yield int(node.get('r')),values
                node.clear()
            elif number==2 and node.tag==TAG('mergeCell'):
                # Body values may never be filled down from a previous medicine.
                refs=re.findall(r'\d+',node.get('ref',''))
                if refs and min(map(int,refs))>5:raise ValueError('Unexpected merged source data; explicit merge handling required')

def source_date(value):
    if not value:return None
    if not re.fullmatch(r'\d+(?:\.0+)?',value):raise ValueError('Unexpected Excel date')
    return (datetime(1899,12,30)+timedelta(days=float(value))).date().isoformat()

def prepare(archive):
    raw=archive.read_bytes();snapshot=re.search(r'esklp_(\d{8})_excel_',archive.name).group(1)
    date=f'{snapshot[:4]}-{snapshot[4:6]}-{snapshot[6:]}'
    outputs=ROOT/'processed';outputs.mkdir(exist_ok=True)
    manifest={'id':'esklp','name':'ЕСКЛП · пользовательская официальная выгрузка','url':'https://esklp.egisz.rosminzdrav.ru/','snapshotDate':date,'archiveName':archive.name,'archiveSha256':digest(raw),'format':'excel','schemaVersion':'2.0.4','receivedAt':datetime.now(timezone.utc).isoformat(),'languages':['ru'],'englishTerms':0,'clinicalUseApproved':False,'limitation':'Excel supplied by user; schema and hashes checked. Bundled instructions recommend XML for automated refreshes. Purchasing groups, source flags and codes are not DDI identities.','workbooks':[],'files':{},'counts':{}}
    files={kind:(outputs/f'esklp-{kind}.jsonl').open('w',encoding='utf-8') for kind in ['smnn','klp','trade-names']}
    counts={kind:0 for kind in files};flags={kind:0 for kind in files};codes={kind:set() for kind in ['smnn','klp']}
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as bundle:
            names=sorted(bundle.namelist())
            required=[f'esklp_smnn_{snapshot}.xlsx',f'tn_smnn_{snapshot}.xlsx']
            assert all(name in names for name in required),'Incomplete ESKLP snapshot'
            parts=[name for name in names if re.fullmatch(fr'esklp_klp_{snapshot}_\d{{5}}\.xlsx',name)]
            assert parts and [int(re.search(r'_(\d{5})\.xlsx',name).group(1)) for name in parts]==list(range(len(parts))),'Missing KLP part'
            for name in required+parts:
                data=bundle.read(name);workbook=zipfile.ZipFile(io.BytesIO(data));sha=digest(data)
                kind='smnn' if name.startswith('esklp_smnn') else 'trade-names' if name.startswith('tn_') else 'klp'
                description=dict(sheet_rows(workbook,1));version=description[4]['A'];declared=int(float(description[7]['B']))
                assert version==manifest['schemaVersion'],'Changed declared ESKLP format'
                assert datetime.strptime(snapshot,'%Y%m%d').strftime('%d.%m.%Y') in description[1]['A'],'Mismatched snapshot date'
                first=6 if kind=='klp' else 5;headers={};n=0
                expected={'smnn':{'A1':'Стандартизованное МНН','B1':'Код узла СМНН','AH1':'Список нормализованных МНН для узла СМНН','AK1':'Некорректные данные'},'trade-names':{'A1':'Торговое наименование','B1':'Номер регистрационного удостоверения','C1':'Код узла СМНН','D1':'Стандартизованное МНН'},'klp':{'D1':'Код КЛП','E1':'Торговое наименование','F1':'Нормализованное МНН','P2':'Номер','AE1':'Некорректные данные'}}[kind]
                for row,values in sheet_rows(workbook,2):
                    if row<first:
                        headers.update({col+str(row):clean(value) for col,value in values.items()})
                        continue
                    if row==first:
                        assert all(headers.get(cell)==title for cell,title in expected.items()),f'Changed source schema: {name}'
                        assert not any(re.search(r'английск|латинск',value,re.I) for value in headers.values()),'New language fields require explicit parser review'
                    v=lambda col:clean(values.get(col,''))
                    if not values:continue
                    item={'workbook':name,'sheet':name[:-5],'row':row}
                    if kind=='smnn':
                        item.update(code=v('B'),nameRu=v('A'),form=v('D'),dosage=v('I'),atc=v('N'),normalizedNames=v('AH'),invalidData=v('AK'),validFrom=source_date(v('R')),validUntil=source_date(v('S')))
                    elif kind=='trade-names':
                        item.update(smnnCode=v('C'),tradeName=v('A'),registrationNumber=v('B'),nameRu=v('D'),form=v('E'),dosage=' '.join(filter(None,[v('F'),v('G')])),normalizedNames=v('K'),invalidData='')
                    else:
                        item.update(code=v('D'),smnnCode=v('A'),nameRu=v('B'),normalizedInn=v('F'),tradeName=v('E'),form=v('G'),dosage=v('H'),registrationNumber=v('P'),holder=v('Q'),invalidData=v('AE'),validFrom=source_date(v('AA')),validUntil=source_date(v('AB')))
                    code=item.get('code') or item['smnnCode']
                    assert CODE.fullmatch(code),f'Invalid source identifier: {name}:{row}'
                    if kind=='klp':assert CODE.fullmatch(item['smnnCode'])
                    if item['invalidData']:flags[kind]+=1
                    if kind in codes:codes[kind].add(code)
                    files[kind].write(json.dumps(item,ensure_ascii=False,separators=(',',':'))+'\n');counts[kind]+=1;n+=1
                assert n==declared,f'Source control count mismatch: {name}'
                manifest['workbooks'].append({'declaredRows':declared,'schemaVersion':version,'name':name,'sha256':sha,'sheet':name[:-5],'dataStartRow':first,'rows':n,'headers':headers})
                print(name,n,flush=True)
    finally:
        for file in files.values():file.close()
    for kind in files:
        path=outputs/f'esklp-{kind}.jsonl'
        with path.open('rb') as file:sha=hashlib.file_digest(file,'sha256').hexdigest()
        manifest['files'][kind]={'path':str(path.relative_to(ROOT)),'sha256':sha,'rows':counts[kind]}
    manifest['counts']={**counts,'uniqueSmnnCodes':len(codes['smnn']),'uniqueKlpCodes':len(codes['klp']),'flaggedRows':flags}
    (ROOT/'esklp-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(manifest['counts']),flush=True)

if __name__=='__main__':prepare(Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'raw/esklp/esklp_20261016_excel_00001.zip')
