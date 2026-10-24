import {providerSummaries,saveProviderKey,PROVIDERS} from './services/provider-config.mjs';
import {verifyProvider} from './services/provider-verification.mjs';
import {fail} from './domain.mjs';
export function connectionRoutes(store,config,fetcher=fetch) {
  return async(req,res,url,{json,bodyJSON})=>{
    if(url.pathname==='/api/connections/providers' && req.method==='GET'){json(res,200,{providers:await providerSummaries(store,config),checks:store.state.contactProviderChecks?.checks || []});return true;}
    const path=url.pathname.match(/^\/api\/connections\/providers\/([a-z]+)$/);
    if(path && req.method==='PUT') {const data=await bodyJSON(req);json(res,200,await saveProviderKey(path[1],data.key,store,config));return true;}
    if(path && req.method==='DELETE') {if(!PROVIDERS.some(p=>p.id===path[1]))fail('Choose a supported provider.');await store.db.prepare('DELETE FROM provider_credentials WHERE id=?').run(path[1]);json(res,200,{ok:true,message:'Workspace key removed. A configured server key remains available.'});return true;}
    if(url.pathname==='/api/connections/verify-provider' && req.method==='POST'){const data=await bodyJSON(req);json(res,200,await verifyProvider(data.provider,store,config,fetcher,{confirmMetered:data.confirmMetered===true}));return true;}
    return false;
  };
}
