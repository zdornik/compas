import importlib.util,json,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('chronic_scope',ROOT/'scripts/knowledge/prepare-chronic.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
CONFIG={'groups':[{'id':'test','label':'Source class','pattern':'исходная группа','aliases':['поисковая группа']} ]}
REGISTRY={'snapshotDate':'2026-10-16','sha256':'a'*64}
def row(**extra):
 return {'inn':'Точное название','registrationNumber':'РУ-1','pharmacotherapeuticGroup':'исходная группа','form':'таблетки','status':'Действующий','registeredAt':'01.01.2020','expiresAt':'','annulledAt':'',**extra}
class ChronicScopeTests(unittest.TestCase):
 def test_source_group_matches_full_inn_without_splitting_compositions(self):
  targets,manifest,aliases=module.prepare([row(inn='Компонент А+Компонент Б')],REGISTRY,CONFIG)
  self.assertEqual(targets[0]['inn'],'Компонент А+Компонент Б');self.assertEqual(manifest['registryNames'],1);self.assertEqual(aliases[0]['name'],targets[0]['inn'])
 def test_historical_group_can_describe_current_missing_label_but_is_not_a_target(self):
  rows=[row(status='Аннулирован'),row(registrationNumber='РУ-2',pharmacotherapeuticGroup='~',registeredAt='01.01.2026')]
  targets,manifest,_=module.prepare(rows,REGISTRY,CONFIG);self.assertEqual([t['registrationNumber'] for t in targets],['РУ-2']);self.assertEqual(manifest['eligibleRegistrations'],1)
 def test_expired_annulled_and_pharmaceutical_substances_are_excluded(self):
  rows=[row(expiresAt='01.01.2020'),row(annulledAt='01.01.2020'),row(form='субстанция')]
  self.assertEqual(module.prepare(rows,REGISTRY,CONFIG)[0],[])
 def test_first_pass_is_breadth_first_without_reusing_another_registration_pdf(self):
  targets,manifest,_=module.prepare([row(),row(registrationNumber='РУ-2',registeredAt='01.01.2026')],REGISTRY,CONFIG)
  self.assertEqual(len(targets),1);self.assertEqual(targets[0]['registrationNumber'],'РУ-2');self.assertEqual(manifest['eligibleRegistrations'],2)
 def test_name_similarity_does_not_establish_a_source_group(self):
  self.assertEqual(module.prepare([row(inn='исходная группа',pharmacotherapeuticGroup='~')],REGISTRY,CONFIG)[0],[])
 def test_specific_class_aliases_do_not_include_neighboring_classes(self):
  config=json.loads((ROOT/'scripts/knowledge/chronic-groups.json').read_text())
  _,_,aliases=module.prepare([row(inn='А',pharmacotherapeuticGroup='антацидное средство'),row(inn='Б',registrationNumber='РУ-2',pharmacotherapeuticGroup='протонного насоса ингибитор')],REGISTRY,config)
  self.assertEqual([a['name'] for a in aliases if a['alias']=='ипп'],['Б']);self.assertEqual([a['name'] for a in aliases if a['alias']=='антациды'],['А'])
if __name__=='__main__':unittest.main()
