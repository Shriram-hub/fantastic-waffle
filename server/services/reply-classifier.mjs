import {emailValid} from '../domain.mjs';
export const REPLY_CATEGORIES={interview:'Interview / Call Request',positive:'Positive / Referral Offered',ooo:'Out of Office',bounce:'Bounce / NDR',other:'Other update'};
export function classifyReply(message){
  const body=String(message.body || '').split(/\nOn .+wrote:|\n_{5,}|\nFrom:/i)[0],text=`${message.subject || ''}\n${body}`,ooo=/out of (?:the )?office|automatic reply|auto.?reply|on (?:annual |parental |medical )?leave|away from (?:the )?office/i.test(text);
  const category=/mailer-daemon|postmaster/i.test(message.from || '') && /delivery|undeliver|returned mail|failure/i.test(text)?'bounce':ooo?'ooo':/not (?:interested|moving forward)|unfortunately|will not be proceeding/i.test(body)?'other':/interview|schedule (?:a |an )?(?:call|chat)|availability|book (?:a |an )?(?:call|meeting)|speak with you|meet with you/i.test(text)?'interview':/happy to (?:refer|forward|connect)|refer(?:ral|ring)? you|forward(?:ed|ing)? (?:your|this)|interested in (?:your|speaking)|would (?:like|love) to|thanks for (?:reaching|your interest)/i.test(text)?'positive':'other';
  let returnDate=null;const raw=text.match(/(?:until|return(?:ing)?(?:\s+on)?|back(?:\s+on)?)\s*:?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{4})?|[A-Za-z]{3,9}\s+\d{1,2}(?:,?\s+\d{4})?)/i)?.[1];
  if(raw){const year=new Date(message.receivedAt || Date.now()).getUTCFullYear(),parsed=Date.parse(/^\d{4}-/.test(raw)?`${raw}T12:00:00Z`:`${raw}${/\d{4}/.test(raw)?'':` ${year}`} 12:00:00 GMT`);if(Number.isFinite(parsed))returnDate=new Date(parsed).toISOString().slice(0,10);}
  const alternatives=category==='ooo'?[...new Set([...body.matchAll(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)].map(m=>m[0].toLowerCase()).filter(emailValid))].slice(0,5):[];
  return {category,label:REPLY_CATEGORIES[category],highPriority:category==='interview',outOfOffice:category==='ooo'?{returnDate,returnText:raw || '',alternatives}:null};
}
