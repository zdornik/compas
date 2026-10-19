import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildNsiCrosswalk} from '../../server/nsi-crosswalk.mjs';
const read=async p=>JSON.parse(await readFile('knowledge/'+p)),hash=value=>createHash('sha256').update(value).digest('hex');
const manifest=await read('nsi-drug-terms-manifest.json'),terms=await read(manifest.preparedFile),substances=await read('processed/grls-substances.json'),provider=await read('raw/openmrs/kb.json'),eaeu=await read('processed/eaeu-inn.json'),previous=await read('eaeu-provider-crosswalk.json'),manual=await read('manual-ingredient-review.json'),reviewed=await read('ingredient-source-links.json');
if(hash(await readFile('knowledge/'+manifest.preparedFile))!==manifest.preparedSha256)throw new Error('NSI checksum mismatch');
const existing=[...reviewed,...previous.links,...manual.reviews],result=buildNsiCrosswalk(substances,terms,provider.drugs,existing,eaeu);
const artifact={method:'exact_nsi_primary_name_provider_and_canonical_rxnorm',nsi:{oid:manifest.oid,version:manifest.version,sha256:manifest.preparedSha256,archiveSha256:manifest.archiveSha256},providerSha256:(await read('openmrs-manifest.json')).sha256,grlsSha256:hash(await readFile('knowledge/processed/grls-substances.json')),clinicalUseApproved:false,links:result.links,gapCounts:result.gaps.reduce((all,row)=>(all[row.reason]=(all[row.reason]||0)+1,all),{})};
await writeFile('knowledge/nsi-provider-crosswalk.json',JSON.stringify(artifact,null,2)+'\n');console.log(JSON.stringify({addedExactCandidates:result.links.length,examples:result.links.slice(0,8).map(row=>[row.nameRu,row.nameEn,row.providerId]),gaps:artifact.gapCounts}));
