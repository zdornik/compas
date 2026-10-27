import assert from 'node:assert/strict';
export async function browserRegistration(browser,origin,output){
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}),page=await context.newPage();
 try{
  await page.goto(origin+'/#patient',{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Регистрация',exact:true}).click();
  await page.getByLabel('Электронная почта').fill('layout-check@example.invalid');await page.getByLabel('Пароль',{exact:true}).fill('Synthetic-layout-2026');await page.getByLabel('Повторите пароль').fill('Synthetic-layout-2026');
  const check=async()=>{await page.waitForFunction(()=>{const panel=document.querySelector('.ag-panel'),content=document.querySelector('.ag-panel-content');return panel&&content&&panel.clientHeight>=content.offsetHeight&&panel.clientHeight<=content.offsetHeight+3;});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Registration must fit the viewport');};
  await check();await page.screenshot({path:output+'/registration-desktop.png'});
  for(const width of [390,320]){await page.setViewportSize({width,height:844});await check();await page.getByRole('button',{name:'Я врач',exact:true}).click();await check();await page.getByRole('button',{name:'Для себя',exact:true}).click();await check();}
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:output+'/registration-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();await check();await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await page.getByLabel('Имя',{exact:true}).fill('Тест');await page.getByLabel('Фамилия',{exact:true}).fill('Проверочный');await page.getByLabel('Возраст',{exact:true}).fill('30');await check();
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();await check();await page.getByRole('button',{name:'Пока пропустить',exact:true}).click();await check();
  assert.ok(await page.getByRole('button',{name:'Создать аккаунт',exact:true}).isVisible());
  assert.equal(await page.getByLabel('Электронная почта').count(),0);
  return ['registration layout and onboarding at 1440, 390 and 320px'];
 }finally{await context.close();}
}
export async function browserTracking(patient,doctor,{output}){
 const checks=[],nav=patient.getByRole('navigation',{name:'Основная навигация',exact:true});
 await doctor.getByRole('navigation',{name:'Разделы кабинета врача',exact:true}).getByRole('button',{name:'Обзор',exact:true}).click();
 await doctor.locator('.cp-linked-patient').first().waitFor({state:'visible'});
 const filter=doctor.getByPlaceholder('Имя или фамилия');await filter.fill('Несуществующее имя');await doctor.getByText('Пациентов с такими фильтрами нет.',{exact:true}).waitFor({state:'visible'});await doctor.getByRole('button',{name:'Сбросить',exact:true}).click();
 await doctor.locator('.cp-linked-patient').first().click();
 await doctor.locator('.trk-metrics').first().waitFor({state:'visible'});await doctor.locator('.trk-mood-dot:not(.is-empty)').first().waitFor({state:'visible'});
 await doctor.getByRole('button',{name:'Заметки врача',exact:true}).click();await doctor.getByRole('button',{name:'Добавить комментарий',exact:true}).click();
 await doctor.getByLabel('Заголовок',{exact:true}).fill('Синтетическая консультация');await doctor.getByLabel('Наблюдения и прогресс',{exact:true}).fill('Вымышленное наблюдение о ходе психотерапии.');
 await doctor.getByRole('button',{name:'Дневник',exact:true}).click();await doctor.getByRole('group',{name:'Раздел дневника пациента',exact:true}).waitFor({state:'visible'});await doctor.getByRole('button',{name:'Заметки врача',exact:true}).click();await doctor.screenshot({path:output+'/doctor-draft-return.png'});assert.equal(await doctor.getByLabel('Наблюдения и прогресс',{exact:true}).inputValue(),'Вымышленное наблюдение о ходе психотерапии.');
 await doctor.getByRole('button',{name:'Сохранить комментарий',exact:true}).click();await doctor.locator('.trk-note').getByText('Вымышленное наблюдение о ходе психотерапии.',{exact:true}).waitFor({state:'visible'});
 await doctor.screenshot({path:output+'/doctor-comments.png'});checks.push('roster filters, encrypted doctor comment saved from UI, draft across card sections');
 await doctor.getByRole('group',{name:'Карта подключённого пациента',exact:true}).getByRole('button',{name:'Обзор',exact:true}).click();await doctor.locator('.trk-mood-dot:not(.is-empty)').first().click();await doctor.locator('.dc-source-entry').first().waitFor({state:'visible'});
 await doctor.getByRole('button',{name:'Все подключённые пациенты',exact:true}).click();await doctor.setViewportSize({width:390,height:844});assert.ok(await doctor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await doctor.screenshot({path:output+'/doctor-tracking-mobile.png'});await doctor.setViewportSize({width:1440,height:1000});
 await nav.getByRole('button',{name:'Лечение',exact:true}).click();await patient.getByText('дней подряд со всеми отметками «Принят»',{exact:true}).waitFor({state:'visible'});await patient.locator('.trk-ring').first().waitFor({state:'visible'});checks.push('patient intake history and streak, doctor mood point opens source day');
 await nav.getByRole('button',{name:'Сегодня',exact:true}).click();await patient.getByRole('button',{name:/Как вы спали/}).click();
 await patient.getByRole('button',{name:'Обновить отметку',exact:true}).waitFor({state:'visible'});await patient.getByLabel('Комментарий в дневник · по желанию',{exact:true}).fill('Вымышленная причина плохого сна.');await patient.getByRole('button',{name:'Обновить отметку',exact:true}).click();await patient.getByRole('dialog').waitFor({state:'hidden'});
 await patient.getByRole('button',{name:/Как вы спали/}).click();await patient.getByLabel('Комментарий в дневник · по желанию',{exact:true}).waitFor({state:'visible'});await patient.waitForFunction(()=>document.querySelector('.sleep-modal textarea')?.value==='Вымышленная причина плохого сна.');await patient.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();checks.push('daily sleep edits the same record and restores optional diary text');
 await patient.getByRole('button',{name:/Опросники самочувствия/}).click();await patient.locator('.assessment-choice').filter({hasText:'PHQ-9'}).click();await patient.getByRole('button',{name:'Начать',exact:true}).click();await patient.locator('.assessment-options input').first().check();await patient.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();await patient.getByRole('button',{name:/Опросники самочувствия/}).click();assert.equal(await patient.locator('.assessment-options input').first().isChecked(),true);await patient.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();checks.push('unfinished screening answers survive closing without browser storage');
 await doctor.screenshot({path:output+'/doctor-tracking.png'});
 return checks;
}
