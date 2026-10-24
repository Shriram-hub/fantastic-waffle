export const embeddedWorkerEnabled=config=>(config.ENABLE_EMBEDDED_WORKER ?? config.RUN_EMBEDDED_WORKER ?? 'true')!=='false';

// An on-demand drain uses the same atomic queue claims and handlers as the
// supervised worker. Never move run_at forward or retry unknown outbound work.
const drains=new WeakMap();
export function requestQueueDrain(store,queue,config,fetcher) {
  if(drains.has(store))return drains.get(store);
  const promise=new Promise(resolve=>setImmediate(resolve)).then(async()=>{
    const {handlers,runOne}=await import('../worker.mjs'),registry=handlers(store,queue,config,fetcher);
    await queue.recover();let processed=0;
    while(processed<5){const task=await runOne(store,queue,registry);if(!task)break;processed++;}
    return {processed};
  }).catch(()=>({error:'Queue processing could not finish. Inspect Automation.'})).finally(()=>drains.delete(store));
  drains.set(store,promise);return promise;
}
