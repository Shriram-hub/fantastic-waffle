import React,{useEffect,useState} from 'react';
import {useApp,api,fmt} from '../../shared/workspace.jsx';
import {Button} from '../../shared/ui.jsx';
export function MailboxChecks({account}) {
  const {tasks,perform,notify}=useApp(),[tests,setTests]=useState({});
  const signature=JSON.stringify(tasks.tasks.filter(t=>t.kind.startsWith('mail.test-')).map(t=>[t.id,t.status,t.updated_at]));
  useEffect(()=>{api(`/mail/${account.id}/test-status`).then(r=>setTests(r.tests)).catch(()=>{});},[account.id,signature]);
  return <div className="mailbox-checks"><div className="btn-row"><Button small onClick={()=>perform(async()=>{await api(`/mail/${account.id}/test-send`,{confirmed:true});notify(`One test email queued to ${account.email}. Repeat requests within 10 minutes reuse the same task.`);})}>Send test to myself</Button><Button small onClick={()=>perform(()=>api(`/mail/${account.id}/test-inbox`,{}),'Inbox connection check queued.')}>Test inbox scan</Button></div>{Object.entries(tests).map(([kind,result])=><p className="hint" key={kind}>{kind==='send' ? 'Send test' : 'Inbox check'} · {result.status} · {fmt(result.at)}{result.error ? ` · ${result.error}` : result.providerId ? ` · Message ID ${result.providerId}` : Number.isFinite(result.count) ? ` · ${result.count} messages awaiting classification` : ''}</p>)}</div>;
}
