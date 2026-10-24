import React,{useState,useEffect} from 'react';
import {api,useApp} from '../../shared/workspace.jsx';
import {Button,Badge,Field} from '../../shared/ui.jsx';
const providers=[['hunter','Hunter','Company emails and verification'],['serper','Serper','Google people and career-board search'],['tavily','Tavily','Web and people search'],['prospeo','Prospeo','Business email search and enrichment'],['getprospect','GetProspect','Named email finder'],['minelead','Minelead','Company email search'],['gemini','Gemini','Resume extraction and document drafting']];
export function ProviderKeys() {
  const {perform,notify}=useApp(),[status,setStatus]=useState({providers:[],checks:[]}),[keys,setKeys]=useState({}),[error,setError]=useState('');
  const refresh=async()=>{try{setStatus(await api('/connections/providers'));setError('');}catch(e){setError(e.message);}};
  useEffect(()=>{void refresh();},[]);
  const save=async id=>{await api(`/connections/providers/${id}`,{key:keys[id]},'PUT');setKeys(s=>({...s,[id]:''}));await refresh();};
  return <section className="provider-vault form-section"><div className="section-heading"><div><span className="eyebrow">PROVIDER CONNECTIONS</span><h2>API keys</h2><p>Workspace keys take priority over server keys. Values are encrypted, stay on the server, and are never returned to this form.</p></div></div>
    {error && <p role="alert">{error}</p>}
    <div className="provider-key-grid">{providers.map(([id,name,purpose])=>{const saved=status.providers.find(p=>p.id===id),check=status.checks.find(p=>p.provider===name),metered=['serper','minelead'].includes(id);return <form className="provider-key-card" key={id} onSubmit={e=>{e.preventDefault();perform(()=>save(id),`${name} key saved.`);}}>
      <div className="spread"><h3>{name}</h3><Badge value={saved?.configured?`${saved.source} key`:'Not configured'}/></div><p>{purpose}</p>
      <Field label={`${name} API key`}><input className="input mono" type="password" autoComplete="off" spellCheck="false" value={keys[id] || ''} placeholder={saved?.configured?'Enter a replacement key':'Paste API key'} onChange={e=>setKeys(s=>({...s,[id]:e.target.value}))}/></Field>
      <div className="btn-row"><Button small type="submit" disabled={!keys[id]?.trim()}>Save key</Button><Button small type="button" disabled={!saved?.configured && !keys[id]?.trim()} onClick={()=>perform(async()=>{if(keys[id]?.trim())await save(id);const result=await api('/connections/verify-provider',{provider:id,confirmMetered:metered});notify(result.message,!result.ok);await refresh();})}>Verify key live</Button>{saved?.source==='workspace' && <Button small type="button" onClick={()=>perform(async()=>{await api(`/connections/providers/${id}`,undefined,'DELETE');await refresh();},'Workspace key removed.')}>Remove</Button>}</div>
      {metered && <p className="hint">Verification issues one search request. The provider may charge a search credit.</p>}
      {check && <div className={check.ok?'provider-check-result':'provider-check-result failed'} role="status"><strong>{check.ok?'Connected':check.httpStatus?`HTTP ${check.httpStatus}`:'Check failed'}</strong><p>{check.message}</p>{Object.entries(check.usage || {}).map(([type,v])=><p className="mono" key={type}>{v.remaining===null || v.remaining===undefined?'Balance unavailable':`${v.remaining}${v.total!==null && v.total!==undefined?` / ${v.total}`:''} ${type.replaceAll('_',' ')} remaining`}</p>)}</div>}
    </form>;})}</div>
  </section>;
}
