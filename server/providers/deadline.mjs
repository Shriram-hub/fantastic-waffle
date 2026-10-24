// A provider deadline bounds both cooperative network I/O and injected adapters.
export async function withDeadline(run,milliseconds=4000,parentSignal) {
  const controller=new AbortController();
  const signal=parentSignal ? AbortSignal.any([parentSignal,controller.signal]) : controller.signal;
  let timer,listener;
  try {
    return await Promise.race([Promise.resolve().then(()=>{signal.throwIfAborted();return run(signal);}),new Promise((_,reject)=>{
      listener=()=>reject(signal.reason || new DOMException('Provider deadline reached','TimeoutError'));
      signal.addEventListener('abort',listener,{once:true});
      timer=setTimeout(()=>controller.abort(new DOMException('Provider deadline reached','TimeoutError')),milliseconds);
      if(signal.aborted)listener();
    })]);
  } finally {clearTimeout(timer);if(listener)signal.removeEventListener('abort',listener);controller.abort();}
}
export const boundedFetcher=(fetcher,signal)=>(url,init={})=>fetcher(url,{...init,signal:init.signal ? AbortSignal.any([init.signal,signal]) : signal});
