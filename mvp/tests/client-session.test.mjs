import {test} from 'node:test';
import assert from 'node:assert/strict';

test('a delayed session refresh cannot overwrite the CSRF token of a newly signed-in account',async()=>{
  const original=globalThis.fetch,oldWindow=globalThis.window;
  globalThis.window=new EventTarget();
  let delayed=false,release,started;
  const pending=new Promise(resolve=>{started=resolve;});
  const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  globalThis.fetch=async(path,options)=>{
    if(path==='/api/session'){
      if(delayed){started();return new Promise(resolve=>{release=()=>resolve(response({csrfToken:'old-csrf'}));});}
      return response({csrfToken:'old-csrf'});
    }
    if(path==='/api/auth/login')return response({account:{id:'new-account',role:'patient'},csrfToken:'new-csrf'});
    if(path==='/api/auth')return response({account:{id:'old-account',role:'patient'}});
    if(path==='/api/entries/note'){
      assert.equal(options.headers['X-CSRF-Token'],'new-csrf');
      return response({id:'note'});
    }
    assert.fail('Unexpected request '+path);
  };
  try{
    const client=await import('../src/persistence.js');await client.loadAuthAccount('patient');
    delayed=true;const stale=client.loadAuthAccount('patient');const rejected=assert.rejects(stale,{code:'STALE_AUTH_REFRESH'});await pending;
    await client.authenticateAccount('login',{role:'patient',email:'synthetic@example.invalid',password:'synthetic-only-password'});
    release();await rejected;await client.storeEntry({id:'note'});
  }finally{globalThis.fetch=original;if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;}
});
