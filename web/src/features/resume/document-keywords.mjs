const stop=new Set('the and with for are you our your that this from have will role team work working skills experience ability responsibilities requirements about into including must should years year preferred required position candidate company job description also excellent strong looking join within such demonstrated relevant support develop using who has all more other both good knowledge understanding highly professional across successful minimum'.split(' '));
const tokens=value=>String(value || '').toLowerCase().match(/[a-z][a-z0-9+#.-]{1,}/g) || [];
export function keywordCoverage(job,model) {
  const frequency=new Map();
  for(const token of tokens(`${job.title} ${job.description}`))if(!stop.has(token) && token.length>2)frequency.set(token,(frequency.get(token) || 0)+1);
  const keywords=[...new Set([...(job.tags || []).map(v=>String(v).toLowerCase()).filter(v=>v && String(job.description || '').toLowerCase().includes(v)),...Array.from(frequency).sort((a,b)=>b[1]-a[1]).map(([word])=>word)])].slice(0,24);
  const resumeText=[model.headline,...model.sections.flatMap(s=>[s.heading,...s.lines])].join(' ').toLowerCase(),available=new Set(tokens(resumeText));
  const present=keywords.filter(word=>word.includes(' ') ? resumeText.includes(word) : available.has(word)),missing=keywords.filter(word=>!present.includes(word));
  return {present,missing,total:keywords.length,percent:keywords.length ? Math.round(present.length/keywords.length*100) : 0};
}
