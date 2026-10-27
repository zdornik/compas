import assert from 'node:assert/strict';

// Fresh contexts keep each animated login independent of the other smoke scenarios.
export async function browserAuthMotion(browser,origin,output,patient){
 const checks=[];
 for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
  for(const background of ['animated','static']){
   const context=await browser.newContext({viewport,reducedMotion:'no-preference',serviceWorkers:'block'});
   const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
   try{
    await page.goto(origin+(background==='static'?'/?background=static#patient':'/#patient'),{waitUntil:'domcontentloaded'});
    await page.getByLabel('Электронная почта').fill(patient.email);
    await page.getByLabel('Пароль',{exact:true}).fill(patient.password);
    await page.locator('.auth-scene').waitFor({state:'visible'});
    await page.evaluate(()=>{
     const scene=document.querySelector('.auth-scene');
     window.__authMotionCheck={scene,replacements:0};
     const observer=new MutationObserver(()=>{
      const current=document.querySelector('.auth-scene');
      if(current&&current!==window.__authMotionCheck.scene){window.__authMotionCheck.replacements++;window.__authMotionCheck.scene=current;}
     });
     observer.observe(document.documentElement,{subtree:true,childList:true});
     window.__authMotionCheck.observer=observer;
    });
    const started=Date.now();
    await page.getByRole('button',{name:'Войти',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.auth-scene')&&!document.querySelector('.auth-arrival'),null,{timeout:Math.max(1,6000-(Date.now()-started))});
    assert.ok(Date.now()-started<=6000,`${name} ${background}: login animation exceeded six seconds`);
    const nav=page.locator(name==='desktop'?'.sidebar':'.bottom-nav');
    await nav.waitFor({state:'visible'});
    const mascot=page.getByRole('button',{name:'Оценить настроение, нажав на маскота'});
    await mascot.waitFor({state:'visible'});
    await page.screenshot({path:`${output}/auth-motion-${name}-${background}.png`});
    // A real click verifies the finished scene does not intercept interaction.
    await mascot.click({timeout:3000});
    await page.getByRole('dialog').waitFor({state:'visible'});
    await page.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>{
     const result=window.__authMotionCheck.replacements;window.__authMotionCheck.observer.disconnect();
     return result+(document.querySelector('.auth-scene')||document.querySelector('.auth-arrival')?1:0);
    }),0,`${name} ${background}: scene remounted or returned`);
    assert.deepEqual(errors,[]);
    checks.push(`animated patient login: ${name}, ${background} background`);
   }finally{await context.close();}
  }
 }
 return checks;
}
