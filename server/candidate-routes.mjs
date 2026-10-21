import {fail,hash,id,now,text,safeUrl} from './domain.mjs';
import {candidateProfile,candidateFromText,mergeCandidate,saveCandidate,MasterProfileSchema} from './services/candidate-profile.mjs';
import {persistResume,hydrateResume} from './services/resume-storage.mjs';
import {validateResumeUpload} from './resume.mjs';
import {scheduleDiscovery} from './services/discovery.mjs';
import {extensionPackage} from './services/extension-package.mjs';
import {packagePairing} from './services/extension-pairing.mjs';
import {requestBase} from './request-origin.mjs';

export async function importLinkedIn(data,store,queue,config={}) {
  if(data.url) {
    let url;try {url=new URL(data.url);}catch {fail('Enter a full LinkedIn profile URL.');}
    if(url.protocol!=='https:' || !/(^|\.)linkedin\.com$/.test(url.hostname) || !url.pathname.startsWith('/in/') || url.username || url.password) fail('Use a linkedin.com/in/ profile URL.');
  }
  if(data.base64) {
    const file=await persistResume({...validateResumeUpload(data),text:'',uploadedAt:now()},store,config);
    const task=await queue.enqueue('profile.import',{file,source:'LinkedIn PDF',useAI:data.useAI!==false},{dedupeKey:`linkedin-pdf-${file.contentHash}-${id()}`});
    return {task,message:'LinkedIn export saved for parsing. Your application résumé is unchanged.'};
  }
  const raw=text(data.text,60000);
  const incoming=MasterProfileSchema.safeParse(mergeCandidate(data.profile || {},candidateFromText(raw)));
  if(!incoming.success) fail('The imported profile has invalid fields.');
  if(data.url) incoming.data.links.linkedinUrl=data.url;
  if(!raw && !data.url && !data.profile) fail('Paste profile text, add a LinkedIn URL, or upload the exported PDF.');
  saveCandidate(store.state.profile,incoming.data,{source:'LinkedIn import'});
  await store.save();
  let task=null;
  if(raw && data.useAI!==false && config.LLM_API_KEY && config.LLM_MODEL) task=await queue.enqueue('profile.extract',{text:raw,source:'LinkedIn import'},{dedupeKey:`linkedin-text-${hash(raw)}-${id()}`});
  await scheduleDiscovery(store,queue,config,true);
  return {task,master:candidateProfile(store.state.profile),message:raw || data.profile ? 'Imported available fields; existing values were preserved. Review the saved profile.' : 'LinkedIn URL saved. Upload its PDF, paste profile text, or use extension sync to import experience and education.'};
}
export function candidateRoutes(store,queue,config,fetcher) {
  return async(req,res,url,{json,bodyJSON})=>{
    const path=url.pathname;
    if(path==='/api/extension/download' && req.method==='GET') {const base=requestBase(req,config),pairing=config.TOKEN_ENCRYPTION_KEY ? await packagePairing(store,config,base) : {serverUrl:base};res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="orbit-extension.zip"','Cache-Control':'no-store'});res.end(await extensionPackage(pairing));return true;}
    if(path==='/api/profile/master' && req.method==='GET') {json(res,200,{master:candidateProfile(store.state.profile),updatedAt:store.state.profile.masterUpdatedAt || null});return true;}
    if(path==='/api/profile/master' && req.method==='PUT') {
      const data=await bodyJSON(req),parsed=MasterProfileSchema.safeParse(data.master);
      if('expectedUpdatedAt' in data && data.expectedUpdatedAt!==(store.state.profile.masterUpdatedAt || null)) fail('Your profile changed during an import. Reload the saved profile before saving these edits.',409);
      if(!parsed.success) fail('Check the candidate profile fields, array limits and number formats.');
      if(parsed.data.personal.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.data.personal.email)) fail('Enter a valid email address.');
      for(const link of Object.values(parsed.data.links).flat()) if(link && !safeUrl(link)) fail('Use full HTTP or HTTPS profile links.');
      saveCandidate(store.state.profile,parsed.data,{overwrite:true});await store.save();
      // A profile edit can change derived roles/skills, but does not change the
      // user's explicit saved search locations or target roles.
      await scheduleDiscovery(store,queue,config,true);
      json(res,200,{master:candidateProfile(store.state.profile),updatedAt:store.state.profile.masterUpdatedAt});return true;
    }
    if(path==='/api/profile/import-linkedin' && req.method==='POST') {json(res,202,await importLinkedIn(await bodyJSON(req),store,queue,config));return true;}
    if(path==='/api/profile/resume-file' && req.method==='GET') {
      const resume=await hydrateResume(store.state.resume,store,config);
      if(!resume) fail('Upload a résumé first.',404);
      res.writeHead(200,{'Content-Type':/\.pdf$/i.test(resume.name) ? 'application/pdf' : /\.docx$/i.test(resume.name) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain','Content-Disposition':`attachment; filename="${resume.name.replace(/["\r\n]/g,'_')}"`,'Cache-Control':'no-store'});
      res.end(Buffer.from(resume.base64,'base64'));return true;
    }
    return false;
  };
}
