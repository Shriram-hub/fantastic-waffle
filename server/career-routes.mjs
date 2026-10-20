import {fail,text,now} from './domain.mjs';
import {careerData,careerStatus,saveCareerTask,saveCareerStory,prepFingerprint,plannerCalendar} from './services/career.mjs';

export function careerRoutes(store,queue,config) {
  return async(req,res,url,{json,bodyJSON})=>{
    const path=url.pathname;if(!path.startsWith('/api/career'))return false;
    if(path==='/api/career' && req.method==='GET'){json(res,200,{...careerStatus(store),aiConfigured:!!(config.LLM_API_KEY && config.LLM_MODEL)});return true;}
    if(path==='/api/career/calendar.ics' && req.method==='GET') {res.writeHead(200,{'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'attachment; filename="orbit-career-planner.ics"'});res.end(plannerCalendar(store));return true;}
    if(!['POST','PATCH'].includes(req.method))fail('Career endpoint not found.',404);
    const data=await bodyJSON(req);
    if(path==='/api/career/preferences' && req.method==='PATCH') {
      if(!Number.isInteger(data.weeklyGoal)||data.weeklyGoal<1||data.weeklyGoal>100)fail('Choose a weekly target between 1 and 100 applications.');
      store.state.career={...careerData(store),weeklyGoal:data.weeklyGoal,updatedAt:now()};await store.save();json(res,200,{ok:true});return true;
    }
    const task=path.match(/^\/api\/career\/tasks(?:\/([^/]+))?$/);
    if(task && req.method===(task[1] ? 'PATCH' : 'POST')){json(res,task[1] ? 200 : 201,{task:await saveCareerTask(data,store,task[1])});return true;}
    const story=path.match(/^\/api\/career\/stories(?:\/([^/]+))?$/);
    if(story && req.method===(story[1] ? 'PATCH' : 'POST')){json(res,story[1] ? 200 : 201,{story:await saveCareerStory(data,store,story[1])});return true;}
    if(path==='/api/career/prep' && req.method==='POST') {
      const job=store.state.jobs.find(j=>j.id===data.jobId);if(!job)fail('Choose an existing job.',404);
      const useAI=data.useAI===true;if(useAI && data.confirmed!==true)fail('Approve sending your résumé and role description to the configured AI provider.');
      if(useAI && (!config.LLM_API_KEY || !config.LLM_MODEL))fail('The AI provider is not configured. Generate the role-based guide instead.',503);
      const fingerprint=prepFingerprint(store,job,useAI),existing=careerData(store).prep.find(p=>p.fingerprint===fingerprint);
      if(existing){json(res,200,{prep:existing,cached:true});return true;}
      const task=await queue.enqueue('career.prep',{jobId:job.id,useAI,fingerprint},{dedupeKey:`career-prep-${fingerprint}`,maxAttempts:1});json(res,202,{task});return true;
    }
    const notes=path.match(/^\/api\/career\/prep\/([^/]+)\/notes$/);
    if(notes && req.method==='PATCH') {
      const prep=careerData(store).prep.find(p=>p.id===notes[1]);if(!prep)fail('Preparation guide not found.',404);
      const question=prep.questions.find(q=>q.id===data.questionId);if(!question)fail('Practice question not found.',404);
      question.answerNotes=text(data.answerNotes,6000);store.state.career.updatedAt=now();await store.save();json(res,200,{ok:true});return true;
    }
    fail('Career endpoint not found.',404);
  };
}
