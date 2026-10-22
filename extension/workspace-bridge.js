// Runs in the isolated extension world on the explicitly paired app origin.
(()=>{
  if(globalThis.__orbitBridgeInstalled)return;globalThis.__orbitBridgeInstalled=true;
  window.addEventListener('message',event=>{
    if(event.source===window && event.origin===location.origin && event.data?.type==='orbit:pair-extension' && typeof event.data.requestId==='string') {
      (async()=>{
        const response=await fetch('/api/extension/token',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'}),data=await response.json();
        if(!response.ok)throw Error('Sign in to Veloce AI before pairing.');
        return chrome.runtime.sendMessage({type:'workspace-pair',token:data.token,expiresAt:data.expiresAt});
      })().then(result=>window.postMessage({type:'orbit:pair-result',requestId:event.data.requestId,...result},location.origin)).catch(error=>window.postMessage({type:'orbit:pair-result',requestId:event.data.requestId,error:error.message},location.origin));
      return;
    }
    if(event.source!==window || event.origin!==location.origin || event.data?.type!=='orbit:start-batch' || typeof event.data.requestId!=='string')return;
    chrome.runtime.sendMessage({type:'workspace-batch',taskIds:event.data.taskIds}).then(result=>window.postMessage({type:'orbit:batch-result',requestId:event.data.requestId,...result},location.origin)).catch(()=>window.postMessage({type:'orbit:batch-result',requestId:event.data.requestId,error:'Reconnect the Veloce AI extension.'},location.origin));
  });
})();
