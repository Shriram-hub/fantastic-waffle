import {names} from './navigation.mjs';
export const commandDefinitions=[
  {id:'discovery',label:'Run Job Discovery Now',hint:'Find fresh roles',icon:'jobs'},
  {id:'queue',label:'Flush Background Queue',hint:'Process due tasks · keeps scheduled send times',icon:'automation'},
  {id:'theme',label:'Toggle Dark/Light Theme',hint:'Appearance',icon:'sun'},
  {id:'profile',label:'Open Master Profile Vault',hint:'Your career evidence',icon:'profile'},
  {id:'export',label:'Export Contacts CSV',hint:'Download your contacts',icon:'download'},
  {id:'mailbox',label:'Test Mailbox Connection',hint:'Read-only inbox check · sends no email',icon:'inbox'}
];
export function commandResults(query,data) {
  const q=query.toLowerCase().trim(),results=[];
  for(const command of commandDefinitions)if(!q || `${command.label} ${command.hint}`.toLowerCase().includes(q))results.push({...command,type:'command'});
  for(const [route,label] of Object.entries(names))if(q && label.toLowerCase().includes(q))results.push({id:`nav:${route}`,type:'route',route,label,hint:'Open workspace view',icon:route});
  if(q) {
    const matches=value=>value.toLowerCase().includes(q);
    const jobs=new Map(data.jobs.map(j=>[j.id,j]));
    for(const j of data.jobs)if(!j.archived && matches(`${j.title} ${j.company}`))results.push({type:'job',id:j.id,label:j.title,hint:j.company,icon:'jobs'});
    for(const c of data.contacts)if(matches(`${c.name} ${c.company} ${c.email}`))results.push({type:'contact',id:c.id,label:c.name || c.email,hint:`${c.company} · ${c.email || 'No email'}`,icon:'contacts'});
    for(const a of data.applications){const j=jobs.get(a.jobId);if(j && matches(`${j.title} ${j.company} ${a.stage}`))results.push({type:'application',id:a.id,label:j.title,hint:`${j.company} · ${a.stage}`,icon:'applications'});}
  }
  return results.slice(0,30);
}
export async function executeCommand(item,app,{api,download=url=>{location.href=url;}}) {
  if(item.type==='route')return app.go(item.route);
  if(item.type==='job' || item.type==='application')return app.setModal({type:item.type,id:item.id});
  if(item.type==='contact')return app.setModal({type:'contact-detail',id:item.id});
  switch(item.id) {
    case 'theme':return app.toggleTheme();
    case 'profile':return app.go('profile');
    case 'export':return download('/api/export/contacts');
    case 'discovery':return app.perform(()=>api('/jobs/discover',{}),'Discovery sweep queued.');
    case 'queue':return app.perform(async()=>{const result=await api('/queue/flush',{});app.notify(result.message);});
    case 'mailbox':if(!app.accounts.length)return app.go('connections');return app.perform(async()=>{await Promise.all(app.accounts.map(a=>api(`/mail/${a.id}/test-inbox`,{})));app.notify('Inbox connection checks queued.');});
  }
}
