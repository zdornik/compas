import {createHmac} from 'node:crypto';

export const JOURNAL_SPEC='stub-v1';
export const JOURNAL_POLICY='local-stub-2026-10-20-v1';
export const journalEnabled=()=>process.env.JOURNAL_ANALYSIS_ENABLED==='1';
export const journalError=(message,status=422)=>Object.assign(new Error(message),{status});
export const entryId=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(value);
export const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export const revisionContext=(patient,id,revision)=>`journal:${patient}:${id}:${revision}`;
export const analysisContext=id=>`journal-analysis:${id}`;
export function journalMutation(input,key){
 if(!input||!entryId(input.id)||input.type!=='journal'||typeof input.title!=='string'||typeof input.body!=='string'||input.title.length>120||input.body.length>20000||!input.body.trim())throw journalError('Некорректный текст заметки');
 if(!Number.isInteger(input.expectedRevision)||input.expectedRevision<0)throw journalError('Обновите запись перед сохранением: требуется её версия',428);
 if(!uuid(input.mutationId))throw journalError('Требуется идентификатор сохранения');
 const canonical=JSON.stringify({id:input.id,title:input.title?.trim(),body:input.body?.trim(),day:input.day,expectedRevision:input.expectedRevision});
 return createHmac('sha256',key).update('journal-mutation\0'+canonical).digest('hex');
}
export function validateJournalAnalysis(value,note){
 if(!value||value.schemaVersion!==1||value.synthetic!==true||!['routine','elevated','urgent','indeterminate'].includes(value.signalLevel))throw journalError('INVALID_ANALYSIS');
 if(typeof value.summary!=='string'||!value.summary.trim()||value.summary.length>2000||!Array.isArray(value.signals)||value.signals.length>10)throw journalError('INVALID_ANALYSIS');
 for(const item of value.signals){
  const span=item?.sourceSpan,source=span&&['title','body'].includes(span.field)?note[span.field]:null;
  if(item?.category!=='synthetic_fixture'||typeof item.explanation!=='string'||item.explanation.length>1000||!source||!Number.isInteger(span.start)||!Number.isInteger(span.end)||span.start<0||span.end<=span.start||span.end>source.length||span.end-span.start>500||span.quote!==source.slice(span.start,span.end))throw journalError('INVALID_ANALYSIS');
 }
 if(['elevated','urgent'].includes(value.signalLevel)&&!value.signals.length)throw journalError('INVALID_ANALYSIS');
 return {schemaVersion:1,synthetic:true,summary:value.summary.trim(),signalLevel:value.signalLevel,signals:value.signals};
}
// Explicit synthetic fixtures exercise routing, never infer a patient's condition.
export async function stubJournalAnalysis(note){
 const match=/\[TEST:(elevated|urgent|indeterminate)\]/.exec(note.body),level=match?.[1]||'routine';
 return validateJournalAnalysis({schemaVersion:1,synthetic:true,signalLevel:level,
  summary:'Тестовая заглушка, не оценка состояния. Фрагмент записи: '+note.body.slice(0,300),
  signals:match?[{category:'synthetic_fixture',explanation:'Сценарий задан явной тестовой меткой. Нейросеть не подключена.',sourceSpan:{field:'body',start:match.index,end:match.index+match[0].length,quote:match[0]}}]:[]},note);
}
export function journalPage(params){
 const limit=Number(params.get('limit')||20);if(!Number.isInteger(limit)||limit<1||limit>50)throw journalError('Некорректный размер страницы');
 let before=null;const raw=params.get('before');
 if(raw){try{if(raw.length>500||!/^[\w-]+$/.test(raw))throw Error();before=JSON.parse(Buffer.from(raw,'base64url').toString());if(!entryId(before.id)||!Number.isFinite(Date.parse(before.at))||new Date(before.at).toISOString()!==before.at)throw Error();}catch{throw journalError('Некорректная страница');}}
 return {limit,before};
}
export const journalCursor=row=>Buffer.from(JSON.stringify({at:new Date(row.updated_at||row.created_at).toISOString(),id:row.entry_id||row.id})).toString('base64url');
