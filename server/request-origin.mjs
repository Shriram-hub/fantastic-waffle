import {fail} from './domain.mjs';

export function requestBase(req,config={}) {
  const configured=config.PUBLIC_APP_URL || config.PUBLIC_BASE_URL || config.RENDER_EXTERNAL_URL;
  if(configured) {
    const u=new URL(configured);if(u.username || u.password || !['http:','https:'].includes(u.protocol))fail('Invalid public application URL.',503);
    return u.origin;
  }
  const host=String(req?.headers?.host || '127.0.0.1:3000');
  if(!/^(?:[a-z0-9.-]+|\[::1\])(?::\d{1,5})?$/i.test(host))fail('Invalid application host.');
  const hostname=host.replace(/:\d+$/,'');
  const loopback=['localhost','127.0.0.1','[::1]'].includes(hostname);
  const allowed=String(config.ALLOWED_HOSTS || '').split(',').map(s=>s.trim()).filter(Boolean);
  if(allowed.length && !allowed.includes(hostname))fail('Host not allowed.',403);
  return `${loopback && !req?.socket?.encrypted ? 'http' : 'https'}://${host}`;
}
export function extensionCORS(req,res,path) {
  const origin=req.headers.origin;
  if(!/^chrome-extension:\/\/[a-p]{32}$/.test(origin || ''))return false;
  // Only capability-scoped extension APIs are exposed cross-origin. Reflect an
  // exact extension origin, never wildcard cookie-authenticated workspace APIs.
  if(!path.startsWith('/api/extension/') && path!=='/api/contacts/import-browser-profiles')return false;
  res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, X-Workspace-Token');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return true;}
  return false;
}
