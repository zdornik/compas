import {normalizeReferenceText} from './reference-text.js';
// Presentation of source text only. No clinical summaries, rewritten recommendations or inferred rules.
const tidy=value=>value.replace(/\s+/gu,' ').trim();
const fold=value=>tidy(value).normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е');
const headingKey=value=>fold(value).replace(/(\d)\.\s*/g,'$1 ').replace(/[.…;:]+$/g,'').trim();
const startHeading=/^(?:\d{1,2}(?:\.\d{1,2}){0,3}\.?\s*[А-ЯЁ]|Глава\s+\d|Список\s+(?:сокращений|литературы)|Термины\s+и\s+определения|Критерии\s+оценки|Приложени[ея]\s*[А-ЯA-Z])/iu;
function numberedLines(page) {
 const lines=page.text.replace(/\r/g,'').split('\n');
 const first=lines.findIndex(line=>line.trim());let last=lines.length-1;while(last>=0&&!lines[last].trim())last--;
 // Remove only isolated margin page labels, never numbers within the body.
 return lines.filter((line,index)=>!((index===first||index===last)&&/^\d{1,4}$/.test(line.trim())&&Math.abs(Number(line.trim())-page.page)<=1));
}
function printedPages(pages) {
 const labels=new Map(),votes=new Map();
 for(const page of pages){const lines=page.text.split('\n').map(x=>x.trim()).filter(Boolean);let candidate=[lines[0],lines.at(-1)].find(x=>/^\d{1,4}$/.test(x||'')&&Math.abs(page.page-Number(x))<=4);if(candidate){const value=Number(candidate);labels.set(value,page.page);const delta=page.page-value;votes.set(delta,(votes.get(delta)||0)+1);}}
 const offset=[...votes].sort((a,b)=>b[1]-a[1])[0]?.[0]||0;
 return value=>labels.get(value)||Math.max(1,Math.min(pages.length,value+offset));
}
export function buildGuidelineOutline(pages) {
 const toPhysical=printedPages(pages),entries=[];
 const start=pages.slice(0,8).findIndex(page=>/(?:оглавление|содержание)/iu.test(page.text));
 const candidates=[];let end=start,pending=[];
 const finish=()=>{
  if(!pending.length)return;
  let text=tidy(pending.join(' '));pending=[];
  const pageMatch=text.match(/(?:[.…·]\s*){2,}(\d{1,4})\s*$/u)||text.match(/\s+(\d{1,4})\s*$/u);
  const printed=pageMatch?Number(pageMatch[1]):null;
  text=text.replace(/Ошибка![\s\S]*$/u,'').replace(/(?:[.…·]\s*){2,}\d*\s*$/u,'').replace(pageMatch&& !/[.…·]{2}/u.test(text)?/\s+\d{1,4}\s*$/u:/$^/u,'').replace(/[.…·;\s]+$/u,'');
  if(text.length>5&&text.length<650&&!/^(?:оглавление|содержание)$/iu.test(text))candidates.push({title:text,printed});
 };
 if(start>=0){
  for(let index=start;index<Math.min(start+5,pages.length);index++){
   let lines=numberedLines(pages[index]).map(tidy).filter(Boolean);
   if(index===start){const at=lines.findIndex(line=>/^(?:оглавление|содержание)/iu.test(line));if(at>=0)lines=lines.slice(at);}
   // A few generated PDFs concatenate the whole contents into one line.
   lines=lines.flatMap(line=>line.length>200?line.replace(/(?=(?<![\d.])[1-7](?:\.\d{1,2})+\.?\s*(?=[А-ЯЁ])|(?<![\d.])[1-7]\.\s*(?:Краткая|Диагностика|Лечение|Медицинская|Профилактика|Организация|Дополнительная)|Список (?:сокращений|литературы)|Термины и определения|Критерии оценки|Приложени[ея] [А-ЯA-Z])/gu,'\n').split('\n').filter(Boolean):[line]);
   const starts=lines.filter(line=>startHeading.test(line)).length;
   const leaders=lines.filter(line=>/[.…·]{3}/u.test(line)).length;
   if(index>start&&leaders<2&&(starts<4||/^(?:Список сокращений|Термины и определения)\s*$/iu.test(lines[0]||'')))break;
   end=index;
   for(let line of lines){
    if(/^(?:оглавление|содержание)(?:[.…·\s]+\d+)?$/iu.test(line))continue;
    if(startHeading.test(line)){finish();pending=[line];}else pending.push(line);
    if(pending.length&&(/(?:[.…·]\s*){2,}\d{1,4}\s*$/u.test(line)||/\s+\d{1,4}\s*$/.test(line)||/^\d{1,4}$/.test(line)||/Ошибка!.*определена[.]?$/u.test(line)))finish();
   }
  }
  finish();
 }
 const compact=value=>fold(value).replace(/[^\p{L}\p{N}]/gu,'');
 const body=pages.filter((page,index)=>index>end).map(page=>({page:page.page,text:compact(numberedLines(page).join(' ')),lines:numberedLines(page).map(tidy).filter(Boolean)}));
 for(const candidate of candidates){
  let page,source;
  if(candidate.printed&&candidate.printed<=pages.length){page=toPhysical(candidate.printed);source='contents';}
  else {
   const key=compact(candidate.title),prefix=key.slice(0,Math.min(35,key.length));
   const code=candidate.title.match(/^(?:Глава\s+)?(\d+(?:\.\d+)*)\.?\s*/iu);
   let found;
   if(code){
    const pattern=new RegExp('^(?:Глава\\s+)?'+code[1].replace(/\./g,'\\.')+'\\.?(?:\\s+|(?=[А-ЯЁ]))','iu');
    const label=candidate.title.slice(code[0].length),words=compact(label).slice(0,12),firstWord=label.match(/[\p{L}]+/u)?.[0];
    const rootWords={'1':/краткая/iu,'2':/диагностика/iu,'3':/лечение/iu,'4':/^(?:медицинская|реабилитация)/iu,'5':/профилактика/iu,'6':/организация/iu,'7':/дополнительная/iu};
    found=body.find(item=>item.lines.some((line,index)=>{if(!pattern.test(line))return false;const actual=line.replace(pattern,'');return compact(item.lines.slice(index,index+3).join(' ').replace(pattern,'')).startsWith(words)||(firstWord&&fold(actual).startsWith(fold(firstWord)))||(rootWords[code[1]]?.test(label)&&rootWords[code[1]].test(actual));}));
   }else found=body.find(item=>item.text.includes(prefix))||body.find(item=>item.text.includes(key.slice(0,Math.min(20,key.length))));
   if(found){page=found.page;source='located_contents_heading';}
  }
  if(page&&!entries.some(item=>headingKey(item.title)===headingKey(candidate.title)))entries.push({title:candidate.title,page,printedPage:candidate.printed,source});
 }
 const ordered=entries.sort((a,b)=>a.page-b.page);
 return ordered.map((item,index)=>{
  const number=item.title.match(/^(?:Глава\s+)?(\d+(?:\.\d+)*)\.?\s*/iu)?.[1]||'';
  return {...item,id:'section-'+index,number,level:Math.min(3,number?number.split('.').length:1),label:item.title.replace(/^(?:Глава\s+)?(\d+(?:\.\d+)*)\.?\s*/iu,''),endPage:Math.max(item.page,(ordered.slice(index+1).find(x=>x.page>item.page)?.page||pages.length+1)-1)};
 });
}
function joinEvidenceContinuations(blocks) {
 const result=[];
 for(const source of blocks){
  const previous=result.at(-1),continuation=/^(?:рекомендаци[яийю](?:\s|$)|[–—−-]\s*[A-DА-Г1-5](?:[.\s)]|$))/iu.test(source.text.trim());
  // PDF glyph extraction may label a bold wrapped class as a separate heading.
  // Join only an explicit evidence continuation; preserve source characters/styles.
  if(previous?.type==='evidence'&&['heading','paragraph','evidence'].includes(source.type)&&continuation){
   const offset=previous.text.length+1;
   const runs=[...(previous.runs||[]),...(source.runs||[]).map(run=>({...run,start:run.start+offset,end:run.end+offset}))];
   previous.text+=' '+source.text;previous.runs=runs;
   if(previous.bbox&&source.bbox)previous.bbox=[Math.min(previous.bbox[0],source.bbox[0]),previous.bbox[1],Math.max(previous.bbox[2],source.bbox[2]),source.bbox[3]];
  }else result.push({...source});
 }
 return result;
}
export function formatGuidelinePage(page,outline=[]) {
 page={...page,text:normalizeReferenceText(page.text),...(page.layout?{layout:{...page.layout,blocks:page.layout.blocks.map(block=>({...block,text:normalizeReferenceText(block.text),...(block.cells?{cells:block.cells.map(cell=>({...cell,text:normalizeReferenceText(cell.text)}))}:{})}))}}:{})};
 if(page.layout?.version===1&&Array.isArray(page.layout.blocks)){
  return {...page,blocks:joinEvidenceContinuations(page.layout.blocks).map(block=>{
   const exact=outline.find(item=>item.page===page.page&&headingKey(item.title)===headingKey(block.text));
   const code=block.text.match(/^(?:Глава\s+)?(\d+(?:\.\d+)*)\.?\s/iu)?.[1];
   const section=exact||(block.type==='heading'&&code?outline.find(item=>item.page===page.page&&item.number===code):null);
   return section?{...block,type:'heading',sectionId:section.id,level:section.level}:block;
  })};
 }
 const raw=numberedLines(page),blocks=[];let buffer=[],type='paragraph';
 const flush=()=>{if(buffer.length){blocks.push({type,text:type==='table'?buffer.join('\n').trim():tidy(buffer.join(' '))});buffer=[];}type='paragraph';};
 const headings=outline.filter(item=>item.page===page.page);
 for(let i=0;i<raw.length;i++){
  const line=raw[i].trim();if(!line){flush();continue;}
  let heading=null,span=0;
  for(const entry of headings){for(let take=1;take<=5&&i+take<=raw.length;take++){if(headingKey(raw.slice(i,i+take).join(' '))===headingKey(entry.title)){heading=entry;span=take;break;}}if(heading)break;}
  if(heading){flush();blocks.push({type:'heading',text:tidy(raw.slice(i,i+span).join(' ')),sectionId:heading.id,level:heading.level});i+=span-1;continue;}
  if(/^Таблица\s+[А-ЯA-Z]?\d/iu.test(line)){flush();type='table';buffer=raw.slice(i);break;}
  if(type==='table'){buffer.push(raw[i]);continue;}
  if(/^[•●▪■\uf0b7]\s*|^[-–—]\s+|^\d{1,2}\)\s+|^[а-яa-z]\)\s+/iu.test(line)){flush();type='list';}
  else if(/^Уровень\s+(?:убедительности|достоверности)/iu.test(line)){flush();type='evidence';}
  else if(/^Комментарии?\s*[:.]/iu.test(line)){flush();type='comment';}
  else if(buffer.length&&/[.!?;:]\s*$/.test(buffer.at(-1))&&/^[А-ЯЁA-Z]/u.test(line)&&type!=='evidence')flush();
  buffer.push(line);
 }
 flush();return {...page,blocks};
}
function normalizedWithMap(text) {
 let normalized='',map=[],space=false;
 for(let index=0;index<text.length;index++){
  const char=text[index];if(char==='\u00ad')continue;
  if(/\s/u.test(char)){if(!space&&normalized){normalized+=' ';map.push(index);}space=true;continue;}
  space=false;const value=char.normalize('NFKC').toLowerCase().replace(/ё/g,'е');
  normalized+=value;for(let j=0;j<value.length;j++)map.push(index);
 }
 return {text:normalized.trimEnd(),map};
}
const searchIndexes=new WeakMap();
export function findGuidelineMatches(pages,query,limit=1500) {
 const needle=fold(query).slice(0,160);if(needle.length<2)return {items:[],total:0,pageCount:0,truncated:false};
 const items=[];let total=0;const foundPages=new Set();
 for(const page of pages)for(const [blockIndex,block]of page.blocks.entries()){
  let indexed=searchIndexes.get(block);if(!indexed){indexed=normalizedWithMap(block.text);searchIndexes.set(block,indexed);}let from=0,at;
  while((at=indexed.text.indexOf(needle,from))!==-1){total++;foundPages.add(page.page);const start=indexed.map[at],end=indexed.map[at+needle.length-1]+1;
   if(items.length<limit){const left=Math.max(0,start-65),right=Math.min(block.text.length,end+100);items.push({id:`hit-${page.page}-${blockIndex}-${start}`,page:page.page,block:blockIndex,start,end,before:(left?'…':'')+block.text.slice(left,start),match:block.text.slice(start,end),after:block.text.slice(end,right)+(right<block.text.length?'…':'')});}
   from=at+needle.length;
  }
 }
 return {items,total,pageCount:foundPages.size,truncated:total>items.length};
}
export function sectionForPage(outline,page){return [...outline].reverse().find(item=>item.page<=page)||outline[0]||null;}

// Only source headings are used. No standardized section is inserted when absent.
const instructionHeading=/^(?:инструкция(?: по (?:медицинскому применению|применению))?|общая характеристика лекарственного препарата|листок[- ]вкладыш|регистрационн(?:ый|ое) (?:номер|удостоверение)|торговое (?:наименование|название)(?: препарата)?|международное непатентованное (?:или группировочное )?наименование|группировочное наименование|лекарственная форма|состав|описание|фармакотерапевтическая группа|код атх|фармакологические свойства|фармакодинамика|фармакокинетика|показания(?: к применению)?|противопоказания|с осторожностью|применение (?:при беременности|во время беременности)|беременность и (?:период )?(?:лактация|грудное вскармливание)|способ применения и дозы|режим дозирования|побочн(?:ое|ые) (?:действие|эффекты|реакции)|нежелательные реакции|передозировка|взаимодействие (?:с другими|с иными)|особые указания|влияние на способность|форма выпуска|условия хранения|срок годности|условия отпуска|производитель|держатель регистрационного удостоверения)/iu;
export function buildInstructionOutline(pages) {
 const entries=[];
 for(const page of pages){
  const blocks=page.layout?.blocks||numberedLines(page).map(text=>({text}));
  for(const block of blocks){const title=tidy(block.text);if(title.length>3&&title.length<300&&(instructionHeading.test(title)||block.type==='heading'&&/^\d{1,2}\.\s*\p{L}/u.test(title))&&(!page.layout||block.type==='heading')&&!entries.some(item=>headingKey(item.title)===headingKey(title)))entries.push({id:'instruction-section-'+entries.length,title,label:title,number:'',level:1,page:page.page,source:'source_heading'});}
 }
 return entries.map((item,index)=>({...item,endPage:(entries.slice(index+1).find(next=>next.page>item.page)?.page||pages.length+1)-1}));
}
export function formatInstructionPage(page,outline=[]) {
 page={...page,text:normalizeReferenceText(page.text)};
 if(page.layout?.version===1)return formatGuidelinePage(page,outline);
 const blocks=[];let lines=[];
 const flush=()=>{if(lines.length)blocks.push({type:'source-lines',text:lines.join('\n')});lines=[];};
 for(const line of numberedLines(page)){
  const section=outline.find(item=>item.page===page.page&&headingKey(item.title)===headingKey(line));
  if(section){flush();blocks.push({type:'heading',text:line.trim(),sectionId:section.id});}
  else if(!line.trim()){flush();}else lines.push(line);
 }
 flush();return {...page,blocks};
}
