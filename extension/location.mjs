const parsed=value=>{try{const u=new URL(value);return u.protocol==='https:' && !u.username && !u.password ? u : null;}catch{return null;}};
export function applicationHost(value) {
  const u=parsed(value);if(!u)return null;
  const greenhouse=u.hostname.match(/^(?:boards|job-boards)(\.eu)?\.greenhouse\.io$/);
  return greenhouse ? `greenhouse${greenhouse[1] || ''}` : u.origin;
}
export function sameApplicationHost(expected,actual) {
  const key=applicationHost(expected);return !!key && key===applicationHost(actual);
}
export function sameApplicationLocation(expected,actual) {
  const a=parsed(expected),b=parsed(actual);if(!a || !b || !sameApplicationHost(expected,actual))return false;
  const path=a.pathname.replace(/\/$/,''),current=b.pathname.replace(/\/$/,'');
  if(path!==current && (!path || !current.startsWith(`${path}/`)))return false;
  for(const [key,value] of a.searchParams)if(/^(?:job[_-]?id|gh_jid|currentJobId|posting[_-]?id|requisition[_-]?id)$/i.test(key) && b.searchParams.get(key)!==value)return false;
  return true;
}
