import {text,stripHtml} from '../domain.mjs';

export const PERSONA_FILTERS=['all','manager','hiring-poster','peer','recruiter'];
export const PITCH_ANGLES=['auto','value','referral','application'];
export const PERSONA_MATRIX=Object.freeze({
  finance:{label:'Finance & accounting',pattern:/\b(financ\w*|account\w*|investment bank\w*|fp&a|valuation|portfolio|treasury|audit|m&a|private equity|controller|cfo)\b/i,managers:['VP Finance','Director of Finance','Head of FP&A','Managing Director','Partner','Portfolio Manager','Chief Financial Officer','Financial Controller','Head of M&A','Vice President Investment Banking'],recruiters:['Finance Recruiter','Campus Recruiter','Talent Acquisition Partner'],peers:['Senior Financial Analyst','Investment Banking Associate','Senior Accountant'],department:'finance'},
  software:{label:'Software, AI & data',pattern:/\b(software|engineer\w*|developer|data|ai|machine learning|frontend|backend|full.?stack|devops|cyber|technical)\b/i,managers:['Engineering Manager','Director of Engineering','VP Engineering','CTO','Head of AI','Principal Engineer','Tech Lead','Head of Data'],recruiters:['Technical Recruiter','Engineering Recruiter','Campus Recruiter'],peers:['Senior Engineer','Senior Data Scientist','Senior Data Analyst'],department:'it'},
  product:{label:'Product & design',pattern:/\b(product|design|ux|ui|user research)\b/i,managers:['VP Product','Head of Product','Director of Product Management','Group Product Manager','Head of Design'],recruiters:['Product Recruiter','Design Recruiter','Talent Acquisition Partner'],peers:['Senior Product Manager','Senior Product Designer'],department:'executive'},
  marketing:{label:'Marketing, growth & sales',pattern:/\b(marketing|growth|sales|revenue|seo|brand|content|advertis\w*)\b/i,managers:['VP Marketing','Head of Growth','CMO','Director of Sales','Revenue Operations Lead'],recruiters:['Marketing Recruiter','Sales Recruiter','Talent Acquisition Partner'],peers:['Senior Growth Manager','Senior Marketing Analyst'],department:'marketing,sales'},
  consulting:{label:'Consulting, strategy & operations',pattern:/\b(consult\w*|strategy|strategic|operations|founder.?s office|business analyst|chief of staff)\b/i,managers:['Engagement Manager','Principal','Partner','Director of Strategy','Chief of Staff','VP Operations'],recruiters:['Consulting Recruiter','Campus Recruiter','Talent Acquisition Partner'],peers:['Senior Consultant','Senior Business Analyst'],department:'management'},
});
const general={label:'Cross-functional',managers:['Department Head','Hiring Manager','Director'],recruiters:['Talent Acquisition Partner','Head of Talent','Campus Recruiter'],peers:['Senior Specialist'],department:'executive'};
const clean=value=>text(stripHtml(value || ''),160).replace(/["\r\n]/g,' ').trim();
export function classifyJobField(job={},preferences={}) {
  const title=clean(job.title),department=clean(`${job.department || ''} ${job.category || ''} ${(job.tags || []).join(' ')}`),prefs=(preferences.roles || preferences.interests || []).join(' ');
  const ranked=Object.entries(PERSONA_MATRIX).map(([field,m])=>({field,score:(m.pattern.test(title)?8:0)+(m.pattern.test(department)?3:0)+(m.pattern.test(prefs)?1:0)})).sort((a,b)=>b.score-a.score);
  return ranked[0]?.score ? ranked[0].field : 'general';
}
export function reportingTargets(job={}) {
  const result=[],description=stripHtml(job.description || '').replace(/\r/g,'');
  for(const match of description.matchAll(/(?:reports?\s+to|reporting\s+to|work\s+closely\s+with|led\s+by|hiring\s+manager\s*:?)\s+(?:the\s+|our\s+)?([^\n.!?;<>]{3,100})/gi)) {
    const target=clean(match[1].split(/\s+(?:who|where|and will|to (?:drive|help|lead|support)|on (?:the|a))\b/i)[0]).replace(/[,\s:]+$/,'').slice(0,70);
    if(target && (/director|manager|head|chief|\bc[tfmo]o\b|president|partner|principal|lead|controller|\bvp\b/i.test(target) || /^[\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+){1,3}$/u.test(target)))result.push({value:target,kind:/director|manager|head|chief|president|partner|lead|controller|\bvp\b|\bc[tfmo]o\b/i.test(target)?'title':'person',reference:job.url,quote:match[0]});
    if(result.length>=3)break;
  }
  if(job.postedBy?.name && job.postedBy?.url)result.unshift({value:clean(job.postedBy.name),kind:'person',reference:job.postedBy.url,quote:job.postedBy.quote || 'Posting author published by source'});
  return [...new Map(result.map(r=>[r.value.toLowerCase(),r])).values()];
}
export function contactTargeting(job={},preferences={}) {
  const field=classifyJobField(job,preferences),matrix=PERSONA_MATRIX[field] || general,reporting=reportingTargets(job);
  return {field,label:matrix.label,department:matrix.department,reporting,personas:[{id:'manager',weight:60,titles:[...reporting.map(r=>r.value),...matrix.managers]},{id:'recruiter',weight:25,titles:matrix.recruiters},{id:'peer',weight:15,titles:matrix.peers}],titles:[...new Set([...reporting.map(r=>r.value),...matrix.managers,...matrix.recruiters,...matrix.peers])]};
}
export function contactPersona(contact,targeting={}) {
  if((contact.warmSignals || []).some(s=>s.status==='source-supported'))return 'peer';
  const title=String(contact.title || '');
  if(/recruit|talent|human resources|head of people|people partner|\bhr\b|hiring team|public recruiting|suggested hiring/i.test(title))return 'recruiter';
  if(/director|manager|head|chief|\bc[tfmo]o\b|president|partner|principal|lead|controller|\bvp\b|founder/i.test(title) && !/senior (?:analyst|engineer|consultant|designer)/i.test(title))return 'manager';
  return 'peer';
}
export function prioritizeContact(contact,targeting) {
  const persona=contactPersona(contact,targeting),weight={manager:60,recruiter:25,peer:15}[persona];
  const exact=targeting.reporting?.some(r=>`${contact.name} ${contact.title}`.toLowerCase().includes(r.value.toLowerCase()));
  return {...contact,persona,field:targeting.field,priorityScore:weight+(contact.activeHiringPoster?25:0)+(exact?20:0)+((contact.warmSignals || []).some(s=>s.status==='source-supported')?15:0),priorityReason:exact?'Matches reporting line published in job':contact.activeHiringPoster?'Public hiring post':`${targeting.label} · ${persona}`,reportingMatch:!!exact};
}
export const matchesPersona=(contact,filter='all')=>filter==='all' || (filter==='hiring-poster' ? contact.activeHiringPoster===true : contact.persona===filter);
export const pitchAngle=(contact,requested='auto')=>requested!=='auto' && PITCH_ANGLES.includes(requested) ? requested : ({manager:'value',peer:'referral',recruiter:'application'}[contact.persona || contactPersona(contact)] || 'application');
