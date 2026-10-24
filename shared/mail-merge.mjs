// Shared by the live composer and server renderer. No network or secret access.
export const MERGE_TAGS=['firstName','company','role','myTopSkill','myExperienceHighlight','resumeLink'];
export const MAIL_PRESETS=[
  {id:'manager',name:'Hiring manager value pitch',subject:'{{role}} at {{company}}',body:'Hi {{firstName}},\n\nI am interested in {{role}} at {{company}}. My background includes {{myTopSkill}}. {{myExperienceHighlight}}\n\nMy resume: {{resumeLink}}\n\nWould this experience be useful to your team? I would welcome a short conversation.'},
  {id:'recruiter',name:'Recruiter role-fit summary',subject:'Application interest: {{role}}',body:'Hi {{firstName}},\n\nI am exploring {{role}} opportunities at {{company}}. My strongest relevant skill is {{myTopSkill}}. {{myExperienceHighlight}}\n\nMy resume: {{resumeLink}}\n\nAre you the right person to contact about the hiring process?'},
  {id:'alumni',name:'Alumni / referral request',subject:'Advice on opportunities at {{company}}',body:'Hi {{firstName}},\n\n{{warm_hook}}\n\nI am exploring {{role}} at {{company}} and would value your perspective on the team. {{myExperienceHighlight}}\n\nMy resume: {{resumeLink}}\n\nWould you be open to sharing advice about the role or the appropriate application route?'},
  {id:'speculative',name:'Short speculative inquiry',subject:'Future {{role}} opportunities at {{company}}',body:'Hi {{firstName}},\n\nI am interested in your team at {{company}}, including opportunities that may not yet be advertised. My background includes {{myTopSkill}}. {{myExperienceHighlight}}\n\nMy resume: {{resumeLink}}\n\nWould it be useful to stay in touch about future {{role}} openings?'},
];
export function mergeVariables(contact={},profile={}) {
  const master=profile.master || {},skills=profile.skills || [],work=master.workExperience || [];
  const highlight=profile.summary || master.summary?.professionalSummary || work.flatMap(w=>w.bullets || []).find(Boolean) || '';
  const vars={first_name:String(contact.name || '').trim().split(/\s+/)[0] || 'there',name:contact.name || 'Hiring team',company:contact.company || 'your company',title:contact.title || '',my_name:profile.name || 'Your name',my_role:profile.headline || profile.interests?.[0] || 'my next role',skills:skills.join(', '),portfolio:profile.portfolio || '',resume_url:profile.resumeUrl || '',icebreaker:contact.icebreaker || '',warm_hook:contact.warmOpener || '',job_title:contact.jobTitle || '',job_url:contact.jobUrl || ''};
  return {...vars,firstName:vars.first_name,role:contact.jobTitle || profile.interests?.[0] || profile.headline || 'a suitable role',myTopSkill:skills[0] || 'the experience described in my resume',myExperienceHighlight:String(highlight).slice(0,700),resumeLink:vars.resume_url};
}
export function mergeMail(value,contact,profile) {
  const vars=mergeVariables(contact,profile);
  return expandSpintax(value,`${contact?.email || contact?.id || contact?.name || ''}:${String(value || '')}`).replace(/\{\{\s*([^{}]+?)\s*\}\}/g,(_,key)=>{
    if(!Object.hasOwn(vars,key))throw Error(`Unknown template variable: ${key}`);
    return String(vars[key]);
  });
}
export function expandSpintax(value,seed=''){
  let n=2166136261;for(const ch of String(seed))n=Math.imul(n^ch.charCodeAt(0),16777619)>>>0;
  let index=0;return String(value || '').replace(/(?<!\{)\{([^{}]*\|[^{}]*)\}(?!\})/g,(_,body)=>{const options=body.split('|').slice(0,20);n=Math.imul(n^(++index),16777619)>>>0;return options[n%options.length];});
}
export function safeSpintax(value){return String(value || '').replace(/^Hi\b/,'{Hi|Hello|Hey}').replace(/I would welcome a short conversation\./,'{I would welcome a short conversation.|I would value a brief conversation.}');}
export function tightenMail(value,maxWords=89){
  const source=String(value || '').replace(/\b(?:just wanted to|I wanted to|I am writing to|at this point in time|in order to)\s*/gi,'').trim(),words=source.split(/\s+/);if(words.length<=maxWords)return source;
  // Keep each URL intact without duplicating whole, potentially long link lines.
  const links=[...new Set(source.match(/https?:\/\/[^\s<>]+|\{\{(?:resumeLink|resume_url)\}\}/g) || [])].slice(0,Math.max(1,maxWords-1)),linkSet=new Set(links),prose=source.split(/\s+/).filter(word=>!linkSet.has(word)),allowance=Math.max(0,maxWords-links.length);
  return `${prose.slice(0,allowance).join(' ').replace(/[,:;]$/,'')}…${links.length?`\n\n${links.join('\n')}`:''}`.trim();
}
