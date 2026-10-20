import {z} from 'zod';
import {hash,text,now,safeUrl} from '../domain.mjs';
import {resumeSuggestions} from '../resume.mjs';

const str=z.string().max(1200).default(''),long=z.string().max(12000).default('');
const list=z.array(z.string().max(500)).max(100).default([]);
const tri=z.boolean().nullable().default(null);
const group=fields=>z.object(fields).strict().prefault({});
export const MasterProfileSchema=z.object({
  personal:group(Object.fromEntries(['firstName','middleName','lastName','fullName','email','phoneCountryCode','phoneNumber','phoneFormatted','addressLine1','city','state','postalCode','country','citizenship','dateOfBirth'].map(k=>[k,str]))),
  links:group({linkedinUrl:str,githubUrl:str,portfolioUrl:str,twitterUrl:str,otherUrls:list}),
  summary:group({headline:str,professionalSummary:long,shortBio:long}),
  workExperience:z.array(z.object({id:str,company:str,title:str,employmentType:str,location:str,startMonth:str,startYear:str,endMonth:str,endYear:str,isCurrentRole:tri,description:long,bullets:list}).strict()).max(30).default([]),
  education:z.array(z.object({id:str,institution:str,degree:str,fieldOfStudy:str,location:str,startMonth:str,startYear:str,endMonth:str,endYear:str,isCurrent:tri,gradeOrGpa:str,activities:long}).strict()).max(20).default([]),
  projects:z.array(z.object({name:str,role:str,url:str,description:long,technologies:list}).strict()).max(30).default([]),
  certifications:z.array(z.object({name:str,issuer:str,issueDate:str,credentialUrl:str}).strict()).max(30).default([]),
  skills:group({technical:list,financeAndTools:list,softSkills:list,languages:list}),
  applicationDefaults:group({currentSalary:str,expectedSalary:str,salaryCurrency:str,noticePeriodDays:z.number().int().min(0).max(730).nullable().default(null),earliestStartDate:str,workAuthorizationCountry:str,requiresVisaSponsorship:tri,willingToRelocate:tri,preferredWorkMode:str,totalYearsExperience:z.number().min(0).max(80).nullable().default(null),highestEducationLevel:str,referralSourceDefault:z.string().max(300).default('Company Career Board'),gender:str,veteranStatus:str,disabilityStatus:str}),
}).strict();

const empty=value=>value===null || value===undefined || value==='' || Array.isArray(value) && !value.length;
export function mergeCandidate(old,incoming,overwrite=false) {
  if(incoming===undefined) return old;
  if(Array.isArray(incoming)) {
    if(overwrite || !Array.isArray(old) || !old.length) return structuredClone(incoming);
    if(incoming.every(v=>typeof v==='string')) return [...new Set([...old,...incoming])].slice(0,100);
    const identity=v=>hash([v.company || v.institution || v.name,v.title || v.degree || v.issuer,v.startYear || '',v.startMonth || ''].map(s=>String(s || '').trim().toLowerCase()));
    const result=structuredClone(old),positions=new Map(result.map((v,i)=>[identity(v),i]));
    for(const item of incoming) {const key=identity(item),index=positions.get(key);if(index!==undefined) result[index]=mergeCandidate(result[index],item);else {positions.set(key,result.length);result.push(structuredClone(item));}}
    return result;
  }
  if(incoming && typeof incoming==='object') {
    const result={...(old || {})};
    for(const [key,value] of Object.entries(incoming)) result[key]=mergeCandidate(result[key],value,overwrite);
    return result;
  }
  return overwrite || empty(old) ? incoming : old;
}
export function splitName(name) {
  const parts=String(name || '').trim().split(/\s+/).filter(Boolean);
  return {fullName:parts.join(' '),firstName:parts[0] || '',middleName:parts.length>2 ? parts.slice(1,-1).join(' ') : '',lastName:parts.length>1 ? parts.at(-1) : ''};
}
function legacyCandidate(profile) {
  const city=/\sor\s|[;|·]/i.test(profile.location || '') ? '' : String(profile.location || '').split(',')[0];
  return {personal:{...splitName(profile.name),email:profile.email || '',phoneFormatted:profile.phone || '',phoneNumber:profile.phone || '',city},links:{linkedinUrl:profile.linkedin || '',githubUrl:profile.github || '',portfolioUrl:profile.portfolio || ''},summary:{headline:profile.headline || '',professionalSummary:profile.summary || ''},skills:{technical:profile.skills || []},applicationDefaults:{expectedSalary:profile.expectedSalary || '',preferredWorkMode:profile.workMode==='Any' ? '' : profile.workMode || ''}};
}
export function candidateProfile(profile) {
  const parsed=MasterProfileSchema.safeParse(profile.master || {});
  return MasterProfileSchema.parse(mergeCandidate(parsed.success ? parsed.data : MasterProfileSchema.parse({}),legacyCandidate(profile)));
}
export function saveCandidate(profile,incoming,{overwrite=false,source='Manual edit'}={}) {
  const normalized=MasterProfileSchema.parse(incoming);
  if(!normalized.personal.fullName) normalized.personal.fullName=[normalized.personal.firstName,normalized.personal.middleName,normalized.personal.lastName].filter(Boolean).join(' ');
  const nameParts=splitName(normalized.personal.fullName);
  for(const key of ['firstName','middleName','lastName']) normalized.personal[key] ||= nameParts[key];
  for(const row of normalized.workExperience) row.id ||= hash([row.company,row.title,row.startYear,row.startMonth]).slice(0,24);
  for(const row of normalized.education) row.id ||= hash([row.institution,row.degree,row.startYear]).slice(0,24);
  const merged=mergeCandidate(candidateProfile(profile),normalized,overwrite);
  for(const [key,limit] of Object.entries({workExperience:30,education:20,projects:30,certifications:30}))merged[key]=merged[key].slice(0,limit);
  for(const [key,value] of Object.entries(merged.links))merged.links[key]=Array.isArray(value) ? value.map(safeUrl).filter(Boolean) : value ? safeUrl(value) || '' : '';
  for(const project of merged.projects)if(project.url)project.url=safeUrl(project.url) || '';
  for(const item of merged.certifications)if(item.credentialUrl)item.credentialUrl=safeUrl(item.credentialUrl) || '';
  profile.master=MasterProfileSchema.parse(merged);
  profile.masterUpdatedAt=now();profile.masterSource=source;
  const m=profile.master;
  const mirror={name:m.personal.fullName,email:m.personal.email,phone:m.personal.phoneFormatted || m.personal.phoneNumber,location:[m.personal.city,m.personal.state,m.personal.country].filter(Boolean).join(', '),headline:m.summary.headline,summary:m.summary.professionalSummary,linkedin:m.links.linkedinUrl,github:m.links.githubUrl,portfolio:m.links.portfolioUrl,expectedSalary:m.applicationDefaults.expectedSalary};
  for(const [key,value] of Object.entries(mirror)) if(value || overwrite) profile[key]=value;
  if(m.applicationDefaults.preferredWorkMode && ['Remote','Hybrid','On-site','Any'].includes(m.applicationDefaults.preferredWorkMode)) profile.workMode=m.applicationDefaults.preferredWorkMode;
  profile.skills=[...new Set([...m.skills.technical,...m.skills.financeAndTools,...m.skills.softSkills,...m.skills.languages])].slice(0,100);
  if(m.applicationDefaults.noticePeriodDays!==null) profile.noticePeriod=`${m.applicationDefaults.noticePeriodDays} days`;
  return profile.master;
}
export function updateCandidateFromLegacy(profile,patch) {
  const m=candidateProfile(profile);
  if('name' in patch && patch.name!==m.personal.fullName) Object.assign(m.personal,splitName(patch.name));
  const fields={email:['personal','email'],phone:['personal','phoneFormatted'],location:['personal','city'],linkedin:['links','linkedinUrl'],github:['links','githubUrl'],portfolio:['links','portfolioUrl'],headline:['summary','headline'],summary:['summary','professionalSummary'],expectedSalary:['applicationDefaults','expectedSalary'],workMode:['applicationDefaults','preferredWorkMode']};
  for(const [key,[group,name]] of Object.entries(fields)) if(key in patch) m[group][name]=patch[key];
  if('skills' in patch) m.skills.technical=patch.skills;
  profile.master=MasterProfileSchema.parse(m);
}
export function parseDateRange(value) {
  const matches=[...String(value || '').matchAll(/(?:(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|0?[1-9]|1[0-2])[ /.-]+)?((?:19|20)\d{2})/gi)];
  const month=value=>{if(!value)return '';if(/^\d+$/.test(value))return String(Number(value)).padStart(2,'0');const index=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(value.slice(0,3).toLowerCase());return index<0 ? '' : String(index+1).padStart(2,'0');};
  return {startMonth:month(matches[0]?.[1]),startYear:matches[0]?.[2] || '',endMonth:month(matches[1]?.[1]),endYear:matches[1]?.[2] || '',isCurrentRole:/\bpresent\b|\bcurrent\b|\btill date\b/i.test(value) ? true : matches[1] ? false : null};
}
export function candidateFromText(raw) {
  const value=text(raw,100000),lines=value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),suggestions=resumeSuggestions(value);
  const first=lines.slice(0,5).find(line=>/^[\p{L}][\p{L} .'-]{2,80}$/u.test(line) && line.split(/\s+/).length<=5 && !/resume|curriculum|contact|experience|education|summary|profile|linkedin|page \d|engineer|analyst|accountant|developer|manager|director|consultant|specialist|university|college/i.test(line));
  const phone=value.match(/(?:phone|mobile|tel(?:ephone)?|contact)\s*[:\-]?\s*([+\d][\d ()-]{7,25}\d)/i)?.[1] || value.match(/\+\d[\d ()-]{7,22}\d/)?.[0] || '';
  const callingCode=phone.match(/^\+(\d{1,3})[ -]/)?.[1] || '';
  const personal={...(first ? splitName(first) : {}),email:suggestions.email,phoneFormatted:phone,phoneCountryCode:callingCode ? `+${callingCode}` : '',phoneNumber:callingCode ? phone.replace(new RegExp(`^\\+${callingCode}[ -]`),'').replace(/\D/g,'') : phone.replace(/\D/g,'')};
  const links={linkedinUrl:value.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[^\s<>]+/i)?.[0] || '',githubUrl:value.match(/https?:\/\/(?:www\.)?github\.com\/[^\s<>]+/i)?.[0] || ''};
  const workExperience=[],education=[];let section='';
  for(let i=0;i<lines.length;i++) {
    if(/^(?:work |professional |employment )?experience\b|^employment history$/i.test(lines[i])) {section='work';continue;}
    if(/^education\b|^academic qualifications$/i.test(lines[i])) {section='education';continue;}
    if(/^(?:skills|projects|certifications|publications|languages|interests|summary)\b/i.test(lines[i])) {section='';continue;}
    const dates=parseDateRange(lines[i]);
    if(!dates.startYear || !section) continue;
    const previous=lines[i-1] || '',before=lines[i-2] || '';
    if(!previous || !before || /experience|education/i.test(before)) continue;
    let end=i+1;while(end<lines.length && !/\b(?:19|20)\d{2}\b/.test(lines[end]) && !/^(?:education|experience|skills|certifications|projects)\b/i.test(lines[end])) end++;
    const description=lines.slice(i+1,Math.min(end,i+12)).join('\n');
    if(section==='work') workExperience.push({company:before,title:previous,...dates,description,bullets:description.split('\n').filter(s=>/^[-•*]/.test(s)).map(s=>s.replace(/^[-•*]\s*/,''))});
    else education.push({institution:before,degree:previous,startMonth:dates.startMonth,startYear:dates.startYear,endMonth:dates.endMonth,endYear:dates.endYear,isCurrent:dates.isCurrentRole});
  }
  return MasterProfileSchema.parse({personal,links,workExperience:workExperience.slice(0,30).map(row=>({id:'',employmentType:'',location:'',...row})),education:education.slice(0,20).map(row=>({id:'',fieldOfStudy:'',location:'',gradeOrGpa:'',activities:'',...row})),skills:{financeAndTools:suggestions.skills.filter(s=>/excel|finance|valuation|tax|account|audit|ifrs|gaap|power bi/i.test(s)),technical:suggestions.skills.filter(s=>!/excel|finance|valuation|tax|account|audit|ifrs|gaap|power bi/i.test(s))}});
}
