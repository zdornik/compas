import {access,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {root} from './database-tools.mjs';
import {bundleAccountPassword} from './presentation-fixture.mjs';
const demoPassword=await bundleAccountPassword(join(root,'.compass-bundle.json'));
const exists=path=>access(path).then(()=>true,()=>false);
async function run(action,...args){
 await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(root,'scripts/presentation.mjs'),action,...args],{cwd:root,env:process.env,stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Не удалось выполнить '+action+'; данные сохранены.')));});
}
try{
 console.log('Компас · локальный демонстрационный стенд');
 await run('prepare','--bundle-accounts');
 const base=join(root,'qa/presentation');
 if(await exists(join(base,'reference/sample.json')))await run('reference');
 await run('start');await run('check');
 const accounts=JSON.parse(await readFile(join(base,'accounts.json'),'utf8'));
 if(accounts.syntheticOnly!==true)throw Error('Expected synthetic presentation accounts');
 console.log('\nГотово: http://127.0.0.1:4176/');
 console.log('Аккаунты для этого экземпляра: qa/presentation/accounts.json');
 console.log('Пациент: '+accounts.patient+'\nВрач: '+accounts.doctor);
 console.log(accounts.password===demoPassword?'Пароль указан в DEMO-ACCOUNTS.md. Остановка: STOP.command.':'Экземпляр создан раньше: актуальный пароль — в qa/presentation/accounts.json. Остановка: STOP.command.');
}catch(error){console.error('\n'+error.message+'\nПодробности: qa/presentation/application.log. Не удаляйте qa/presentation для исправления ошибки.');process.exitCode=1;}
