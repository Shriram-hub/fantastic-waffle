import {fail} from './domain.mjs';
import {alertStatus,saveAlerts} from './services/notifications.mjs';
export function notificationRoutes(store,config) {
  return async(req,res,url,{json,bodyJSON})=>{
    if(url.pathname!=='/api/alerts')return false;
    if(req.method==='GET'){json(res,200,alertStatus(store));return true;}
    if(req.method==='PUT'){json(res,200,await saveAlerts(await bodyJSON(req),store,config));return true;}
    fail('Method not allowed.',405);
  };
}
