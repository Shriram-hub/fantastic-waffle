import {providerJSON} from './provider-http.mjs';
import {normalizeProviderContact} from './normalized.mjs';
import {providerKey} from '../../services/provider-config.mjs';
import {cleanHunterDomain} from './hunter.mjs';
import {fail} from '../../domain.mjs';
export async function searchMineleadDomain(domain,key,limit=15,fetcher=fetch) {
  key=providerKey(key,'minelead');domain=cleanHunterDomain(domain);if(!key || !domain)fail('Configure Minelead and use a corporate domain.',503);
  const url=new URL('https://api.minelead.io/v1/search/');url.search=new URLSearchParams({domain,key,'max-emails':String(Math.min(50,limit))});
  const data=await providerJSON('Minelead',url.href,{},fetcher,15000,[key]);
  const contacts=(data.emails || []).slice(0,limit).map(p=>normalizeProviderContact(typeof p==='string'?{email:p}:p,domain,'Minelead',{verified:p.verification?.status==='valid',catchAll:p.verification?.accept_all===true,reference:'https://minelead.io/'})).filter(Boolean);
  const pattern=String(data.pattern || '').split('@')[0];return {contacts,pattern:/^(?:[._-]|\{(?:first|last|f|l)\})+$/.test(pattern)?pattern:''};
}
