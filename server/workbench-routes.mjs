import {fail} from './domain.mjs';
import {companyDirectory,lookupCompanies,startCompanyAction} from './services/company-explorer.mjs';
import {MAIL_PRESETS,MERGE_TAGS,pasteContacts,prepareQuickBatch,launchQuickBatch,batchProgress,controlQuickBatch} from './services/quick-mailer.mjs';
import {companyLogos} from './services/company-logos.mjs';
import {draftInboxReply,queueInboxReply} from './services/inbox-replies.mjs';
import {startDailySprint,dailySprintStatus} from './services/daily-sprint.mjs';
export function workbenchRoutes(store,queue,config,fetcher=fetch) {
  const logos=companyLogos(fetcher);
  return async(req,res,url,{json,bodyJSON})=>{
    const path=url.pathname;
    if(path==='/api/workbench/daily-sprint' && req.method==='POST'){json(res,202,await startDailySprint(await bodyJSON(req),store,queue,config));return true;}
    const sprint=path.match(/^\/api\/workbench\/daily-sprint\/([^/]+)$/);if(sprint && req.method==='GET'){json(res,200,dailySprintStatus(sprint[1],store));return true;}
    const reply=path.match(/^\/api\/inbox\/([^/]+)\/(draft-reply|send-reply)$/);
    if(reply && req.method==='POST'){const data=await bodyJSON(req);json(res,reply[2]==='send-reply'?202:200,reply[2]==='draft-reply'?await draftInboxReply(reply[1],data,store,config,fetcher):await queueInboxReply(reply[1],data,store,queue,config));return true;}
    const logo=path.match(/^\/api\/companies\/([a-z0-9]{24})\/logo$/);
    if(logo && req.method==='GET'){const company=store.state.companyExplorer?.companies.find(c=>c.id===logo[1]),asset=company?.logoUrl?await logos({companyLogo:company.logoUrl}):null;if(!asset)fail('Company logo unavailable.',404);res.writeHead(200,{'Content-Type':asset.type,'Content-Length':asset.bytes.length,'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'});res.end(asset.bytes);return true;}
    if(path==='/api/companies' && req.method==='GET'){json(res,200,await companyDirectory(store,Object.fromEntries(url.searchParams)));return true;}
    if(path==='/api/outreach/studio' && req.method==='GET'){json(res,200,{presets:MAIL_PRESETS,variables:MERGE_TAGS,batches:await Promise.all(store.state.campaigns.filter(c=>c.studio).slice(0,10).map(c=>batchProgress(c.id,store)))});return true;}
    const progress=path.match(/^\/api\/outreach\/batches\/([^/]+)(?:\/(next|pause|retry))?$/);
    if(progress && !progress[2] && req.method==='GET'){json(res,200,await batchProgress(progress[1],store));return true;}
    if(!['/api/companies/lookup','/api/companies/action','/api/outreach/paste','/api/outreach/preview','/api/outreach/launch'].includes(path) && !progress)return false;
    if(req.method!=='POST')fail('Method not allowed.',405);
    const data=await bodyJSON(req);
    if(path==='/api/companies/lookup')json(res,200,await lookupCompanies(data.query,store,queue,fetcher));
    else if(path==='/api/companies/action')json(res,202,await startCompanyAction(data,store,queue,config));
    else if(path==='/api/outreach/paste')json(res,200,await pasteContacts(data.text,store));
    else if(path==='/api/outreach/preview')json(res,200,await prepareQuickBatch(data,store,config));
    else if(path==='/api/outreach/launch')json(res,202,await launchQuickBatch(data,store,queue,config));
    else {if(data.confirmed!==true)fail('Confirm the selected campaign action.');json(res,200,await controlQuickBatch(progress[1],progress[2],store,queue,config));}
    return true;
  };
}
