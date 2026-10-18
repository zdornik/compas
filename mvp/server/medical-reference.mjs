export async function canonicalMedicalInput(db,input) {
 if(!input||!Array.isArray(input.medications)||!Array.isArray(input.conditions))throw Object.assign(new Error('Проверьте медицинский профиль'),{status:422});
 const ids=[...new Set(input.medications.map(row=>row?.productId).filter(Boolean))],codes=[...new Set(input.conditions.map(row=>row?.icd10).filter(Boolean))];
 const products=ids.length?(await db.query('SELECT id,trade_name FROM knowledge.products WHERE id=ANY($1::text[])',[ids])).rows:[];
 const conditions=codes.length?(await db.query('SELECT code,name_ru FROM knowledge.conditions WHERE code=ANY($1::text[])',[codes])).rows:[];
 if(products.length!==ids.length||conditions.length!==codes.length)throw Object.assign(new Error('Один из препаратов или диагнозов не найден в справочнике'),{status:422});
 return {...input,medications:input.medications.map(row=>row.productId?{...row,name:products.find(product=>product.id===row.productId).trade_name}:row),conditions:input.conditions.map(row=>row.icd10?{...row,name:conditions.find(condition=>condition.code===row.icd10).name_ru}:row)};
}
export async function canonicalMedicationInput(db,input){
 if(!input.productId)return input;
 const product=(await db.query('SELECT id,trade_name FROM knowledge.products WHERE id=$1',[input.productId])).rows[0];
 if(!product)throw Object.assign(new Error('Препарат не найден в реестре'),{status:422});
 return {...input,name:product.trade_name,productId:product.id};
}
