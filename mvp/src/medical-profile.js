import { dayKey } from './domain.js';
const clean=(value,max,label)=>{if(typeof value!=='string'||value.trim().length>max)throw new Error(label);return value.trim();};
const content=row=>({id:row.id,name:row.name,details:row.details||'',...(Object.hasOwn(row,'productId')?{productId:row.productId||null}:{icd10:row.icd10||null})});
export function makeMedicalProfile(input,previous=null,now=new Date(),actor={type:'patient'}) {
 if(input.id!=='medical-profile'||input.type!=='medical-profile'||(previous&&previous.type!=='medical-profile'))throw new Error('Некорректный медицинский профиль');
 if(!Array.isArray(input.medications)||!Array.isArray(input.conditions)||input.medications.length>80||input.conditions.length>80)throw new Error('Не более 80 препаратов и 80 заболеваний');
 const medications=input.medications.map(item=>({id:clean(item.id,80,'Некорректный препарат'),name:clean(item.name,120,'Название до 120 символов'),details:clean(item.details||'',500,'Описание до 500 символов'),productId:item.productId?clean(item.productId,100,'Некорректная ссылка на реестр'):null}));
 const conditions=input.conditions.map(item=>({id:clean(item.id,80,'Некорректное заболевание'),name:clean(item.name,250,'Название до 250 символов'),details:clean(item.details||'',500,'Описание до 500 символов'),icd10:item.icd10?clean(item.icd10,10,'Некорректный код МКБ-10'):null}));
 if([...medications,...conditions].some(item=>!item.id||!item.name)||new Set([...medications,...conditions].map(item=>item.id)).size!==medications.length+conditions.length)throw new Error('Укажите названия без повторяющихся идентификаторов');
 const config={medications,conditions},oldContent=previous?{medications:previous.medications.map(row=>content({...row,productId:row.productId||null})),conditions:previous.conditions.map(row=>content({...row,icd10:row.icd10||null}))}:null;
 if(previous&&JSON.stringify(config)===JSON.stringify(oldContent))return previous;
 if(input.expectedRevision!==(previous?.revision||0))throw Object.assign(new Error('Профиль изменён в другом окне. Перечитайте его перед сохранением'),{status:409});
 const annotate=(items,kind)=>items.map(row=>{const before=previous?.[kind].find(old=>old.id===row.id);return {...row,source:before&&JSON.stringify(content({...before,...(kind==='medications'?{productId:before.productId||null}:{icd10:before.icd10||null})}))===JSON.stringify(row)?before.source||{type:'patient'}:{...actor,at:now.toISOString()}};});
 return {id:'medical-profile',type:'medical-profile',medications:annotate(medications,'medications'),conditions:annotate(conditions,'conditions'),revision:(previous?.revision||0)+1,history:previous?[...(previous.history||[]),{revision:previous.revision,medications:previous.medications,conditions:previous.conditions,updatedAt:previous.updatedAt,updatedBy:previous.updatedBy||{type:'patient'}}]:[],updatedBy:actor,day:dayKey(now),at:now.toISOString(),updatedAt:now.toISOString(),createdAt:previous?.createdAt||now.toISOString()};
}
export const emptyMedicalProfile=()=>({id:'medical-profile',type:'medical-profile',expectedRevision:0,medications:[],conditions:[]});
