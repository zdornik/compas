import {test} from 'node:test';
import assert from 'node:assert/strict';

const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const csrfRejected=()=>json({error:'Проверка запроса не пройдена',code:'CSRF_INVALID'},403);
let clientCase=0;
async function withClient(fetch,run){
  const original=globalThis.fetch,oldWindow=globalThis.window;
  globalThis.fetch=fetch;globalThis.window=new EventTarget();
  try{return await run(await import('../src/persistence.js?csrf-case='+ ++clientCase));}
  finally{globalThis.fetch=original;if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;}
}

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

test('login recovers an anonymous token replaced by another tab and retains the discovered role',async()=>{
  let reads=0;const attempts=[];
  await withClient(async(path,options)=>{
    if(path==='/api/session')return json({csrfToken:++reads===1?'old-anonymous':'current-anonymous'});
    if(path==='/api/auth/login'){
      attempts.push(options);
      if(attempts.length===1)return csrfRejected();
      assert.equal(options.headers['X-CSRF-Token'],'current-anonymous');
      return json({account:{id:'doctor-id',role:'doctor'},csrfToken:'doctor-csrf'});
    }
    if(path==='/api/appointments'){
      assert.equal(options.headers['X-Compass-Role'],'doctor');
      assert.equal(options.headers['X-CSRF-Token'],'doctor-csrf');
      return json({items:[]});
    }
    assert.fail('Unexpected request '+path);
  },async client=>{
    const result=await client.authenticateAccount('login',{role:'patient',discoverRole:true,email:'doctor@example.invalid',password:'Synthetic-password-2026'});
    assert.equal(result.account.role,'doctor');
    await client.appointmentRequest('/api/appointments',{role:'doctor'});
  });
  assert.equal(reads,2);assert.equal(attempts.length,2);
  assert.equal(attempts[0].body,attempts[1].body);
});

test('concurrent stale-token saves share recovery and preserve their original owner and bodies',async()=>{
  let reads=0,release,started;const recovering=new Promise(resolve=>{started=resolve;}),attempts=new Map();
  await withClient(async(path,options)=>{
    if(path==='/api/session'){
      if(++reads===1)return json({csrfToken:'old-csrf'});
      started();return new Promise(resolve=>{release=()=>resolve(json({csrfToken:'current-csrf'}));});
    }
    if(path==='/api/state')return json({entries:[]});
    if(path.startsWith('/api/entries/')){
      const values=attempts.get(path)||[];values.push(options);attempts.set(path,values);
      if(values.length===1)return csrfRejected();
      assert.equal(options.headers['X-Compass-Account'],'patient-a');
      assert.equal(options.headers['X-CSRF-Token'],'current-csrf');
      assert.equal(options.body,values[0].body);
      return json({id:JSON.parse(options.body).id});
    }
    assert.fail('Unexpected request '+path);
  },async client=>{
    client.setAccountOwner('patient','patient-a');await client.loadStoredState();
    const saves=Promise.all(['one','two'].map(id=>client.storeEntry({id,body:'Synthetic draft '+id})));
    await recovering;release();await saves;
  });
  assert.equal(reads,2);assert.deepEqual([...attempts.values()].map(rows=>rows.length),[2,2]);
});

test('a client account change during token recovery prevents replay of a private write',async()=>{
  for(const expired of [false,true]){
    let reads=0,writes=0,mismatches=0,release,started;const recovering=new Promise(resolve=>{started=resolve;});
    await withClient(async(path,options)=>{
      if(path==='/api/session'){
        if(++reads===1)return json({csrfToken:'old-csrf'});
        if(reads===3)return json({csrfToken:'new-owner-csrf'});
        started();return new Promise(resolve=>{release=()=>resolve(expired?json({error:'Old session expired'},401):json({csrfToken:'other-csrf'}));});
      }
      if(path==='/api/state')return json({entries:[]});
      if(path==='/api/auth')return json({account:{id:'patient-b',role:'patient'}});
      if(path==='/api/entries/note'){writes++;return csrfRejected();}
      if(path==='/api/entries/new-note'){
        assert.equal(options.headers['X-CSRF-Token'],'new-owner-csrf');
        assert.equal(options.headers['X-Compass-Account'],'patient-b');return json({id:'new-note'});
      }
      assert.fail('Unexpected request '+path);
    },async client=>{
      window.addEventListener('compass-account-mismatch',()=>mismatches++);
      client.setAccountOwner('patient','patient-a');await client.loadStoredState();
      const rejected=assert.rejects(client.storeEntry({id:'note',body:'Owner A draft'}),expired?{status:401}:{code:'STALE_AUTH_REFRESH'});
      await recovering;client.setAccountOwner('patient','patient-b');await client.loadAuthAccount('patient');release();await rejected;
      await client.storeEntry({id:'new-note',body:'Owner B draft'});
    });
    assert.equal(writes,1);assert.equal(mismatches,0);
  }
});

test('server account changes retain the old owner hint and quarantine instead of saving to another account',async()=>{
  let reads=0,writes=0,mismatches=0;
  await withClient(async(path,options)=>{
    if(path==='/api/session')return json({csrfToken:++reads===1?'old-csrf':'other-account-csrf'});
    if(path==='/api/state')return json({entries:[]});
    if(path==='/api/entries/note'){
      assert.equal(options.headers['X-Compass-Account'],'patient-a');
      return ++writes===1?csrfRejected():json({error:'Account changed',code:'ACCOUNT_CHANGED'},409);
    }
    assert.fail('Unexpected request '+path);
  },async client=>{
    window.addEventListener('compass-account-mismatch',event=>{assert.equal(event.detail,'patient');mismatches++;});
    client.setAccountOwner('patient','patient-a');await client.loadStoredState();
    await assert.rejects(client.storeEntry({id:'note',body:'Owner A draft'}),{code:'ACCOUNT_CHANGED'});
  });
  assert.equal(writes,2);assert.equal(mismatches,1);
});

test('CSRF recovery is bounded and does not retry other permission or server failures',async()=>{
  for(const failure of [{status:403},{status:403,code:'ACCESS_DENIED'},{status:503,code:'CSRF_INVALID'},{status:403,code:'CSRF_INVALID'}]){
    let reads=0,writes=0;
    await withClient(async path=>{
      if(path==='/api/session')return json({csrfToken:++reads===1?'old-csrf':'current-csrf'});
      if(path==='/api/state')return json({entries:[]});
      if(path==='/api/entries/note'){writes++;return json({error:'Denied',code:failure.code},failure.status);}
      assert.fail('Unexpected request '+path);
    },async client=>{
      await client.loadStoredState();await assert.rejects(client.storeEntry({id:'note'}),{status:failure.status});
    });
    const recoverable=failure.status===403&&failure.code==='CSRF_INVALID';
    assert.equal(writes,recoverable?2:1);assert.equal(reads,recoverable?2:1);
  }
});

test('a session expiring during CSRF recovery never creates a guest session or repeats the private write',async()=>{
  let reads=0,writes=0,mismatches=0;
  await withClient(async(path,options)=>{
    assert.notEqual(options.method,'POST','Recovery must not create an anonymous session');
    if(path==='/api/session')return ++reads===1?json({csrfToken:'old-csrf'}):json({error:'Session expired'},401);
    if(path==='/api/state')return json({entries:[]});
    if(path==='/api/entries/note'){writes++;return csrfRejected();}
    assert.fail('Unexpected request '+path);
  },async client=>{
    window.addEventListener('compass-account-mismatch',()=>mismatches++);
    await client.loadStoredState();await assert.rejects(client.storeEntry({id:'note'}),{status:401});
  });
  assert.equal(writes,1);assert.equal(mismatches,1);
});

test('a delayed CSRF recovery cannot overwrite a newer sign-in token or replay its old draft',async()=>{
  let reads=0,writes=0,release,started;const recovering=new Promise(resolve=>{started=resolve;});
  await withClient(async(path,options)=>{
    if(path==='/api/session'){
      if(++reads===1)return json({csrfToken:'old-csrf'});
      started();return new Promise(resolve=>{release=()=>resolve(json({csrfToken:'stale-recovery-csrf'}));});
    }
    if(path==='/api/state')return json({entries:[]});
    if(path==='/api/auth/login')return json({account:{id:'new-account',role:'patient'},csrfToken:'new-login-csrf'});
    if(path==='/api/entries/old-draft'){writes++;return csrfRejected();}
    if(path==='/api/entries/new-draft'){
      assert.equal(options.headers['X-CSRF-Token'],'new-login-csrf');return json({id:'new-draft'});
    }
    assert.fail('Unexpected request '+path);
  },async client=>{
    await client.loadStoredState();
    const rejected=assert.rejects(client.storeEntry({id:'old-draft'}),{code:'STALE_AUTH_REFRESH'});
    await recovering;await client.authenticateAccount('login',{role:'patient',email:'new@example.invalid',password:'Synthetic-password-2026'});
    release();await rejected;await client.storeEntry({id:'new-draft'});
  });
  assert.equal(writes,1);
});
