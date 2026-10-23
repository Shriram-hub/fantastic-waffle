import curated from '../providers/jobs/boards.json' with {type:'json'};
import {id,hash,text,now,fail} from '../domain.mjs';
import {companyDomain} from '../providers/contacts/company.mjs';
import {remoteJSON} from '../providers/http.mjs';
import {withDeadline,boundedFetcher} from '../providers/deadline.mjs';
import {page,robotsAllows} from '../providers/contacts/public-pages.mjs';
import {careerLinks,crawlCareerPage} from '../providers/jobs/career-pages.mjs';
import {boardFromURL,boardURL} from '../providers/jobs/ats-search.mjs';
import {fetchJobs,canonicalJobKey} from '../providers/jobs/index.mjs';
import {buildSearchPlan} from './search-plan.mjs';
import {getSearchConfig} from './discovery.mjs';
import {catalogReady,putCatalogJobs,compactWorkspace,retainCatalogJob} from './job-catalog.mjs';
import {startBulkHarvest} from './bulk-harvest.mjs';
import {providerLogoURL} from './company-logos.mjs';
import {gzipSync} from 'node:zlib';
import {compactIndexedJob} from './job-details.mjs';
export const COMPANY_SECTORS=['Investment Banking & PE','Big 4 & Accounting','Management Consulting','Fintech & Banking','Enterprise SaaS & AI','Indian Unicorns','Global MNCs (India Offices)','Other employers'];
export const COMPANY_CITIES=['Mumbai','Gurugram / Delhi NCR','Bengaluru','Hyderabad','Pune','Chennai','Remote','Global'];
const normal=v=>String(v || '').toLowerCase().replace(/[^a-z0-9]/g,'');
const companyId=name=>hash(['company',normal(name)]).slice(0,24);
function sector(name) {
  if(/deloitte|kpmg|pwc|pricewaterhouse|ernst|\bey\b|bdo|grant thornton|mazars|rsm|crowe|baker tilly/i.test(name))return COMPANY_SECTORS[1];
  if(/mckinsey|\bbain\b|boston consulting|\bbcg\b|kearney|wyman|roland berger|accenture|z[sS] associates|strategy|consult/i.test(name))return COMPANY_SECTORS[2];
  if(/goldman|morgan stanley|blackstone|blackrock|lazard|evercore|moelis|houlihan|rothschild|capital|pincus|kkr|carlyle|temasek|brookfield/i.test(name))return COMPANY_SECTORS[0];
  if(/bank|razorpay|stripe|plaid|ramp|brex|wise|revolut|paypal|paytm|phonepe|zerodha|groww|fintech|cred\b|barclays|hsbc|citi|ubs|deutsche/i.test(name))return COMPANY_SECTORS[3];
  if(/zepto|meesho|swiggy|zomato|flipkart|ola\b|oyo\b|lenskart|nykaa|udaan|dream11/i.test(name))return COMPANY_SECTORS[5];
  if(/microsoft|google|amazon|apple|nvidia|oracle|cisco|ibm\b|sap\b|siemens|walmart|adobe/i.test(name))return COMPANY_SECTORS[6];
  if(/ai\b|software|cloud|data|figma|notion|anthropic|openai|databricks|snowflake|atlassian|salesforce|hubspot/i.test(name))return COMPANY_SECTORS[4];
  return COMPANY_SECTORS[7];
}
function fromBoard(board,status='candidate') {
  return {id:companyId(board.company || board.slug),name:board.company || board.slug,domain:companyDomain(board.companyDomain) || '',sector:board.sector || sector(board.company),locations:board.locations || ['Global'],boards:[{source:board.source,slug:board.slug,reference:board.reference || boardURL(board),confirmed:status==='active' || !!board.reference,status}],reference:board.reference || boardURL(board),description:'',source:'Employer directory'};
}
export function filterCompanies(companies,{q='',sector:chosen='',city=''}={}) {
  const needle=String(q).trim().toLowerCase();
  return companies.filter(c=>(!needle || `${c.name} ${c.domain} ${c.sector}`.toLowerCase().includes(needle)) && (!chosen || c.sector===chosen) && (!city || (c.locations || []).some(l=>city==='Gurugram / Delhi NCR'?/gurugram|gurgaon|delhi|noida|ncr/i.test(l):new RegExp(city==='Bengaluru'?'bengaluru|bangalore':city,'i').test(l))));
}
export async function companyDirectory(store,options={}) {
  const q=text(options.q,150),pattern=`%${q.toLowerCase().replaceAll('!','!!').replaceAll('%','!%').replaceAll('_','!_')}%`;
  const rows=q?await store.db.prepare("SELECT status,body FROM discovered_boards WHERE lower(body) LIKE ? ESCAPE '!' ORDER BY checked_at DESC,id LIMIT 500").all(pattern):[];
  const companies=[...curated.map(b=>fromBoard(b,b.verifiedAt?'active':'candidate')),...rows.map(r=>fromBoard(JSON.parse(r.body),r.status)),...(store.state.companyExplorer?.companies || [])],map=new Map();
  for(const incoming of companies){const old=map.get(incoming.id);if(old){old.boards=[...new Map([...old.boards,...incoming.boards].map(b=>[`${b.source}:${b.slug}`,b])).values()];if(incoming.domain)old.domain=incoming.domain;if(incoming.description)Object.assign(old,{description:incoming.description,reference:incoming.reference,source:incoming.source});}else map.set(incoming.id,structuredClone(incoming));}
  const seenJobs=new Map();for(const j of store.state.jobs.filter(j=>!j.isDemo && !j.archived)){const key=companyId(j.company);if(!seenJobs.has(key))seenJobs.set(key,[]);seenJobs.get(key).push(j);}
  for(const company of map.values()){const jobs=seenJobs.get(company.id) || [];company.openJobs=jobs.length;company.locations=[...new Set([...company.locations,...jobs.map(j=>j.location).filter(Boolean),...jobs.filter(j=>j.workMode==='Remote').map(()=>'Remote')])];company.atsType=[...new Set(company.boards.map(b=>b.source))].join(', ') || 'Not yet found';}
  const filtered=filterCompanies([...map.values()],options).sort((a,b)=>b.openJobs-a.openJobs || a.name.localeCompare(b.name)),offset=Math.max(0,Math.min(5000,Number(options.offset)||0)),limit=Math.max(1,Math.min(50,Number(options.limit)||24));
  return {companies:filtered.slice(offset,offset+limit),total:filtered.length,curatedCount:curated.length,offset,limit,sectors:COMPANY_SECTORS,cities:COMPANY_CITIES,runs:(store.state.companyExplorer?.runs || []).slice(0,10),note:'City filters use directory region tags and observed job locations. Global does not assert an office in every city.'};
}
function savedExplorer(store){return store.state.companyExplorer ||= {companies:[],runs:[]};}
async function selectedCompany(key,store,nameHint) {
  const known=curated.find(b=>companyId(b.company)===key);if(known)return fromBoard(known,known.verifiedAt?'active':'candidate');
  const found=(store.state.companyExplorer?.companies || []).find(c=>c.id===key);if(found)return structuredClone(found);
  if(typeof nameHint==='string' && nameHint.length<=150 && companyId(nameHint)===key){const rows=await store.db.prepare("SELECT status,body FROM discovered_boards WHERE json_extract(body,'$.company')=? ORDER BY checked_at DESC LIMIT 12").all(nameHint);if(rows.length){const found=fromBoard(JSON.parse(rows[0].body),rows[0].status);found.boards=rows.flatMap(r=>fromBoard(JSON.parse(r.body),r.status).boards);return found;}}
  fail('Search for this company again before taking an action.',404);
}
export async function lookupCompanies(query,store,queue,fetcher=fetch) {
  const q=text(query,120);if(q.length<2)fail('Enter at least two characters.');
  const cacheKey=`company-lookup:${hash(q.toLowerCase())}`,cached=await store.db.prepare('SELECT body,expires_at FROM job_source_cache WHERE id=?').get(cacheKey);
  if(cached?.expires_at>Date.now())return {...JSON.parse(cached.body),cached:true};
  const call=(url)=>withDeadline(signal=>remoteJSON(url,{},boundedFetcher(fetcher,signal),4000),4500);
  const results=await Promise.allSettled([
    call(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(q)}`),
    call(`https://en.wikipedia.org/w/api.php?${new URLSearchParams({action:'query',list:'search',srsearch:`${q} company`,srlimit:'3',format:'json'})}`),
  ]),companies=[],warnings=[];
  if(results[0].status==='fulfilled' && Array.isArray(results[0].value))for(const c of results[0].value.slice(0,3)){const domain=companyDomain(c.domain);if(c.name && domain)companies.push({id:companyId(c.name),name:text(c.name,150),domain,logoUrl:providerLogoURL(c.logo),description:'Company suggestion; confirm its identity and website.',reference:`https://${domain}`,sector:sector(c.name),locations:['Global'],boards:[],source:'Clearbit company suggestion'});}
  else warnings.push('Company autocomplete is unavailable. Wikipedia and your local employer directory remain available.');
  const hits=results[1].status==='fulfilled'?results[1].value.query?.search || []:[];
  const facts=await Promise.allSettled(hits.slice(0,3).map(async h=>{
    if(!Number.isInteger(h.pageid))return null;
    const data=await call(`https://en.wikipedia.org/w/api.php?${new URLSearchParams({action:'query',pageids:String(h.pageid),prop:'extracts|pageprops',exintro:'1',explaintext:'1',exchars:'800',format:'json'})}`),p=data.query?.pages?.[h.pageid];
    if(!p || p.pageprops?.disambiguation!==undefined)return null;
    let domain='';const entity=p.pageprops?.wikibase_item;
    if(/^Q\d+$/.test(entity || ''))try {const wd=await call(`https://www.wikidata.org/wiki/Special:EntityData/${entity}.json`),site=wd.entities?.[entity]?.claims?.P856?.find(v=>v.rank!=='deprecated')?.mainsnak?.datavalue?.value;if(site)domain=companyDomain(new URL(site).hostname);}catch{}
    return {id:companyId(p.title),name:text(p.title,150),domain,description:text(p.extract,1000),reference:`https://en.wikipedia.org/?curid=${h.pageid}`,sector:sector(p.title),locations:['Global'],boards:[],source:'Wikipedia / Wikidata'};
  }));
  companies.push(...facts.filter(r=>r.status==='fulfilled' && r.value).map(r=>r.value));
  if(results[1].status==='rejected')warnings.push('Wikipedia is temporarily unavailable. Try a more specific name or use the local directory.');
  const unique=[...new Map(companies.map(c=>[c.id,c])).values()].slice(0,5);
  await store.refresh();const explorer=savedExplorer(store);
  for(const company of unique){const old=explorer.companies.find(c=>c.id===company.id);if(old)Object.assign(old,{...company,boards:old.boards});else explorer.companies.unshift(company);if(company.domain)await queue.enqueue('company.probe',{companyId:company.id},{dedupeKey:`company-probe:${company.id}:${Math.floor(Date.now()/86400000)}`,maxAttempts:1});}
  explorer.companies=explorer.companies.slice(0,100);await store.save();
  const result={companies:unique,warnings,note:'Public lookup has no paid API dependency. Company names can be ambiguous; select the matching source. Board discovery runs in the background.'};
  await store.db.prepare('INSERT INTO job_source_cache(id,expires_at,body) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at,body=excluded.body').run(cacheKey,Date.now()+86400000,JSON.stringify(result));return result;
}
export async function probeCompany(task,store,queue,config={},fetcher=fetch,dependencies={}) {
  const company=await selectedCompany(task.payload.companyId,store),domain=companyDomain(company.domain);if(!domain)return {status:'cancelled'};
  const load=dependencies.page || page,confirmed=new Map(company.boards.map(b=>[`${b.source}:${b.slug}`,b])),warnings=[];
  await withDeadline(async signal=>{
    let robots;try{robots=await load(`https://${domain}/robots.txt`,domain,0,signal);}catch(e){if(e.httpStatus===404)robots={text:''};else throw e;}
    const paths=['/','/careers','/jobs'].filter(p=>robotsAllows(robots.text,p));
    const pages=await Promise.allSettled(paths.map(p=>load(`https://${domain}${p}`,domain,0,signal)));
    for(const p of pages.filter(r=>r.status==='fulfilled').map(r=>r.value))for(const link of careerLinks(p.text,p.url)) {const board=boardFromURL(link);if(board)confirmed.set(`${board.source}:${board.slug}`,{...board,reference:p.url,confirmed:true,status:'candidate'});}
  },8000).catch(()=>warnings.push('No readable public career links were found.'));
  // A same-named slug can belong to a different employer. Probe it as a lead,
  // but never index it under this company without a source-supported link.
  const slug=domain.split('.')[0].replace(/[^a-z0-9-]/g,''),candidates=['Greenhouse','Lever','Ashby','Workable','SmartRecruiters','Recruitee','Rippling','Pinpoint','BreezyHR','BambooHR','Personio'].filter(source=>![...confirmed.values()].some(b=>b.source===source));
  for(let offset=0;offset<candidates.length;offset+=2)await Promise.allSettled(candidates.slice(offset,offset+2).map(async source=>{
    const jobs=await withDeadline(signal=>fetchJobs(source,slug,boundedFetcher(fetcher,signal)),3500);if(jobs.length)confirmed.set(`${source}:${slug}`,{source,slug,reference:boardURL({source,slug}),confirmed:false,status:'needs-review',note:'A same-named public board exists. Company ownership is not confirmed.'});
  }));
  for(const board of confirmed.values())if(board.confirmed) {
    const key=hash([board.source,board.slug]),body={...board,company:company.name,companyDomain:domain};
    await store.db.prepare("INSERT INTO discovered_boards(id,source,slug,status,body,checked_at) VALUES(?,?,?,'candidate',?,0) ON CONFLICT(id) DO NOTHING").run(key,board.source,board.slug,JSON.stringify(body));
    await queue.enqueue('boards.verify',{id:key,board:body},{dedupeKey:`explorer-board:${key}:${Math.floor(Date.now()/86400000)}`,maxAttempts:1});
  }
  await store.refresh();const explorer=savedExplorer(store),old=explorer.companies.find(c=>c.id===company.id);if(old)Object.assign(old,{boards:[...confirmed.values()],warnings,probedAt:now()});await store.save();return {boards:confirmed.size,confirmed:[...confirmed.values()].filter(b=>b.confirmed).length,warnings};
}
export async function startCompanyAction(data,store,queue,config={}) {
  if(store.state.isDemo)fail('Start a personal workspace before searching live companies.');
  const company=await selectedCompany(data.companyId,store,data.companyName);
  const saved=savedExplorer(store);if(!curated.some(b=>companyId(b.company)===company.id) && !saved.companies.some(c=>c.id===company.id))saved.companies=[company,...saved.companies].slice(0,100);
  if(data.action==='contacts') {
    await store.save();const harvest=await startBulkHarvest({source:'companies',companies:[company.domain || company.name],companyLimit:1,contactsPerCompany:10,allowCredits:data.allowCredits===true,allowSearch:data.allowSearch===true,targetPersona:'all'},store,queue,config);
    for(const target of harvest.run.targets){target.company=company.name;const job=store.state.jobs.find(j=>!j.archived && !j.isDemo && normal(j.company)===normal(company.name));if(job)target.jobId=job.id;}
    await store.save();return {company,harvest};
  }
  if(data.action!=='jobs')fail('Choose a supported company action.');
  const explorer=savedExplorer(store),old=explorer.runs.find(r=>r.companyId===company.id && ['queued','running'].includes(r.status));if(old)return {run:old,existing:true};
  const run={id:id(),companyId:company.id,company:company.name,status:'queued',createdAt:now(),found:0,warnings:[]};explorer.runs=[run,...explorer.runs].slice(0,30);await store.save();
  const task=await queue.enqueue('company.jobs',{companyId:company.id,runId:run.id},{dedupeKey:`company-jobs:${run.id}`,maxAttempts:1});return {run,task};
}
export async function fetchCompanyJobs(task,store,queue,config={},fetcher=fetch,dependencies={}) {
  const company=await selectedCompany(task.payload.companyId,store),boards=company.boards.filter(b=>b.confirmed),warnings=[],jobs=[];
  const active=savedExplorer(store).runs.find(r=>r.id===task.payload.runId);if(active){active.status='running';await store.save();}
  const plan=buildSearchPlan(store.state,await getSearchConfig(store));
  async function compactBatch(batch,board,pageNumber) {
    const compact=[];
    for(let offset=0;offset<batch.length;offset+=100) {
      const chunk=batch.slice(offset,offset+100),cacheKey=hash(['company-jobs',task.id,board.source,board.slug,pageNumber,offset]);
      await store.db.prepare('INSERT INTO job_source_cache(id,expires_at,body) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at,body=excluded.body').run(cacheKey,Date.now()+24*3600000,gzipSync(JSON.stringify(chunk),{level:4}).toString('base64'));
      compact.push(...chunk.map(job=>compactIndexedJob(job,plan,cacheKey)));
    }
    return compact;
  }
  const targets=[...boards.slice(0,4),...(company.domain?[{source:'Career Pages',slug:`https://${company.domain}/careers`,confirmed:true}]:[])];
  if(!targets.length)warnings.push('No source-supported career board yet. Public board discovery is queued; check back shortly.');
  for(let i=0;i<targets.length;i+=2) {
    const results=await Promise.allSettled(targets.slice(i,i+2).map(async b=>{
      const found=[];for(let pageNumber=1;pageNumber<=5;pageNumber++){const batch=b.source==='Career Pages'?(await crawlCareerPage(b.slug,dependencies.page?{load:dependencies.page}:{})).jobs:await fetchJobs(b.source,b.slug,fetcher,{...config,ATS_PAGE:pageNumber});found.push(...await compactBatch(batch,b,pageNumber));if(!batch.pagination?.hasMore)break;if(pageNumber===5)warnings.push(`${b.source}: first five pages indexed; scheduled discovery continues the board.`);}
      return found.map(j=>({...j,company:company.name,...company.domain?{companyDomain:company.domain,companyDomainSource:'provider'}:{}}));
    }));
    results.forEach((r,n)=>{if(r.status==='fulfilled')jobs.push(...r.value);else warnings.push(`${targets[i+n].source}: public source unavailable or unreadable.`);});
  }
  try{const roles=store.state.profile.interests?.slice(0,1).join(' ') || '';const linked=await fetchJobs('LinkedIn Guest',`${company.name} ${roles}`,fetcher,{...config,SEARCH_LOCATION:store.state.profile.location});jobs.push(...linked.filter(j=>normal(j.company)===normal(company.name)));}catch{warnings.push('LinkedIn public search unavailable. Other sources continued.');}
  const unique=[...new Map(jobs.filter(j=>!j.isDemo).map(j=>[canonicalJobKey(j),j])).values()];
  if(await catalogReady(store))await putCatalogJobs(unique,plan,store,config);
  await store.refresh();const keys=new Set(store.state.jobs.map(canonicalJobKey));for(const j of unique)if(!keys.has(canonicalJobKey(j))){store.state.jobs.push(j);keys.add(canonicalJobKey(j));}
  const run=savedExplorer(store).runs.find(r=>r.id===task.payload.runId);if(run)Object.assign(run,{status:unique.length?'completed':'needs-attention',found:unique.length,warnings,completedAt:now()});await store.save();
  if(await catalogReady(store))await compactWorkspace(store,plan);return {found:unique.length,warnings};
}
export async function companyDossier(data,store,queue,config={},fetcher=fetch) {
  const job=data.jobId?await retainCatalogJob(data.jobId,store):null;
  let company=data.companyId?await selectedCompany(data.companyId,store):job?fromBoard({company:job.company,source:job.source,slug:job.board,companyDomain:job.companyDomain,reference:job.url}):null;
  if(!company)fail('Choose a job or company for this brief.');
  let facts=(store.state.companyExplorer?.companies || []).find(c=>normal(c.name)===normal(company.name));
  if(!facts?.description){const found=await lookupCompanies(company.name,store,queue,fetcher);facts=found.companies.find(c=>normal(c.name)===normal(company.name)) || null;}
  if(facts)company={...company,description:facts.description,reference:facts.reference,source:facts.source};
  const jobs=store.state.jobs.filter(j=>!j.isDemo && !j.archived && normal(j.company)===normal(company.name)),contacts=store.state.contacts.filter(c=>!c.suppressed && !c.isDemo && (normal(c.company)===normal(company.name) || company.domain && c.companyDomain===company.domain)).slice(0,10);
  return {company,role:job?.title || '',hiringFocus:[...new Set(jobs.map(j=>j.title))].slice(0,12),contacts:contacts.map(c=>({id:c.id,name:c.name,title:c.title,linkedinUrl:c.linkedinUrl,emailStatus:c.emailStatus})),questions:[`What would success in ${job?.title || 'this role'} look like after the first 90 days?`,`Which priorities led ${company.name} to open this position?`,...(job?.tags || []).slice(0,2).map(skill=>`How does the team use ${skill}, and what is the biggest challenge in that work?`),'How does the team make decisions and review the quality of its work?'],sources:[company.reference,...jobs.slice(0,5).map(j=>j.url)].filter(Boolean),generatedAt:now(),note:'Company facts cite public sources. Hiring focus and contacts come from your saved workspace; this is not a news feed.'};
}
