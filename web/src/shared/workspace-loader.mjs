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
