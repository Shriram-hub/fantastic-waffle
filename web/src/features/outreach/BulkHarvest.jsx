import {DepthControl,ClusterButtons} from './DiscoveryControls.jsx';
import React,{useState} from 'react';
import {useApp,api} from '../../shared/workspace.jsx';
import {Button,Field} from '../../shared/ui.jsx';
const legacyPresets=[['finance','Investment Banking & PE'],['consulting','Big 4 & Consulting'],['fintech','Indian Unicorns & Fintech'],['technology','Global Big Tech']];
export function BulkHarvest({status,onQueued}) {
  const {perform,notify,data}=useApp(),[source,setSource]=useState('matches'),[companies,setCompanies]=useState(''),[preset,setPreset]=useState(''),[count,setCount]=useState(25),[limit,setLimit]=useState(50),[search,setSearch]=useState(false),[credits,setCredits]=useState(false),[github,setGithub]=useState(false);
  return <section className="bulk-harvest form-section"><span className="eyebrow">BULK CONTACT HARVESTER</span><h2>Build a company contact list.</h2><p>Start with matching roles or a company list. Search, email lookup and verification run in the background, two companies at a time.</p>
    <form className="stack" onSubmit={e=>{e.preventDefault();perform(async()=>{const result=await api('/contacts/bulk-harvest',{source,companies,preset:preset || undefined,companyLimit:count,targetCount:limit,allowSearch:search && status?.warmSearchConfigured===true,allowCredits:credits,github});notify(result.existing?'This contact batch is already running.':`${result.run.targets.length} companies queued.`);await onQueued?.();});}}>
      <div className="form-grid"><Field label="Companies from"><select value={source} onChange={e=>{setSource(e.target.value);setPreset('');}}><option value="matches">Top matching jobs</option><option value="companies">Company list or sector preset</option></select></Field><Field label="Company limit"><select value={count} onChange={e=>setCount(Number(e.target.value))}>{[10,25,50,100].map(n=><option key={n}>{n}</option>)}</select></Field></div>
      <DepthControl value={limit} onChange={setLimit}/>
      <ClusterButtons disabled={data.isDemo} onChoose={id=>perform(async()=>{const r=await api('/contacts/bulk-harvest',{source:'companies',preset:id,companyLimit:10,contactsPerCompany:10,allowSearch:search && status?.warmSearchConfigured===true,allowCredits:credits});notify(r.existing?'This cluster is already running.':'Ten-company cluster queued with a target of 100 profiles.');await onQueued?.();})}/>
      {source==='companies' && <><div className="bulk-presets">{legacyPresets.map(([id,label])=><Button small key={id} type="button" active={preset===id} onClick={()=>setPreset(id)}>{label}</Button>)}</div><Field label="Company names or domains" hint={preset?'Sector preset selected. Type to use your own list instead.':'Up to 50, separated by commas or new lines.'}><textarea rows="4" value={companies} required={!preset} placeholder="Goldman Sachs, Deloitte, razorpay.com" onChange={e=>{setCompanies(e.target.value);setPreset('');}}/></Field></>}
      <label className="checkbox-group"><input type="checkbox" checked={search && status?.warmSearchConfigured===true} disabled={!status?.warmSearchConfigured} onChange={e=>setSearch(e.target.checked)}/>Use configured search APIs to find people and company websites</label>
      <label className="checkbox-group"><input type="checkbox" checked={credits} disabled={!status?.emailFinderConfigured} onChange={e=>setCredits(e.target.checked)}/>Use email-finder and mailbox-verification credits</label>
      <label className="checkbox-group"><input type="checkbox" checked={github} onChange={e=>setGithub(e.target.checked)}/>Include public corporate emails from GitHub commits</label>
      <p className="hint">Up to {count*limit} candidates. Search results, published addresses and inferred formats are separate from verified mailboxes. GitHub addresses and MX records do not prove deliverability. Actual coverage and credits depend on your providers.</p>
      <p className="hint">Search budget: {status?.searchDailyLimit || 100} requests/day. Email lookup budget: {status?.dailyLimit || 20} requests/day. This action creates contacts; sending stays in the outreach review workflow.</p>
      <div className="form-actions"><Button primary type="submit" disabled={!status || data.isDemo}>Start bulk harvest</Button></div>
    </form>
  </section>;
}
