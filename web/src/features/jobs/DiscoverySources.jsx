import React,{useState,useEffect} from 'react';
import {useApp,api} from '../../shared/workspace.jsx';
import {Panel,Button} from '../../shared/ui.jsx';
export const defaultSources={'Remotive':true,'Arbeitnow':true,'Remote OK':true,'Jobicy':true,'Himalayas':true,'Greenhouse':true,'Lever':true,'Ashby':true,'Google Jobs':false};
export function SourceOptions({value,onChange}) {
  const {setup={}}=useApp();
  return <fieldset className="discovery-source-options"><legend>Job discovery sources</legend><div>{Object.keys(defaultSources).map(source=><label className="check" key={source}><input type="checkbox" checked={value[source]===true} onChange={e=>onChange({...value,[source]:e.target.checked})}/>{source==='Google Jobs' ? 'Google Jobs / LinkedIn & Indeed links' : source}{source==='Google Jobs' && <small>{setup.jsearchConfigured || setup.serpapiConfigured ? 'Optional key saved' : 'Optional JSearch / SerpApi key required'}</small>}</label>)}</div><p>Public feeds and company boards work without keys. Google Jobs uses your optional API quota. LinkedIn and Indeed coverage depends on the aggregator; it is not a direct integration.</p></fieldset>;
}
export function DiscoverySources() {
  const {search,perform,busy}=useApp(),prefs=search?.preferences;
  const [sources,setSources]=useState({...defaultSources,...prefs?.sources}),[enabled,setEnabled]=useState(prefs?.enabled!==false);
  useEffect(()=>{setSources({...defaultSources,...prefs?.sources});setEnabled(prefs?.enabled!==false);},[JSON.stringify(prefs)]);
  return <Panel title="Automatic job search" subtitle="Runs independently of outreach. New jobs appear without adding links or buying contact credits."><form className="panel-body" onSubmit={e=>{e.preventDefault();perform(()=>api('/search',{...prefs,enabled,sources},'PUT'),'Search settings saved.');}}><label className="check"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>Find jobs automatically every two hours</label><SourceOptions value={sources} onChange={setSources}/><Button primary type="submit" disabled={busy}>Save search sources</Button></form></Panel>;
}
