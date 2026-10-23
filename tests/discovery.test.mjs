import test from 'node:test';
import {directoryBoard,syncDirectories,DIRECTORY_SOURCES} from '../server/providers/jobs/directory.mjs';
import {discoverATSBoards} from '../server/providers/jobs/ats-search.mjs';
import {pruneSourceCache} from '../server/services/discovery.mjs';
import assert from 'node:assert/strict';

test('Keka, Darwinbox and Freshteam public responses preserve actual locations, dates and application links',async()=>{
  const uuid='12345678-1234-1234-1234-123456789abc';
  const keka=await fetchJobs('Keka','https://company.keka.com/careers',async input=>String(input).endsWith('/careers')?new Response(`<img src="/ats/documents/${uuid}/careerportal/logo.png">`):json([{id:'k1',title:'Financial Analyst',description:'<p>Forecasting</p>',jobLocations:[{city:'Mumbai',countryName:'India'}],publishedOn:'2026-10-22',skillNames:['Excel']} ]));
  assert.equal(keka[0].url,'https://company.keka.com/careers/jobdetails/k1');assert.equal(keka[0].description,'Forecasting');assert.equal(keka[0].location,'Mumbai, India');assert.deepEqual(keka[0].tags,['Excel']);
  const darwin=await fetchJobs('Darwinbox','https://company.darwinbox.in/ms/candidate/careers',async(input,options)=>{assert.match(String(input),/\/ms\/candidateapi\/job\/alljobs\?companyId=main$/);assert.deepEqual(JSON.parse(options.body),{companyId:'main',page:4,sort_option:'new',limit:10});return json({status:'success',job_counts:100,data:Array.from({length:10},(_,i)=>({id:`d${i}`,designation_display_name:'Financial Analyst',locations:'Mumbai',jd:'<p>Finance reporting</p>',posted_on:'2026-10-22',is_remote:'0'}))});},{ATS_PAGE:4});
  assert.equal(darwin[0].description,'Finance reporting');assert.equal(darwin[0].workMode,'On-site');assert.equal(darwin.pagination.nextPage,5);assert.equal(darwin.pagination.hasMore,true);
  const fresh=await fetchJobs('Freshteam','https://company.freshteam.com/jobs',async input=>{assert.equal(String(input),'https://company.freshteam.com/hire/widgets/jobs.json');return json([{id:'f1',title:'Accountant',location:{city:'Delhi',country:'India'},description:'Accounting'}]);});assert.equal(fresh[0].company,'company');assert.equal(fresh[0].location,'Delhi, India');
  await assert.rejects(fetchJobs('Keka','https://127.0.0.1/careers'),/supported/);
  await assert.rejects(fetchJobs('Darwinbox','https://company.darwinbox.in/ms/candidate/careers',async()=>new Response('CAPTCHA',{status:403})),/HTTP 403/);
});

test('Amazon, Workday and SmartRecruiters pagination continues past the old shallow-page limit',async()=>{
  const amazon=await fetchJobs('Amazon Jobs','Financial Analyst',async input=>{const u=new URL(input);assert.equal(u.searchParams.get('offset'),'300');assert.equal(u.searchParams.get('result_limit'),'100');assert.equal(u.searchParams.get('loc_query'),'Mumbai');return json({hits:1000,jobs:Array.from({length:100},(_,i)=>({id:`a${i}`,title:'Financial Analyst',job_path:`/en/jobs/a${i}`,location:'Mumbai, India',description:'Finance',posted_date:'2026-10-22'}))});},{ATS_PAGE:4,SEARCH_LOCATION:'Mumbai'});assert.equal(amazon.pagination.hasMore,true);assert.equal(amazon[0].url,'https://www.amazon.jobs/en/jobs/a0');
  const workday=await fetchJobs('Workday','https://company.wd1.myworkdayjobs.com/External',async(_input,options)=>{assert.equal(JSON.parse(options.body).offset,180);return json({total:220,jobPostings:Array.from({length:20},(_,i)=>({title:'Analyst',externalPath:`/job/analyst-${i}`,locationsText:'Mumbai'}))});},{ATS_PAGE:10});assert.equal(workday.pagination.nextPage,11);assert.equal(workday.pagination.hasMore,true);
  const smart=await fetchJobs('SmartRecruiters','Company',async input=>{assert.equal(new URL(input).searchParams.get('offset'),'900');return json({totalFound:1001,content:Array.from({length:100},(_,i)=>({id:i+1,name:'Analyst'}))});},{ATS_PAGE:10});assert.equal(smart.pagination.hasMore,true);assert.equal(smart.pagination.nextPage,11);
});

test('streamed community directories deduplicate candidates, record attribution and never assert live validation',async t=>{
  const store=clean(t),queue=taskQueue(store),source=DIRECTORY_SOURCES[0];
  assert.equal(directoryBoard({provider:'greenhouse',slug:'company',name:'Company',status:'ok'},source).license,'CC0-1.0');
  assert.equal(directoryBoard({url:'http://localhost/jobs'},source),null);
  const result=await syncDirectories(store,queue,async input=>String(input).endsWith('.gz')?new Response(gzipSync(JSON.stringify({provider:'greenhouse',slug:'company',name:'Company',status:'ok'})+'\n')):new Response('name,url\n"Company, Ltd",https://company.keka.com/careers\n'));
  assert.equal(result.companies,2);assert.equal(result.failures.length,0);assert.ok(store.db.prepare('SELECT status FROM discovered_boards').all().every(r=>r.status==='candidate'));
  assert.ok((await knownBoards(store)).some(b=>b.source==='Keka' && b.company==='Company, Ltd'));assert.equal(store.state.jobs.length,0);
});

test('Serper ATS search recognizes supported career boards and source cache maintenance is bounded',async t=>{
  const found=await discoverATSBoards('Analyst','Mumbai',{SERPER_API_KEY:'test'},async(_u,options)=>{assert.match(JSON.parse(options.body).q,/site:keka.com/);return json({organic:[{link:'https://company.keka.com/careers/jobdetails/1'},{link:'https://jobs.lever.co/company/1'},{link:'https://www.linkedin.com/in/someone'}]});});assert.deepEqual(found.map(b=>b.source),['Keka','Lever']);
  const store=clean(t);for(let i=0;i<5;i++)store.db.prepare('INSERT INTO job_source_cache(id,expires_at,body) VALUES(?,?,?)').run(`cache-${i}`,Date.now()+i,'x'.repeat(100));await pruneSourceCache(store,200);assert.ok(store.db.prepare('SELECT SUM(length(body)) AS n FROM job_source_cache').get().n<=200);
});
import {openStore} from '../server/store.mjs';
import {initialState} from '../server/fixtures.mjs';
import {taskQueue} from '../server/queue.mjs';
import {handlers,runOne} from '../server/worker.mjs';
import {createApp} from '../server/index.mjs';
import {saveSearchConfig,scheduleDiscovery,searchStatus,SOURCE_DEFAULTS,DISCOVERY_INTERVAL} from '../server/services/discovery.mjs';
import {buildSearchPlan,rankOpportunity,searchLocations} from '../server/services/search-plan.mjs';
import {sourcePlan} from '../server/services/discovery.mjs';
import {fetchLinkedInGuest,parseLinkedInCards} from '../server/providers/jobs/linkedin-guest.mjs';
import {fetchGoogleJobs} from '../server/providers/jobs/google-jobs.mjs';
import {knownBoards,rememberBoards} from '../server/providers/jobs/registry.mjs';
import {providerCall} from '../server/services/provider-budget.mjs';
import {parseResumeAsync} from '../server/resume.mjs';
import {fetchJobs} from '../server/providers/jobs/index.mjs';
import {normalizePublicATS} from '../server/providers/jobs/public-ats.mjs';
import {extractSchemaOrgJobPostings} from '../server/providers/jobs/core.mjs';
import {boardFromURL} from '../server/providers/jobs/ats-search.mjs';
import {crawlCareerPage,careerURL} from '../server/providers/jobs/career-pages.mjs';
import {addCareerURL} from '../server/providers/jobs/registry.mjs';
import {compactIndexedJob,hydrateJobDetail} from '../server/services/job-details.mjs';
import {jobFreshness} from '../server/services/job-freshness.mjs';
import {MAX_INDEX,mergeDiscoveryResults} from '../server/services/discovery.mjs';
import {gzipSync} from 'node:zlib';
import catalog from '../server/providers/jobs/boards.json' with {type:'json'};

const json=x=>new Response(JSON.stringify(x));
const sources=(...names)=>Object.fromEntries(Object.keys(SOURCE_DEFAULTS).map(k=>[k,names.includes(k)]));
const job=(title='Frontend Engineer',extra={})=>({id:'job-1',company:'Stripe',title,location:'Remote',workMode:'Remote',description:'React TypeScript interfaces',tags:['React'],url:'https://boards.greenhouse.io/stripe/jobs/1',source:'Greenhouse',board:'stripe',fetchedAt:new Date().toISOString(),...extra});
test('public ATS adapters normalize SmartRecruiters, Workable, Recruitee, Ashby and EU Lever; partial lists never invent dates',async()=>{
  const fixtures=[
    ['SmartRecruiters','Visa',{content:[{id:'sr1',name:'Financial Analyst',company:{name:'Visa'},location:{city:'Bengaluru',country:'India'},ref:'https://api.smartrecruiters.com/v1/companies/Visa/postings/sr1',releasedDate:'2026-10-22T08:00:00Z',department:{label:'Finance'}}]}],
    ['Workable','exampleco',{name:'Company',jobs:[{shortcode:'abc',title:'Analyst',location:{city:'Mumbai',country:'India'},description:'Build financial models',url:'https://apply.workable.com/exampleco/j/abc/'}]}],
    ['Recruitee','exampleco',{offers:[{id:2,slug:'analyst',title:'Analyst',city:'London',country:'UK',careers_url:'https://exampleco.recruitee.com/o/analyst',description:'Financial analysis'}]}],
    ['Ashby','exampleco',{jobs:[{id:'a1',title:'Data Analyst',jobUrl:'https://jobs.ashbyhq.com/exampleco/a1',department:'Data',descriptionPlain:'Analyze SQL data'}]}],
    ['Lever EU','exampleco',[{id:'e1',text:'Analyst',categories:{location:'Paris'},hostedUrl:'https://jobs.eu.lever.co/exampleco/e1'}]],
  ];
  for(const [source,board,payload] of fixtures){const requests=[];const [result]=await fetchJobs(source,board,async input=>{requests.push(String(input));return json(payload);});assert.ok(result.id,source);assert.equal(result.source,source);assert.equal(result.isDemo,false);if(source==='SmartRecruiters'){assert.equal(result.company,'Visa');assert.match(result.url,/jobs.smartrecruiters.com/);assert.ok(!result.url.includes('api.smartrecruiters'));}else assert.equal(result.publishedAt,null,source);if(source==='Lever EU')assert.match(requests[0],/api.eu.lever.co/);}
  assert.throws(()=>normalizePublicATS('Workable','x',{error:'No account'}),/unexpected/);
});
test('Workday tenant URLs auto-detect and search bounded public CXS pages without relying on relative posting labels for freshness',async()=>{
  const board='https://statestreet.wd1.myworkdayjobs.com/Global';
  assert.deepEqual(boardFromURL(board+'/job/Mumbai/Analyst_R1'),{source:'Workday',slug:board});
  assert.deepEqual(boardFromURL('https://jobs.eu.lever.co/seb/123'),{source:'Lever EU',slug:'seb'});
  assert.equal(boardFromURL('https://evil.example/myworkdayjobs.com/Global'),null);
  const [result]=await fetchJobs('Workday',board,async(input,options)=>{assert.equal(input,board.replace('/Global','/wday/cxs/statestreet/Global/jobs'));assert.deepEqual(JSON.parse(options.body),{limit:20,offset:20,searchText:'Financial Analyst',appliedFacets:{}});return json({jobPostings:[{title:'Financial Analyst',externalPath:'/job/Mumbai/Analyst_R1',locationsText:'Mumbai, India',postedOn:'Posted Today'}]});},{ATS_PAGE:2,SEARCH_QUERY:'Financial Analyst'});
  assert.equal(result.url,board+'/job/Mumbai/Analyst_R1');assert.equal(result.publishedAt,null);assert.equal(jobFreshness(result).firstMover,false);
});
test('The Muse and optional Adzuna aliases produce category/location and country-specific public queries',async()=>{
  const [muse]=await fetchJobs('The Muse','Financial Analyst',async input=>{const u=new URL(input);assert.equal(u.searchParams.get('category'),'Accounting and Finance');assert.equal(u.searchParams.get('location'),'Mumbai');assert.equal(u.searchParams.get('page'),'1');return json({results:[{id:5,name:'Financial Analyst',company:{name:'Company'},locations:[{name:'Mumbai'}],refs:{landing_page:'https://themuse.com/jobs/company/analyst'},contents:'<p>Build models</p>',publication_date:'2026-10-21T20:00:00Z'}]});},{ATS_PAGE:2,SEARCH_LOCATION:'Mumbai'},'Financial Analyst');
  assert.equal(muse.description,'Build models');assert.equal(muse.source,'The Muse');
  for(const country of ['IN','US','GB','SG'])await fetchJobs('Adzuna','',async input=>{const u=new URL(input);assert.match(u.pathname,new RegExp(`/jobs/${country.toLowerCase()}/search/1$`));assert.equal(u.searchParams.get('app_key'),'fake-key');return json({results:[]});},{ADZUNA_APP_ID:'fake',ADZUNA_API_KEY:'fake-key',SEARCH_COUNTRY:country},'Analyst');
});
test('universal JobPosting extraction supports arrays and graphs, deadlines and country restrictions while ignoring malformed JSON and unsafe links',async()=>{
  const posting={'@type':['Thing','JobPosting'],title:'Analyst',hiringOrganization:{name:'Company'},description:'<p>Build &amp; review models</p>',url:'/careers/analyst',jobLocation:{address:{addressLocality:'Mumbai',addressCountry:'India'}},datePosted:'2026-10-22',validThrough:'2026-11-22'};
  const html=`<script type="application/ld+json">bad</script><script type="application/ld+json">${JSON.stringify({'@graph':[posting]})}</script><script type="application/ld+json">${JSON.stringify([posting,{'@type':'Person',name:'Not a job'},{...posting,title:'Unsafe',url:'javascript:alert(1)'}])}</script>`;
  const results=extractSchemaOrgJobPostings(html,'https://company.com/careers');assert.equal(results.length,1);assert.equal(results[0].location,'Mumbai, India');assert.equal(results[0].expiresAt,'2026-11-22T00:00:00.000Z');assert.equal(results[0].url,'https://company.com/careers/analyst');
  const remote=extractSchemaOrgJobPostings(`<script type="application/ld+json">${JSON.stringify({...posting,jobLocation:null,jobLocationType:'TELECOMMUTE',applicantLocationRequirements:{name:'India'}})}</script>`,'https://company.com/careers');assert.deepEqual(remote[0].locationRestrictions,['India']);
  let calls=0;const crawl=await crawlCareerPage('https://company.com/careers',{load:async url=>{calls++;if(url.endsWith('/robots.txt'))return {text:'User-agent: *\nAllow: /',url};return {text:html,url};}});assert.equal(crawl.jobs.length,1);assert.equal(calls,2);
  await assert.rejects(crawlCareerPage('https://company.com/careers',{load:async url=>({text:'User-agent: *\nDisallow: /careers',url})}),/does not allow/);
  for(const url of ['http://company.com/jobs','https://localhost/jobs','https://127.0.0.1/jobs','https://user:secret@company.com/jobs','https://company.com:123/jobs'])assert.equal(careerURL(url),'');
});
test('career URL registrations persist, dedupe, require validation, and keep unsupported pages out of the active registry',async t=>{
  const store=clean(t),queue=taskQueue(store),first=await addCareerURL('https://apply.workable.com/new-employer/',store,queue);
  assert.equal(first.board.source,'Workable');assert.equal((await knownBoards(store)).length,0);
  assert.equal((await addCareerURL('https://apply.workable.com/new-employer/j/abc',store,queue)).existing,true);
  await drain(store,queue,async()=>json({jobs:[]}));assert.equal((await knownBoards(store))[0].source,'Workable');
  await assert.rejects(addCareerURL('https://user:secret@company.com/careers',store,queue),/public HTTPS/);
});
test('expanded index retains ten times as many roles with compact descriptions and restores full text for per-job workflows',async t=>{
  assert.equal(MAX_INDEX,15000);assert.ok(catalog.length>=150);assert.equal(new Set(catalog.map(b=>`${b.source}:${b.slug}`)).size,catalog.length);assert.ok(catalog.every(b=>b.reference));
  const store=clean(t),plan=buildSearchPlan(store.state,{roles:['Frontend Engineer']}),full=job('Frontend Engineer',{description:'Intro. '+ 'React data '.repeat(1000)+' Reporting to the Director of Engineering.'}),indexed=compactIndexedJob(full,plan,'detail-fixture');
  assert.equal(indexed.description.length,280);assert.equal(indexed.descriptionTruncated,true);
  await store.db.prepare('INSERT INTO job_source_cache(id,expires_at,body) VALUES(?,?,?)').run('detail-fixture',Date.now()+1000,gzipSync(JSON.stringify([full])).toString('base64'));
  assert.equal((await hydrateJobDetail(indexed,store)).description,full.description);
  const many=Array.from({length:15020},(_,i)=>({...indexed,id:`many-${i}`,company:`Company ${i}`,description:'React',url:`https://company.com/jobs/${i}`}));
  assert.equal(mergeDiscoveryResults(store.state,[{descriptor:{source:'Fixture',board:''},jobs:many}],plan).jobs.length,15000);
});
test('snippet sources cannot replace a complete cached description or its observed posting date',()=>{
  const state=initialState(false),plan=buildSearchPlan(state,{roles:['Frontend Engineer'],workMode:'Any'}),date=new Date(Date.now()-3600000).toISOString();
  const complete=compactIndexedJob(job('Frontend Engineer',{source:'Lever',board:'stripe',publishedAt:date,description:'React '.repeat(500)+' Reporting to the Director of Engineering.'}),plan,'full');
  state.jobs=[complete];const snippet=compactIndexedJob({...complete,id:'google-copy',source:'Google Jobs',board:'Frontend Engineer',description:'Short search snippet',publishedAt:null},plan,'snippet');
  const merged=mergeDiscoveryResults(state,[{descriptor:{source:'Google Jobs',board:'Frontend Engineer'},jobs:[snippet]}],plan).jobs[0];
  assert.equal(merged.detailCacheKey,'full');assert.equal(merged.publishedAt,date);assert.equal(merged.descriptionHash,complete.descriptionHash);
  const expired={...complete,id:'expired',company:'Expired Co',expiresAt:'2025-01-01T00:00:00Z'};
  assert.equal(mergeDiscoveryResults(initialState(false),[{descriptor:{source:'Lever',board:'stripe'},jobs:[expired]}],plan).jobs[0].archived,true);
});
test('LinkedIn fetches five pages concurrently with freshness parameters, deduplicates, and retains partial successful pages',async()=>{
  const starts=[];let active=0,peak=0;
  const jobs=await fetchLinkedInGuest('Analyst',{freshness:'24h'},async input=>{const u=new URL(input),start=u.searchParams.get('start');starts.push(start);assert.equal(u.searchParams.get('f_TPR'),'r86400');active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,10));active--;if(start==='50')return new Response('blocked',{status:403});return new Response(`<li><a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/analyst-${start}"></a><h3 class="base-search-card__title">Analyst</h3><h4 class="base-search-card__subtitle">Company</h4></li>`);});
  assert.deepEqual(starts,['0','25','50','75','100']);assert.equal(jobs.length,4);assert.equal(peak,5);
  const clock=Date.parse('2026-10-22T12:00:00Z');
  assert.equal(jobFreshness({publishedAt:'2026-10-22T10:00:00Z'},clock).firstMover,true);
  for(const fixture of [{fetchedAt:'2026-10-22T11:00:00Z'},{publishedAt:'2026-10-20T10:00:00Z'},{publishedAt:'2026-10-23T10:00:00Z'},{source:'Greenhouse',publishedAt:'2026-10-22T10:00:00Z'}])assert.equal(jobFreshness(fixture,clock).firstMover,false);
});
test('finance searches expand metro alternatives and separate adjacent roles without recommending unrelated tech',()=>{
  const state=initialState(false),prefs={roles:['Financial Analyst','Accountant','Investment Banking'],location:'Mumbai or Bengaluru or Delhi',country:'IN',sources:{'Google Jobs':true,'LinkedIn Guest':true}};
  const plan=buildSearchPlan(state,prefs);
  assert.deepEqual(searchLocations(prefs.location),['Mumbai','Bengaluru','Delhi']);
  for(const location of ['Navi Mumbai, India','Bangalore, India','Gurgaon, India','Noida, India'])assert.equal(rankOpportunity(job('Financial Analyst',{location,workMode:'On-site'}),plan).tier,'strong',location);
  for(const title of ['FP&A Associate','Treasury Analyst','Equity Research Associate','Bookkeeper','Tax Associate']){const match=rankOpportunity(job(title,{location:'Mumbai, India',workMode:'On-site'}),plan);assert.equal(match.tier,'adjacent',title);assert.equal(match.eligible,false);assert.ok(match.score<=74);}
  assert.equal(rankOpportunity(job('Frontend Engineer',{location:'Mumbai, India'}),plan).recommendable,false);
  assert.equal(rankOpportunity(job('Financial Analyst',{location:'Remote, United States',locationRestrictions:['United States only']}),plan).recommendable,false);
  assert.equal(rankOpportunity(job('Financial Analyst',{location:'India (Remote)',locationRestrictions:['India only']}),plan).tier,'strong');
  const requests=sourcePlan(plan,{},prefs).filter(d=>d.source==='Google Jobs');assert.equal(requests.length,9);assert.ok(requests.every(d=>!d.location.includes(' or ')));assert.equal(requests[8].location,'Delhi');
  const internships=sourcePlan(buildSearchPlan(state,{...prefs,experience:'Internship'}),{},prefs).filter(d=>['Google Jobs','LinkedIn Guest'].includes(d.source));assert.ok(internships.every(d=>d.board.includes('Internship')),'Experience preferences reach the providers before local filtering');
  const internPlan=buildSearchPlan(state,{...prefs,experience:'Internship'});assert.equal(rankOpportunity(job('Financial Analyst',{location:'Mumbai, India',type:'Internship'}),internPlan).eligible,true);
});
test('public LinkedIn cards preserve source URLs and dates; blocks fail visibly without evasion',async()=>{
  const html='<li><a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/finance-123?trackingId=x"></a><h3 class="base-search-card__title">Financial Analyst</h3><h4 class="base-search-card__subtitle"><a>Acme &amp; Co</a></h4><span class="job-search-card__location">Mumbai, India</span><time datetime="2026-10-19">1 day ago</time></li>';
  const [parsed]=parseLinkedInCards(html,'Financial Analyst');assert.equal(parsed.title,'Financial Analyst');assert.equal(parsed.company,'Acme & Co');assert.equal(parsed.url,'https://www.linkedin.com/jobs/view/finance-123');assert.equal(parsed.publishedAt,'2026-10-19T00:00:00.000Z');assert.equal(parsed.descriptionUnavailable,true);
  const jobs=await fetchLinkedInGuest('Financial Analyst',{SEARCH_LOCATION:'Mumbai'},async url=>{const u=new URL(url);assert.equal(u.searchParams.get('location'),'Mumbai');assert.equal(u.searchParams.get('f_TPR'),'r604800');return new Response(html);});assert.equal(jobs.length,1);
  await assert.rejects(fetchLinkedInGuest('Analyst',{},async()=>new Response('Blocked',{status:429})),/HTTP 429/);
  assert.equal(parseLinkedInCards(html.replace('https://www.linkedin.com/jobs/view/finance-123','https://malicious.example/jobs/view/123')).length,0);
});
function clean(t) {const store=openStore(':memory:');t.after(()=>store.close());store.replace(initialState(false));return store;}
async function drain(store,queue,fetcher,config={}) {
  const registry=handlers(store,queue,config,fetcher);
  for(let i=0;i<180;i++) {const result=await runOne(store,queue,registry);if(!result) break;assert.equal(result.status,'completed',JSON.stringify(result));}
  await store.refresh();
}
test('job search starts from preferences without a resume, name, mailbox, contact key, or outreach consent',async t=>{
  const store=clean(t),queue=taskQueue(store);let calls=0;
  await saveSearchConfig({roles:['Frontend Engineer'],sources:sources('Remotive')},store,queue,{});
  assert.equal(store.state.resume,null);assert.equal(store.state.profile.name,'');
  const first=(await queue.list())[0];assert.equal(first.kind,'jobs.discover');
  assert.equal((await scheduleDiscovery(store,queue,{},true)).id,first.id,'An active run is reused');
  const fetcher=async url=>{calls++;assert.match(String(url),/remotive/);return json({jobs:Array.from({length:32},(_,i)=>({id:i,company_name:`Company ${i}`,title:'Frontend Engineer',candidate_required_location:'Remote',tags:['React'],url:`https://remotive.com/remote-jobs/software-dev/frontend-${i}`,description:'React and TypeScript interfaces'}))});};
  await drain(store,queue,fetcher);
  const status=await searchStatus(store);assert.equal(status.indexed,32);assert.equal(status.matches,32);assert.equal(status.run.status,'completed');
  assert.equal(store.state.applications.length,0);assert.equal(store.state.contacts.length,0);assert.equal(store.state.campaigns.length,0);
  assert.ok((await queue.list()).every(t=>t.kind==='jobs.discover'));
  assert.equal(await scheduleDiscovery(store,queue,{}),null);
  await scheduleDiscovery(store,queue,{},true);await drain(store,queue,fetcher);assert.equal(calls,1,'Manual refresh respects provider caches');
  assert.ok(status.schedule.next_run>Date.now()+DISCOVERY_INTERVAL-10000);
});
test('a multi-batch sweep indexes public feeds and all company boards, deduplicates and isolates a failed source',async t=>{
  const store=clean(t),queue=taskQueue(store),requests=[];let active=0,peak=0;
  await saveSearchConfig({roles:['Frontend Engineer'],sources:{...SOURCE_DEFAULTS,'Google Jobs':false}},store,queue,{});
  const fetcher=async input=>{
    const u=String(input);requests.push(u);
    active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));active--;
    if(u.includes('remotive.com')) return json({jobs:[{id:1,company_name:'Stripe',title:'Frontend Engineer',candidate_required_location:'Remote',url:'https://remotive.com/remote-jobs/stripe-1',description:'React TypeScript'},...Array.from({length:30},(_,i)=>({id:i+2,company_name:`Business ${i}`,title:i%2 ? 'Frontend Engineer' : 'Financial Analyst',candidate_required_location:'Worldwide',url:`https://remotive.com/remote-jobs/${i}`,description:'Financial modeling and React'}))]});
    if(u.includes('arbeitnow')) return new Response('{}',{status:503});
    if(u.includes('remoteok')) return json([]);
    if(u.includes('jobicy')) return json({jobs:[]});
    if(u.includes('himalayas')) return json({jobs:[]});
    if(u.includes('api.lever')) return json([]);
    if(u.includes('boards-api.greenhouse.io/v1/boards/stripe/')) return json({jobs:[{id:1,title:'Frontend Engineer',location:{name:'Remote'},absolute_url:'https://boards.greenhouse.io/stripe/jobs/1',content:'React TypeScript'}]});
    if(/greenhouse|ashby/.test(u)) return json({jobs:[]});
    throw Error('Unexpected external request');
  };
  await drain(store,queue,fetcher);
  const status=await searchStatus(store);assert.equal(status.run.status,'completed');assert.ok(status.run.details.sourcesChecked>=110);assert.ok(status.run.details.failed>=1);
  assert.equal(store.state.jobs.filter(j=>j.company==='Stripe').length,1);assert.equal(status.indexed,31);assert.equal(status.matches,16);
  assert.equal(status.sources.find(s=>s.source==='Arbeitnow').status,'unavailable');
  assert.ok(store.state.jobs.filter(j=>j.title==='Financial Analyst').every(j=>!j.archived),'Other fields remain in the index, available under All live jobs');
  assert.ok(!requests.some(u=>u.endsWith('/stripe/jobs')),'Curated boards do not need a second validation request');
  assert.ok(!requests.some(u=>/api\.(apollo|hunter|resend)\./.test(u)));
  assert.ok(peak<=2,'Provider concurrency stays within the free-host memory budget');
});
test('resume-derived roles include finance, while country, experience and work-mode preferences filter unsuitable roles',()=>{
  const state=initialState(false);state.resume={text:'Financial modeling, valuation, bookkeeping and accounting. Built dashboards in Power BI.',suggestions:{skills:['Excel','Financial modeling']}};
  const plan=buildSearchPlan(state,{country:'IN',experience:'Entry level',workMode:'Remote'});
  assert.ok(plan.roles.includes('Financial Analyst'));assert.ok(plan.roles.includes('Accountant'));
  assert.equal(rankOpportunity(job('Frontend Engineer'),plan).eligible,false);
  assert.equal(rankOpportunity(job('Financial Analyst',{description:'Financial modeling Excel',locationRestrictions:['India']}),plan).eligible,true);
  assert.equal(rankOpportunity(job('Senior Financial Analyst'),plan).eligible,false);
  assert.equal(rankOpportunity(job('Financial Analyst',{locationRestrictions:['United States']}),plan).eligible,false);
  assert.equal(rankOpportunity(job('Financial Analyst',{location:'London',workMode:'On-site'}),plan).eligible,false);
});
test('optional Google Jobs normalizes real apply links from both aggregators; provider quota failure leaves free discovery working',async t=>{
  const [serp]=await fetchGoogleJobs('Frontend Engineer',{SERPAPI_API_KEY:'test'},async input=>{assert.equal(new URL(input).searchParams.get('engine'),'google_jobs');return json({jobs_results:[{job_id:'s1',title:'Frontend Engineer',company_name:'Stripe',location:'Remote',description:'React',apply_options:[{title:'LinkedIn',link:'https://linkedin.com/jobs/view/123'},{title:'Stripe careers',link:'https://boards.greenhouse.io/stripe/jobs/1'}]}]});});
  assert.equal(serp.applyOptions.length,2);assert.equal(serp.source,'Google Jobs');assert.equal(serp.url,'https://linkedin.com/jobs/view/123');
  const [rapid]=await fetchGoogleJobs('Analyst',{JSEARCH_API_KEY:'test'},async(input,options)=>{assert.equal(options.headers['X-RapidAPI-Key'],'test');return json({data:[{job_id:'j1',job_title:'Analyst',employer_name:'Company',job_country:'India',job_apply_link:'https://company.com/jobs/1',job_description:'Analyze finances'}]});});
  assert.equal(rapid.title,'Analyst');assert.equal(rapid.url,'https://company.com/jobs/1');
  const store=clean(t),queue=taskQueue(store);
  await saveSearchConfig({roles:['Analyst'],sources:sources('Google Jobs','Remotive')},store,queue,{});
  await drain(store,queue,async input=>String(input).includes('remotive') ? json({jobs:[]}) : new Response('{}',{status:429}),{JSEARCH_API_KEY:'test',SERPAPI_API_KEY:'test',JOB_SEARCH_API_DAILY_LIMIT:'1'});
  const status=await searchStatus(store);assert.equal(status.run.status,'completed');assert.equal(status.sources.find(s=>s.source==='Remotive').status,'healthy');
  assert.equal((await store.db.prepare('SELECT count(*) AS count FROM provider_requests').get()).count,1);
});
test('parallel provider reservations are serialized and contact and search budgets are independent',async t=>{
  const store=clean(t);let requests=0;
  const results=await Promise.allSettled([providerCall(store,'a','JSearch',1,async()=>{requests++;return []; }),providerCall(store,'b','SerpApi',1,async()=>{requests++;return [];})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(requests,1);
  await providerCall(store,'c','Apollo',1,async()=>{requests++;return [];});assert.equal(requests,2);
});
test('a hosted fresh workspace bootstraps discovery, and source changes supersede an old search scope',async t=>{
  const store=clean(t),queue=taskQueue(store);
  assert.equal(await scheduleDiscovery(store,queue,{}),null);
  assert.ok(await scheduleDiscovery(store,queue,{DISCOVERY_BOOTSTRAP:'true'}));
  await saveSearchConfig({roles:['Accountant'],sources:sources('Arbeitnow')},store,queue,{});
  const tasks=await Promise.all((await queue.list()).map(t=>queue.get(t.id)));assert.equal(tasks.filter(t=>t.kind==='jobs.discover').length,2);
  const scope=buildSearchPlan(store.state,(await searchStatus(store)).preferences).scope;
  const old=tasks.find(t=>t.payload.scope!==scope);
  const done=await runOne(store,queue,handlers(store,queue,{},()=>{throw Error('Old scope must not fetch');}),old.id);
  assert.equal(done.status,'cancelled');
});
test('bootstrap exposes setup booleans, not secrets; run endpoint only enqueues and job details retain full text',async t=>{
  const store=clean(t);store.state.jobs=[job('Frontend Engineer',{description:'React '.repeat(300)})];await store.save();
  const config={APOLLO_API_KEY:'never-return-apollo',JSEARCH_API_KEY:'never-return-search',WORKSPACE_PASSWORD:'owner',DISCOVERY_BOOTSTRAP:'true'};
  const app=createApp({store,config,fetcher:()=>{throw Error('Request path must not call providers');}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(async()=>{app.events.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));});
  const base=`http://127.0.0.1:${app.server.address().port}`,headers={Authorization:`Basic ${Buffer.from('orbit:owner').toString('base64')}`,'Content-Type':'application/json'};
  assert.equal((await fetch(base+'/api/bootstrap')).status,401);
  const response=await fetch(base+'/api/bootstrap',{headers}),raw=await response.text(),data=JSON.parse(raw);
  assert.ok(!raw.includes('never-return'));assert.equal(data.setup.jsearchConfigured,true);assert.ok(data.data.jobs[0].description.length<300);
  const detail=await (await fetch(base+'/api/jobs/job-1',{headers})).json();assert.equal(detail.job.description.length,1800);
  assert.equal((await fetch(base+'/api/autopilot/run',{method:'POST',headers,body:'{}'})).status,202);
  assert.ok((await app.queue.list()).some(t=>t.kind==='jobs.discover'));
});
test('PDF text and skills extract on native hosting without Poppler',async()=>{
  const content='BT /F1 12 Tf 40 740 Td (Casey Quinn - React and SQL engineer) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let pdf='%PDF-1.4\n';const offsets=[0];
  for(const [i,object] of objects.entries()) {offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;}
  const start=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  const originalPath=process.env.PATH;
  try {
    process.env.PATH='/__orbit_test_without_poppler__';
    const parsed=await parseResumeAsync({name:'resume.pdf',base64:Buffer.from(pdf).toString('base64')});
    assert.match(parsed.resume.text,/Casey Quinn/);assert.ok(parsed.suggestions.skills.includes('React'));assert.ok(parsed.suggestions.skills.includes('SQL'));assert.equal(parsed.warning,'');
  } finally {process.env.PATH=originalPath;}
});
test('new ATS apply links expand the persistent board registry only after a successful JSON probe',async t=>{
  const store=clean(t),queue=taskQueue(store),listing=job('Frontend Engineer',{company:'New Company',url:'https://jobs.ashbyhq.com/orbit-new-company/role-1',source:'Google Jobs'});
  await rememberBoards([listing],store,queue);assert.equal((await knownBoards(store)).length,0);
  let probes=0;await drain(store,queue,async input=>{probes++;assert.equal(String(input),'https://api.ashbyhq.com/posting-api/job-board/orbit-new-company');return json({jobs:[]});});
  assert.equal((await knownBoards(store))[0].slug,'orbit-new-company');
  await rememberBoards([listing],store,queue);await drain(store,queue,()=>{throw Error('Already checked');});assert.equal(probes,1);
});
