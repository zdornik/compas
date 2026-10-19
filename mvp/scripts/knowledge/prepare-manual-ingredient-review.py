#!/usr/bin/env python3
"""Explicit human-readable review decisions, no name-based DDI inference."""
import json,hashlib
from pathlib import Path
K=Path('knowledge');load=lambda p:json.loads((K/p).read_text())
gaps=load('eaeu-provider-crosswalk.json')['psychiatryGaps'];kb=load('raw/openmrs/kb.json');sources=load('raw/manual/sources.json');manifest=load('openmrs-manifest.json')
# These are display descriptions, not internationally assigned INNs or provider mappings.
DESCRIPTIVE={
'Валерианы лекарственной корневища с корнями':'Valerian rhizomes and roots',
'Валерианы лекарственной корневищ с корнями экстракт':'Valerian rhizome and root extract',
'Валерианы лекарственной корневищ с корнями настойка':'Valerian rhizome and root tincture',
'Валерианы лекарственной корневища с корнями настойка':'Valerian rhizome and root tincture',
'Пустырника трава':'Motherwort herb','Пустырника травы настойка':'Motherwort herb tincture','Пустырника травы экстракт':'Motherwort herb extract',
'Пиона уклоняющегося трава, корневища и корни':'Paeonia anomala herb, rhizomes and roots',
'Пиона уклоняющегося трава, корневища и корни настойка':'Paeonia anomala herb, rhizome and root tincture',
'Пиона уклоняющегося травы, корневищ и корней настойка':'Paeonia anomala herb, rhizome and root tincture',
'Пиона уклоняющегося [корневищ и корней + травы] экстракт':'Paeonia anomala rhizome, root and herb extract',
'Пиона уклоняющегося [корневищ и корней+травы] настойка':'Paeonia anomala rhizome, root and herb tincture',
'Пиона уклоняющегося трава+Пиона уклоняющегося корневища и корни':'Paeonia anomala herb + Paeonia anomala rhizomes and roots',
'Гинкго двулопастного листьев экстракт':'Ginkgo biloba leaf extract','Зверобоя травы экстракт':"St. John's wort herb extract",
'Пассифлоры инкарнатной травы экстракт':'Passiflora incarnata herb extract',
'Валерианы лекарственной корневищ с корнями настойка+Ландыша травы настойка':'Valerian rhizome and root tincture + Lily-of-the-valley herb tincture',
'Мелиссы лекарственной листьев экстракт+Мяты перечной листьев масло+Пустырника травы экстракт':'Lemon balm leaf extract + Peppermint leaf oil + Motherwort herb extract',
'Мяты перечной листьев масло+Фенобарбитал+Этилбромизовалерианат':'Peppermint leaf oil + Phenobarbital + Ethyl bromisovalerate',
'Валерианы лекарственной корневищ с корнями экстракт+Мелиссы лекарственной листьев экстракт+Мяты перечной листьев экстракт':'Valerian rhizome and root extract + Lemon balm leaf extract + Peppermint leaf extract',
'Мяты перечной листьев масло+Пустырника травы настойка+Этилбромизовалерианат':'Peppermint leaf oil + Motherwort herb tincture + Ethyl bromisovalerate',
'Фенобарбитал+Этилбромизовалерианат':'Phenobarbital + Ethyl bromisovalerate',
'Дифенгидрамин+Мяты перечной листьев масло+Пустырника травы настойка+Этилбромизовалерианат':'Diphenhydramine + Peppermint leaf oil + Motherwort herb tincture + Ethyl bromisovalerate',
'Мелатонин+Мяты перечной листьев масло+Пустырника травы экстракт':'Melatonin + Peppermint leaf oil + Motherwort herb extract',
'Глицин+Мелатонин':'Glycine + Melatonin',
'Ландыша травы настойка+Пустырника травы настойка':'Lily-of-the-valley herb tincture + Motherwort herb tincture',
'Красавки листьев настойка+Валерианы лекарственной корневищ с корнями настойка+Ландыша травы настойка+[Левоментол]':'Belladonna leaf tincture + Valerian rhizome and root tincture + Lily-of-the-valley herb tincture + Levomenthol',
'Мяты перечной листьев масло+Пустырника травы экстракт+Этилбромизовалерианат':'Peppermint leaf oil + Motherwort herb extract + Ethyl bromisovalerate',
'Боярышника цветков экстракт+Магния оксид+Эшшольции цветков экстракт':'Hawthorn flower extract + Magnesium oxide + California poppy flower extract',
'Валерианы лекарственной корневищ с корнями настойка+Красавки листьев настойка+Ландыша травы настойка+Натрия бромид+[Левоментол]':'Valerian rhizome and root tincture + Belladonna leaf tincture + Lily-of-the-valley herb tincture + Sodium bromide + Levomenthol',
'Красавки листьев и травы сумма алкалоидов+Фенобарбитал+Эрготамин':'Belladonna leaf and herb total alkaloids + Phenobarbital + Ergotamine',
'Боярышника плодов настойка+Валерианы лекарственной корневищ с корнями настойка+Левоментол+Натрия бромид':'Hawthorn fruit tincture + Valerian rhizome and root tincture + Levomenthol + Sodium bromide',
'Белладонны настойка+Валерианы лекарственной корневищ с корнями настойка+Ландыша травы настойка+[Левоментол]':'Belladonna tincture + Valerian rhizome and root tincture + Lily-of-the-valley herb tincture + Levomenthol',
'Пустырника травы экстракт+[Магния аспарагинат+Пиридоксин]':'Motherwort herb extract + Magnesium aspartate + Pyridoxine',
'Амид N-(6-фенилгексаноил)глицил-L-триптофана':'N-(6-phenylhexanoyl)glycyl-L-tryptophanamide (composition description)'}
ALIASES={
'Бромкамфора':('bromocamphor','https://pubchem.ncbi.nlm.nih.gov/compound/camphor_-monobromated'),
'Аминофенилмасляная кислота':('aminophenylbutyric acid (phenibut)','https://pubchem.ncbi.nlm.nih.gov/compound/14113'),
'фенибут':('phenibut','https://pubchem.ncbi.nlm.nih.gov/compound/14113'),
'Бромдигидрохлорфенилбензодиазепин':('phenazepam','https://pubchem.ncbi.nlm.nih.gov/compound/40113'),
'Гидразинокарбонилметилбромфенилдигидробенздиазепин':('gidazepam','https://pubchem.ncbi.nlm.nih.gov/compound/121919'),
'Темгиколурил':('temgicoluril (mebicar)','https://gsrs.ncats.nih.gov/ginas/app/ui/substances/ed077ec7-8d79-4a25-ba3c-79a517666139'),
'Цианамид':('cyanamide','https://pubchem.ncbi.nlm.nih.gov/compound/Cyanamide'),
'Цитизин':('cytisine','https://atcddd.fhi.no/atc_ddd_index/?code=N07BA04'),
'Маритупирдин':('maritupirdine','https://pubmed.ncbi.nlm.nih.gov/41255319/')}
LINKS={
'Лития карбонат':('lithium carbonate',[('Лития карбонат','lithium carbonate','DDInter1081','exact')],['lithium-carbonate']),
'Левомепромазин':('levomepromazine',[('Левомепромазин','levomepromazine','DDInter1175','exact')],['levomepromazine']),
'Вальпроевая кислота':('valproic acid',[('Вальпроевая кислота','valproic acid','DDInter1913','reviewed_active_moiety')],['valproic-acid']),
'Никотин':('nicotine',[('Никотин','nicotine','DDInter1290','reviewed_active_moiety')],['nicotine']),
'Валерианы лекарственной корневищ с корнями экстракт':('valerian root and rhizome extract',[('Валерианы лекарственной корневищ с корнями экстракт','valerian root extract','DDInter1911','exact')],['valerian']),
'Гинкго двулопастного листьев экстракт':('ginkgo biloba leaf extract',[('Гинкго двулопастного листьев экстракт','ginkgo biloba leaf extract','DDInter819','exact')],['ginkgo']),
'Донепезил+Мемантин':('donepezil + memantine',[('Донепезил','donepezil','DDInter583','reviewed_active_moiety'),('Мемантин','memantine','DDInter1146','reviewed_active_moiety')],[]),
'Дифенгидрамин+Мелатонин':('diphenhydramine + melatonin',[('Дифенгидрамин','diphenhydramine','DDInter569','reviewed_active_moiety'),('Мелатонин','melatonin','DDInter1142','exact')],[])}
# The complete active-ingredient list is inspected from the original GRLS text,
# not inferred by splitting '+' for any other combination.
documents={}
for p in (K/'processed/instructions').glob('*.json'):
 d=json.loads(p.read_text());name=d['title'].split(' · ')[-1];text=' '.join(page.get('text','') for page in d.get('pages',[]))
 if name in LINKS and len(text)>500 and (name not in documents or len(text)>documents[name][1]):documents[name]=(d,len(text))
reviews=[]
for gap in gaps:
 name=gap['nameRu'];en=gap['nameEn'];kind='official_inn' if en else 'unresolved';evidence=[{'kind':'pinned_provider_snapshot','sha256':manifest['sha256'],'commit':manifest['commit']}];components=[]
 if name in DESCRIPTIVE:en=DESCRIPTIVE[name];kind='descriptive';evidence.append({'kind':'manual_display_description','source':'Exact GRLS grouping name; descriptive translation only, not an INN identity decision'})
 if name in ALIASES:
  en,url=ALIASES[name];kind='reviewed_synonym' if en else 'unresolved'
  if url:evidence.append({'kind':'primary_synonym_reference','url':url})
 status='composition_incomplete' if gap['reason']=='composition_requires_component_review' else 'absent_from_snapshot'
 note='В закреплённой выгрузке нет подтверждённого ID для этого МНН или проверенного синонима.'
 if status=='composition_incomplete':note='Английское описание сохраняет весь заявленный состав. Полного соответствия всех компонентов в базе нет; состав не подменяется одним веществом.'
 if 'Валериан' in name or name=='Зверобоя травы экстракт':status='form_unresolved';note='В базе есть общее растительное название, но оно не подтверждает именно эту форму, часть растения и состав. Сырьё, настойка и экстракт не объявлены одинаковыми.'
 if name=='Галантамин':status='source_conflict';note='Конфликт upstream: DDInter802 назван Galantamine, но RxNorm указывает benzgalantamine и ATC N06DA06. Для galantamine официальный ATC N06DA04. Автоматическое соответствие заблокировано.';evidence.append({'kind':'primary_identity_conflict','url':sources['galantamine']['url'],'sha256':sources['galantamine'].get('sha256')})
 if name in LINKS:
  en,parts,refs=LINKS[name];kind='reviewed_synonym';status='linked';note='Ручная проверка полного МНН, оригинальной инструкции и исходного ID; это справочная идентичность, не клинический допуск.'
  document=documents[name][0];evidence.append({'kind':'grls_full_composition','documentId':document['id'],'sourceUrl':document['sourceUrl'],'sha256':document['sha256']})
  for ref in refs:
   assert sources[ref].get('sha256'),f'Missing primary source {ref}'
   evidence.append({'kind':'primary_identity_reference',**sources[ref]})
  if name=='Левомепромазин':assert all(word.lower() in (K/'raw/manual'/sources['levomepromazine']['file']).read_text().lower() for word in ['Levomepromazine','Methotrimeprazine'])
  for ru,english,provider,relation in parts:
   drug=next(d for d in kb['drugs'] if d['id']==provider)
   components.append({'nameRu':ru,'nameEn':english,'providerId':provider,'providerName':drug['name'],'relation':relation})
  if name in ['Никотин','Вальпроевая кислота']:note+=' Сверено исходное имя DDInter; солевая/анионная подпись RxNorm сохранена отдельно, без пересчёта доз.'
  if name in ['Гинкго двулопастного листьев экстракт','Валерианы лекарственной корневищ с корнями экстракт']:kind='descriptive';note+=' Соответствие растительному компоненту не утверждает одинаковую стандартизацию экстрактов; её проверяют по инструкции.'
 reviews.append({**gap,'nameEn':en,'translationKind':kind,'providerStatus':status,'components':components,'note':note,'evidence':evidence})
assert len(reviews)==67 and len({r['substanceId'] for r in reviews})==67
artifact={'reviewDate':'2026-10-19','reviewScope':'67 remaining psychiatry registry names after exact EAEU crosswalk','reviewType':'manual_source_identity_review_not_clinical_expert_certification','sourceSnapshotSha256':manifest['sha256'],'clinicalUseApproved':False,'counts':{status:sum(r['providerStatus']==status for r in reviews) for status in sorted({r['providerStatus'] for r in reviews})},'reviews':reviews}
(K/'manual-ingredient-review.json').write_text(json.dumps(artifact,ensure_ascii=False,indent=2)+'\n');print(json.dumps(artifact['counts']))
