const form = document.querySelector("#pair"),
  status = document.querySelector("#status");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = new FormData(form),
      u = new URL(data.get("base"));
    if (
      u.username ||
      u.password ||
      (u.protocol !== "https:" &&
        !["127.0.0.1", "localhost"].includes(u.hostname))
    )
      throw Error("Use HTTPS or a loopback Veloce address.");
    if (u.protocol === "https:") {
      const granted = await chrome.permissions.request({
        origins: [`${u.origin}/*`],
      });
      if (!granted)
        throw Error("Access to this Veloce address was not granted.");
    }
    await chrome.storage.session.set({
      base: u.origin,
      token: data.get("token"),
    });
    await chrome.runtime.sendMessage({type:'register-workspace'});
    status.textContent =
      "Paired. Add jobs to the queue, then open the next one.";
  } catch (error) {
    status.textContent = error.message;
  }
});
document.querySelector("#next").addEventListener("click", async (event) => {
  event.target.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: "next" });
    status.textContent = result.error || result.message;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    event.target.disabled = false;
  }
});
document.querySelector("#forget").addEventListener("click", async () => {
  await chrome.storage.session.clear();
  form.elements.token.value = "";
  status.textContent = "Connection forgotten.";
});
const saved = await chrome.storage.session.get(["base", "lastResult"]);
try{const connection=await chrome.runtime.sendMessage({type:'connection-status'});if(connection?.base)form.elements.base.value=connection.base;status.textContent=connection?.paired ? `Connected to ${connection.base}. Review and submit each application yourself.` : 'Open Veloce → Connections → Pair extension with this workspace.';}catch{status.textContent='Open Veloce Connections to pair this extension.';}
if(!saved.base)try{const configured=await (await fetch(chrome.runtime.getURL('config.json'))).json();if(configured.serverUrl)form.elements.base.value=configured.serverUrl;}catch{}
if (saved.base) form.elements.base.value = saved.base;
if (saved.lastResult)
  document.querySelector("#result").textContent =
    `${saved.lastResult.company}: ${saved.lastResult.status}. ${(saved.lastResult.missing || []).join(" ")}`;

document.querySelector("#refill").addEventListener("click", async () => {
  try {
    const result = await chrome.runtime.sendMessage({ type: "refill" });
    status.textContent = result.error || result.message;
  } catch (error) {
    status.textContent = error.message;
  }
});

async function activePageAccess() {
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.url || !tab.id)throw Error('Open the application or your LinkedIn profile first.');
  const url=new URL(tab.url);if(url.protocol!=='https:')throw Error('Use an HTTPS page.');
  const origins=new Set([`${url.origin}/*`]);
  const frames=await chrome.webNavigation.getAllFrames({tabId:tab.id});
  for(const frame of frames || [])try {const u=new URL(frame.url);if(u.protocol==='https:' && /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|smartrecruiters\.com|taleo\.net|icims\.com)$/.test(u.hostname))origins.add(`${u.origin}/*`);}catch {}
  if(!await chrome.permissions.request({origins:[...origins]}))throw Error('Page access was not granted.');
  return tab;
}
for(const [selector,type,options] of [['#current','fill-current',{}],['#history','fill-current',{addRepeating:true}],['#linkedin','sync-linkedin',{}]])document.querySelector(selector).addEventListener('click',async event=>{
  event.target.disabled=true;
  try {
    if(type==='sync-linkedin' && !document.querySelector('#own-profile').checked)throw Error('Confirm this is your own LinkedIn profile.');
    const tab=await activePageAccess();const result=await chrome.runtime.sendMessage({type,tabId:tab.id,options,confirmOwnProfile:true});status.textContent=result.error || result.message;
  }catch(error){status.textContent=error.message;}finally{event.target.disabled=false;}
});
document.querySelector('#suggest').addEventListener('click',async event=>{event.target.disabled=true;try{const result=await chrome.runtime.sendMessage({type:'suggest-answers'});status.textContent=result.error || result.message;}catch(error){status.textContent=error.message;}finally{event.target.disabled=false;}});

for(const [selector,type] of [['#pause-batch','batch-pause'],['#resume-batch','batch-resume'],['#skip-batch','batch-skip']])document.querySelector(selector).addEventListener('click',async()=>{const r=await chrome.runtime.sendMessage({type});status.textContent=r.error || r.message;});
for(const [selector,type] of [['#company-contacts','pull-company-recruiters'],['#get-email','linkedin-get-email']])document.querySelector(selector).addEventListener('click',async event=>{
  event.target.disabled=true;
  try{
    const tab=await activePageAccess();status.textContent=type==='linkedin-get-email'?'Reading this profile…':'Scrolling and collecting loaded profiles…';
    let r=await chrome.runtime.sendMessage({type,tabId:tab.id,targetCount:100,company:document.querySelector('#contact-company').value,domain:document.querySelector('#contact-domain').value,domainConfirmed:document.querySelector('#contact-domain-confirm').checked,allowCredits:document.querySelector('#contact-credits').checked});
    if(r.error)throw Error(r.error);status.textContent=r.message;
    for(let i=0;r.taskId && !['completed','failed','cancelled'].includes(r.status) && i<18;i++){await new Promise(resolve=>setTimeout(resolve,1000));r=await chrome.runtime.sendMessage({type:'browser-import-status',taskId:r.taskId,tabId:tab.id});if(r.error)throw Error(r.error);status.textContent=r.message;}
    document.querySelector('#contact-results').textContent=(r.contacts || []).slice(0,10).map(c=>`${c.name}: ${c.email || 'No corporate address found'} · ${c.emailStatus==='verified'?'Verified mailbox':c.domainVerification?.hasMx?'MX routing found; mailbox unverified':'Pattern suggestion; mailbox unverified'}`).join('\n');
  }catch(error){status.textContent=error.message;}finally{event.target.disabled=false;}
});
