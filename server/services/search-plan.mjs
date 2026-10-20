import {hash} from '../domain.mjs';

export const SEARCH_DEFAULTS={enabled:true,roles:[],location:'',country:'',workMode:'Any',experience:'Any'};
export const normalizeSearch=s=>String(s || '').toLowerCase().replace(/front[ -]?end/g,'frontend').replace(/back[ -]?end/g,'backend').replace(/full[ -]?stack/g,'fullstack').replace(/\bdevelopers?\b/g,'engineer').replace(/\bfinancial\b/g,'finance').replace(/\b(bangalore)\b/g,'bengaluru').replace(/\bgurgaon\b/g,'gurugram').replace(/[^a-z0-9+#]+/g,' ').trim();
export const searchLocations=value=>[...new Set((Array.isArray(value) ? value : String(value || '').split(/\s+(?:or|and)\s+|[,;|\n·]/i)).map(s=>String(s).trim()).filter(Boolean))].slice(0,8);
const metros=[
  {country:'IN',aliases:['Delhi','New Delhi','Delhi NCR','Gurugram','Gurgaon','Noida','Faridabad','Ghaziabad']},
  {country:'IN',aliases:['Bengaluru','Bangalore'],regions:['Karnataka']},
  {country:'IN',aliases:['Mumbai','Navi Mumbai','Thane','Bombay'],regions:['Maharashtra']},
  {country:'IN',aliases:['Hyderabad','Secunderabad'],regions:['Telangana']},
  {country:'IN',aliases:['Chennai','Madras'],regions:['Tamil Nadu']},
  {country:'US',aliases:['New York','NYC','Manhattan']},
  {country:'US',aliases:['San Francisco','SF Bay Area','Bay Area','San Jose','Palo Alto']},
  {country:'GB',aliases:['London','Greater London']},
];
const termMatchers=new Map();
const contains=(value,term)=>{const normalized=normalizeSearch(term);let pattern=termMatchers.get(normalized);if(!pattern){if(termMatchers.size>1024)termMatchers.clear();pattern=new RegExp(`(?:^| )${normalized.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?: |$)`);termMatchers.set(normalized,pattern);}return pattern.test(value);};
const metroFor=value=>metros.find(m=>m.aliases.some(a=>contains(normalizeSearch(value),a)));
const roleFamilies=[
  ['finance',/\b(finance|financial|fp a|fpa|corporate finance|valuation|investment banking|equity research|treasury|credit analyst|risk analyst|m a|mergers|acquisitions)\b/],
  ['accounting',/\b(accountant|accounting|chartered account|bookkeep|audit|assurance|tax)\w*/],
  ['marketing',/\b(marketing|seo|growth market|content market|brand)\w*/],
  ['recruiting',/\b(recruit|talent acquisition|human resources)\w*/],
];
const family=value=>roleFamilies.find(([,pattern])=>pattern.test(normalizeSearch(value)))?.[0];
const words=s=>[...new Set(normalizeSearch(s).split(' ').filter(w=>w.length>1 && !['and','or','of','the','in','at','for','a'].includes(w)))];
const roleRules=[
  [/software engineer|software developer|computer science/i,'Software Engineer'],
  [/frontend|react|angular|vue/i,'Frontend Engineer'],[/backend|node\.js|django|spring boot/i,'Backend Engineer'],[/full.?stack/i,'Full Stack Developer'],
  [/machine learning|pytorch|tensorflow/i,'Machine Learning Engineer'],[/data analy|tableau|power bi/i,'Data Analyst'],
  [/finance analy|financial analy|financial model|valuation|fp&a|corporate finance/i,'Financial Analyst'],[/investment banking|equity research|mergers|acquisitions/i,'Investment Banking Analyst'],[/accounting|accountant|chartered account|bookkeeping/i,'Accountant'],[/audit|assurance/i,'Audit Associate'],
  [/digital marketing|seo|google ads/i,'Digital Marketing Specialist'],[/content writ|copywrit/i,'Content Writer'],[/recruit|talent acquisition/i,'Recruiter'],
  [/ux design|product design|figma/i,'Product Designer'],[/project manag|pmp/i,'Project Manager'],[/business analy/i,'Business Analyst'],[/customer support|customer success/i,'Customer Success Specialist'],
];
export function buildSearchPlan(state,settings={}) {
  const p=state.profile,r=state.resume;
  const skills=[...new Set([...(p.skills || []),...(r?.suggestions?.skills || [])])].slice(0,50);
  const explicit=(settings.roles?.length ? settings.roles : p.interests || []).filter(Boolean).slice(0,8);
  const derived=explicit.length ? [] : roleRules.filter(([pattern])=>pattern.test(`${p.headline || ''}\n${r?.text || ''}\n${skills.join(' ')}`)).map(([,role])=>role).slice(0,6);
  const location=settings.location || p.location || '',locations=searchLocations(location);
  const inferred=[...new Set(locations.map(l=>metroFor(l)?.country).filter(Boolean))];
  const plan={roles:explicit.length ? explicit : derived,skills,location,locations,country:settings.country || (inferred.length===1 ? inferred[0] : ''),workMode:settings.workMode || p.workMode || 'Any',experience:settings.experience || 'Any',derived:!explicit.length && !!derived.length};
  return {...plan,personalized:!!plan.roles.length,scope:hash({...plan,matcherVersion:2,sources:settings.sources})};
}
const senior=/\b(senior|sr|staff|principal|lead|manager|director|head|vp)\b/i;
const regionNames=new Intl.DisplayNames(['en'],{type:'region'});
const countryAliases={US:['united states','usa','u s','us only','us remote'],GB:['united kingdom','uk','great britain'],IN:['india'],CA:['canada'],AU:['australia'],DE:['germany'],FR:['france'],SG:['singapore']};
export function rankOpportunity(job,plan) {
  const title=normalizeSearch(job.title),body=normalizeSearch(`${job.title} ${job.description || ''} ${(job.tags || []).join(' ')}`);
  const matched=plan.skills.filter(s=>body.includes(normalizeSearch(s))),missing=plan.skills.filter(s=>!matched.includes(s));
  const reasons=[],gaps=[];
  let eligible=true,hardBlocked=false,roleFit=0;
  const titleWords=words(title),jobFamily=family(job.title);
  for(const role of plan.roles) {
    const tokens=words(role),hits=tokens.filter(t=>titleWords.includes(t));
    let ratio=tokens.length ? hits.length/tokens.length : 0;
    if(/software engineer/.test(normalizeSearch(role)) && /engineer/.test(title) && /software|react|python|javascript|typescript|backend|frontend|fullstack/.test(body)) ratio=Math.max(ratio,.85);
    const targetFamily=family(role);
    if(targetFamily && jobFamily===targetFamily) ratio=Math.max(ratio,.72);
    if(['finance','accounting'].includes(targetFamily) && ['finance','accounting'].includes(jobFamily)) ratio=Math.max(ratio,.56);
    roleFit=Math.max(roleFit,ratio);
  }
  if(plan.roles.length && roleFit<.85) {eligible=false;gaps.push(roleFit>=.45 ? 'Adjacent role rather than an exact target title' : 'Title is outside your target roles');}
  if(plan.workMode!=='Any' && job.workMode!==plan.workMode) {eligible=false;gaps.push('Work arrangement differs');}
  const intern=/\bintern(ship)?\b|trainee|apprentice/i.test(job.title);
  if(plan.experience==='Internship' && !intern) {eligible=false;hardBlocked=true;gaps.push('Not an internship');}
  if(plan.experience==='Entry level' && senior.test(job.title)) {eligible=false;hardBlocked=true;gaps.push('Senior position');}
  if(plan.experience==='Senior' && intern) {eligible=false;hardBlocked=true;gaps.push('Internship rather than senior role');}
  const location=normalizeSearch(job.location),preferred=plan.locations || searchLocations(plan.location);
  let locationFit=!preferred.length;
  if(job.workMode==='Remote') {
    locationFit=/worldwide|anywhere|global/.test(location) || location==='remote';
    if(plan.country) {
      const name=regionNames.of(plan.country);
      const aliases=[plan.country,name,...(countryAliases[plan.country] || [])].map(normalizeSearch);
      const restrictions=job.locationRestrictions || [];
      if(restrictions.length && !restrictions.some(r=>aliases.some(a=>a.length>2 ? contains(normalizeSearch(r),a) : normalizeSearch(r)===a) || /worldwide|anywhere|global/i.test(r))) {eligible=false;hardBlocked=true;gaps.push('Country restriction differs');}
      if(aliases.some(c=>c.length>2 ? location.includes(c) : words(location).includes(c))) locationFit=true;
      const stated=Object.entries(countryAliases).filter(([,names])=>names.some(n=>new RegExp(`\\b${n}\\b`).test(location))).map(([code])=>code);
      if(stated.length && !stated.includes(plan.country) && !/worldwide|anywhere|global/.test(location)) {eligible=false;hardBlocked=true;gaps.push('Remote role restricted to another country');}
      if(!locationFit || location==='remote' && !restrictions.length) {eligible=false;gaps.push('Remote country availability needs review');}
    } else if(job.locationRestrictions?.length) gaps.push('Check the listed country restrictions');
  } else if(preferred.length) {
    locationFit=preferred.some(place=>contains(location,place) || metroFor(place)?.aliases.some(alias=>contains(location,alias)));
    if(!locationFit) {eligible=false;gaps.push('On-site location differs');}
  }
  const listedCountries=Object.entries(countryAliases).filter(([code,names])=>names.some(name=>contains(location,name)) || new RegExp(`(?:^|[,(/])\\s*${code}(?:\\s*$|[,)\\/])`).test(job.location || '')).map(([code])=>code);
  const metroCountry=metroFor(job.location)?.country;
  if(plan.country && (listedCountries.length && !listedCountries.includes(plan.country) || metroCountry && metroCountry!==plan.country)) {eligible=false;hardBlocked=true;gaps.push('Listed country differs');}
  const expiry=job.expiresAt && (typeof job.expiresAt==='number' ? job.expiresAt*1000 : Date.parse(job.expiresAt));
  if(job.archived || job.isDemo || expiry && expiry<Date.now()) {eligible=false;hardBlocked=true;}
  const recommendable=!hardBlocked && (!plan.roles.length || roleFit>=.45);
  if(!recommendable) eligible=false;
  const tier=!recommendable ? 'excluded' : !plan.roles.length ? 'explore' : eligible && roleFit>=.85 ? 'strong' : 'adjacent';
  const weights=plan.skills.length ? {role:60,skills:25,location:10,mode:5} : {role:85,skills:0,location:10,mode:5};
  let score=plan.roles.length ? Math.round(roleFit*weights.role+(plan.skills.length ? matched.length/plan.skills.length*weights.skills : 0)+(locationFit ? weights.location : 0)+(plan.workMode==='Any'||job.workMode===plan.workMode ? weights.mode : 0)) : null;
  if(score!==null && !eligible) score=Math.min(score,recommendable ? 74 : 49);
  if(roleFit>=.65) reasons.push(roleFit>=.99 ? 'Title matches a target role' : 'Related to your target role');
  if(plan.skills.length) reasons.push(`${matched.length} of ${plan.skills.length} skills found in the listing`);
  if(locationFit) reasons.push(job.workMode==='Remote' ? 'Remote/location preference fits' : 'Preferred location matches');
  if(!plan.roles.length) reasons.push('Set target roles to personalize your recommendations');
  if(tier==='adjacent') reasons.push('Adjacent opportunity: review role and location differences');
  return {score,eligible,recommendable,tier,matched,missing,reasons:[...reasons,...gaps],gaps,scope:plan.scope,method:'Explained profile match'};
}
