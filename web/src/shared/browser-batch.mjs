export function startBrowserBatch(taskIds) {
  return new Promise(resolve=>{
    const requestId=crypto.randomUUID();
    const done=message=>{window.removeEventListener('message',listener);clearTimeout(timer);resolve(message);};
    const listener=event=>{if(event.source===window && event.origin===location.origin && event.data?.type==='orbit:batch-result' && event.data.requestId===requestId)done(event.data.error || event.data.message || 'The first application is ready for your review.');};
    const timer=setTimeout(()=>done('Applications queued. Pair/reload extension 0.8, refresh Orbit, then use Open & fill next application.'),4000);
    window.addEventListener('message',listener);window.postMessage({type:'orbit:start-batch',taskIds,requestId},location.origin);
  });
}
export function pairBrowserExtension(){return new Promise(resolve=>{const requestId=crypto.randomUUID();const done=message=>{window.removeEventListener('message',listener);clearTimeout(timer);resolve(message);};const listener=event=>{if(event.source===window && event.origin===location.origin && event.data?.type==='orbit:pair-result' && event.data.requestId===requestId)done(event.data.error || event.data.message || 'Extension paired.');};const timer=setTimeout(()=>done('Install extension 0.8 from this workspace, refresh this page, then pair again.'),5000);window.addEventListener('message',listener);window.postMessage({type:'orbit:pair-extension',requestId},location.origin);});}
