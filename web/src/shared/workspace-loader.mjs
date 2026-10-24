// Coordinate expensive, read-only bootstrap loads. React startup and the SSE
// ready event can arrive together; sharing a promise keeps them off the DB pool.
export function workspaceLoader(load,{delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),retries=2}={}) {
  let pending=null;
  return function read({fresh=false}={}) {
    if(pending)return fresh ? pending.then(()=>read()) : pending;
    const request=(async()=>{
      for(let attempt=0;;attempt++) {
        try{return await load();}catch(error){
          const transient=error instanceof TypeError || [500,502,503,504].includes(error.status);
          if(!transient || attempt>=retries)throw error;
          await delay(500*2**attempt);
        }
      }
    })();
    pending=request;
    const clear=()=>{if(pending===request)pending=null;};
    request.then(clear,clear);
    return request;
  };
}

// Own reconnect scheduling instead of stacking it on EventSource's fixed retry.
// Close the previous socket before reconnecting, and stop completely on logout.
export function connectWorkspaceEvents({handlers={},onConnection=()=>{},EventSourceClass=globalThis.EventSource,schedule=setTimeout,cancel=clearTimeout,random=Math.random}={}) {
  let stream,timer,closed=false,attempt=0;
  function connect() {
    if(closed)return;
    stream=new EventSourceClass('/api/events');
    stream.addEventListener('ready',event=>{attempt=0;onConnection(true);handlers.ready?.(event);});
    for(const [name,handler] of Object.entries(handlers))if(name!=='ready')stream.addEventListener(name,event=>{
      if(name==='auth-required'){close();onConnection(false);}handler(event);
    });
    stream.onerror=()=>{
      if(closed)return;stream.close();onConnection(false);cancel(timer);
      const delay=Math.min(30000,1000*2**Math.min(attempt++,5)*(.85+random()*.3));
      timer=schedule(connect,delay);
    };
  }
  function close(){closed=true;cancel(timer);stream?.close();}
  connect();return close;
}
