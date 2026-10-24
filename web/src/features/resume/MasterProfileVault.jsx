import React,{useEffect,useState,useRef} from 'react';
import {useApp,api,fmt} from '../../shared/workspace.jsx';
import {Button,Field} from '../../shared/ui.jsx';

const label=name=>name.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,s=>s.toUpperCase()).replace(/Url/g,'URL').replace(/Gpa/g,'GPA');
const groups={personal:['firstName','middleName','lastName','fullName','email','phoneCountryCode','phoneNumber','phoneFormatted','addressLine1','city','state','postalCode','country','citizenship','dateOfBirth'],links:['linkedinUrl','githubUrl','portfolioUrl','twitterUrl','otherUrls'],summary:['headline','professionalSummary','shortBio'],skills:['technical','financeAndTools','softSkills','languages'],applicationDefaults:['currentSalary','expectedSalary','salaryCurrency','noticePeriodDays','earliestStartDate','workAuthorizationCountry','requiresVisaSponsorship','willingToRelocate','preferredWorkMode','totalYearsExperience','highestEducationLevel','referralSourceDefault','gender','veteranStatus','disabilityStatus']};
const arrays={workExperience:['company','title','employmentType','location','startMonth','startYear','endMonth','endYear','isCurrentRole','description','bullets'],education:['institution','degree','fieldOfStudy','location','startMonth','startYear','endMonth','endYear','isCurrent','gradeOrGpa','activities'],projects:['name','role','url','description','technologies'],certifications:['name','issuer','issueDate','credentialUrl']};
const listFields=new Set(['otherUrls','technical','financeAndTools','softSkills','languages','bullets','technologies']);
const numberFields=new Set(['noticePeriodDays','totalYearsExperience']);
const booleans=new Set(['requiresVisaSponsorship','willingToRelocate','isCurrentRole','isCurrent']);
function InputField({name,value,onChange,prefix=''}) {
  const separator=name==='bullets' ? '\n' : ', ',format=v=>Array.isArray(v) ? v.join(separator) : v || '';
  const [rawList,setRawList]=useState(format(value)),emitted=useRef(null),signature=JSON.stringify(value);
  useEffect(()=>{if(signature!==emitted.current)setRawList(format(value));},[signature,name]);
  const common={value:value ?? '',onChange:event=>{
    if(listFields.has(name)){const raw=event.target.value,parsed=raw.split(name==='bullets' ? '\n' : ',').map(s=>s.trim()).filter(Boolean);setRawList(raw);emitted.current=JSON.stringify(parsed);onChange(parsed);}
    else onChange(numberFields.has(name) ? event.target.value==='' ? null : Number(event.target.value) : event.target.value);
  }};
  return <Field label={`${prefix}${label(name)}`} hint={name==='bullets' ? 'One existing bullet per line' : listFields.has(name) ? 'Separate values with commas' : /Month$/.test(name) ? '01–12; leave blank if unknown' : undefined}>
    {booleans.has(name) ? <select value={value===null || value===undefined ? '' : String(value)} onChange={e=>onChange(e.target.value==='' ? null : e.target.value==='true')}><option value="">Not provided</option><option value="true">Yes</option><option value="false">No</option></select> : ['description','professionalSummary','shortBio','activities','bullets'].includes(name) ? <textarea rows="3" {...common} value={listFields.has(name) ? rawList : value || ''}/> : <input {...common} type={numberFields.has(name) ? 'number' : /(?:dateOfBirth|earliestStartDate)/.test(name) ? 'date' : name==='email' ? 'email' : 'text'} min={numberFields.has(name) ? '0' : undefined} value={listFields.has(name) ? rawList : value ?? ''}/>}
  </Field>;
}
export function MasterProfileVault() {
  const {data,perform,notify}=useApp();
  const [draft,setDraft]=useState(data.profile.master || null),[tab,setTab]=useState('personal'),[dirty,setDirty]=useState(false),[draftVersion,setDraftVersion]=useState(data.profile.masterUpdatedAt || null),[linkedin,setLinkedin]=useState(''),[paste,setPaste]=useState('');
  const stored=JSON.stringify(data.profile.master);
  useEffect(()=>{if(!dirty && data.profile.master){setDraft(data.profile.master);setDraftVersion(data.profile.masterUpdatedAt || null);}},[stored,dirty]);
  useEffect(()=>{if(!draft)api('/profile/master').then(value=>{setDraft(value.master);setDraftVersion(value.updatedAt);}).catch(()=>{});},[]);
  const edit=next=>{setDraft(next);setDirty(true);};
  async function importText() {const result=await api('/profile/import-linkedin',{url:linkedin,text:paste});notify(result.message);setPaste('');}
  async function importFile(file) {
    if(!file)return;if(file.size>5000000)throw Error('Choose a file under 5 MB.');
    let raw='';for(const byte of new Uint8Array(await file.arrayBuffer()))raw+=String.fromCharCode(byte);
    const result=await api('/profile/import-linkedin',{name:file.name,base64:btoa(raw)});notify(result.message);
  }
  return <section className="form-section master-vault">
    <div className="spread"><div><span className="eyebrow">ENTER ONCE</span><h2>Your candidate vault</h2></div><span className="badge">{dirty ? 'Unsaved edits' : data.profile.masterUpdatedAt ? `Saved ${fmt(data.profile.masterUpdatedAt)}` : 'Ready to set up'}</span></div>
    <p>Your saved history and answers travel with each application. Review imported facts once. Unknown answers stay blank.</p>
    <div className="vault-tabs" role="tablist" aria-label="Candidate profile sections">{[['personal','Personal'],['workExperience','Experience'],['education','Education'],['skills','Skills'],['applicationDefaults','Screening defaults'],['links','Links'],['summary','Summary'],['projects','Projects'],['certifications','Certifications']].map(([key,title])=><button type="button" key={key} role="tab" aria-selected={tab===key} onClick={()=>setTab(key)}>{title}{Array.isArray(draft?.[key]) ? ` (${draft[key].length})` : ''}</button>)}</div>
    {draft ? <form onSubmit={e=>{e.preventDefault();perform(async()=>{const result=await api('/profile/master',{master:draft,expectedUpdatedAt:draftVersion},'PUT');setDraft(result.master);setDraftVersion(result.updatedAt);setDirty(false);},'Candidate vault saved.')}}>
      {tab==='applicationDefaults' && <p className="hint">Eligibility and demographic answers are optional. Enter them explicitly; the assistant will not infer them. Work authorization country means you have confirmed authorization there.</p>}
      {groups[tab] && <div className="form-grid">{groups[tab].map(name=><InputField key={name} name={name} value={draft[tab][name]} onChange={value=>edit({...draft,[tab]:{...draft[tab],[name]:value}})}/>)}</div>}
      {arrays[tab] && <>{draft[tab].map((row,index)=><fieldset className="vault-entry" key={`${tab}-${index}`}><legend>{label(tab)} {index+1}</legend><div className="form-grid">{arrays[tab].map(name=><InputField key={name} prefix={`${index+1}. `} name={name} value={row[name]} onChange={value=>edit({...draft,[tab]:draft[tab].map((r,i)=>i===index ? {...r,[name]:value} : r)})}/>)}</div><Button small onClick={()=>edit({...draft,[tab]:draft[tab].filter((_,i)=>i!==index)})}>Remove entry {index+1}</Button></fieldset>)}<Button onClick={()=>edit({...draft,[tab]:[...draft[tab],Object.fromEntries(arrays[tab].map(name=>[name,booleans.has(name) ? null : listFields.has(name) ? [] : '']))]})}>+ Add {tab==='workExperience' ? 'work experience' : tab==='education' ? 'education' : tab==='projects' ? 'project' : 'certification'}</Button></>}
      <div className="form-actions"><Button primary type="submit" disabled={!dirty}>Save candidate vault</Button>{dirty && <Button onClick={()=>{setDraft(data.profile.master || draft);setDraftVersion(data.profile.masterUpdatedAt || null);setDirty(false);}}>Reload saved profile</Button>}</div>
    </form> : <p>Loading your saved profile…</p>}
    <details className="vault-import"><summary>Import LinkedIn profile or exported PDF</summary><p>Use your LinkedIn Save to PDF export, paste profile text, or select Sync My LinkedIn Profile in the extension. A URL alone saves the link.</p>{dirty && <p className="hint">Save your edits before importing more information.</p>}<Field label="Your LinkedIn profile URL"><input type="url" value={linkedin} onChange={e=>setLinkedin(e.target.value)} placeholder="https://www.linkedin.com/in/your-profile/"/></Field><Field label="Paste About / Experience / Education text"><textarea rows="5" value={paste} onChange={e=>setPaste(e.target.value)}/></Field><div className="btn-row"><Button disabled={dirty || !linkedin && !paste} onClick={()=>perform(importText)}>Import profile</Button><label className="btn small">Upload LinkedIn PDF<input className="sr-only" type="file" accept=".pdf,.txt,.docx" disabled={dirty} onChange={e=>perform(()=>importFile(e.target.files[0]))}/></label></div></details>
  </section>;
}
