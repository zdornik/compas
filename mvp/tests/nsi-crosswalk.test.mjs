import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildNsiCrosswalk} from '../server/nsi-crosswalk.mjs';
import {isEsklpCode,esklpProduct} from '../server/esklp.mjs';
const substances=[{id:'inn:test',nameRu:'Точное вещество'}],term={code:'123',name_ru:'Точное вещество',name_en:'Exact ingredient',group:'1',alternatives:[]},drug={id:'DDInter-test',name:'Exact ingredient',rxcui:'12345',rxnorm_name:'Exact ingredient'};
test('NSI exact primary chemical name resolves independently of a PDF and keeps its code',()=>{
 const result=buildNsiCrosswalk(substances,[term],[drug]);assert.equal(result.links.length,1);assert.deepEqual(result.links[0].nsiCodes,['123']);assert.equal(result.links[0].providerId,drug.id);
});
test('NSI alternatives, herbal groups, missing English names and conflicting official names do not create provider IDs',()=>{
 for(const change of [{name_ru:'Другое',alternatives:['Точное вещество']},{group:'4'},{name_en:null}])assert.equal(buildNsiCrosswalk(substances,[{...term,...change}],[drug]).links.length,0);
 const conflict=buildNsiCrosswalk(substances,[term],[drug],[],[{name_ru:term.name_ru,name_en:'Different chemical'}]);assert.equal(conflict.links.length,0);assert.equal(conflict.gaps[0].reason,'official_naming_sources_disagree');
 assert.equal(buildNsiCrosswalk(substances,[term],[{...drug,rxnorm_name:'Exact ingredient hydrochloride'}]).links.length,0);
});
test('ESKLP codes retain every identifier component and an empty catalog does not imply a DDI mapping',async()=>{
 assert.ok(isEsklpCode('21.20.10.235-000008-1-00136-2000001419629'));assert.equal(isEsklpCode('2000001419629'),false);
 assert.equal(await esklpProduct({query:async()=>({rows:[{total:0}]})},'grls:synthetic'),null);
});
