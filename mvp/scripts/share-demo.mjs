import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const run = (command, args) => execFileSync(command, args, { cwd:root, stdio:'inherit' });
if (process.argv.includes('--stop')) {
  run('docker',['compose','--env-file','.demo-runtime.env','-f','compose.demo.yaml','stop']);
  console.log('Internet demo stopped. Database volume preserved.');
} else {
  run('node',['scripts/init-local-secrets.mjs','--demo']);
  run('docker',['compose','-f','compose.demo.yaml','up','-d','--build','--force-recreate','tunnel']);
  let origin;
  for(let attempt=0;attempt<80;attempt++) {
    const output=execFileSync('docker',['compose','-f','compose.demo.yaml','logs','--no-log-prefix','--tail','30','tunnel'],{encoding:'utf8'});
    origin=[...output.matchAll(/https:\/\/[a-z0-9-]+\.tunnelmole\.net\b/g)].at(-1)?.[0];
    if(origin) break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(!origin) throw new Error('Tunnel did not start. Inspect the private tunnel log.');
  await writeFile('.demo-runtime.env',`DEMO_ORIGIN=${origin}\n`,{mode:0o600});
  run('docker',['compose','--env-file','.demo-runtime.env','-f','compose.demo.yaml','up','-d','db','web','gate']);
  console.log(`Demo URL: ${origin}`);
  console.log('Access code is stored separately in .demo-secrets/demo_access_code.');
}
