import {sameApplicationLocation,sameApplicationHost} from './location.mjs';
import {buildAnswers,fillApplication,fieldKey} from './autofill.mjs';
import {extractLinkedInProfile,extractLinkedInCompanyPeople,extractLinkedInProspect} from './linkedin.mjs';
let installation;
async function installationConfig() {
  if(installation!==undefined)return installation;
  try{installation=await (await fetch(chrome.runtime.getURL('config.json'))).json();}catch{installation={};}
  return installation;
}
async function autoPair() {
  const {base,token}=await chrome.storage.session.get(['base','token']);if(base && token)return;
  const config=await installationConfig();if(!config.serverUrl)return;
  await chrome.storage.session.set({base:config.serverUrl});
  if(!config.pairingCode || config.expiresAt<Date.now())return;
  const response=await fetch(`${config.serverUrl}/api/extension/pair`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:config.pairingCode}),signal:AbortSignal.timeout(15000)}),data=await response.json();
  if(response.ok)await chrome.storage.session.set({base:config.serverUrl,token:data.token,expiresAt:data.expiresAt});
}
chrome.runtime.onInstalled?.addListener(()=>{void autoPair().catch(()=>{});});
export function combineResults(results) {
  const reports=results.map(r=>r.result).filter(Boolean);
  if(!reports.length)return null;
  return {status:reports.some(r=>r.status==='blocked') ? 'blocked' : 'needs-review',filled:reports.reduce((sum,r)=>sum+(r.filled || 0),0),added:reports.reduce((sum,r)=>sum+(r.added || 0),0),missing:[...new Set(reports.flatMap(r=>r.missing || []))].slice(0,60),questions:[...new Map(reports.flatMap(r=>r.questions || []).map(q=>[q.label,q])).values()].slice(0,20)};
}
async function request(path,body) {
  await autoPair();
  const {base,token}=await chrome.storage.session.get(['base','token']);
  if(!base || !token)throw Error('Pair the extension first.');
  const response=await fetch(`${base}/api/extension/${path}`,{method:body ? 'POST' : 'GET',headers:{Authorization:`Bearer ${token}`,...(body ? {'Content-Type':'application/json'} : {})},...(body ? {body:JSON.stringify(body)} : {}),signal:AbortSignal.timeout(20000)});
  let data;try{data=await response.json();}catch{throw Error('Veloce is starting or temporarily unavailable. Wait a moment and retry Get email.');}if(response.status===401){await chrome.storage.session.remove?.('token');throw Error('Your Veloce pairing expired. Open Connections in Veloce and pair the extension again.');}if(!response.ok)throw Error(data.error || 'Veloce request failed.');return data;
}
async function permittedFrames(tabId) {
  const frames=await chrome.webNavigation.getAllFrames({tabId}),allowed=[];
  for(const frame of frames || [])try {const url=new URL(frame.url);if(url.protocol==='https:' && await chrome.permissions.contains({origins:[`${url.origin}/*`]}))allowed.push(frame.frameId);}catch {}
  if(!allowed.length)throw Error('Grant access to this application portal using Fill this page.');
  return allowed;
}
async function inject(tabId,answers,resume,options={}) {
  const frameIds=await permittedFrames(tabId);
  const results=await chrome.scripting.executeScript({target:{tabId,frameIds},func:fillApplication,args:[answers,resume,options]});
  const report=combineResults(results) || {status:'needs-review',filled:0,missing:['Could not inspect this form.'],questions:[]};
  return report;
}
async function runFill(task,tabId,options={}) {
  const tab=await chrome.tabs.get(tabId);
  if(!sameApplicationLocation(task.url,tab.url))throw Error('This application changed website. Grant the new portal access and use Fill this page.');
  const fresh=task.id ? await request('context',{taskId:task.id,url:tab.url}) : await request('profile');
  let resume=fresh.resume ? await request('resume') : null,coverLetter=null,documentWarning='';
  if(task.id)try {const documents=await request('documents',{taskId:task.id,url:tab.url});resume=documents.resume;coverLetter=documents.coverLetter;}catch(error){documentWarning=`Tailored documents unavailable: ${error.message} The original résumé is available for review.`;}
  const report=await inject(tabId,buildAnswers(fresh.profile,fresh.qa),resume,{...options,coverLetter});
  if(documentWarning)report.missing.push(documentWarning);
  if(task.id) {
    const frames=await chrome.webNavigation.getAllFrames({tabId});
    await request('report',{taskId:task.id,pageUrl:tab.url,formOrigins:[...new Set((frames || []).flatMap(frame=>{try{return [new URL(frame.url).origin];}catch{return [];}}))],...report});
    try {await chrome.scripting.executeScript({target:{tabId,frameIds:await permittedFrames(tabId)},files:['confirmation.js','copilot.js']});}catch {}
  }
  await chrome.storage.session.set({lastResult:{...report,company:task.company || 'Current page',role:task.role || ''}});
  return {message:`Filled ${report.filled} fields${report.added ? ` and added ${report.added} sections` : ''}. Review the open application. ${report.missing.length ? `${report.missing.length} items still need attention.` : ''}`};
}
async function next(taskIds=null) {
  const {task}=await request('next',taskIds ? {taskIds} : undefined);if(!task)return {message:'No queued applications. Select jobs in Veloce first.'};
  const tab=await chrome.tabs.create({url:task.url,active:!taskIds});await chrome.storage.session.set({currentTask:{task,tabId:tab.id}});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{chrome.tabs.onUpdated.removeListener(listener);reject(Error('Page is still loading. Use Fill this page once it is ready.'));},25000);
    const finish=()=>{clearTimeout(timer);chrome.tabs.onUpdated.removeListener(listener);resolve();};
    const listener=(id,change)=>{if(id===tab.id && change.status==='complete')finish();};
    chrome.tabs.onUpdated.addListener(listener);chrome.tabs.get(tab.id).then(t=>{if(t.status==='complete')finish();});
  });
  const result=await runFill(task,tab.id);
  if(taskIds)await chrome.tabs.update(tab.id,{active:true});
  return result;
}
async function refill(options={}) {
  const {currentTask}=await chrome.storage.session.get('currentTask');if(!currentTask)throw Error('Open a queued application or choose Fill this page.');
  return runFill(currentTask.task,currentTask.tabId,options);
}
async function fillCurrent(tabId,options={}) {
  const tab=await chrome.tabs.get(tabId),url=new URL(tab.url);
  if(url.protocol!=='https:')throw Error('Open an HTTPS job application form first.');
  const {currentTask}=await chrome.storage.session.get('currentTask');
  const task=currentTask?.tabId===tabId && sameApplicationLocation(currentTask.task.url,tab.url) ? currentTask.task : {url:tab.url,company:'Current page',role:''};
  await chrome.storage.session.set({currentTask:{task,tabId}});return runFill(task,tabId,options);
}
async function syncLinkedIn(tabId,confirmOwnProfile) {
  if(!confirmOwnProfile)throw Error('Confirm this is your own profile.');
  const [result]=await chrome.scripting.executeScript({target:{tabId},func:extractLinkedInProfile});
  if(!result?.result)throw Error('Open your own LinkedIn profile first.');
  const imported=await request('import-linkedin',{...result.result,confirmOwnProfile:true});return {message:imported.message};
}
async function suggestAnswers() {
  const {currentTask,lastResult}=await chrome.storage.session.get(['currentTask','lastResult']);
  if(!currentTask?.task.id)throw Error('Queue this application in Veloce before requesting Gemini suggestions.');
  const active=await chrome.tabs.get(currentTask.tabId);if(!sameApplicationLocation(currentTask.task.url,active.url))throw Error('Return to the queued application before suggesting answers.');
  const questions=lastResult?.questions || [];if(!questions.length)return {message:'No unanswered supported text questions were found. Fill the form first.'};
  const result=await request('questions',{taskId:currentTask.task.id,questions}),fresh=await request('profile'),answers=buildAnswers(fresh.profile,fresh.qa);
  for(const answer of result.answers)answers[fieldKey(answer.label)]=answer.answer;
  const report=await inject(currentTask.tabId,answers,null);
  await request('report',{taskId:currentTask.task.id,...report});
  await chrome.storage.session.set({lastResult:{...report,company:currentTask.task.company,role:currentTask.task.role}});
  return {message:`${result.answers.length} source-checked suggestions filled for review. ${result.unanswered.length} unsupported questions left for you.`};
}
async function advanceBatch() {
  const {batch,currentTask}=await chrome.storage.session.get(['batch','currentTask']);
  if(!batch || batch.paused)return {message:'Batch paused.'};
  if(currentTask?.task.id)return {message:'Review and submit the current application, or skip it from the application assistant.'};
  if(!batch.ids.length)return {message:`Batch finished: ${batch.completed} confirmed applications.`,finished:true};
  try {return await next(batch.ids);}catch(error){batch.paused=true;await chrome.storage.session.set({batch});throw error;}
}
async function startBatch(taskIds) {
  if(!Array.isArray(taskIds) || !taskIds.length || taskIds.length>10 || taskIds.some(id=>typeof id!=='string'))throw Error('Choose 1–10 queued applications.');
  const {currentTask,batch}=await chrome.storage.session.get(['currentTask','batch']);
  if(batch?.ids.length && !batch.paused)throw Error('Finish or pause your current batch first.');
  if(currentTask?.task.id)throw Error('Finish or skip the current application before starting a new batch.');
  await chrome.storage.session.set({batch:{ids:[...new Set(taskIds)],completed:0,total:taskIds.length,paused:false,startedAt:Date.now()}});return advanceBatch();
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(!['connection-status','pull-company-recruiters','linkedin-get-email','browser-import-status','linkedin-page-context','linkedin-open-mailer','linkedin-scan-progress','workspace-pair','workspace-batch','copilot-context','copilot-fill','batch-pause','batch-resume','batch-skip','register-workspace'].includes(message.type))return;
  (async()=>{
    const {base,currentTask,batch}=await chrome.storage.session.get(['base','currentTask','batch']);
    const extensionPage=sender.url?.startsWith(chrome.runtime.getURL(''));
    if(message.type==='connection-status') {
      if(!extensionPage)throw Error('Open the extension popup.');
      await autoPair();const state=await chrome.storage.session.get(['base','token','expiresAt']);return {paired:!!state.token,base:state.base,expiresAt:state.expiresAt};
    }
    if(message.type==='workspace-pair') {
      const installed=await installationConfig(),expected=base || installed.serverUrl;
      if(!expected || !sender.tab?.id || new URL(sender.url).origin!==expected || !/^[A-Za-z0-9_-]{43}$/.test(message.token || ''))throw Error('Pair from the configured Veloce workspace.');
      await chrome.storage.session.set({base:expected,token:message.token,expiresAt:message.expiresAt || Date.now()+86400000});return {message:'Extension paired for 24 hours. No URL or token copying needed.'};
    }
    if(message.type==='register-workspace') {
      if(!extensionPage || !base)throw Error('Pair using the extension popup.');
      await chrome.scripting.unregisterContentScripts({ids:['orbit-workspace']}).catch(()=>{});
      await chrome.scripting.registerContentScripts([{id:'orbit-workspace',matches:[`${base}/*`],js:['workspace-bridge.js'],runAt:'document_idle'}]);
      for(const tab of await chrome.tabs.query({url:`${base}/*`}))if(tab.id)await chrome.scripting.executeScript({target:{tabId:tab.id},files:['workspace-bridge.js']}).catch(()=>{});
      return {ok:true};
    }
    if(!sender.tab?.id && !extensionPage)throw Error('Open a supported application page.');
    if(message.type==='linkedin-scan-progress'){
      if(!sender.tab?.id || sender.frameId!==0 || !/(^|\.)linkedin\.com$/.test(new URL(sender.url).hostname))throw Error('Use the LinkedIn main tab.');
      const count=Math.min(100,Math.max(0,Number(message.count)||0));await chrome.runtime.sendMessage({type:'veloce-scan-progress',tabId:sender.tab.id,count}).catch(()=>{});return {ok:true};
    }
    if(['pull-company-recruiters','linkedin-get-email','browser-import-status','linkedin-page-context','linkedin-open-mailer'].includes(message.type)) {
      if(!extensionPage && sender.frameId!==0)throw Error('Open the LinkedIn page in its main tab.');
      const tabId=extensionPage?message.tabId:sender.tab.id,tab=await chrome.tabs.get(tabId),u=new URL(tab.url);
      if(u.protocol!=='https:' || !/(^|\.)linkedin\.com$/.test(u.hostname) || !/^\/(in\/|company\/|jobs\/view\/|search\/results\/people\/?)/.test(u.pathname))throw Error('Open a LinkedIn profile, company People page or people search.');
      if(message.pageUrl){const expected=new URL(message.pageUrl);if(expected.origin!==u.origin || expected.pathname!==u.pathname || expected.search!==u.search)throw Error('LinkedIn changed pages. Wait for the new profile to load and try again.');}
      if(message.type==='browser-import-status')return request('contact-result',{taskId:message.taskId});
      if(message.type==='linkedin-open-mailer'){
        if(!Array.isArray(message.contactIds) || !message.contactIds.length || message.contactIds.length>100 || message.contactIds.some(id=>typeof id!=='string' || !/^[a-z0-9_-]{1,100}$/i.test(id)))throw Error('Choose saved contacts before opening the mail studio.');
        await autoPair();const {base:workspace,token}=await chrome.storage.session.get(['base','token']);if(!workspace || !token)throw Error('Pair with your Veloce workspace first.');
        await chrome.tabs.create({url:`${workspace}/#outreach?contacts=${encodeURIComponent([...new Set(message.contactIds)].join(','))}`,active:true});return {message:'Opened selected contacts in the mass mail studio. Review and approve the exact batch before sending.'};
      }
      const isProfile=u.pathname.startsWith('/in/'),contextOnly=message.type==='linkedin-page-context';
      // Install the classic parser in the tab's isolated world, then return errors as data.
      // Chrome can omit InjectionResult.result when an injected function throws.
      await chrome.scripting.executeScript({target:{tabId},files:['linkedin.js']});
      const [result]=await chrome.scripting.executeScript({target:{tabId},func:async options=>{
        const parser=globalThis.VeloceLinkedIn;
        if(!parser)return {extractionError:'The LinkedIn reader could not load. Reload the extension, then refresh LinkedIn.'};
        for(let attempt=0;attempt<9;attempt++)try{
          const data=options.isProfile ? parser.extractLinkedInProspect() : await parser.extractLinkedInCompanyPeople(options);
          return {data:await parser.enrichLinkedInContext(data,{includeContactInfo:options.isProfile && !options.contextOnly})};
        }catch(error){
          if(!options.isProfile || attempt===8 || !/loading/i.test(error.message))return {extractionError:error.message || 'Could not read this LinkedIn page.'};
          await new Promise(resolve=>setTimeout(resolve,250));
        }
      },args:[{isProfile,targetCount:Math.min(100,Number(message.targetCount)||100),duration:contextOnly?0:5000,contextOnly,company:message.company || ''}]});
      if(result?.result?.extractionError)throw Error(result.result.extractionError);
      if(result?.error)throw Error(result.error.message || String(result.error));
      if(!result?.result?.data)throw Error('LinkedIn did not return page data. Refresh this profile tab and try again.');
      const data=result.result.data,fresh=await chrome.tabs.get(tabId);if(new URL(fresh.url).pathname!==u.pathname)throw Error('The LinkedIn page changed during lookup. Retry on the new profile.');
      if(message.company?.trim() && message.company.trim().toLowerCase()!==data.company?.toLowerCase()){
        // A corrected employer must not reuse the previous company's domain evidence.
        delete data.verifiedCompanyDomain;delete data.domainEvidence;delete data.companyLinkedinUrl;data.domain='';data.company=message.company.trim();
      }
      if(contextOnly){const context=await request('contact-context',{company:message.company || data.company,intent:message.intent,sourceUrl:tab.url,verifiedCompanyDomain:data.verifiedCompanyDomain,companyLinkedinUrl:data.companyLinkedinUrl,domainEvidence:data.domainEvidence});return {...data,...context,domain:context.domain || data.verifiedCompanyDomain || data.domain || '',requiresDomainReview:!context.domain || context.requiresDomainReview===true,profileName:data.profiles?.[0]?.name || '',title:data.profiles?.[0]?.title || ''};}
      if(!data.company)return {needsCompany:true,profileName:data.profiles[0]?.name,message:'Enter the current company shown on this page, then click Get email again.'};
      return request('import-browser-profiles',{...data,domain:message.domainConfirmed && message.domain || data.verifiedCompanyDomain || message.domain || data.domain || '',domainConfirmed:message.domainConfirmed===true,allowCredits:message.allowCredits===true,allowSearch:message.allowSearch===true});
    }
    if(message.type==='workspace-batch') {
      if(!sender.url || !base || new URL(sender.url).origin!==base)throw Error('Start a batch from your paired Veloce workspace.');
      return startBatch(message.taskIds);
    }
    if(message.type==='copilot-context') {
      const context=await request('copilot',{url:sender.url,taskId:currentTask?.tabId===sender.tab.id ? currentTask.task.id : undefined});
      return {...context,batch:batch ? {remaining:batch.ids.length,completed:batch.completed,total:batch.total,paused:batch.paused} : null};
    }
    if(message.type==='copilot-fill')return fillCurrent(sender.tab.id,{addRepeating:true});
    if(!extensionPage && sender.tab.id!==currentTask?.tabId)throw Error('Control the batch from its current application or the popup.');
    if(message.type==='batch-pause'){if(batch){batch.paused=true;await chrome.storage.session.set({batch});}return {message:'Batch paused.'};}
    if(message.type==='batch-resume'){if(batch){batch.paused=false;await chrome.storage.session.set({batch});}return advanceBatch();}
    if(message.type==='batch-skip'){if(batch && currentTask){batch.ids=batch.ids.filter(id=>id!==currentTask.task.id);await chrome.storage.session.set({batch});}await chrome.storage.session.remove(['currentTask','submissionAttempt']);return advanceBatch();}
  })().then(respond).catch(error=>respond({error:error.message}));return true;
});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(!['next','refill','fill-current','sync-linkedin','suggest-answers'].includes(message.type))return;
  if(sender.url && !sender.url.startsWith(chrome.runtime.getURL('')))return;
  const action=message.type==='next' ? next() : message.type==='refill' ? refill(message.options) : message.type==='fill-current' ? fillCurrent(message.tabId,message.options) : message.type==='sync-linkedin' ? syncLinkedIn(message.tabId,message.confirmOwnProfile) : suggestAnswers();
  action.then(respond).catch(error=>respond({error:error.message}));return true;
});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(!['submission-attempt','application-confirmation'].includes(message.type))return;
  (async()=>{
    const {currentTask}=await chrome.storage.session.get('currentTask');
    if(!currentTask?.task.id || sender.tab?.id!==currentTask.tabId)throw Error('This tab has no active Veloce task.');
    const source=new URL(sender.url),target=new URL(currentTask.task.url),tab=await chrome.tabs.get(currentTask.tabId);
    if(message.type==='submission-attempt' ? !sameApplicationLocation(currentTask.task.url,tab.url) : !sameApplicationHost(currentTask.task.url,tab.url))throw Error('Return to the queued application page.');
    const frames=await chrome.webNavigation.getAllFrames({tabId:currentTask.tabId});
    if(!sameApplicationHost(source.href,target.href) && !frames?.some(frame=>frame.frameId===sender.frameId && new URL(frame.url).origin===source.origin))throw Error('Confirmation origin does not match an observed form frame.');
    if(message.type==='submission-attempt') {await request('submission',{taskId:currentTask.task.id,status:'submission-pending',url:source.href,topUrl:tab.url});await chrome.storage.session.set({submissionAttempt:{taskId:currentTask.task.id,at:Date.now()}});}
    else {const {submissionAttempt}=await chrome.storage.session.get('submissionAttempt');if(submissionAttempt?.taskId!==currentTask.task.id || Date.now()-submissionAttempt.at>15*60000)return;await request('submission',{taskId:currentTask.task.id,status:'confirmed',url:source.href,topUrl:tab.url,evidence:message.evidence});await chrome.storage.session.set({lastResult:{status:'confirmed',company:currentTask.task.company,role:currentTask.task.role,missing:[]}});await chrome.storage.session.remove(['submissionAttempt','currentTask']);
      const {batch}=await chrome.storage.session.get('batch');if(batch?.ids.includes(currentTask.task.id)){batch.ids=batch.ids.filter(id=>id!==currentTask.task.id);batch.completed++;await chrome.storage.session.set({batch});if(!batch.paused)await advanceBatch();}}
    return {ok:true};
  })().then(respond).catch(error=>respond({error:error.message}));return true;
});

chrome.tabs.onRemoved?.addListener(async tabId=>{const {currentTask,batch}=await chrome.storage.session.get(['currentTask','batch']);if(currentTask?.tabId===tabId && batch){batch.paused=true;await chrome.storage.session.set({batch,lastResult:{status:'needs-review',company:currentTask.task.company,missing:['Application tab was closed. Skip or reopen it before resuming.']}});}});
