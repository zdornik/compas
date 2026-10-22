// Portable stream of hash-addressed public originals. Never scans arbitrary folders.
import {createHash} from 'node:crypto';
import {openBlob,writeBlob,BLOB_KEY} from '../server/reference-files.mjs';
const MAGIC='COMPASS-REFERENCE-OBJECTS-1\n';
export function validateObjects(value){
 if(value?.format!=='compass-reference-objects-v1'||!Array.isArray(value.entries)||!value.entries.length||value.entries.length>1000000||!Array.isArray(value.parts)||!value.parts.length||!BLOB_KEY.test(value.sha256))throw new Error('Invalid reference object manifest');
 const keys=new Set();for(const entry of value.entries){if(!BLOB_KEY.test(entry.sha256)||keys.has(entry.sha256)||!Number.isSafeInteger(entry.bytes)||entry.bytes<1)throw new Error('Invalid reference object');keys.add(entry.sha256);}
 let bytes=0;for(const [i,part]of value.parts.entries()){
  if(part.index!==i+1||!/^reference-db-[a-zA-Z0-9._-]+\.objects-\d{4}$/.test(part.name)||!part.name.endsWith('.objects-'+String(i+1).padStart(4,'0'))||!Number.isSafeInteger(part.assetId)||part.assetId<1||!BLOB_KEY.test(part.sha256)||!Number.isSafeInteger(part.bytes)||part.bytes<1||part.bytes>=2*1024**3)throw new Error('Invalid reference object part');bytes+=part.bytes;
 }
 const expected=Buffer.byteLength(MAGIC)+value.entries.reduce((sum,entry)=>sum+Buffer.byteLength(entry.sha256+' '+entry.bytes+'\n')+entry.bytes,0);
 if(bytes!==value.bytes||bytes!==expected)throw new Error('Invalid reference object inventory size');return value;
}
export async function* packObjects(root,entries){
 yield Buffer.from(MAGIC);
 for(const entry of entries){
  const file=await openBlob(root,entry.sha256,entry.bytes),hash=createHash('sha256');
  try{
   yield Buffer.from(entry.sha256+' '+entry.bytes+'\n');
   for await(const chunk of file.createReadStream({autoClose:false,highWaterMark:256*1024})){hash.update(chunk);yield chunk;}
   if(hash.digest('hex')!==entry.sha256)throw new Error('Corrupt reference object during export');
  }finally{await file.close();}
 }
}
export async function unpackObjects(root,entries,source){
 const iterator=source[Symbol.asyncIterator]();let buffer=Buffer.alloc(0);
 async function read(max){
  while(!buffer.length){const next=await iterator.next();if(next.done)return null;buffer=Buffer.from(next.value);}
  const part=buffer.subarray(0,max);buffer=buffer.subarray(part.length);return part;
 }
 async function line(){let value='';for(;;){const byte=await read(1);if(!byte||value.length>128)throw new Error('Invalid object archive header');value+=byte.toString('ascii');if(byte[0]===10)return value;}}
 if(await line()!==MAGIC)throw new Error('Invalid reference object archive');
 for(const entry of entries){
  if(await line()!==entry.sha256+' '+entry.bytes+'\n')throw new Error('Reference object inventory mismatch');
  async function* bytes(){let remaining=entry.bytes;while(remaining){const chunk=await read(Math.min(remaining,256*1024));if(!chunk)throw new Error('Truncated reference object');remaining-=chunk.length;yield chunk;}}
  await writeBlob(root,entry.sha256,bytes());
 }
 if(await read(1))throw new Error('Unexpected data after reference objects');
}
