export function mergeEntries(...groups){
  const entries=new Map();
  for(const row of groups.flat()){
    const old=entries.get(row.id);
    const stamp=value=>Number(value.revision||0)*1e14+(Date.parse(value.updatedAt||value.createdAt||value.at)||0);
    if(!old||stamp(row)>=stamp(old))entries.set(row.id,row);
  }
  return [...entries.values()];
}

// Keep only the selected window. Restart if a write changes the snapshot mid-page.
export async function readHistoryWindow(load,signal,cached){
  for(let attempt=0;attempt<3;attempt++){
    try{
      const first=await load({limit:100,...(cached?{since:cached.revision}:{})},signal);
      if(first.unchanged){if(!cached)throw new Error('Историю нужно загрузить заново');return cached;}
      const entries=[...first.entries];let next=first.nextCursor,pages=1;
      while(next){
        if(++pages>100)throw new Error('Слишком много записей в выбранном периоде. Выберите меньший период.');
        const page=await load({limit:100,before:next},signal);entries.push(...page.entries);next=page.nextCursor;
      }
      return {entries,revision:first.revision};
    }catch(error){if(error.code!=='HISTORY_CHANGED'||attempt===2)throw error;cached=null;}
  }
}
