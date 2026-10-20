import {fail} from './domain.mjs';
import {documentFingerprint,documentSummary,hydrateDocument} from './services/job-documents.mjs';

export function documentRoutes(store,queue,config) {
  return async(req,res,url,{json,bodyJSON})=>{
    if(!url.pathname.startsWith('/api/documents'))return false;
    if(url.pathname==='/api/documents' && req.method==='GET') {json(res,200,{documents:(store.state.jobDocuments || []).filter(d=>!url.searchParams.get('jobId') || d.jobId===url.searchParams.get('jobId')).map(d=>{const job=store.state.jobs.find(j=>j.id===d.jobId);return {...documentSummary(d),current:!!job && d.fingerprint===documentFingerprint(store.state,job,d.useAI)};})});return true;}
    const download=url.pathname.match(/^\/api\/documents\/([^/]+)\/(resume|coverLetter)$/);
    if(download && req.method==='GET') {
      const item=(store.state.jobDocuments || []).find(d=>d.id===download[1]);if(!item)fail('Document not found.',404);
      const file=await hydrateDocument(item,download[2],store,config);res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${file.name}"`});res.end(Buffer.from(file.base64,'base64'));return true;
    }
    if(url.pathname==='/api/documents' && req.method==='POST') {
      const data=await bodyJSON(req),job=store.state.jobs.find(j=>j.id===data.jobId);if(!job)fail('Choose an existing job.',404);
      if(store.state.isDemo)fail('Use your personal workspace to prepare documents.');
      const useAI=data.useAI===true;
      if(useAI && (data.confirmed!==true || !config.LLM_API_KEY || !config.LLM_MODEL))fail('Configure AI and approve using your saved evidence for document selection.');
      const fingerprint=documentFingerprint(store.state,job,useAI),existing=(store.state.jobDocuments || []).find(d=>d.fingerprint===fingerprint);
      if(existing){json(res,200,{document:documentSummary(existing),cached:true});return true;}
      const task=await queue.enqueue('documents.build',{jobId:job.id,useAI,fingerprint},{dedupeKey:`documents-${fingerprint}`,maxAttempts:2});json(res,202,{task});return true;
    }
    fail('Document endpoint not found.',404);
  };
}
