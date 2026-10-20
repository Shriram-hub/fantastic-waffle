import {fail,id,hash,now,text} from '../domain.mjs';
import {tokenCipher} from '../providers/mail/oauth.mjs';
export function alertStatus(store) {
  const c=store.state.alertConfig;
  return {enabled:c?.enabled===true,provider:c?.provider || 'telegram',configured:!!c?.credentials,events:c?.events || ['interview','assessment'],updatedAt:c?.updatedAt || null,destination:c?.destination || '',lastResult:c?.lastResult || null};
}
export async function saveAlerts(data,store,config) {
  const old=store.state.alertConfig || {},provider=data.provider || old.provider || 'telegram';
  if(!['telegram','discord','whatsapp'].includes(provider))fail('Choose Telegram, Discord or WhatsApp.');
  const credentials={};
  if(data.credentials && Object.values(data.credentials).some(Boolean)) {
    if(provider==='discord') {
      const url=String(data.credentials.webhookUrl || '');
      if(!/^https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w.-]{20,200}$/.test(url))fail('Use a Discord channel webhook URL from discord.com.');
      credentials.webhookUrl=url;
    } else if(provider==='telegram') {
      const {botToken,chatId}=data.credentials;
      if(!/^\d{5,20}:[\w-]{20,100}$/.test(botToken || '') || !/^-?\d{5,25}$/.test(String(chatId || '')))fail('Enter a Telegram bot token and your numeric chat ID.');
      Object.assign(credentials,{botToken,chatId:String(chatId)});
    } else {
      const {token,phoneNumberId,recipient,templateName,language}=data.credentials;
      if(!/^[\w.-]{20,4000}$/.test(token || '') || !/^\d{5,30}$/.test(phoneNumberId || '') || !/^\d{8,16}$/.test(recipient || '') || !/^[a-z0-9_]{1,100}$/.test(templateName || '') || !/^[a-z]{2}(?:_[A-Z]{2})?$/.test(language || ''))fail('Enter a WhatsApp Cloud API token, phone-number ID, recipient digits, approved template and language.');
      Object.assign(credentials,{token,phoneNumberId,recipient,templateName,language});
    }
  }
  const sealed=Object.keys(credentials).length ? tokenCipher(config).seal(credentials) : old.provider===provider ? old.credentials : null;
  const events=data.events || old.events || ['interview','assessment'];
  if(!Array.isArray(events) || events.some(e=>!['interview','assessment','resume-view'].includes(e)))fail('Choose supported career alert types.');
  if(data.enabled===true && (!sealed || data.confirmed!==true))fail('Save a destination and confirm it is your chat or channel before enabling alerts.');
  const destination=Object.keys(credentials).length ? provider==='telegram' ? `Chat …${credentials.chatId.slice(-4)}` : provider==='discord' ? 'Your saved Discord channel' : `Phone …${credentials.recipient.slice(-4)}` : old.provider===provider ? old.destination : '';
  store.state.alertConfig={id:id(),provider,destination,credentials:sealed,enabled:data.enabled===true,events:[...new Set(events)],updatedAt:now()};await store.save();return alertStatus(store);
}
export async function queueAlert(kind,message,key,store,queue) {
  const c=store.state.alertConfig;if(!queue || !c?.enabled || !c.events.includes(kind))return null;
  return queue.enqueue('alert.send',{configId:c.id,kind,message:text(message,900)},{dedupeKey:`alert-${hash([c.id,kind,key])}`,maxAttempts:1});
}
export async function deliverAlert(task,store,config={},fetcher=fetch) {
  const c=store.state.alertConfig;if(!c?.enabled || c.id!==task.payload.configId || !c.events.includes(task.payload.kind))return {status:'cancelled'};
  const secret=tokenCipher(config).open(c.credentials),message=`Orbit · ${task.payload.message}`;
  let url,body;
  if(c.provider==='discord') {url=`${secret.webhookUrl}?wait=true`;body={content:message,allowed_mentions:{parse:[]}};}
  else if(c.provider==='telegram') {url=`https://api.telegram.org/bot${secret.botToken}/sendMessage`;body={chat_id:secret.chatId,text:message,link_preview_options:{is_disabled:true}};}
  else {
    const version=config.WHATSAPP_GRAPH_VERSION || 'v23.0';if(!/^v\d+\.\d+$/.test(version))fail('Use a supported WHATSAPP_GRAPH_VERSION.',503);
    url=`https://graph.facebook.com/${version}/${secret.phoneNumberId}/messages`;
    body={messaging_product:'whatsapp',to:secret.recipient,type:'template',template:{name:secret.templateName,language:{code:secret.language},components:[{type:'body',parameters:[{type:'text',text:message}]}]}};
  }
  let result;
  try {
    const response=await fetcher(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',...(c.provider==='whatsapp' ? {Authorization:`Bearer ${secret.token}`} : {})},body:JSON.stringify(body)});
    result={status:response.ok ? 'accepted' : response.status>=500 ? 'unknown' : 'failed',httpStatus:response.status,at:now()};
    if(response.ok)try{const payload=await response.json();const acknowledged=c.provider==='telegram' ? payload.ok===true && payload.result?.message_id!==undefined : c.provider==='discord' ? !!payload.id : Array.isArray(payload.messages) && !!payload.messages[0]?.id;if(!acknowledged)result.status='unknown';}catch{result.status='unknown';}
    else await response.body?.cancel();
  } catch {result={status:'unknown',at:now()};}
  // No automatic resend after an ambiguous outbound request.
  await store.refresh();if(store.state.alertConfig?.id===c.id){store.state.alertConfig.lastResult=result;await store.save();}
  return result;
}
