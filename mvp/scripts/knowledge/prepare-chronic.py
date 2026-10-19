#!/usr/bin/env python3
"""Expand official instruction coverage by source GRLS groups, one RU per INN first.
No drug identity, indication, treatment priority or interchangeability is inferred.
"""
from pathlib import Path
import argparse,collections,datetime,hashlib,json,re
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'knowledge'
ACTIVE={'Действующий','Выдано по правилам ЕАЭС','Действует на подтверждении государственной регистрации','Действует в иностранных упаковках'}
def norm(s):return re.sub(r'\s+',' ',s.strip().lower().replace('ё','е'))
def date(s):
 try:return datetime.datetime.strptime(s,'%d.%m.%Y').date()
 except (ValueError,TypeError):return datetime.date.min
def atomic(path,data):
 path.parent.mkdir(parents=True,exist_ok=True);temp=path.with_suffix('.tmp');temp.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8');temp.replace(path)
def prepare(rows,registry,config):
 patterns=[(g,re.compile(g['pattern'],re.I)) for g in config['groups']];by_name={}
 for row in rows:
  name=row.get('inn','');group=row.get('pharmacotherapeuticGroup','').strip()
  if not name or name in ('~','-','Не указано') or re.search('субстанц',row.get('form',''),re.I):continue
  matches=[g for g,p in patterns if p.search(group)]
  if matches:
   entry=by_name.setdefault(norm(name),{'name':name,'groups':{},'evidence':set()})
   entry['groups'].update({g['id']:g for g in matches});entry['evidence'].add(group)
 today=datetime.date.fromisoformat(registry['snapshotDate']);current={}
 for row in rows:
  if norm(row.get('inn','')) not in by_name or row['status'] not in ACTIVE or re.search('субстанц',row.get('form',''),re.I):continue
  if row.get('annulledAt') and date(row['annulledAt'])<=today:continue
  if row.get('expiresAt') and date(row['expiresAt'])<today:continue
  reg=row['registrationNumber']
  if reg not in current or date(row.get('registeredAt'))>date(current[reg].get('registeredAt')):current[reg]=row
 # Breadth first. Prioritize the user's explicit examples, then source groups.
 priority={norm(n):i for i,n in enumerate(['Аллопуринол','Аторвастатин','Розувастатин','Симвастатин','Питавастатин','Правастатин','Ловастатин','Флувастатин'])}
 all_rows=sorted(current.values(),key=lambda r:(priority.get(norm(r['inn']),100),norm(r['inn']),-date(r.get('registeredAt')).toordinal(),r['registrationNumber']))
 selected={}
 for row in all_rows:selected.setdefault(norm(row['inn']),row)
 targets=[];names=[];aliases=[];counts=collections.Counter()
 for key,row in selected.items():
  info=by_name[key];groups=sorted(info['groups']);counts.update(groups)
  names.append({'name':row['inn'],'groups':groups,'sourceGroups':sorted(info['evidence'])})
  targets.append({**row,'collectionScope':'chronic','scopeReason':'; '.join(sorted(info['evidence'])),'instructionStatus':'not_fetched'})
  for alias in sorted({a for g in info['groups'].values() for a in g['aliases']}):aliases.append({'name':row['inn'],'alias':alias,'sourceGroups':sorted(info['evidence'])})
 manifest={'id':'chronic-v1','scope':'chronic','label':'Расширение инструкций для хронических заболеваний','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'registrySnapshot':registry['snapshotDate'],'registrySha256':registry['sha256'],'targetRegistrations':len(targets),'eligibleRegistrations':len(current),'registryNames':len(names),'selectionMethod':'Exact full GRLS INN, literal source pharmacotherapeutic group; current statuses/dates; newest registration per INN for the first breadth pass','limitations':'Collection/search scope only; not approved indications, recommended therapy, automatic disease matching or PDF interchangeability. Other trade names remain searchable and use their own instruction links. Compositions/provider identities unchanged.','groups':[{**g,'registryNames':counts[g['id']]} for g in config['groups']],'selectedNames':names}
 return targets,manifest,aliases
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
 config_path=ROOT/'scripts/knowledge/chronic-groups.json';registry=json.loads((OUT/'grls-manifest.json').read_text())
 targets,manifest,aliases=prepare([json.loads(x) for x in (OUT/'processed/grls-products.jsonl').read_text().splitlines() if x.strip()],registry,json.loads(config_path.read_text()))
 manifest['configurationSha256']=hashlib.sha256(config_path.read_bytes()).hexdigest()
 print(json.dumps({k:manifest[k] for k in ['targetRegistrations','eligibleRegistrations','registryNames','groups']},ensure_ascii=False,indent=2))
 if args.apply:
  atomic(OUT/'processed/instruction-targets-chronic.json',targets);atomic(OUT/'chronic-scope.json',manifest);atomic(OUT/'processed/chronic-search-aliases.json',aliases)
if __name__=='__main__':main()
