export const names={overview:'Overview',automation:'Autopilot',jobs:'Jobs Feed',applications:'Applications Tracker',contacts:'Contact Discovery',outreach:'Outreach & Sequences',inbox:'Inbox Monitor',profile:'Master Profile & Resume',documents:'Tailored Documents',career:'Career & Interview Prep',connections:'Connections & Alerts'};
export const navGroups=[{label:'Command Center',routes:['overview','automation']},{label:'Job Engine',routes:['jobs','applications']},{label:'Outreach Studio',routes:['contacts','outreach','inbox']},{label:'Candidate Vault',routes:['profile','documents','career','connections']}];
export const symbols={overview:'◈',jobs:'⌕',applications:'▤',contacts:'',outreach:'↗',inbox:'',profile:'◎',connections:'⌘',automation:'≋'};
export function navigationCount(key,{data,tasks,search,autopilot}) {
  if(key==='jobs')return search?.strongMatches ?? search?.matches ?? data.jobs.filter(j=>!j.archived && j.match?.score>=75).length;
  if(key==='applications')return data.applications.length;
  if(key==='outreach')return autopilot?.reviewCount || 0;
  if(key==='automation')return tasks.tasks.filter(t=>['queued','running'].includes(t.status)).length;
  return null;
}
