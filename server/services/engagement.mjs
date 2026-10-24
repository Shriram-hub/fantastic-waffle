import {randomBytes} from 'node:crypto';
import {hash,now,fail} from '../domain.mjs';
import {resumeHash,hydrateResume} from './resume-storage.mjs';
import {hydrateDocument} from './job-documents.mjs';
import {activity} from './autopilot-policy.mjs';
import {queueAlert} from './notifications.mjs';
export function resumeLinkSummaries(rows,state) {
  const tracking=new Map((state.resumeTracking || []).map(r=>[r.id,r])),contacts=new Map(state.contacts.map(c=>[c.id,c]));
  return rows.map(row=>{const record=tracking.get(row.id),contact=contacts.get(record?.contactId);return {...row,company:record?.company || null,contactName:contact?.name || null,lastActivityAt:record?.lastActivityAt || null};});
}

export async function ensureCampaignLinks(campaign,store,config={}) {
  if(!campaign.trackResume && !campaign.resumeShare)return;
  if(!store.state.resume)fail('Upload a résumé before adding a tracked link.');
  campaign.resumeLinks ||= {};
  const document=(store.state.jobDocuments || []).find(d=>d.id===campaign.documentSetId);
  for(const contactId of campaign.contactIds) {
    if(campaign.resumeLinks[contactId])continue;
    const contact=store.state.contacts.find(c=>c.id===contactId);if(!contact || contact.suppressed)continue;
    const token=randomBytes(32).toString('base64url'),key=hash(token),expires=Date.now()+30*86400000;
    const base=new URL(config.PUBLIC_BASE_URL || config.RENDER_EXTERNAL_URL || 'http://127.0.0.1:3000');
    if(base.protocol!=='https:' && !['localhost','127.0.0.1'].includes(base.hostname))fail('Use an HTTPS public app address for resume links.');
    await store.db.prepare('INSERT INTO public_resumes(id,resume_hash,expires) VALUES(?,?,?)').run(key,document ? resumeHash(document.resume) : resumeHash(store.state.resume),expires);
    const record={id:key,contactId,campaignId:campaign.id,jobId:campaign.jobId || contact.jobId || null,documentId:document?.id || null,company:contact.company,expires,createdAt:now(),events:[]};
    store.state.resumeTracking=[record,...(store.state.resumeTracking || [])].slice(0,1500);
    campaign.resumeLinks[contactId]={id:key,url:new URL(`/r/${token}`,base).href,expires};
  }
  await store.save();
}
export async function serveResumeLink(req,res,token,store,queue,config) {
  const key=hash(token),record=await store.db.prepare('SELECT * FROM public_resumes WHERE id=? AND revoked=0 AND expires>?').get(key,Date.now()),tracking=(store.state.resumeTracking || []).find(r=>r.id===key);
  const item=tracking?.documentId ? (store.state.jobDocuments || []).find(d=>d.id===tracking.documentId) : null,r=item ? item.resume : tracking?.documentId ? null : store.state.resume;
  if(!record || !r || record.resume_hash!==resumeHash(r))fail('This résumé link expired, changed or was revoked.',404);
  // Request counts are signals only: security scanners can request the same URL.
  const automated=/bot|spider|crawler|scanner|preview|safelinks|proofpoint|mimecast/i.test(String(req.headers['user-agent'] || '')) || /prefetch|prerender/i.test(`${req.headers.purpose || ''} ${req.headers['sec-purpose'] || ''}`);
  await store.db.prepare('UPDATE public_resumes SET views=views+1 WHERE id=?').run(key);
  if(tracking && !automated && (!tracking.lastActivityAt || Date.now()-Date.parse(tracking.lastActivityAt)>30*60000)) {
    const at=now();tracking.lastActivityAt=at;tracking.events=[{at,kind:'resume-request'},...(tracking.events || [])].slice(0,30);
    const contact=store.state.contacts.find(c=>c.id===tracking.contactId);
    if(contact){contact.resumeActivityAt=at;contact.resumeActivityCount=(contact.resumeActivityCount || 0)+1;}
    await store.save();
    await activity(store,'resume',`Résumé-link activity for ${tracking.company}. This may include email security scanners.`,1);
    await queueAlert('resume-view',`Résumé-link activity: ${tracking.company}. This is a request signal, not proof of a human view.`,`${key}:${Math.floor(Date.now()/1800000)}`,store,queue);
  }
  const file=item ? await hydrateDocument(item,'resume',store,config) : await hydrateResume(r,store,config);
  res.writeHead(200,{'Content-Type':/\.pdf$/i.test(r.name) ? 'application/pdf' : 'application/octet-stream','Content-Disposition':`inline; filename="${r.name.replace(/[^a-z0-9._-]/gi,'_')}"`,'X-Robots-Tag':'noindex, nofollow, noarchive','Cache-Control':'private, no-store'});res.end(Buffer.from(file.base64,'base64'));
}
