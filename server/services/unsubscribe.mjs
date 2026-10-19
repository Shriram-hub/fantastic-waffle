import { randomBytes, createHash } from 'node:crypto';
import { fail, now } from '../domain.mjs';
const tokenHash = value => createHash('sha256').update(value).digest('hex');
export async function unsubscribeLink(email,store,config) {
  const token=randomBytes(32).toString('base64url');
  await store.db.prepare('INSERT INTO unsubscribe_tokens(id,email,created_at) VALUES(?,?,?)').run(tokenHash(token),email.toLowerCase(),Date.now());
  const base=new URL(config.PUBLIC_BASE_URL || config.RENDER_EXTERNAL_URL || 'http://127.0.0.1:3000');
  if (base.protocol !== 'https:' && !['127.0.0.1','localhost'].includes(base.hostname)) fail('Configure an HTTPS PUBLIC_BASE_URL before outreach.',503);
  return new URL(`/u/${token}`,base).href;
}
export async function unsubscribeRoute(req,res,url,store,queue) {
  const match=url.pathname.match(/^\/u\/([A-Za-z0-9_-]{43})$/);
  if (!match) return false;
  const row=await store.db.prepare('SELECT email FROM unsubscribe_tokens WHERE id=?').get(tokenHash(match[1]));
  if (!row) fail('This unsubscribe link is unavailable.',404);
  if (req.method === 'POST') {
    let body='';for await(const chunk of req) {body+=chunk.toString();if(body.length>1024)fail('Request too large.',413);}
    if (new URLSearchParams(body).get('List-Unsubscribe') !== 'One-Click' && new URLSearchParams(body).get('confirm') !== 'yes') fail('Confirm the unsubscribe request.',400);
    const ids=new Set();
    for(const contact of store.state.contacts) if (contact.email?.toLowerCase() === row.email) {contact.suppressed=true;contact.suppressedAt=now();ids.add(contact.id);}
    for(const campaign of store.state.campaigns) for(const delivery of campaign.deliveries || []) if(ids.has(delivery.contactId)) {delivery.followupStopped=true;if(delivery.followupTaskId)await queue.cancel(delivery.followupTaskId);if(delivery.taskId)await queue.cancel(delivery.taskId);}
    await store.save();
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Unsubscribed</title><h1>You are unsubscribed</h1><p>This workspace will stop sending outreach to your address.</p></html>');
  } else if(req.method === 'GET') {
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Unsubscribe</title><h1>Stop outreach emails</h1><form method="post"><input type="hidden" name="confirm" value="yes"><button type="submit">Unsubscribe</button></form></html>');
  } else fail('Method not allowed.',405);
  return true;
}
