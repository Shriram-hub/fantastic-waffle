import React,{useState,useEffect} from 'react';
import {useApp,api,split,fmt} from '../../shared/workspace.jsx';
import {Button,Field} from '../../shared/ui.jsx';
import {Icon} from '../../shared/Icon.jsx';
import {SourceOptions,defaultSources} from './DiscoverySources.jsx';
const fields=[['Software & AI','Software Engineer, AI Engineer'],['Finance','Financial Analyst, Accountant'],['Data','Data Analyst, Data Scientist'],['Marketing','Digital Marketing Specialist, Content Writer'],['Design','Product Designer, UX Designer'],['Business & operations','Business Analyst, Operations Analyst']];
export function SearchPreferences({compact=false}) {
  const {search,data,perform,busy,go}=useApp();
  const prefs=search?.preferences || {roles:data.profile.interests || [],location:data.profile.location || '',country:'',workMode:data.profile.workMode || 'Any',experience:'Any',enabled:true};
  const personalized=search?.plan.personalized || !!prefs.roles.length;
  const [open,setOpen]=useState(!personalized),[roles,setRoles]=useState(prefs.roles.join(', ')),[location,setLocation]=useState(prefs.location),[country,setCountry]=useState(prefs.country),[mode,setMode]=useState(prefs.workMode),[experience,setExperience]=useState(prefs.experience);
  const [sources,setSources]=useState({...defaultSources,...prefs.sources});
  useEffect(()=>setSources({...defaultSources,...prefs.sources}),[JSON.stringify(prefs.sources)]);
  useEffect(()=>{setRoles(prefs.roles.join(', '));setLocation(prefs.location);setCountry(prefs.country);setMode(prefs.workMode);setExperience(prefs.experience);},[JSON.stringify(prefs)]);
  return <section className={`search-setup ${open ? 'expanded' : ''}`}>
    <div className="search-setup-head"><div className="search-setup-icon"><Icon name="spark"/></div><div className="grow"><h2>{personalized ? 'Your search preferences' : 'Tell Orbit what you’re looking for'}</h2><p>{personalized ? `${search?.plan.roles?.join(' · ') || prefs.roles.join(' · ')}${location ? ` · ${location}` : ''}` : 'Set your target roles once. We find and rank jobs automatically, every two hours.'}</p></div><Button small onClick={()=>setOpen(!open)}>{open ? 'Collapse' : 'Edit preferences'}</Button></div>
    {open && <form onSubmit={e=>{e.preventDefault();perform(async()=>{await api('/search',{roles:split(roles),location,country,workMode:mode,experience,sources,enabled:true},'PUT');setOpen(false);},'Search started. Your recommendations will update as sources are checked.');}}>
      {!personalized && <div className="field-presets" aria-label="Example career fields">{fields.map(([label,value])=><button type="button" key={label} onClick={()=>setRoles(value)}>{label}</button>)}</div>}
      <div className="search-preference-grid"><Field label="Target roles" hint="Separate roles with commas, or upload your résumé to derive suggestions."><input value={roles} onChange={e=>setRoles(e.target.value)} placeholder="e.g. Financial Analyst, Accounting Intern" required/></Field><Field label="Preferred location"><input value={location} onChange={e=>setLocation(e.target.value)} placeholder="e.g. Bengaluru or London"/></Field><Field label="Work arrangement"><select value={mode} onChange={e=>setMode(e.target.value)}>{['Any','Remote','Hybrid','On-site'].map(v=><option key={v}>{v}</option>)}</select></Field></div>
      <div className="search-preference-secondary"><Field label="Your country code" hint="Used to check remote-job country restrictions."><input value={country} maxLength="2" placeholder="IN" onChange={e=>setCountry(e.target.value.toUpperCase())}/></Field><Field label="Experience level"><select value={experience} onChange={e=>setExperience(e.target.value)}>{['Any','Internship','Entry level','Mid level','Senior'].map(v=><option key={v}>{v}</option>)}</select></Field><div className="search-form-actions"><Button onClick={()=>go('profile')}>Upload résumé</Button><Button type="submit" primary disabled={busy || !roles.trim()}><Icon name="jobs"/>Save & find jobs</Button></div></div>
      <p className="search-free-note"><Icon name="check" size={16}/>Automatic job discovery needs no email connection or contact API key.</p>
      <details className="search-source-details"><summary>Choose discovery sources</summary><SourceOptions value={sources} onChange={setSources}/></details>
    </form>}
  </section>;
}
