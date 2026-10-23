import {readFile,writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {root} from './database-tools.mjs';
const directory=join(root,'qa/video');
for(const name of ['patient.webm','doctor.webm','report.json'])await access(join(directory,name));
const report=JSON.parse(await readFile(join(directory,'report.json'),'utf8'));
if(report.syntheticOnly!==true)throw Error('Only a synthetic demonstration may be packaged');
await writeFile(join(directory,'index.html'),`<!doctype html>
<html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>Компас · запись демонстрации</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f7f5;color:#254c42;font:16px system-ui,sans-serif}main{max-width:1600px;margin:auto;padding:32px}h1{font-size:32px;letter-spacing:-1px;margin:4px 0 12px}.eyebrow{font-size:12px;letter-spacing:2px}p{line-height:1.6;color:#587368}.controls{display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:20px 0}button,select{font:inherit;border-radius:24px;border:1px solid #bdcdc3;padding:10px 20px;background:white;color:inherit}button{cursor:pointer}button:first-child{background:#306b59;color:white}input{flex:1;min-width:160px;accent-color:#306b59}.screens{display:grid;grid-template-columns:1fr 1fr;gap:20px}.screen{min-width:0;background:white;border:1px solid #dce5df;border-radius:20px;overflow:hidden}.screen h2{font-size:16px;margin:16px 20px}video{width:100%;display:block;background:#fff}a{color:#306b59}footer{margin-top:24px;font-size:14px}time{font-variant-numeric:tabular-nums}@media(max-width:900px){.screens{grid-template-columns:1fr}main{padding:20px}h1{font-size:26px}}:focus-visible{outline:3px solid #b7cebd;outline-offset:3px}
</style><main><div class="eyebrow">КОМПАС · ВЫМЫШЛЕННЫЕ ДАННЫЕ</div><h1>Запись демонстрации</h1><p>Два кабинета: запрос и подтверждение приёма, прямое назначение, заметка пациента, тестовый сигнал врачу и исходная запись. Управляйте обеими записями общей панелью.</p>
<div class="controls"><button id="play" disabled>Воспроизвести</button><button id="restart" disabled>С начала</button><input id="seek" type="range" min="0" max="1" step="0.1" value="0" aria-label="Позиция записи"><time id="position">0:00 / 0:00</time><select id="speed" aria-label="Скорость воспроизведения"><option value="0.5" selected>0,5×</option><option value="1">1×</option></select></div>
<div class="screens"><section class="screen"><h2>Пациент</h2><video id="patient" src="patient.webm" preload="metadata" muted playsinline></video></section><section class="screen"><h2>Врач</h2><video id="doctor" src="doctor.webm" preload="metadata" muted playsinline></video></section></div>
<p id="status" role="status">Загружаем локальные видео…</p><footer>Запись без звука. Анализ заметки выполняет явно обозначенная локальная заглушка.<br>Отдельные файлы: <a href="patient.webm">пациент</a> · <a href="doctor.webm">врач</a>. Для переноса сохраните эту страницу и оба файла рядом.</footer></main>
<script>
const videos=[document.querySelector('#patient'),document.querySelector('#doctor')],play=document.querySelector('#play'),restart=document.querySelector('#restart'),seek=document.querySelector('#seek'),position=document.querySelector('#position'),speed=document.querySelector('#speed'),status=document.querySelector('#status');
const stamp=t=>Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0');let duration=0,working=false;
async function toggle(){if(working){videos.forEach(v=>v.pause());working=false;}else{try{await Promise.all(videos.map(v=>v.play()));working=true;}catch{status.textContent='Не удалось запустить видео. Откройте отдельные файлы по ссылкам ниже.';}}play.textContent=working?'Пауза':'Воспроизвести';}
function jump(t){videos.forEach(v=>{v.currentTime=Math.min(t,v.duration||t);});seek.value=t;}
function ready(){if(videos.some(v=>!Number.isFinite(v.duration)))return;duration=Math.max(...videos.map(v=>v.duration));seek.max=duration;play.disabled=false;restart.disabled=false;status.textContent='Видео готово. Воспроизведение замедлено для удобства чтения.';videos.forEach(v=>v.playbackRate=Number(speed.value));position.textContent='0:00 / '+stamp(duration);}
videos.forEach(v=>{v.addEventListener('loadedmetadata',ready);v.addEventListener('error',()=>status.textContent='Видео не найдено. Сохраните patient.webm и doctor.webm рядом с этой страницей.');});
play.addEventListener('click',toggle);restart.addEventListener('click',()=>jump(0));seek.addEventListener('input',()=>jump(Number(seek.value)));speed.addEventListener('change',()=>videos.forEach(v=>v.playbackRate=Number(speed.value)));
setInterval(()=>{const t=videos[0].currentTime;seek.value=t;position.textContent=stamp(t)+' / '+stamp(duration);if(working&&Math.abs(videos[1].currentTime-t)>.35&&!videos[1].ended)videos[1].currentTime=Math.min(t,videos[1].duration);if(videos.every(v=>v.ended)){working=false;play.textContent='Воспроизвести';}},250);
</script></html>`,{mode:0o600});
console.log('Offline synthetic replay prepared: qa/video/index.html');
