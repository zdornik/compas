#!/usr/bin/env python3
"""Normalize the original GRLS workbook export without treating it as instructions."""
from pathlib import Path
import datetime, hashlib, io, json, re, zipfile
import openpyxl
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'knowledge'

def normalized(value):
    return re.sub(r'\s+', ' ', str(value or '').replace('\u00a0', ' ').strip())
def key(value):
    return normalized(value).casefold().replace('ё', 'е')

def main():
    archive = OUT / 'raw/grls/registry.zip'
    if not archive.exists():
        raise SystemExit('Download the official GRLS export first')
    source_hash = hashlib.sha256(archive.read_bytes()).hexdigest()
    (OUT / 'processed').mkdir(exist_ok=True)
    substances = {}
    statuses = {}
    count = 0
    with zipfile.ZipFile(archive) as z, (OUT / 'processed/grls-products.jsonl').open('w',encoding='utf-8') as output:
        for name in z.namelist():
            if not name.endswith('.xlsx'):
                continue
            wb = openpyxl.load_workbook(io.BytesIO(z.read(name)), read_only=True, data_only=True)
            status = name.split('-1-',1)[1][:-5].replace('_',' ')
            rows = 0
            for values in wb.active.iter_rows(min_row=7, values_only=True):
                if len(values)<14 or not normalized(values[2]) or not normalized(values[8]):
                    continue
                reg, trade, inn, form = [normalized(values[i]) for i in (2,8,9,10)]
                if not reg or reg in ('Действующий','Изменённый','Исключённый','Истёкший'):
                    continue
                identity = json.dumps([status, *[normalized(value) for value in values]], ensure_ascii=False)
                source_id = hashlib.sha256(identity.encode()).hexdigest()
                item = {'id': 'grls:'+source_id, 'registrationNumber': reg, 'tradeName': trade, 'inn': inn,
                        'form': form, 'status': status, 'registeredAt': normalized(values[3]),
                        'expiresAt': normalized(values[4]), 'annulledAt': normalized(values[5]),
                        'holder': normalized(values[6]), 'country': normalized(values[7]),
                        'pharmacotherapeuticGroup': normalized(values[13]),
                        'sourceId': 'grls', 'sourceSha256':source_hash,'sourceWorkbook': name,
                        'instructionStatus':'not_fetched', 'mappingStatus':'source_name_only'}
                output.write(json.dumps(item,ensure_ascii=False)+'\n')
                count+=1; rows+=1
                if inn and inn not in ('~','-','Нет','Не указано') and len(inn)>2:
                    # A GRLS grouping/composition is not silently split into invented ingredients.
                    norm=key(inn)
                    substances.setdefault(norm, {'id':'inn:'+hashlib.sha256(norm.encode()).hexdigest()[:24], 'nameRu':inn,
                         'normalizedName':norm,'sourceId':'grls','kind':'registry_inn_or_group_name',
                         'componentMappingStatus':'unreviewed','aliases':[]})
            statuses[status]=rows
            print(status,rows,flush=True)
            wb.close()
    (OUT/'processed/grls-substances.json').write_text(json.dumps(list(substances.values()),ensure_ascii=False),encoding='utf-8')
    manifest={'sourceId':'grls','sourceUrl':(OUT/'raw/grls/source-url.txt').read_text().strip(),
              'landingUrl':'https://grls.minzdrav.gov.ru/grls.aspx', 'sha256':source_hash,'snapshotDate':re.search(r'grls(\d{4}-\d{2}-\d{2})', name).group(1),
              'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'products':count,
              'innOrGroupingNames':len(substances), 'statuses':statuses,'instructionFiles':0,
              'limitation':'Registry metadata is not an instruction corpus. Statuses and grouping names are preserved exactly.'}
    (OUT/'grls-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    print('Products',count,'INN/group names',len(substances),flush=True)

if __name__=='__main__': main()
