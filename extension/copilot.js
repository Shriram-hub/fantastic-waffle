(()=>{
  if(window.top!==window || globalThis.__orbitCopilotInstalled)return;globalThis.__orbitCopilotInstalled=true;
  const host=document.createElement('div');host.id='orbit-career-copilot';host.style.cssText='position:fixed;right:20px;bottom:20px;z-index:2147483647;';
  const root=host.attachShadow({mode:'closed'}),style=document.createElement('style');
  style.textContent='*{box-sizing:border-box}button{font:inherit;cursor:pointer}#launch{border:0;border-radius:30px;background:#152b46;color:#fff;padding:13px 20px;box-shadow:0 4px 24px #0003}section{font:14px/1.5 system-ui,sans-serif;width:330px;max-height:75vh;overflow:auto;background:#fff;color:#162a43;border:1px solid #cad5df;border-radius:16px;padding:20px;box-shadow:0 10px 45px #0003}h2{margin:0;font-size:20px}h3{font-size:14px;margin-bottom:5px}p{margin:8px 0}small{color:#566878}button.action{display:block;width:100%;padding:10px;margin-top:10px;border:1px solid #cbd5df;border-radius:8px;background:#f4f7fa;color:#162a43}button.primary{background:#183958;color:white}#close{float:right;background:none;border:0;font-size:20px}li{margin-bottom:6px}[hidden]{display:none!important}';
  const launch=document.createElement('button');launch.id='launch';launch.textContent='◌ Orbit Copilot';launch.setAttribute('aria-expanded','false');
  const panel=document.createElement('section');panel.hidden=true;panel.setAttribute('aria-label','Orbit career copilot');
  const close=document.createElement('button');close.id='close';close.textContent='×';close.setAttribute('aria-label','Close copilot');
  const title=document.createElement('h2');title.textContent='Application copilot';
  const status=document.createElement('p');status.setAttribute('role','status');
  const content=document.createElement('div');
  const button=(label,type,primary=false)=>{const b=document.createElement('button');b.className=`action ${primary ? 'primary' : ''}`;b.textContent=label;b.addEventListener('click',async event=>{if(!event.isTrusted)return;b.disabled=true;try{const r=await chrome.runtime.sendMessage({type});status.textContent=r.error || r.message || 'Ready for review.';if(!r.error)await refresh();}catch{status.textContent='Pair or reconnect your extension in its popup.';}finally{b.disabled=false;}});return b;};
  async function refresh(){
    const companyPage=/(^|\.)linkedin\.com$/.test(location.hostname) && /^\/(?:company\/|jobs\/view\/)/.test(location.pathname);
    if(companyPage){content.replaceChildren(button('Pull company recruiters to Orbit','pull-company-recruiters',true));status.textContent='Import names, roles and public profile links already visible on this page. Email suggestions require mailbox verification.';if(location.pathname.startsWith('/company/'))return;}
    try {const data=await chrome.runtime.sendMessage({type:'copilot-context'});content.replaceChildren();
      if(data.error){status.textContent=data.error;return;}
      if(!data.matched){status.textContent=data.message;if(companyPage)content.append(button('Pull company recruiters to Orbit','pull-company-recruiters',true));return;}
      status.textContent=`${data.job.company} · ${data.job.title}`;
      if(companyPage)content.append(button('Pull company recruiters to Orbit','pull-company-recruiters',true));
      const match=document.createElement('h3');match.textContent=data.match.score===null ? 'Set target roles in Orbit' : `${data.match.score}% profile match`;content.append(match);
      const keywords=document.createElement('p');keywords.textContent=data.missingKeywords.length ? `Keywords to review: ${data.missingKeywords.join(', ')}` : 'No gaps found among the checked keywords.';content.append(keywords);
      const note=document.createElement('small');note.textContent=data.note;content.append(note);
      const heading=document.createElement('h3');heading.textContent='Hiring contacts';content.append(heading);
      for(const contact of data.contacts){const p=document.createElement('p');p.textContent=`${contact.name} · ${contact.title} · ${contact.emailStatus}`;content.append(p);}
      if(!data.contacts.length){const p=document.createElement('p');p.textContent='No contacts discovered for this role yet.';content.append(p);}
      content.append(button('Autofill & tailor documents','copilot-fill',true));
      const review=document.createElement('small');review.textContent='Review the PDFs in Orbit and every form field. Submit the application yourself.';content.append(review);
      if(data.batch?.remaining){const p=document.createElement('p');p.textContent=`Batch: ${data.batch.completed}/${data.batch.total} confirmed · ${data.batch.paused ? 'paused' : 'waiting for your submission'}`;content.append(p,button(data.batch.paused ? 'Resume batch' : 'Pause batch',data.batch.paused ? 'batch-resume' : 'batch-pause'),button('Skip this application','batch-skip'));}
    }catch{status.textContent='Pair the Orbit extension to use your saved profile.';}
  }
  launch.addEventListener('click',event=>{if(!event.isTrusted)return;panel.hidden=false;launch.hidden=true;launch.setAttribute('aria-expanded','true');refresh();});
  close.addEventListener('click',()=>{panel.hidden=true;launch.hidden=false;launch.setAttribute('aria-expanded','false');});
  panel.append(close,title,status,content);root.append(style,launch,panel);document.documentElement.append(host);
})();
