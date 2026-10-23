import {effectiveProviderConfig} from './services/provider-config.mjs';
import {fail,hash} from './domain.mjs';
import {startContactDiscovery,contactDiscoveryStatus} from './services/contact-discovery.mjs';
import {checkContactProviders} from './services/contact-provider-checks.mjs';
import {queueBrowserContacts,browserImportResult} from './services/browser-contacts.mjs';
import {companyDomain} from './providers/contacts/company.mjs';
import {startBulkHarvest,SECTOR_PRESETS} from './services/bulk-harvest.mjs';

const csvCell=value=>`"${String(value ?? '').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')}"`;
export function contactRoutes(store,queue,config,fetcher=fetch) {
  return async(req,res,url,{json,bodyJSON})=>{
    const path=url.pathname;
    if(path==='/api/contacts/bulk-harvest' && req.method==='POST'){json(res,202,await startBulkHarvest(await bodyJSON(req),store,queue,config));return true;}
    if(path==='/api/contacts/sector-presets' && req.method==='GET'){json(res,200,{presets:SECTOR_PRESETS});return true;}
    if(path==='/api/contacts/company-domain/confirm' && req.method==='POST') {
      const data=await bodyJSON(req),domain=companyDomain(data.domain);
      if(data.confirmed!==true || !domain || typeof data.company!=='string')fail('Confirm the official domain for this company.');
      const row=await store.db.prepare('SELECT body FROM companies WHERE domain=?').get(domain),company=row ? JSON.parse(row.body) : {domain,name:data.company};
      Object.assign(company,{requiresDomainReview:false,source:'User-confirmed corporate website',reference:`https://${domain}`,resolvedAt:new Date().toISOString()});
      await store.db.prepare('INSERT INTO companies(domain,name,body) VALUES(?,?,?) ON CONFLICT(domain) DO UPDATE SET body=excluded.body').run(domain,data.company,JSON.stringify(company));
      for(const contact of store.state.contacts)if(contact.companyDomain===domain && contact.company.toLowerCase()===data.company.toLowerCase())contact.requiresDomainReview=false;
      await store.save();json(res,200,{ok:true});return true;
    }
    if(path==='/api/contacts/import-browser-profiles' && req.method==='POST'){json(res,202,await queueBrowserContacts(await bodyJSON(req),store,queue));return true;}
    if(path==='/api/contacts/browser-import-result' && req.method==='POST'){const data=await bodyJSON(req);json(res,200,await browserImportResult(data.taskId,store,queue));return true;}
    if(path==='/api/contacts/providers/check' && req.method==='POST'){await bodyJSON(req);json(res,200,await checkContactProviders(store,config,fetcher));return true;}
    if(path==='/api/contacts/discovery' && req.method==='GET'){json(res,200,await contactDiscoveryStatus(store,config));return true;}
    if(path==='/api/contacts/discover' && req.method==='POST'){json(res,202,await startContactDiscovery(await bodyJSON(req),store,queue,config));return true;}
    if(path==='/api/contacts/verify-batch' && req.method==='POST') {
      const data=await bodyJSON(req);if(data.confirmed!==true || !Array.isArray(data.ids) || !data.ids.length || data.ids.length>100)fail('Select 1–100 contacts and approve verification credit usage.');
      if(!(await effectiveProviderConfig(store,config)).HUNTER_API_KEY)fail('Configure HUNTER_API_KEY before verifying mailboxes.',503);
      const contacts=[...new Set(data.ids)].map(id=>store.state.contacts.find(c=>c.id===id));
      if(contacts.some(c=>!c || c.isDemo || c.suppressed || !c.email))fail('Select existing, unsuppressed work-email contacts.');
      const tasks=[];
      for(const contact of contacts.filter(c=>c.emailStatus!=='verified'))tasks.push(await queue.enqueue('contact.verify',{contactId:contact.id},{dedupeKey:`verify-${contact.id}-${hash(contact.email)}-${Math.floor(Date.now()/(7*86400000))}`,maxAttempts:1}));
      json(res,202,{queued:tasks.length});return true;
    }
    if(path==='/api/export/contacts' && req.method==='GET') {
      const rows=[['ID','Name','Company','Role','Email','Verification','Source','Reference','Job URL','LinkedIn URL','Confidence','Domain','Domain Health'],...store.state.contacts.map(c=>[c.id,c.name,c.company,c.title,c.email,c.suppressed ? 'suppressed' : c.emailStatus,c.source,c.verification?.reference || c.sources?.[0]?.url || '',store.state.jobs.find(j=>j.id===c.jobId)?.url || '',c.linkedinUrl || '',c.confidence ?? '',c.companyDomain || '',c.domainVerification?.status || ''])];
      res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="orbit-contacts.csv"'});res.end(rows.map(row=>row.map(csvCell).join(',')).join('\r\n'));return true;
    }
    return false;
  };
}
