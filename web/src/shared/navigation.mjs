export const names={companies:'Company Explorer',overview:'Overview',automation:'Autopilot',jobs:'Jobs Feed',applications:'Applications Tracker',contacts:'Contact Discovery',outreach:'Outreach & Sequences',inbox:'Inbox Monitor',profile:'Master Profile & Resume',documents:'Tailored Documents',career:'Career & Interview Prep',connections:'Connections & Alerts'};
export const workspaces=[
  {id:'overview',title:'Overview',icon:'overview',tabs:[['overview','Today'],['overview-telemetry','Activity & health']]},
  {id:'jobs',title:'Jobs & Companies',icon:'jobs',tabs:[['jobs','Job Feed'],['companies','Company Explorer'],['applications','Applications Pipeline']]},
  {id:'outreach',title:'Outreach & Contacts',icon:'outreach',tabs:[['outreach','1-Screen Mass Mailer'],['contact-search','Find Contacts'],['contacts','Contacts Directory'],['campaigns','Drip Sequences & Queue'],['inbox','Inbox & Replies']]},
  {id:'profile',title:'Profile & Interview Prep',icon:'profile',tabs:[['profile','Master Profile Vault'],['documents','Tailored Resumes & Cover Letters'],['career','Mock Interview Simulator'],['stories','Story Bank & Career Planner']]},
  {id:'connections',title:'Settings & Autopilot',icon:'connections',tabs:[['connections','Mailbox & Sending'],['provider-keys','API Keys & Quotas'],['automation','Autopilot Rules & Review'],['appearance','Alerts & Appearance']]}
];
for(const workspace of workspaces)for(const [key,label] of workspace.tabs)names[key] ||= label;
export const navGroups=workspaces.map(w=>({label:w.title,routes:[w.id]}));
export const workspaceFor=route=>workspaces.find(w=>w.tabs.some(([key])=>key===route)) || workspaces[0];
export const symbols={overview:'◈',jobs:'⌕',applications:'▤',contacts:'',outreach:'↗',inbox:'',profile:'◎',connections:'⌘',automation:'≋'};
export function navigationCount(key,{data,tasks,search,autopilot}) {
  if(key==='jobs')return search?.strongMatches ?? search?.matches ?? data.jobs.filter(j=>!j.archived && j.match?.score>=75).length;
  if(key==='applications')return data.applications.length;
  if(key==='outreach')return autopilot?.reviewCount || 0;
  if(key==='automation')return tasks.tasks.filter(t=>['queued','running'].includes(t.status)).length;
  return null;
}
