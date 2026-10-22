import {command} from './reference-snapshot.mjs';
await command(process.execPath,['scripts/init-local-secrets.mjs'],{capture:false});
await command('docker',['compose','up','-d','--wait','db'],{capture:false});
await command('docker',['compose','run','--rm','migrate'],{capture:false});
const restoreArgs=[];for(const name of ['--manifest','--local-parts']){const at=process.argv.indexOf(name);if(at!==-1){if(!process.argv[at+1])throw new Error('Missing '+name);restoreArgs.push(name,process.argv[at+1]);}}
if(!process.argv.includes('--skip-reference'))await command(process.execPath,['scripts/restore-reference-db.mjs',...restoreArgs],{capture:false});
else console.log('Notes-only startup: reference snapshot restore explicitly skipped.');
if(!process.argv.includes('--no-build'))await command('docker',['compose','build','web'],{capture:false});
if(!process.argv.includes('--skip-reference'))await command('docker',['compose','run','--rm','reference-publish'],{capture:false});
await command('docker',['compose','up','-d','--no-build','--wait','web','journal-worker'],{capture:false});
console.log('Компас готов: '+(process.env.COMPASS_LOCAL_ORIGIN||'http://127.0.0.1:4174/'));
