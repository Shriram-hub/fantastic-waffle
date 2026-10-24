export function contactHandoff(hash,contacts=[]) {
  const [route,query]=String(hash || '').replace(/^#/,'').split('?');if(route!=='outreach')return null;
  const raw=new URLSearchParams(query || '').get('contacts');if(!raw)return null;
  const ids=[...new Set(raw.split(','))].slice(0,100),known=new Set(contacts.filter(c=>!c.isDemo && !c.suppressed).map(c=>c.id));return ids.filter(id=>known.has(id));
}
