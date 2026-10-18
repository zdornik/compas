#!/usr/bin/env python3
"""Snapshot the official catalogue; fetch only catalogue-discovered PDF revisions.
No patient data, LLM calls or inferred clinical recommendations.
Run with the bundled Python (pypdf). Re-running checks hashes and reuses originals.
"""
import argparse, concurrent.futures, datetime, hashlib, json, re, time, urllib.request
from pathlib import Path
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'knowledge'
BASE = 'https://apicr.minzdrav.gov.ru/api.ashx'
CATALOG_URL = BASE + '?op=GetJsonClinrecsFilterV2'
AGENT = 'CompassResearch/0.1 (local non-commercial reference archive)'

def get(url, body=None):
    request = urllib.request.Request(url, data=body, headers={'User-Agent': AGENT, **({'Content-Type': 'application/json'} if body else {})})
    last_error = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                if response.geturl().split('/')[2] != 'apicr.minzdrav.gov.ru':
                    raise ValueError('Unexpected source redirect')
                return response.read()
        except Exception as error:
            last_error = error
            time.sleep(2 + attempt * 3)
    raise last_error

def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(path)

def fetch_one(record):
    key = record['CodeVersion']
    if not re.fullmatch(r'\d+_\d+', key):
        raise ValueError('Invalid catalogue document identifier')
    path = OUT / 'raw' / 'clinical' / (key + '.pdf')
    path.parent.mkdir(parents=True, exist_ok=True)
    url = BASE + '?op=GetClinrecPdf&id=' + key
    if not path.exists():
        data = get(url)
        if not data.startswith(b'%PDF-'):
            raise ValueError('Source did not return a PDF for ' + key)
        temporary = path.with_suffix('.pdf.tmp')
        temporary.write_bytes(data)
        temporary.replace(path)
    checksum = hashlib.sha256(path.read_bytes()).hexdigest()
    reader = PdfReader(path)
    pages = [{'page': index + 1, 'text': re.sub(r'[\ud800-\udfff]', '\ufffd', page.extract_text() or '')} for index, page in enumerate(reader.pages)]
    if not pages or sum(len(page['text'].strip()) for page in pages) < 200:
        raise ValueError('PDF needs OCR: ' + key)
    item = {
        'id': 'cr:' + key, 'sourceId': 'minzdrav-cr', 'kind': 'clinical_recommendation',
        'title': record['Name'], 'externalId': key, 'version': str(record['Version']),
        'sourceUrl': url, 'landingUrl': 'https://cr.minzdrav.gov.ru/view-cr/' + key,
        'sha256': checksum, 'filePath': str(path.relative_to(ROOT)), 'mimeType': 'application/pdf',
        'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'publicationDate': record.get('PublishDateStr'), 'sourceStatus': 'Применяется',
        'ageCategory': record.get('AgeCategoryStr'), 'icd10': sorted({m['MkbCode'] for m in record.get('Mkbs', [])}),
        'reviewStatus': 'source_document', 'clinicalUseApproved': False,
        'metadata': record, 'pages': pages,
    }
    atomic_json(OUT / 'processed' / 'clinical' / (key + '.json'), item)
    return {'id': item['id'], 'title': item['title'], 'pages': len(pages), 'sha256': checksum}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--scope', choices=['psychiatry', 'all'], default='psychiatry')
    args = parser.parse_args()
    request = {'filters': [{'fieldName': 'status', 'filterType': 1, 'filterValueType': 2, 'value1': 0, 'value2': '', 'values': []}], 'sortOption': {'fieldName': 'publishdate', 'sortType': 2}, 'pageSize': 1000, 'currentPage': 1, 'useANDoperator': True, 'columns': []}
    data = json.loads(get(CATALOG_URL, json.dumps(request).encode()))
    records = data.get('Data', [])
    if len(records) != data.get('TotalRecords'):
        raise ValueError('Catalogue is paginated or incomplete; refusing a false complete snapshot')
    atomic_json(OUT / 'raw' / 'clinical-catalog.json', data)
    selected = [row for row in records if row.get('ApplyStatusCalculated') == 1 and (args.scope == 'all' or any(re.match(r'^F\d', item['MkbCode']) for item in row.get('Mkbs', [])))]
    manifest = {'catalogUrl': CATALOG_URL, 'scope': args.scope, 'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'catalogTotal': len(records), 'selectedTotal': len(selected), 'completed': [], 'errors': []}
    print(f'Official catalogue: {len(records)}; selected active documents: {len(selected)}', flush=True)
    # Two concurrent source requests at most; no identifier/version brute forcing.
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = {}
        for record in selected:
            futures[pool.submit(fetch_one, record)] = record
            time.sleep(.7)
        for future in concurrent.futures.as_completed(futures):
            record = futures[future]
            try:
                item = future.result()
                manifest['completed'].append(item)
                print(f"OK {item['id']}: {item['pages']} pages", flush=True)
            except Exception as error:
                manifest['errors'].append({'id': record['CodeVersion'], 'error': str(error)})
                print(f"FAILED {record['CodeVersion']}: {error}", flush=True)
            atomic_json(OUT / 'clinical-manifest.json', manifest)
    print(f"Completed {len(manifest['completed'])}/{len(selected)}", flush=True)
    if manifest['errors']:
        raise SystemExit(1)

if __name__ == '__main__':
    main()
