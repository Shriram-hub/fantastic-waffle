import {fail} from './domain.mjs';
import {startJobPitch,pitchSummary} from './services/job-pitch.mjs';
export function jobPitchRoutes(store,queue,config) {
  return async(req,res,url,{json,bodyJSON})=>{
    const match=url.pathname.match(/^\/api\/jobs\/([^/]+)\/auto-pitch$/);if(!match)return false;
    if(req.method==='POST'){json(res,202,await startJobPitch(match[1],await bodyJSON(req),store,queue,config));return true;}
    if(req.method==='GET'){const run=(store.state.jobPitches || []).find(r=>r.jobId===match[1]);json(res,200,{pitch:run ? pitchSummary(run,store) : null});return true;}
    fail('Method not allowed.',405);
  };
}
