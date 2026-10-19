import {catalogSuggestions,catalogSubstanceProducts} from './reference-catalog.mjs';
import {searchConditions} from './condition-search.mjs';
export async function referenceSearch(db,path,url,q){
 if(path==='/api/knowledge/conditions')return searchConditions(db,q);
 if(path==='/api/knowledge/suggestions')return catalogSuggestions(db,q);
 if(path==='/api/knowledge/substance-products'){
  const id=url.searchParams.get('id');if(!/^inn:[a-f0-9]{24}$/.test(id||''))throw Object.assign(new Error('Некорректное МНН'),{status:400});
  return catalogSubstanceProducts(db,id);
 }
 return null;
}
