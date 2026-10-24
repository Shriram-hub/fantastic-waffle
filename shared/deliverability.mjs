import {expandSpintax} from './mail-merge.mjs';
export function scoreDeliverability({subject='',body=''}={}){
  const text=expandSpintax(body,'writing-check'),words=text.trim().split(/\s+/).filter(Boolean).length,links=(text.match(/https?:\/\/[^\s<>]+/g)||[]).length,phrases=['urgent','guarantee','free','click here'].filter(word=>new RegExp(`\\b${word}\\b`,'i').test(`${subject} ${text}`)),warnings=[];
  if(words>125)warnings.push('Message exceeds 125 words.');if(links>2)warnings.push('More than two links.');if(phrases.length)warnings.push(`Review promotional wording: ${phrases.join(', ')}.`);if(!subject.trim() || !text.trim())warnings.push('Add a subject and message.');
  const score=Math.max(0,100-(words>125?20:0)-(links>2?20:0)-Math.min(35,phrases.length*10)-(!subject.trim() || !text.trim()?50:0));
  return {score,wordCount:words,links,phrases,warnings,label:score>=90?'Writing checks clear':score>=65?'Review suggested':'Needs editing',note:'Content heuristic only. This does not predict inbox placement or bypass provider limits.'};
}
