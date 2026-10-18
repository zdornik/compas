#!/usr/bin/env python3
"""Restrict instruction downloads to an inspectable psychiatry research scope.
GRLS pharmacotherapeutic groups provide source classification; this is not a prescribing formulary.
Historical rows can supply a missing group name, but are never download targets.
"""
from pathlib import Path
import json,re,datetime,hashlib,argparse,collections
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'knowledge'
ACTIVE={'Действующий','Выдано по правилам ЕАЭС','Действует на подтверждении государственной регистрации','Действует в иностранных упаковках'}
GROUP=re.compile(r'^(?:антипсихот|нейролепт|антидепрессант|антидепрессивн|анксиолит|транквилиз|снотворн|нормотим)|^(?:психолепт|психоаналепт|психотропн).*(?:антипсихот|анксиолит|антидепресс|снотворн|деменц|лития)',re.I)
# Explicit extensions cover named medicines outside the core psycholeptic/psychoanaleptic groups.
# They define collection scope only; no indication, efficacy or safety is inferred.
EXTRA={
 'Вальпроевая кислота':'нормотимики: отдельный отбор', 'Натрия вальпроат':'нормотимики: отдельный отбор',
 'Карбамазепин':'нормотимики: отдельный отбор', 'Ламотриджин':'нормотимики: отдельный отбор',
 'Окскарбазепин':'нормотимики: отдельный отбор', 'Прегабалин':'отдельный отбор для психиатрического корпуса',
 'Габапентин':'отдельный отбор для психиатрического корпуса', 'Топирамат':'отдельный отбор для психиатрического корпуса',
 'Лития карбонат':'препараты лития', 'Мелатонин':'средства для сна',
 'Бипериден':'корректоры экстрапирамидных нарушений: отдельный отбор',
 'Тригексифенидил':'корректоры экстрапирамидных нарушений: отдельный отбор',
 'Дисульфирам':'средства для лечения зависимостей', 'Налтрексон':'средства для лечения зависимостей',
 'Налмефен':'средства для лечения зависимостей', 'Акампросат':'средства для лечения зависимостей',
 'Цианамид':'средства для лечения зависимостей', 'Никотин':'средства для лечения зависимостей',
 'Цитизин':'средства для лечения зависимостей', 'Варениклин':'средства для лечения зависимостей',
 'Донепезил':'средства для лечения деменции', 'Галантамин':'средства для лечения деменции',
 'Ривастигмин':'средства для лечения деменции', 'Мемантин':'средства для лечения деменции',
 'Атомоксетин':'отдельный отбор для психиатрического корпуса',
 'Аминофенилмасляная кислота':'отдельный отбор для психиатрического корпуса',
 'фенибут':'отдельный отбор для психиатрического корпуса',
 'Клоназепам':'отдельный отбор для психиатрического корпуса',
}
EXCLUDED={'дексмедетомидин','ипидакрин'}
def norm(value):return re.sub(r'\s+',' ',value.strip().lower().replace('ё','е'))
def date(value):
 try:return datetime.datetime.strptime(value,'%d.%m.%Y').date()
 except (ValueError,TypeError):return datetime.date.min
def atomic(path,value):
 path.parent.mkdir(parents=True,exist_ok=True);temp=path.with_suffix('.tmp');temp.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8');temp.replace(path)
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
 rows=[json.loads(line) for line in (OUT/'processed/grls-products.jsonl').read_text().splitlines() if line.strip()]
 classified={norm(name):{'name':name,'reason':reason,'classification':'explicit_collection_scope'} for name,reason in EXTRA.items()}
 for row in rows:
  name=row.get('inn','');group=row.get('pharmacotherapeuticGroup','').strip()
  if name and name not in ('~','-','Не указано') and GROUP.search(group):classified[norm(name)]={'name':name,'reason':group,'classification':'grls_pharmacotherapeutic_group'}
 snapshot=json.loads((OUT/'grls-manifest.json').read_text()).get('snapshotDate')
 snapshot_date=datetime.date.fromisoformat(snapshot)
 selected={};rejected=collections.Counter()
 for row in rows:
  if norm(row.get('inn','')) not in classified or norm(row.get('inn','')) in EXCLUDED:continue
  if row['status'] not in ACTIVE:rejected['historical_or_suspended']+=1;continue
  if row.get('annulledAt') and date(row['annulledAt'])<=snapshot_date:rejected['annulled']+=1;continue
  if row.get('expiresAt') and date(row['expiresAt'])<snapshot_date:rejected['expired']+=1;continue
  reg=row['registrationNumber']
  if reg not in selected or date(row.get('registeredAt'))>date(selected[reg].get('registeredAt')):selected[reg]=row
 targets=[]
 for row in selected.values():
  scope=classified[norm(row['inn'])];targets.append({**row,'instructionStatus':'not_fetched','mappingStatus':'source_name_only','collectionScope':'psychiatry','scopeReason':scope['reason']})
 names=sorted(set(row['inn'] for row in targets));manifest={'id':'psychiatry-v1','scope':'psychiatry','label':'Психиатрия: психотропные препараты и явно перечисленные дополнительные МНН',
 'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'registrySnapshot':snapshot,'targetRegistrations':len(targets),'registryNames':len(names),
 'selectionMethod':'GRLS core pharmacotherapeutic group, or explicit named collection scope; current status categories and dates, one target per registration number',
 'limitations':'Collection scope only, not a verified clinical formulary or a statement of approved indications. Combination names are preserved as given by GRLS. No ATC code is inferred for a GRLS row.',
 'groupPattern':GROUP.pattern,'explicitExtensions':EXTRA,'excludedNames':sorted(EXCLUDED),'selectedNames':[classified[norm(name)] for name in names],'rejectedRows':dict(rejected)}
 print(json.dumps({'targetRegistrations':len(targets),'registryNames':len(names),'names':names},ensure_ascii=False,indent=2))
 if args.apply:
  previous=OUT/'processed/instruction-targets.json'
  if previous.exists():
   value=json.loads(previous.read_text());key=hashlib.sha256(previous.read_bytes()).hexdigest()[:12]
   backup=OUT/'archive'/f'instruction-targets-{key}.json'
   if not backup.exists():atomic(backup,value)
  atomic(previous,targets);atomic(OUT/'psychiatry-scope.json',manifest)
if __name__=='__main__':main()
