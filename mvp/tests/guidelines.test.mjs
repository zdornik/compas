import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGuidelineOutline, formatGuidelinePage, findGuidelineMatches, sectionForPage, buildInstructionOutline, formatInstructionPage } from '../src/guidelines.js';

test('contents continues across pages and maps printed page labels to PDF pages',()=>{
 const pages=[{page:1,text:'Клинические рекомендации'},
 {page:2,text:'Оглавление\n1. Краткая информация ........ 3\n1.1 Определение состояния .... 3\n2. Диагностика ........ 4'},
 {page:3,text:'2\n3. Лечение, включая медикаментозную\nтерапию ........ 5\n4. Реабилитация ........ 6'},
 {page:4,text:'3\n1. Краткая информация\n1.1 Определение состояния\nТекст.'},
 {page:5,text:'4\n2. Диагностика\nТекст.'},
 {page:6,text:'5\n3. Лечение, включая медикаментозную\nтерапию\nТекст.'},
 {page:7,text:'6\n4. Реабилитация\nТекст.'}];
 const outline=buildGuidelineOutline(pages);
 assert.equal(outline.find(x=>x.number==='3').page,6);
 assert.equal(outline.find(x=>x.number==='3').title,'3. Лечение, включая медикаментозную терапию');
 assert.equal(outline.find(x=>x.number==='1.1').level,2);
 assert.equal(sectionForPage(outline,5).number,'2');
});
test('contents without page references locates source headings and excludes numbered prose',()=>{
 const pages=[{page:1,text:'КР'}, {page:2,text:'Оглавление\nСписок сокращений;\n1. Краткая информация;\n2. Диагностика;\n3. Лечение;'},
 {page:3,text:'Список сокращений\nАД – артериальное давление\nТермины и определения\n3 Гц — частота.'},
 {page:4,text:'1. Краткая информация\nТекст'}, {page:5,text:'2. Диагностика\nТекст'}, {page:6,text:'3. Лечение\nТекст'}];
 const outline=buildGuidelineOutline(pages);
 assert.equal(outline.find(x=>x.number==='1').page,4);
 assert.equal(outline.find(x=>x.number==='3').page,6);
 assert.equal(outline.some(x=>x.title.includes('Гц')),false);
});
test('broken PDF bookmarks are located by the actual heading rather than exposing error text',()=>{
 const pages=[{page:1,text:'КР'},{page:2,text:'Оглавление\n1. Краткая информация ...... Ошибка! Закладка не определена.\n2. Диагностика ...... Ошибка! Закладка не определена.\n3. Лечение ...... Ошибка! Закладка не определена.'},
 {page:3,text:'1. Краткая информация\nТекст'},{page:4,text:'2. Диагностика\nТекст'},{page:5,text:'3. Лечение\nТекст'}];
 const outline=buildGuidelineOutline(pages);assert.equal(outline.length,3);assert.equal(outline[2].page,5);assert.equal(outline.some(x=>x.title.includes('Ошибка')),false);
});
test('reading layout preserves source words, negative statements, dose symbols and evidence',()=>{
 const text='12\n3. Лечение\n• Не рекомендуется изменять\nдозу 0,5–1 мг/кг без оценки.\nУровень убедительности рекомендаций — C\n(уровень достоверности доказательств — 5).\n\nКомментарий: наблюдение.\nТаблица 1. Дозы\nПрепарат А 5 мг\nПрепарат Б 10 мкг';
 const formatted=formatGuidelinePage({page:12,text},[{id:'s',page:12,title:'3. Лечение',level:1}]);
 assert.equal(formatted.blocks.map(x=>x.text).join('').replace(/\s/gu,''),text.replace(/^12\n/,'').replace(/\s/gu,''));
 assert.ok(formatted.blocks.some(x=>x.type==='evidence'));
 assert.ok(formatted.blocks.some(x=>x.type==='table'&&x.text.includes('10 мкг')));
});
test('document search finds all literal occurrences across wrapped lines and handles Russian case and ё',()=>{
 const pages=[formatGuidelinePage({page:4,text:'Тяжёлое\nсостояние. ТЯЖЕЛОЕ состояние.\n\n[А+Б] 5 мг.'}),formatGuidelinePage({page:18,text:'Тяжелое состояние.'})];
 const result=findGuidelineMatches(pages,'тяжелое состояние');assert.equal(result.total,3);assert.equal(result.pageCount,2);
 for(const hit of result.items){const text=pages.find(x=>x.page===hit.page).blocks[hit.block].text;assert.equal(text.slice(hit.start,hit.end),hit.match);}
 assert.equal(findGuidelineMatches(pages,'[А+Б]').total,1);
 assert.equal(findGuidelineMatches(pages,'.*').total,0);
 assert.equal(findGuidelineMatches(pages,'несуществующее').total,0);
 const limited=findGuidelineMatches(pages,'состояние',1);assert.equal(limited.total,3);assert.equal(limited.items.length,1);assert.equal(limited.truncated,true);
});

test('source layout preserves merged table cells, source notes and superscripts in searchable reading order',()=>{
 const layout={version:1,blocks:[{type:'heading',text:'3. Лечение'},
 {type:'paragraph',text:'Исходный текст1.',runs:[{start:14,end:15,superscript:true}]},
 {type:'table',text:'Доза\n0,5 мг/кг\nНе применять',structured:true,rowCount:2,columnCount:2,cells:[{row:0,col:0,rowspan:1,colspan:2,text:'Доза',start:0,end:4},{row:1,col:0,rowspan:1,colspan:1,text:'0,5 мг/кг',start:5,end:14},{row:1,col:1,rowspan:1,colspan:1,text:'Не применять',start:15,end:27}],assetId:'abc'},
 {type:'footnote',text:'1 Примечание из источника.'}]};
 const page=formatGuidelinePage({page:12,text:'original',layout},[{id:'section-3',page:12,title:'3. Лечение',number:'3',level:1}]);
 assert.equal(page.blocks[0].sectionId,'section-3');assert.equal(page.blocks[1].runs[0].superscript,true);
 assert.equal(page.blocks[2].cells[0].colspan,2);assert.equal(page.blocks[3].type,'footnote');
 const result=findGuidelineMatches([page],'0,5 мг/кг');assert.equal(result.total,1);assert.equal(result.items[0].block,2);
 assert.equal(findGuidelineMatches([page],'Не применять').total,1);assert.equal(findGuidelineMatches([page],'Примечание').total,1);
});


test('instruction contents uses only present source headings and unparsed text keeps line breaks and dose columns',()=>{
 const pages=[{page:1,text:'Препарат\nСостав\nДействующее вещество  5 мг\nВспомогательные вещества\n\nОписание\nБелые таблетки.'},{page:2,text:'Способ применения и дозы\nНе применять более 0,5–1 мг/кг.\nВзрослые    5 мг\nДети       2,5 мг'}];
 const outline=buildInstructionOutline(pages);
 assert.deepEqual(outline.map(item=>item.title),['Состав','Описание','Способ применения и дозы']);
 const formatted=pages.map(page=>formatInstructionPage(page,outline));
 assert.ok(formatted[1].blocks.some(block=>block.text.includes('Взрослые    5 мг\nДети       2,5 мг')));
 assert.equal(findGuidelineMatches(formatted,'не применять').total,1);
 assert.equal(outline.some(item=>item.title==='Противопоказания'),false);
});

test('a wrapped recommendation class stays inside its evidence block without losing source text or search offsets',()=>{
 const blocks=[{type:'evidence',text:'Уровень достоверности доказательств – 5, Уровень убедительности',runs:[{start:0,end:7,bold:true}]},{type:'heading',text:'рекомендаций – C.',runs:[{start:0,end:12,bold:true}]},{type:'heading',text:'3. Лечение'},{type:'paragraph',text:'Не рекомендуется менять дозу.'}];
 const formatted=formatGuidelinePage({page:32,text:'original',layout:{version:1,blocks}},[]);
 assert.equal(formatted.blocks.length,3);assert.equal(formatted.blocks[0].type,'evidence');assert.ok(formatted.blocks[0].text.endsWith('рекомендаций – C.'));assert.equal(formatted.blocks[1].text,'3. Лечение');
 assert.equal(formatted.blocks.map(row=>row.text).join('').replace(/\s/gu,''),blocks.map(row=>row.text).join('').replace(/\s/gu,''));
 assert.equal(findGuidelineMatches([formatted],'рекомендаций – C.').total,1);assert.equal(blocks[0].text.includes('рекомендаций'),false);
});
