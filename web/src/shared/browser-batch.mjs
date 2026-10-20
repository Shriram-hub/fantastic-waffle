export function startBrowserBatch(taskIds) {
  return new Promise(resolve=>{
    const requestId=crypto.randomUUID();
    const done=message=>{window.removeEventListener('message',listener);clearTimeout(timer);resolve(message);};
    const listener=event=>{if(event.source===window && event.origin===location.origin && event.data?.type==='orbit:batch-result' && event.data.requestId===requestId)done(event.data.error || event.data.message || 'The first application is ready for your review.');};
    const timer=setTimeout(()=>done('Applications queued. Pair/reload extension 0.7, refresh Orbit, then use Open & fill next application.'),4000);
    window.addEventListener('message',listener);window.postMessage({type:'orbit:start-batch',taskIds,requestId},location.origin);
  });
}
