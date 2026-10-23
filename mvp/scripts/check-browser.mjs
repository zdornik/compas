// Repeatable browser smoke + bounded two-window measurement. Fresh synthetic DB only.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {access,mkdir,readFile,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import pg from 'pg';
import {chromium} from 'playwright';
import {createStore} from '../server/store.mjs';
import {seedSyntheticHistory} from './synthetic-history.mjs';
import {processJournalJob} from './run-journal-worker.mjs';
import {browserAppointments} from './browser-appointments.mjs';
import {JOURNAL_POLICY} from '../server/journal-policy.mjs';

const rehearsal=process.env.BROWSER_REHEARSAL==='1',recordVideo=process.env.BROWSER_VIDEO==='1';
const output=rehearsal?'qa/rehearsal':recordVideo?'qa/video':'qa/browser';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const videoPause=(ms=1800)=>recordVideo?sleep(ms):Promise.resolve();
const store=await createStore();let browser,child,worker,pageA,pageB;
await mkdir(output,{recursive:true,mode:0o700});
try{
  const fixture=await seedSyntheticHistory(store),{accounts}=fixture;
  await store.auth.consents(accounts.patient.session,{healthData:true,journalProcessing:true,journalSharing:true,journalAiProcessing:true,providerPolicyVersion:JOURNAL_POLICY,expectedConsentUpdatedAt:accounts.patient.account.consentUpdatedAt});
  const portServer=createServer();await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve));
  const port=portServer.address().port;await new Promise(resolve=>portServer.close(resolve));const origin='http://127.0.0.1:'+port;
  child=spawn(process.execPath,['scripts/serve.mjs'],{env:{...process.env,PORT:String(port),SITE_ORIGIN:origin,SESSION_COOKIE_NAME:'compass_browser_qa'},stdio:['ignore','ignore','inherit']});
  for(let i=0;;i++){try{if((await fetch(origin+'/api/health')).ok)break;}catch{}if(i===100)throw Error('QA server unavailable');await sleep(100);}
  let executablePath=process.env.BROWSER_EXECUTABLE;
  if(!executablePath&&process.platform==='darwin'){const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';try{await access(chrome);executablePath=chrome;}catch{}}
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',serviceWorkers:'block',...(recordVideo?{recordVideo:{dir:output+'/raw',size:{width:1280,height:800}}}:{})});
  pageA=await context.newPage();pageB=await context.newPage();const errors=[];
  for(const page of [pageA,pageB]){page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));}
  const visible=async locator=>{await locator.waitFor({state:'visible'});};
  const login=async(page,role)=>{
    await page.goto(origin+'/#'+role);await page.getByLabel('Электронная почта').fill(accounts[role].email);
    await page.getByLabel('Пароль',{exact:true}).fill(accounts[role].password);await page.getByRole('button',{name:'Войти',exact:true}).click();
    await visible(page.locator(role==='patient'?'.sidebar':'.dw-sidebar'));await videoPause();
  };
  await login(pageA,'patient');await login(pageB,'doctor');
  const appointmentChecks=await browserAppointments(pageA,pageB,{pause:()=>recordVideo?sleep(1200):Promise.resolve(),...(!recordVideo?{revokeDoctor:()=>store.auth.consents(accounts.doctor.session,{healthData:false,journalProcessing:false,journalSharing:false}),restoreDoctor:()=>store.auth.consents(accounts.doctor.session,{healthData:true,journalProcessing:false,journalSharing:false})}:{})});
  const nav=pageA.getByRole('navigation',{name:'Основная навигация',exact:true});
  await nav.getByRole('button',{name:'Дневник',exact:true}).click();
  await visible(pageA.getByRole('button',{name:'Открыть запись «Запись истории 0»',exact:true}));
  assert.equal(await pageA.locator('.notes-list-row').count(),20);await videoPause();
  await pageA.getByRole('tab',{name:'Самочувствие',exact:true}).click();
  const calendar=pageA.getByRole('region',{name:'Календарь самочувствия'});
  const historicalResponse=pageA.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/history'&&url.searchParams.get('kind')==='observations'&&url.searchParams.get('to')<new Date().toISOString().slice(0,10)&&response.ok();});
  await calendar.getByRole('button',{name:'Предыдущий период',exact:true}).click();await historicalResponse;
  await calendar.locator('.calendar-day').first().click();await visible(pageA.locator('.timeline-row').first());
  assert.equal(await pageA.locator('.timeline-row').count(),2);
  await pageA.getByRole('tab',{name:'Записи',exact:true}).click();
  await pageA.getByRole('button',{name:'Более ранние записи'}).click();await visible(pageA.getByRole('button',{name:'Открыть запись «Запись истории 20»',exact:true}));
  await pageA.getByRole('button',{name:'Открыть запись «Запись истории 20»',exact:true}).click();
  assert.ok((await pageA.getByLabel('Текст записи').inputValue()).length>19000,'Opening a list excerpt must fetch the full note');await videoPause();
  await pageA.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();
  await pageA.getByRole('button',{name:'К последним записям'}).click();
  await pageA.getByRole('button',{name:'Новая запись',exact:true}).click();
  const noteTitle='Браузерная проверка заметки',noteBody='[TEST:elevated] Синтетическая запись из браузерного сценария.';
  await pageA.getByLabel('Название записи').fill(noteTitle);await pageA.getByLabel('Текст записи').fill(noteBody);await videoPause();
  await pageA.getByRole('button',{name:'Сохранить запись',exact:true}).click();
  await pageA.getByRole('dialog').waitFor({state:'hidden'});
  worker=new pg.Pool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||5432),database:process.env.DB_NAME,user:'compass_journal_worker',password:(await readFile(process.env.JOURNAL_DB_PASSWORD_FILE,'utf8')).trim()});
  const key=Buffer.from((await readFile(process.env.DATA_KEY_FILE,'utf8')).trim(),'base64');assert.equal(await processJournalJob(worker,key),true);
  await pageB.getByRole('button',{name:/^Заметки/}).click();
  await pageB.getByRole('button',{name:/Тестовый сигнал/}).click();await visible(pageB.getByText(noteBody,{exact:true}));await videoPause(3000);
  await pageB.getByRole('button',{name:'Принять к рассмотрению',exact:true}).click();await visible(pageB.getByText('Статус: Принято к рассмотрению',{exact:true}));await videoPause();
  await pageB.screenshot({path:output+'/journal-alert.png'});
  // Close the source and inbox, then open the existing physician diary.
  await pageB.getByRole('dialog').last().getByRole('button',{name:'Закрыть',exact:true}).click();
  await pageB.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();
  await pageB.locator('.cp-linked-patient').first().click();await pageB.getByRole('button',{name:'Дневник',exact:true}).click();
  await visible(pageB.locator('.dc-source-entry').first());
  await pageB.getByRole('button',{name:'Записи',exact:true}).click();await visible(pageB.getByText(noteTitle,{exact:true}));await videoPause();
  // A new unsaved draft survives section and role changes and polling in both windows.
  await pageA.getByRole('button',{name:'Новая запись',exact:true}).click();await pageA.getByLabel('Текст записи').fill('Несохранённый синтетический черновик');
  await pageA.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();
  await nav.getByRole('button',{name:'Лечение',exact:true}).click();await visible(pageA.getByRole('button',{name:'Синтетическая схема 0',exact:true}));
  await nav.getByRole('button',{name:'Дневник',exact:true}).click();
  await pageA.evaluate(()=>{location.hash='doctor';});await visible(pageA.locator('.dw-sidebar'));
  await pageA.evaluate(()=>{location.hash='patient';});await visible(pageA.locator('.sidebar'));
  await pageA.getByRole('button',{name:'Продолжить запись',exact:true}).click();
  assert.equal(await pageA.getByLabel('Текст записи').inputValue(),'Несохранённый синтетический черновик');
  await pageA.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();
  const durationMs=rehearsal?1200000:Number(process.env.BROWSER_MEASURE_MS||60000);assert.ok(durationMs>=30000&&durationMs<=(rehearsal?1200000:120000));
  const measure=async(name,ms)=>{
    for(const page of [pageA,pageB])assert.equal(await page.evaluate(()=>document.visibilityState),'visible');
    await sleep(1500);const records=[],pending=new Set(),listeners=[];
    for(const [index,page] of [pageA,pageB].entries()){
      const listener=request=>{
        if(!new URL(request.url()).pathname.startsWith('/api/'))return;
        const task=(async()=>{const response=await request.response();if(!response)return;const body=await response.body();records.push({window:index+1,status:response.status(),ms:Math.round(request.timing().responseEnd),bytes:body.length});})();
        pending.add(task);task.catch(()=>errors.push('Measurement request failed')).finally(()=>pending.delete(task));
      };
      page.on('requestfinished',listener);listeners.push(listener);
    }
    console.log('Measuring '+name+' for '+ms/1000+' seconds…');
    const started=performance.now();let elapsed=0;
    while(elapsed<ms){
      await sleep(Math.min(30000,ms-elapsed));elapsed=performance.now()-started;
      if(rehearsal){
        assert.deepEqual(errors,[]);for(const page of [pageA,pageB])assert.equal(await page.evaluate(()=>document.visibilityState),'visible');
        assert.ok(!records.some(row=>row.status>=400),'Unexpected API failure during rehearsal');
        console.log('Rehearsal: '+Math.min(Math.round(elapsed/1000),ms/1000)+'/'+ms/1000+' seconds, '+records.length+' API requests, no failures.');
        await writeFile(output+'/progress.json',JSON.stringify({elapsedMs:Math.round(elapsed),targetMs:ms,requests:records.length,errors:errors.length}));
      }
    }
    for(const [i,page] of [pageA,pageB].entries())page.off('requestfinished',listeners[i]);await Promise.all(pending);
    const windows=[1,2].map(window=>{const rows=records.filter(row=>row.window===window),times=rows.map(row=>row.ms).sort((a,b)=>a-b);return {window,requests:rows.length,requestsPerMinute:Number((rows.length*60000/ms).toFixed(1)),p95Ms:times[Math.max(0,Math.ceil(times.length*.95)-1)]||0,responseBytes:rows.reduce((sum,row)=>sum+row.bytes,0),errors:rows.filter(row=>row.status>=400).length};});
    for(const result of windows){assert.equal(result.errors,0);assert.ok(result.requestsPerMinute<=40,'Polling budget exceeded: '+JSON.stringify(result));assert.ok(result.p95Ms<1000,'Local p95 exceeded one second');}
    return {name,durationMs:ms,windows};
  };
  console.log('Browser smoke passed.');
  const measurements=recordVideo?[]:[await measure('patient + doctor',durationMs)];
  await pageA.evaluate(()=>{location.hash='doctor';});await visible(pageA.locator('.dw-sidebar'));
  await pageA.locator('.cp-linked-patient').first().click();await pageA.getByRole('button',{name:'Дневник',exact:true}).click();
  await pageA.getByRole('button',{name:'Записи',exact:true}).click();await visible(pageA.getByText(noteTitle,{exact:true}));
  if(!recordVideo)measurements.push(await measure('two windows of the same doctor session',30000));
  await pageA.evaluate(()=>{location.hash='patient';});await visible(pageA.locator('.sidebar'));
  await pageA.getByRole('button',{name:'Продолжить запись',exact:true}).click();
  assert.equal(await pageA.getByLabel('Текст записи').inputValue(),'Несохранённый синтетический черновик');
  await context.setOffline(true);await pageA.getByRole('button',{name:'Сохранить запись',exact:true}).click();
  await visible(pageA.getByRole('alert').filter({hasText:'Нет связи с хранилищем'}));
  assert.equal(await pageA.getByLabel('Текст записи').inputValue(),'Несохранённый синтетический черновик');
  await context.setOffline(false);await pageA.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();
  await pageA.setViewportSize({width:390,height:844});await pageA.screenshot({path:output+'/patient-mobile.png'});
  assert.ok(await pageA.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  for(const page of [pageA,pageB])assert.deepEqual(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length})),{local:0,session:0});
  await store.care.consent(accounts.patient.session,fixture.linkId,'revoked');await pageB.reload();
  await visible(pageB.getByText('Начните с подключения',{exact:true}));assert.equal(await pageB.getByText(noteBody,{exact:true}).count(),0);
  const replacement=await store.auth.register({role:'patient',email:'replacement-'+Date.now()+'@example.invalid',password:'Synthetic-replacement-2026',profile:{name:'Другой',surname:'Пациент',age:30},consents:{healthData:true}});
  await context.addCookies([{name:'compass_browser_qa',value:replacement.token,domain:'127.0.0.1',path:'/api',httpOnly:true,sameSite:'Strict'}]);
  await pageA.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await visible(pageA.locator('.bottom-nav button[aria-current="page"]').filter({hasText:'Сегодня'}));
  await pageA.getByRole('navigation',{name:'Навигация по приложению',exact:true}).getByRole('button',{name:'Дневник',exact:true}).click();
  await visible(pageA.getByText('Ваше место для мыслей',{exact:true}));
  await pageA.getByRole('button',{name:'Новая запись',exact:true}).click();assert.equal(await pageA.getByLabel('Текст записи').inputValue(),'');
  assert.deepEqual(errors,[]);
  const state=await store.state(accounts.patient.session.patient_id);
  const report={syntheticOnly:true,fixture:{notes:fixture.notes,observationDays:fixture.days,plans:fixture.plans},measurements,bootstrapBytes:Buffer.byteLength(JSON.stringify(state)),checks:[...appointmentChecks,'password login in both roles','patient pagination and full original','patient note → stub worker → doctor alert → acknowledgement','period observations','old active plan','draft across sections, roles and polling','390px width','offline draft','owner switch quarantine','no browser health storage','revocation'],limits:rehearsal?'Twenty-minute local warm browser rehearsal; not production capacity, cold-start performance or a medical SLA.':recordVideo?'Synthetic recorded browser demonstration. No capacity measurement.':'Local visible pages: patient + doctor for 60 seconds and two windows of the same doctor for 30 seconds. Not production capacity.'};
  await writeFile(output+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  if(recordVideo){await pageA.close();await pageB.close();await pageA.video().saveAs(output+'/patient.webm');await pageB.video().saveAs(output+'/doctor.webm');}
}catch(error){for(const [name,page] of [['patient',pageA],['doctor',pageB]])if(page)await page.screenshot({path:output+'/failure-'+name+'.png'}).catch(()=>{});throw error;}
finally{
  await browser?.close();await worker?.end();await store.close();
  if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await once(child,'exit');}
}
