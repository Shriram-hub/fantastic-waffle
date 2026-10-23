(()=>{
  if(window.top!==window || globalThis.__orbitCopilotInstalled)return;globalThis.__orbitCopilotInstalled=true;
  const host=document.createElement('div');host.id='orbit-career-copilot';host.style.cssText='all:initial!important;position:fixed!important;right:20px!important;bottom:20px!important;left:auto!important;top:auto!important;z-index:2147483647!important;display:block!important;';
  const root=host.attachShadow({mode:'open'}),style=document.createElement('style');
  style.textContent=`
    :host{all:initial;color-scheme:dark;font:13px/1.6 Inter,system-ui,sans-serif}
    *,*::before,*::after{box-sizing:border-box}button{font:inherit;cursor:pointer;line-height:1.5;text-transform:none;letter-spacing:normal}button:focus-visible{outline:2px solid #22d3ee;outline-offset:3px}button:disabled{opacity:.5}
    #launch{display:flex;align-items:center;gap:9px;border:1px solid #ffffff20;border-radius:30px;background:#111827;color:#fff;padding:13px 19px;font-size:12px;font-weight:600;box-shadow:0 8px 35px #0006;white-space:nowrap}
    section{font:12px/1.7 Inter,system-ui,sans-serif;width:min(355px,calc(100vw - 32px));max-height:80vh;overflow:auto;background:#111827;backdrop-filter:blur(24px);color:#edf2fc;border:1px solid #ffffff1c;border-radius:18px;padding:23px;box-shadow:0 18px 70px #0007;text-align:left}
    h2{margin:0 0 18px;font-size:18px;font-weight:600;letter-spacing:-.5px}h3{font-size:12px;margin:20px 0 8px;color:#c4bfff;font-weight:600}p{margin:10px 0;font-size:12px;line-height:1.8;overflow-wrap:anywhere}small{color:#94a3b8;font-size:10px;line-height:1.8}
    button.action{display:block;width:100%;padding:11px 13px;margin:12px 0;border:1px solid #ffffff14;border-radius:8px;background:#1b263a;color:#edf2fc;font-size:11px;text-align:center}button.action:hover{background:#25334c}button.primary{background:#4f46e5;border-color:#7971fa;color:white}button.primary:hover{background:#5f56f0}
    #close{float:right;background:none;border:0;font-size:22px;color:#94a3b8;width:24px;height:24px;padding:0}#close:hover{color:#fff}#status{padding:12px;border:1px solid #ffffff14;background:#ffffff04;border-radius:8px;color:#a8b6cc}li{margin-bottom:6px}[hidden]{display:none!important}
  `;
  const launch=document.createElement('button');launch.id='launch';launch.textContent='Veloce Application assistant';launch.setAttribute('aria-expanded','false');
  const panel=document.createElement('section');panel.hidden=true;panel.setAttribute('aria-label','Veloce application assistant');
  const close=document.createElement('button');close.id='close';close.textContent='×';close.setAttribute('aria-label','Close assistant');
  const title=document.createElement('h2');title.textContent='Application assistant';
  const status=document.createElement('p');status.setAttribute('role','status');
  const content=document.createElement('div');
  const button=(label,type,primary=false)=>{const b=document.createElement('button');b.className=`action ${primary ? 'primary' : ''}`;b.textContent=label;b.addEventListener('click',async event=>{if(!event.isTrusted)return;b.disabled=true;try{const r=await chrome.runtime.sendMessage({type});status.textContent=r.error || r.message || 'Ready for review.';if(!r.error)await refresh();}catch{status.textContent='Pair or reconnect your extension in its popup.';}finally{b.disabled=false;}});return b;};
  async function refresh(){
    const companyPage=/(^|\.)linkedin\.com$/.test(location.hostname) && /^\/(?:company\/|jobs\/view\/)/.test(location.pathname);
    if(companyPage){content.replaceChildren(button('Pull company recruiters to Veloce','pull-company-recruiters',true));status.textContent='Import names, roles and public profile links already visible on this page. Email suggestions require mailbox verification.';if(location.pathname.startsWith('/company/'))return;}
    try {const data=await chrome.runtime.sendMessage({type:'copilot-context'});content.replaceChildren();
      if(data.error){status.textContent=data.error;return;}
      if(!data.matched){status.textContent=data.message;if(companyPage)content.append(button('Pull company recruiters to Veloce','pull-company-recruiters',true));return;}
      status.textContent=`${data.job.company} · ${data.job.title}`;
      if(companyPage)content.append(button('Pull company recruiters to Veloce','pull-company-recruiters',true));
      const match=document.createElement('h3');match.textContent=data.match.score===null ? 'Set target roles in Veloce' : `${data.match.score}% profile match`;content.append(match);
      const keywords=document.createElement('p');keywords.textContent=data.missingKeywords.length ? `Keywords to review: ${data.missingKeywords.join(', ')}` : 'No gaps found among the checked keywords.';content.append(keywords);
      const note=document.createElement('small');note.textContent=data.note;content.append(note);
      const heading=document.createElement('h3');heading.textContent='Hiring contacts';content.append(heading);
      for(const contact of data.contacts){const p=document.createElement('p');p.textContent=`${contact.name} · ${contact.title} · ${contact.emailStatus}`;content.append(p);}
      if(!data.contacts.length){const p=document.createElement('p');p.textContent='No contacts discovered for this role yet.';content.append(p);}
      content.append(button('Autofill & tailor documents','copilot-fill',true));
      const review=document.createElement('small');review.textContent='Review the PDFs in Veloce and every form field. Submit the application yourself.';content.append(review);
      if(data.batch?.remaining){const p=document.createElement('p');p.textContent=`Batch: ${data.batch.completed}/${data.batch.total} confirmed · ${data.batch.paused ? 'paused' : 'waiting for your submission'}`;content.append(p,button(data.batch.paused ? 'Resume batch' : 'Pause batch',data.batch.paused ? 'batch-resume' : 'batch-pause'),button('Skip this application','batch-skip'));}
    }catch{status.textContent='Pair the Veloce extension to use your saved profile.';}
  }
  launch.addEventListener('click',event=>{if(!event.isTrusted)return;panel.hidden=false;launch.hidden=true;launch.setAttribute('aria-expanded','true');refresh();});
  const hide=()=>{panel.hidden=true;launch.hidden=false;launch.setAttribute('aria-expanded','false');launch.focus();};close.addEventListener('click',hide);panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();hide();}});
  panel.append(close,title,status,content);root.append(style,launch,panel);document.documentElement.append(host);
})();
