import {command} from './reference-snapshot.mjs';
await command(process.execPath,['scripts/init-local-secrets.mjs'],{capture:false});
await command('docker',['compose','up','-d','--wait','db'],{capture:false});
await command('docker',['compose','run','--rm','migrate'],{capture:false});
const restoreArgs=[];for(const name of ['--manifest','--local-parts']){const at=process.argv.indexOf(name);if(at!==-1){if(!process.argv[at+1])throw new Error('Missing '+name);restoreArgs.push(name,process.argv[at+1]);}}
await command(process.execPath,['scripts/restore-reference-db.mjs',...restoreArgs],{capture:false});
await command('docker',['compose','up','-d',process.argv.includes('--no-build')?'--no-build':'--build','--wait','web'],{capture:false});
console.log('Компас готов: '+(process.env.COMPASS_LOCAL_ORIGIN||'http://127.0.0.1:4174/'));
