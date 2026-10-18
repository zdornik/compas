import http.cookiejar,urllib.request,urllib.parse,re
from html.parser import HTMLParser
from html import unescape
from pathlib import Path
class Form(HTMLParser):
 def __init__(self): super().__init__(); self.values={}
 def handle_starttag(self,tag,attrs):
  d=dict(attrs)
  if tag=='input' and d.get('type','').lower()=='hidden' and d.get('name'): self.values[d['name']]=d.get('value','')
jar=http.cookiejar.CookieJar(); opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
u='https://grls.minzdrav.gov.ru/grls.aspx'
with opener.open(u,timeout=30) as r:s=r.read().decode('utf-8')
f=Form();f.feed(s)
f.values.update({'ctl00$plate$isFS':'0','ctl00$plate$txtMNN':'Сертралин','ctl00$plate$txtRecordOnPageCount':'99','ctl00$plate$hfRegType':'1,6','ctl00$plate$ddlRegType':'1','ctl00$plate$bSeek':'Найти'})
req=urllib.request.Request(u,data=urllib.parse.urlencode(f.values).encode(),headers={'Content-Type':'application/x-www-form-urlencoded','Referer':u})
with opener.open(req,timeout=40) as r:s=r.read().decode('utf-8')
Path('knowledge/discovery/grls-sertraline-search.html').write_text(s)
s=unescape(s)
keys=re.findall(r"det\('([^']+)'[^)]*\)",s)
print('Registration cards',keys[:10],flush=True)
if keys:
 url='https://grls.minzdrav.gov.ru/Grls_View_v2.aspx?routingGuid='+keys[0]
 with opener.open(url,timeout=35) as r:s=r.read().decode('utf-8')
 Path('knowledge/discovery/grls-sertraline-card.html').write_text(s)
 print('Card',url,flush=True)
 for m in list(dict.fromkeys(re.findall(r'.{0,100}(?:\.pdf|FilePath|[Ии]нструкц|\.ashx|\.PDF|\.zip).{0,200}',s))): print(m,flush=True)
