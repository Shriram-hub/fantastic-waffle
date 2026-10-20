// Runs in the isolated extension world on the explicitly paired app origin.
(()=>{
  if(globalThis.__orbitBridgeInstalled)return;globalThis.__orbitBridgeInstalled=true;
  window.addEventListener('message',event=>{
    if(event.source!==window || event.origin!==location.origin || event.data?.type!=='orbit:start-batch' || typeof event.data.requestId!=='string')return;
    chrome.runtime.sendMessage({type:'workspace-batch',taskIds:event.data.taskIds}).then(result=>window.postMessage({type:'orbit:batch-result',requestId:event.data.requestId,...result},location.origin)).catch(()=>window.postMessage({type:'orbit:batch-result',requestId:event.data.requestId,error:'Reconnect the Orbit extension.'},location.origin));
  });
})();
