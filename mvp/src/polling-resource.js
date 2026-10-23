// Ephemeral, owner-scoped resources. Discard responses when the last reader leaves.
export function createPollingResources({visible=()=>true,now=Date.now,schedule=setTimeout,cancel=clearTimeout}={}) {
  const resources=new Map();
  const emit=resource=>{for(const listener of resource.listeners)listener(resource.state);};
  const stop=resource=>{
    if(resource.disposed)return;
    resource.disposed=true;
    cancel(resource.timer);
    resource.controller?.abort();
    resource.state={data:null,error:'',loading:true};
    emit(resource);
    if(resources.get(resource.key)===resource)resources.delete(resource.key);
  };
  const later=(resource,delay)=>{
    cancel(resource.timer);
    if(!resource.disposed)resource.timer=schedule(()=>refresh(resource),delay);
  };
  async function refresh(resource,invalidate=false) {
    if(resource.disposed||!visible())return;
    if(invalidate&&[401,403,404,409].includes(resource.lastStatus))resource.retryAt=0;
    if(resource.pending){resource.dirty ||= invalidate;return resource.pending;}
    if(resource.retryAt>now()){later(resource,resource.retryAt-now());return;}
    cancel(resource.timer);
    resource.controller=new AbortController();
    const controller=resource.controller;
    resource.pending=(async()=>{
      try {
        const data=await Promise.resolve().then(()=>resource.load(controller.signal));
        if(resource.disposed||controller.signal.aborted)return;
        resource.failures=0;resource.retryAt=0;resource.lastStatus=null;
        resource.state={data,error:'',loading:false};emit(resource);
        return data;
      } catch(error) {
        if(resource.disposed||controller.signal.aborted)return;
        resource.failures++;
        resource.lastStatus=error.status;
        const delay=Math.max(resource.interval*Math.min(2**resource.failures,16),Number(error.retryAfterMs)||0);
        resource.retryAt=now()+delay;
        // Permission/ownership failures must remove previously visible contents.
        const denied=[401,403,404,409].includes(error.status);
        resource.state={data:denied?null:resource.state.data,error:error.message,loading:false};emit(resource);
      } finally {
        resource.pending=null;
        if(!resource.disposed){
          if(resource.dirty){resource.dirty=false;later(resource,Math.max(0,resource.retryAt-now()));}
          else later(resource,Math.max(resource.interval,resource.retryAt-now()));
        }
      }
    })();
    return resource.pending;
  }
  return {
    subscribe(key,load,listener,interval=15000){
      let resource=resources.get(key);
      if(!resource){resource={key,load,interval,listeners:new Set(),state:{data:null,error:'',loading:true},failures:0,retryAt:0,disposed:false,dirty:false};resources.set(key,resource);}
      resource.listeners.add(listener);listener(resource.state);
      if(!resource.pending&&!resource.timer)void refresh(resource);
      return ()=>{resource.listeners.delete(listener);if(!resource.listeners.size)stop(resource);};
    },
    reload(key){const resource=resources.get(key);return resource?refresh(resource,true):Promise.resolve();},
    refreshAll(){for(const resource of resources.values())void refresh(resource,true);},
    clearRole(role){for(const resource of resources.values())if(resource.key.startsWith(role+':'))stop(resource);},
  };
}

export const pollingResources=createPollingResources({visible:()=>typeof document==='undefined'||!document.hidden});
