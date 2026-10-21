import {fail} from './domain.mjs';

export function mailCheckRoutes(store,queue) {
  return async(req,res,url,{json,bodyJSON})=>{
    const match=url.pathname.match(/^\/api\/mail\/([^/]+)\/(test-send|test-inbox|test-status)$/);if(!match)return false;
    const account=await store.db.prepare('SELECT id,provider,email,metadata FROM mail_accounts WHERE id=?').get(match[1]);
    if(!account)fail('Connect a mailbox first.',404);
    if(match[2]==='test-status' && req.method==='GET'){json(res,200,{tests:JSON.parse(account.metadata).connectionTests || {}});return true;}
    if(req.method!=='POST')fail('Method not allowed.',405);
    const data=await bodyJSON(req);
    if(match[2]==='test-send' && data.confirmed!==true)fail('Approve sending one test email to your own connected address.');
    const kind=match[2]==='test-send' ? 'mail.test-send' : 'mail.test-inbox';
    const task=await queue.enqueue(kind,{accountId:account.id},{dedupeKey:`${kind}:${account.id}:${Math.floor(Date.now()/600000)}`,maxAttempts:1});
    json(res,202,{taskId:task.id,status:task.status,to:match[2]==='test-send' ? account.email : undefined,message:'Check queued. Results appear here and in Automation.'});return true;
  };
}
