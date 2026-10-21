import {initialState} from './fixtures.mjs';
import {fail,id,now,text,safeUrl,STAGES,parseCSV} from './domain.mjs';

export function maintenanceRoutes(store,queue) {
  return async(req,res,url,{json,bodyJSON})=>{
    if(req.method!=='POST')return false;
    if(url.pathname==='/api/workspace/clear-demo-data') {
      const data=await bodyJSON(req);if(data.confirmed!==true)fail('Confirm removing only sample data.');
      if(await store.db.prepare("SELECT id FROM tasks WHERE status='running' LIMIT 1").get())fail('Wait for the current background task to finish, then clear sample data.',409);
      const s=store.state,jobIds=new Set(s.jobs.filter(j=>j.isDemo).map(j=>j.id)),contactIds=new Set(s.contacts.filter(c=>c.isDemo).map(c=>c.id)),appIds=new Set(s.applications.filter(a=>a.isDemo || jobIds.has(a.jobId)).map(a=>a.id));
      const campaignIds=new Set(s.campaigns.filter(c=>c.isDemo || jobIds.has(c.jobId) || c.contactIds?.length && c.contactIds.every(id=>contactIds.has(id))).map(c=>c.id));
      await store.db.exec('BEGIN IMMEDIATE');
      try{
        for(const task of await store.db.prepare("SELECT id,payload FROM tasks WHERE status='queued'").all()) {const p=JSON.parse(task.payload);if(jobIds.has(p.jobId) || contactIds.has(p.contactId) || appIds.has(p.applicationId) || campaignIds.has(p.campaignId))await queue.cancel(task.id);}
        for(const id of appIds)await store.db.prepare('DELETE FROM apply_tasks WHERE application_id=?').run(id);
        s.inbox=s.inbox.filter(i=>!i.isDemo).map(i=>appIds.has(i.applicationId) ? {...i,applicationId:null} : i);
        s.campaigns=s.campaigns.filter(c=>!campaignIds.has(c.id));for(const c of s.campaigns){c.contactIds=c.contactIds.filter(id=>!contactIds.has(id));if(jobIds.has(c.jobId))c.jobId=null;}
        s.contacts=s.contacts.filter(c=>!contactIds.has(c.id));for(const c of s.contacts)if(jobIds.has(c.jobId))c.jobId=null;
        s.applications=s.applications.filter(a=>!appIds.has(a.id));s.jobs=s.jobs.filter(j=>!jobIds.has(j.id));
        if(s.isDemo && s.profile.email==='alex@candidate.example') {
          const fixture=initialState(true).profile,empty=initialState(false).profile;
          for(const key of Object.keys(fixture))if(JSON.stringify(s.profile[key])===JSON.stringify(fixture[key]))s.profile[key]=empty[key];
        }
        s.isDemo=false;s.previews={};await store.save(true);await store.db.exec('COMMIT');
      }catch(error){await store.db.exec('ROLLBACK');throw error;}
      json(res,200,{removed:{jobs:jobIds.size,contacts:contactIds.size,applications:appIds.size,campaigns:campaignIds.size}});return true;
    }
    if(url.pathname==='/api/applications/import') {
      const data=await bodyJSON(req),rows=parseCSV(data.csv,{required:'url'}),s=store.state,errors=[];let imported=0,skipped=0;
      for(const [index,row] of rows.entries()){
        const company=text(row.company,150),title=text(row.role || row.title,200),url=safeUrl(row.url),stage=row.stage || 'Saved';
        if(!company || !title || !url || !STAGES.includes(stage)){errors.push(`Row ${index+2}: company, role, HTTP(S) URL and a supported stage are required.`);continue;}
        let job=s.jobs.find(j=>j.url===url && !j.isDemo);
        if(job && s.applications.some(a=>a.jobId===job.id)){skipped++;continue;}
        if(!job){job={id:id(),company,title,url,description:'Imported from your application backup.',source:'CSV backup',location:text(row.location,200) || 'Not listed',workMode:'On-site',type:'Not listed',tags:[],isDemo:false,archived:false,createdAt:now()};s.jobs.push(job);}
        s.applications.push({id:id(),jobId:job.id,stage,notes:text(row.notes,6000),createdAt:now(),updatedAt:now(),isDemo:false,history:[{stage,at:now(),source:'User-supplied CSV backup'}]});imported++;
      }
      await store.save();json(res,200,{imported,skipped,errors:errors.slice(0,20)});return true;
    }
    return false;
  };
}
