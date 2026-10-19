// Runs only on supported ATS origins, in every permitted frame. Submission is
// reported as pending; only an explicit ATS success panel can confirm it.
(() => {
  const roots=new WeakSet();let scheduled=false,lastEvidence='';
  const selectors=['#application_confirmation','#application-confirmation','.application-confirmation','[data-testid="application-success"]','[data-automation-id="congratulationsMessage"]','.artdeco-modal h2'];
  const success=/thank you for applying|application (?:has been )?(?:submitted|received|sent)|we have received your application|successfully submitted/i;
  const message=value=>chrome.runtime.sendMessage(value).catch(()=>{});
  function scan(root=document) {
    if(!roots.has(root)) {
      roots.add(root);
      root.addEventListener('submit',()=>message({type:'submission-attempt'}),true);
      root.addEventListener('click',event=>{
        const button=event.composedPath().find(el=>el?.matches?.('button,input[type="submit"]'));
        if(button && /^(submit(?: application)?|send application|apply)$/i.test((button.textContent || button.value || '').trim()))message({type:'submission-attempt'});
      },true);
      new MutationObserver(()=>{if(!scheduled){scheduled=true;setTimeout(()=>{scheduled=false;scan();},300);}}).observe(root,{childList:true,subtree:true,characterData:true});
    }
    for(const element of root.querySelectorAll(selectors.join(','))) {
      const evidence=element.textContent.trim().slice(0,500);
      if(success.test(evidence) && evidence !== lastEvidence) {lastEvidence=evidence;message({type:'application-confirmation',evidence});}
    }
    for(const element of root.querySelectorAll('*')) if(element.shadowRoot)scan(element.shadowRoot);
  }
  scan();
})();
