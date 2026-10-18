#!/usr/bin/env python3
"""Discover the current official GRLS export link instead of hard-coding a GUID."""
from pathlib import Path
import urllib.request,urllib.parse,re,html,zipfile,json,hashlib,datetime
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'knowledge/raw/grls';OUT.mkdir(parents=True,exist_ok=True)
landing='https://grls.minzdrav.gov.ru/grls.aspx'
with urllib.request.urlopen(landing,timeout=45) as response:page=response.read().decode('utf-8')
match=re.search(r"go\('(GetGRLS\.ashx[^']+)",page)
if not match:raise SystemExit('Official export link is unavailable; do not substitute an unofficial registry')
url='https://grls.minzdrav.gov.ru/'+html.unescape(match.group(1))
with urllib.request.urlopen(url,timeout=90) as response:
 if urllib.parse.urlparse(response.geturl()).hostname!='grls.minzdrav.gov.ru':raise ValueError('Unexpected export host')
 data=response.read(100*1024*1024+1)
 if len(data)>100*1024*1024 or not data.startswith(b'PK'):raise ValueError('Invalid or oversized GRLS ZIP')
temporary=OUT/'registry.zip.tmp';temporary.write_bytes(data)
with zipfile.ZipFile(temporary) as archive:
 if not archive.namelist() or any(not name.endswith('.xlsx') for name in archive.namelist()):raise ValueError('Unexpected GRLS ZIP members')
temporary.replace(OUT/'registry.zip');(OUT/'source-url.txt').write_text(url)
(OUT/'download.json').write_text(json.dumps({'landingUrl':landing,'url':url,'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sha256':hashlib.sha256(data).hexdigest()},ensure_ascii=False,indent=2))
print('Official GRLS snapshot downloaded:',len(data),'bytes',flush=True)
