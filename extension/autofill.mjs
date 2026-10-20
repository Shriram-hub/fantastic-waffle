export const fieldKey=s=>String(s || '').toLowerCase().replace(/[^a-z0-9]/g,'');
export function buildAnswers(profile,qa=[]) {
  const parts=String(profile.name || '').trim().split(/\s+/);
  const m=profile.master || {personal:{fullName:profile.name,firstName:parts[0],lastName:parts.slice(1).join(' '),email:profile.email,phoneFormatted:profile.phone,city:profile.location},links:{linkedinUrl:profile.linkedin,githubUrl:profile.github,portfolioUrl:profile.portfolio},summary:{professionalSummary:profile.summary},applicationDefaults:{expectedSalary:profile.expectedSalary},workExperience:[],education:[]};
  const p=m.personal || {},l=m.links || {},d=m.applicationDefaults || {},answers={__master:m};
  const add=(names,value)=>{if(value!==null && value!==undefined && value!=='')for(const name of names)answers[fieldKey(name)]=String(value);};
  for(const [names,value] of [
    [['name','full name','your name'],p.fullName],[['first name','given name'],p.firstName],[['middle name'],p.middleName],[['last name','surname','family name'],p.lastName],
    [['email','email address'],p.email],[['phone','phone number','mobile'],p.phoneFormatted || [p.phoneCountryCode,p.phoneNumber].filter(Boolean).join(' ')],[['phone country code','dial code'],p.phoneCountryCode],
    [['address','street address','address line 1'],p.addressLine1],[['city','location','current location'],p.city],[['state','province'],p.state],[['zip','zip code','postal code','postcode'],p.postalCode],[['country','country of residence'],p.country],
    [['date of birth','birth date'],p.dateOfBirth],[['citizenship','nationality'],p.citizenship],
    [['linkedin','linkedin profile','linkedin url'],l.linkedinUrl],[['github','github url'],l.githubUrl],[['portfolio','website','personal website'],l.portfolioUrl],
    [['professional summary','cover letter summary','about yourself'],m.summary?.professionalSummary],
    [['notice period'],d.noticePeriodDays===null || d.noticePeriodDays===undefined ? profile.noticePeriod : `${d.noticePeriodDays} days`],
    [['notice period days'],d.noticePeriodDays],[['expected salary','expected ctc','desired salary'],d.expectedSalary],[['current salary','current ctc'],d.currentSalary],[['salary currency'],d.salaryCurrency],
    [['earliest start date','available start date'],d.earliestStartDate],[['total years experience','total years of experience'],d.totalYearsExperience],
    [['highest education level'],d.highestEducationLevel],[['how did you hear about us','referral source'],d.referralSourceDefault],
    [['gender'],d.gender],[['veteran status'],d.veteranStatus],[['disability status'],d.disabilityStatus],
  ]) add(names,value);
  for(const item of qa)if(item.question && item.answer!==null && item.answer!==undefined)add([item.question],item.answer);
  return answers;
}

export async function fillApplication(answers,resume,options={}) {
  // chrome.scripting serializes this function. Keep every DOM helper inside it.
  const key=s=>String(s || '').toLowerCase().replace(/[^a-z0-9]/g,'');
  const master=answers.__master || {},defaults=master.applicationDefaults || {},missing=[],questions=[];
  let filled=0,added=0;
  const roots=()=>{const all=[document];for(let i=0;i<all.length;i++)for(const e of all[i].querySelectorAll('*'))if(e.shadowRoot)all.push(e.shadowRoot);return all;};
  const deep=selector=>roots().flatMap(root=>[...root.querySelectorAll(selector)]);
  const visible=el=>!el.disabled && (!el.readOnly || el.getAttribute('role')==='combobox') && !el.hidden && !el.closest('[hidden],[aria-hidden="true"]') && !['none'].includes(el.ownerDocument.defaultView.getComputedStyle(el).display);
  const label=el=>[...(el.labels || [])].map(l=>l.textContent).join(' ').trim() || (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id=>el.getRootNode().getElementById?.(id)?.textContent || '').join(' ').trim() || el.getAttribute('aria-label') || el.placeholder || el.name || el.id || '';
  const identity=el=>`${label(el)} ${el.name || ''} ${el.id || ''} ${el.getAttribute('data-automation-id') || ''}`;
  const fields=root=>{const all=[root];for(let i=0;i<all.length;i++)for(const el of all[i].querySelectorAll('*'))if(el.shadowRoot)all.push(el.shadowRoot);return all.flatMap(r=>[...r.querySelectorAll('input,textarea,select,[role="combobox"]')]).filter(visible);};
  const composedContains=(parent,child)=>{for(let node=child;node;node=node.parentElement || node.getRootNode?.().host)if(node===parent)return true;return false;};
  const emit=el=>{const E=el.ownerDocument.defaultView.Event;for(const type of ['input','change','blur'])el.dispatchEvent(new E(type,{bubbles:true,composed:true}));};
  const native=(el,value,property='value')=>{const w=el.ownerDocument.defaultView,proto=el.tagName==='TEXTAREA' ? w.HTMLTextAreaElement.prototype : el.tagName==='SELECT' ? w.HTMLSelectElement.prototype : w.HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(proto,property)?.set;if(setter)setter.call(el,value);else el[property]=value;emit(el);};
  const choice=(expected,actual)=>{const a=key(actual),e=key(expected);return a===e || e==='yes' && /^(yes|true)$/.test(a) || e==='no' && /^(no|false)$/.test(a) || e==='declinetoselfidentify' && /^(prefernottoanswer|idonotwishtoanswer|declinetoselfidentify)$/.test(a);};
  const monthNumber=value=>{const raw=String(value || ''),i=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(raw.slice(0,3).toLowerCase());return /^\d{1,2}$/.test(raw) ? Number(raw) : i>=0 ? i+1 : NaN;};
  const optionMatches=(value,option,isMonth)=>choice(value,option.textContent) || choice(value,option.value) || isMonth && monthNumber(value)===monthNumber(option.textContent || option.value);
  const waitFor=(test,timeout=1800)=>new Promise(resolve=>{let done=false;const observers=[];const finish=value=>{if(done)return;done=true;clearTimeout(timer);for(const o of observers)o.disconnect();resolve(value);};const timer=setTimeout(()=>finish(test()),timeout);for(const root of roots()){const o=new MutationObserver(()=>{const result=test();if(result)finish(result);});o.observe(root,{childList:true,subtree:true});observers.push(o);}const result=test();if(result)finish(result);});
  const answerFor=(el,local={})=>{
    const names=[label(el),el.name,el.id].filter(Boolean),joined=identity(el),exact=names.map(n=>local[key(n)] ?? (local.__row ? undefined : answers[key(n)])).find(v=>v!==undefined && v!=='');
    if(exact!==undefined)return exact;
    const identifiers=[el.name,el.id,el.getAttribute('data-automation-id'),el.getRootNode().host?.id,el.getRootNode().host?.getAttribute('data-automation-id')].filter(Boolean).map(key);
    const mapping=local.__row ? local : answers,aliases=Object.keys(mapping).filter(alias=>!alias.startsWith('__') && alias.length>=5 && identifiers.some(name=>name.endsWith(alias) || name.includes(`${alias}input`))).sort((a,b)=>b.length-a.length);
    if(aliases.length && mapping[aliases[0]]!==undefined)return mapping[aliases[0]];
    if(/(?:require|need).*sponsor|sponsor.*(?:require|need)/i.test(joined) && !/without|do not|don't|not require/i.test(joined) && defaults.requiresVisaSponsorship!==null && defaults.requiresVisaSponsorship!==undefined)return defaults.requiresVisaSponsorship ? 'Yes' : 'No';
    if(/\bwilling\b.*relocat|relocat.*\bwilling\b/i.test(joined) && !/not willing|unwilling/i.test(joined) && defaults.willingToRelocate!==null && defaults.willingToRelocate!==undefined)return defaults.willingToRelocate ? 'Yes' : 'No';
    const country=String(defaults.workAuthorizationCountry || '').trim(),countryAliases={IN:['India'],US:['United States','USA','U.S.'],GB:['United Kingdom','UK'],CA:['Canada'],AU:['Australia'],DE:['Germany'],SG:['Singapore']};
    const countries=countryAliases[country.toUpperCase()] || (country.length>2 ? [country] : []);
    if(/legally authori[sz]ed|right to work/i.test(joined) && !/not (?:legally )?authori[sz]ed|unauthori[sz]ed/i.test(joined) && countries.some(name=>new RegExp(`(?:^|[^a-z])${name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:[^a-z]|$)`,'i').test(joined)))return 'Yes';
    return undefined;
  };
  const fill=async(el,local={})=>{
    if(!visible(el) || ['hidden','password','submit','button','reset','image'].includes(el.type))return;
    const name=label(el),identityText=identity(el);
    if(el.type==='file') {
      if(!resume || !/resume|résumé|\bcv\b|curriculum/i.test(identityText) || el.files?.length)return;
      const mime=/\.pdf$/i.test(resume.name) ? 'application/pdf' : /\.docx$/i.test(resume.name) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain';
      const accept=(el.accept || '').toLowerCase(),extension=`.${resume.name.split('.').at(-1).toLowerCase()}`;
      if(accept && !accept.split(',').some(t=>[extension,mime,'application/*','*/*'].includes(t.trim()))){missing.push(`${name}: upload a résumé in an accepted format`);return;}
      try {const w=el.ownerDocument.defaultView,bytes=Uint8Array.from(atob(resume.base64),c=>c.charCodeAt(0)),dt=new w.DataTransfer();dt.items.add(new w.File([bytes],resume.name,{type:mime}));el.files=dt.files;emit(el);filled++;}catch {missing.push('Attach your résumé manually.');}
      return;
    }
    if(el.type==='radio') {
      const group=el.closest('fieldset,[role="radiogroup"]'),question=group?.querySelector('legend')?.textContent || group?.getAttribute('aria-label') || '';
      if(!question)return;
      const surrogate={...el,labels:[],getAttribute:attr=>attr==='aria-label' ? question : '',getRootNode:()=>el.getRootNode(),name:el.name,id:el.id};
      const value=answerFor(surrogate,local);
      if(value!==undefined && (choice(value,name) || choice(value,el.value)) && !el.checked){el.click();emit(el);filled++;}
      return;
    }
    const value=answerFor(el,local);
    if(value===undefined || value==='') {if(el.required || el.getAttribute('aria-required')==='true'){missing.push(name || 'Unmapped required field');if(['text','search','url'].includes(el.type) || el.tagName==='TEXTAREA')questions.push({label:name});}return;}
    if(el.type==='checkbox') {
      if(/agree|certify|consent|privacy|terms|marketing|subscribe/i.test(identityText))return;
      const checked=/^(true|yes)$/i.test(String(value));
      if(checked && !el.checked){el.click();emit(el);filled++;}
      else if(!checked && el.checked)missing.push(`${name}: review the existing checked answer`);
      return;
    }
    const selected=el.tagName==='SELECT' ? el.options[el.selectedIndex] : null;
    if(el.value && !(selected && /^(please\s+)?(select|choose|month|year)\b/i.test(selected.textContent.trim())) || el.getAttribute('aria-checked')==='true')return;
    if(el.tagName==='SELECT') {
      const option=[...el.options].find(o=>!o.disabled && o.value!=='' && optionMatches(value,o,/month/i.test(identityText)));
      if(option){native(el,option.value);filled++;}else missing.push(name);
    } else if(el.getAttribute('role')==='combobox') {
      el.click();if(el.tagName==='INPUT' && !el.readOnly)native(el,String(value));
      const find=()=>{const controlled=el.getAttribute('aria-controls'),list=controlled ? deep('[role="listbox"]').find(l=>l.id===controlled) : null;return [...(list?.querySelectorAll('[role="option"]') || deep('[role="option"]'))].filter(visible).find(o=>optionMatches(value,o,/month/i.test(identityText)));};
      const option=await waitFor(find,900);if(option){option.click();emit(el);filled++;}else missing.push(`${name}: choose the dropdown option manually`);
    } else {
      let formatted=String(value);
      if(el.type==='number' && !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(formatted)){missing.push(`${name}: enter a numeric value explicitly`);return;}
      if(el.maxLength>0 && formatted.length>el.maxLength){missing.push(`${name}: shorten the saved answer to fit this form`);return;}
      if(el.type==='date' && !/^\d{4}-\d{2}-\d{2}$/.test(formatted)){missing.push(`${name}: an exact day is required`);return;}
      if(el.type==='month' && /^\d{2}\/\d{4}$/.test(formatted))formatted=`${formatted.slice(3)}-${formatted.slice(0,2)}`;
      native(el,formatted);filled++;
    }
  };
  const groupKind=el=>{
    const marker=`${el.id || ''} ${el.className || ''} ${el.getAttribute('data-automation-id') || ''} ${el.getAttribute('data-testid') || ''} ${el.querySelector('legend,h2,h3,h4')?.textContent || ''}`;
    if(/education|school|academic/i.test(marker))return 'education';
    if(/work.?experience|employment|experience.?entry|experience.?item|work.?history/i.test(marker))return 'workExperience';
    return '';
  };
  const groups=kind=>{const candidates=deep('fieldset,section,[data-automation-id],[data-testid],[class*="experience"],[class*="education"],[id*="experience"],[id*="education"]').filter(el=>groupKind(el)===kind && fields(el).length>=2);return candidates.filter(el=>!candidates.some(child=>child!==el && composedContains(el,child)));};
  const rowAnswers=(kind,row)=>{
    const local={__row:true},add=(aliases,value)=>{if(value!==null && value!==undefined && value!=='')for(const alias of aliases)local[key(alias)]=String(value);};
    if(kind==='workExperience') {add(['company','company name','employer','employer name','organization'],row.company);add(['job title','title','position','role','position title'],row.title);add(['description','role description','responsibilities','duties'],row.description || row.bullets?.join('\n'));add(['I currently work here','currently employed','current role','current job'],row.isCurrentRole===null ? null : row.isCurrentRole ? 'Yes' : 'No');}
    else {add(['school','school name','institution','university','college'],row.institution);add(['degree','qualification','education level'],row.degree);add(['field of study','major','specialization'],row.fieldOfStudy);add(['GPA','grade','grade or GPA'],row.gradeOrGpa);add(['currently studying','I currently study here'],row.isCurrent===null ? null : row.isCurrent ? 'Yes' : 'No');}
    add(['location','city'],row.location);add(['employment type'],row.employmentType);
    for(const [prefix,alternate] of [['start','from'],['end','to']]) {add([`${prefix} month`,`${alternate} month`],row[`${prefix}Month`]);add([`${prefix} year`,`${alternate} year`],row[`${prefix}Year`]);if(row[`${prefix}Month`] && row[`${prefix}Year`])add([`${prefix} date`,`${alternate} date`],`${String(row[`${prefix}Month`]).padStart(2,'0')}/${row[`${prefix}Year`]}`);}
    return local;
  };
  const processed=new WeakSet();
  for(const kind of ['workExperience','education']) {
    const entries=master[kind] || [];let current=groups(kind);
    if(options.addRepeating && entries.length)for(let attempt=0;current.length<entries.length && attempt<30;attempt++) {
      const last=current.at(-1);let button=last ? null : deep('button,[role="button"]').find(el=>visible(el) && /add/i.test(el.textContent || '') && new RegExp(kind==='education' ? 'education|school' : 'work.*experience|employment','i').test(`${el.textContent} ${el.getAttribute('aria-label') || ''}`));
      for(let scope=last?.parentElement;scope && !button;scope=scope.parentElement)button=[...scope.querySelectorAll('button,[role="button"]')].find(el=>visible(el) && /add/i.test(`${el.textContent} ${el.getAttribute('aria-label') || ''}`) && (new RegExp(kind==='education' ? 'education|school|academic' : 'work|employment|experience','i').test(`${el.textContent} ${el.getAttribute('aria-label') || ''}`) || /^(\+\s*)?add (another|more)$/i.test(el.textContent.trim()) && ![...scope.querySelectorAll('fieldset,section')].some(e=>groupKind(e) && groupKind(e)!==kind)));
      if(!button)break;const before=current.length;button.click();const increased=await waitFor(()=>groups(kind).length>before);if(!increased)break;current=groups(kind);added++;
    }
    for(const [index,container] of current.entries())for(const el of fields(container)){processed.add(el);if(entries[index]){const local=rowAnswers(kind,entries[index]);let token=identity(el);for(let parent=el.parentElement,depth=0;parent && depth<3;parent=parent.parentElement,depth++)token+=` ${parent.id} ${parent.getAttribute('data-automation-id') || ''} ${parent.getAttribute('aria-label') || ''}`;token=key(token);for(const [prefix,alternate] of [['start','from'],['end','to']]){const direction=`(?:${prefix}|${alternate})`;const part=new RegExp(`${direction}.*month`).test(token) ? 'month' : new RegExp(`${direction}.*year`).test(token) ? 'year' : new RegExp(`${direction}date`).test(token) ? 'date' : '';if(part && local[`${prefix}${part}`]!==undefined)local[key(label(el))]=local[`${prefix}${part}`];}await fill(el,local);}else if(el.required)missing.push(`${kind} ${index+1}: add this entry to your candidate vault`);}
    if(entries.length>current.length)missing.push(`${entries.length-current.length} ${kind==='education' ? 'education' : 'work experience'} entries need additional form sections. Use Auto-add entries or review manually.`);
  }
  for(const el of deep('input,textarea,select,[role="combobox"]'))if(!processed.has(el))await fill(el);
  const challenge=deep('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare"],.h-captcha,.g-recaptcha').some(visible);
  if(challenge)missing.push('Complete the verification challenge yourself.');
  return {status:challenge ? 'blocked' : 'needs-review',filled,added,missing:[...new Set(missing)].slice(0,60),questions:[...new Map(questions.filter(q=>q.label).map(q=>[q.label,q])).values()].slice(0,20),note:'Review every field and submit yourself.'};
}
