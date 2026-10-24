(()=>{
  if(window.top!==window || globalThis.__veloceCopilotVersion==='0.11.0')return;globalThis.__orbitCopilotInstalled=true;globalThis.__veloceCopilotVersion='0.11.0';
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
  let contactTools=null;const usedIntents=new Set();
  function peopleTools(){
    contactTools?.dispose();content.replaceChildren();title.textContent=location.pathname.startsWith('/in/')?'LinkedIn email finder':'People harvester';
    if(!globalThis.VeloceContactUI){status.textContent='Refresh this LinkedIn tab after loading the updated Veloce extension.';return;}
    const params=new URLSearchParams(location.hash.slice(1)),intent=params.get('veloce_intent') || '',company=params.get('company') || '',page=location.href;
    contactTools=globalThis.VeloceContactUI.create(content,{send:message=>chrome.runtime.sendMessage(message),status,kind:location.pathname.startsWith('/in/')?'profile':'people',pageUrl:()=>location.href,intent,initialCompany:company});
    const tools=contactTools;
    if(intent && !usedIntents.has(intent)){usedIntents.add(intent);void tools.ready.then(ctx=>{if(ctx?.autoAuthorized && location.href===page && contactTools===tools){panel.hidden=false;launch.hidden=true;return tools.run({targetCount:ctx.targetCount,allowCredits:false,allowSearch:false});}});}
  }
  async function refresh(){
    if(/(^|\.)linkedin\.com$/.test(location.hostname) && /^\/(?:in\/|company\/|search\/results\/people)/.test(location.pathname)){peopleTools();return;}
    contactTools?.dispose();contactTools=null;title.textContent='Application assistant';
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
  launch.addEventListener('click',event=>{if(!event.isTrusted)return;panel.hidden=false;launch.hidden=true;launch.setAttribute('aria-expanded','true');if(!contactTools)refresh();});
  const hide=()=>{panel.hidden=true;launch.hidden=false;launch.setAttribute('aria-expanded','false');launch.focus();};close.addEventListener('click',hide);panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();hide();}});
  let lastURL=location.href,inlineHost=null;
  function openContacts(){panel.hidden=false;launch.hidden=true;launch.setAttribute('aria-expanded','true');if(!contactTools)peopleTools();return contactTools;}
  function inlineAction(){
    const linkedin=/(^|\.)linkedin\.com$/.test(location.hostname),profile=linkedin && location.pathname.startsWith('/in/'),supported=linkedin && /^\/(?:in\/|company\/|search\/results\/people)/.test(location.pathname);
    if(linkedin && !supported && !location.pathname.startsWith('/jobs/')){host.style.setProperty('display','none','important');}else host.style.setProperty('display','block','important');
    if(!profile){inlineHost?.remove();inlineHost=null;return;}
    if(inlineHost?.isConnected)return;
    const heading=document.querySelector('main h1,h1');if(!heading)return;
    const header=heading.closest('section,[data-view-name*="profile-top-card"],.pv-top-card') || heading.parentElement,actions=header?.querySelector('.pv-top-card-v2-ctas,.pvs-profile-actions,button[aria-label*="Message" i],button[aria-label*="Connect" i]');
    inlineHost=document.createElement('span');inlineHost.id='veloce-inline-email';inlineHost.style.cssText='display:inline-block!important;margin:8px!important;position:relative!important;z-index:10!important;';
    const shadow=inlineHost.attachShadow({mode:'open'}),css=document.createElement('style');css.textContent=':host{all:initial}button{font:600 12px/1.5 Inter,system-ui,sans-serif;background:#4f46e5;color:white;border:1px solid #8b83ff;border-radius:24px;padding:9px 15px;cursor:pointer}button:focus-visible{outline:2px solid #06b6d4;outline-offset:2px}';
    const button=document.createElement('button');button.textContent='Get Email (Veloce)';button.addEventListener('click',event=>{if(event.isTrusted)void openContacts()?.run();});shadow.append(css,button);(actions?.parentElement || header || heading.parentElement).append(inlineHost);
  }
  const update=()=>{
    const changed=lastURL!==location.href;if(changed){lastURL=location.href;contactTools?.dispose();contactTools=null;content.replaceChildren();inlineHost?.remove();inlineHost=null;if(!panel.hidden)refresh();}
    launch.textContent=/(^|\.)linkedin\.com$/.test(location.hostname) && location.pathname.startsWith('/in/')?'Veloce · Get email':'Veloce Application assistant';
    inlineAction();if(!host.isConnected)document.documentElement.append(host);
    if(location.hash.includes('veloce_harvest=') && !contactTools && /^\/search\/results\/people/.test(location.pathname))openContacts();
  };
  window.addEventListener('popstate',update);setInterval(update,1000);
  panel.append(close,title,status,content);root.append(style,launch,panel);document.documentElement.append(host);update();
})();
