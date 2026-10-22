import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {publishReferenceFiles} from '../server/publish-reference-files.mjs';
const password=(await readFile(process.env.DB_PASSWORD_FILE,'utf8')).trim();
const pool=new pg.Pool({host:process.env.DB_HOST||'db',port:Number(process.env.DB_PORT||5432),database:process.env.DB_NAME||'compass',user:'compass_admin',password,max:1});
const client=await pool.connect(),args=process.argv.slice(2),at=args.indexOf('--document');
try{console.log(JSON.stringify(await publishReferenceFiles(client,{id:at>=0?args[at+1]:undefined,indexOnly:args.includes('--index-only'),verify:args.includes('--verify'),onDocument:value=>console.log(JSON.stringify(value))})));}
finally{client.release();await pool.end();}
