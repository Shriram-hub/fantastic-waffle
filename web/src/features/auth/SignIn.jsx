import React,{useState,useEffect} from 'react';
import {BrandMark,Icon} from '../../shared/Icon.jsx';
import {api} from '../../shared/workspace.jsx';

export const authMessages={
  unlock_to_link:'Unlock with your workspace password once, then link your Google account from the top bar.',
  google_configuration:'Google sign-in needs the Google client ID, client secret and token encryption key on the server.',
  google_denied:'Google sign-in was cancelled. You can try again.',
  google_unavailable:'Google could not be reached. Try again or use your workspace password.',
  google_failed:'Google sign-in could not be verified. Start again from this page.',
  wrong_account:'This Google account is not linked to this workspace. Choose the linked account or use your workspace password.',
};
export function SignIn({session,onSignedIn,initialError=''}) {
  const [online,setOnline]=useState(null);
  useEffect(()=>{let current=true;api('/health').then(r=>{if(current)setOnline(r.ok===true);}).catch(()=>{if(current)setOnline(false);});return()=>{current=false;};},[]);
  const [password,setPassword]=useState(''),[error,setError]=useState(initialError),[busy,setBusy]=useState(false);
  const [showPassword,setShowPassword]=useState(!session.googleLinked);
  async function unlock(event) {
    event.preventDefault();if(busy)return;setBusy(true);setError('');
    try {await api('/auth/password',{password});setPassword('');await onSignedIn();}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <main className="signin-page"><a href="/" className="signin-brand" aria-label="Veloce home"><BrandMark size={40}/><strong>Veloce</strong><span>CANDIDATE PIPELINE</span></a>
    <div className="signin-layout"><section className="signin-intro"><div className="system-badges"><span><i className={`status-dot ${online===false ? 'warning' : ''}`}/>{online===null ? 'Checking system' : online ? 'API online' : 'Reconnecting'}</span><span><Icon name="check" size={14}/>Private workspace</span></div><span className="eyebrow">YOUR NEXT CHAPTER, ACCELERATED</span><h1>Less searching.<br/>More <em>possibility.</em></h1><p>Candidate Pipeline & Outbound Desk</p><p className="signin-description">Discover the right roles, turn your experience into a compelling application, and start conversations that move your career forward.</p><div className="signin-glass"><div className="spread"><span className="eyebrow">ONE CONNECTED WORKSPACE</span><Icon name="check"/></div><div className="signin-flow">{[['jobs','Discover'],['check','Match'],['documents','Prepare'],['outreach','Connect']].map(([icon,label],i)=><div key={label}><span className="signin-flow-icon"><Icon name={icon}/></span><small>0{i+1}</small><strong>{label}</strong></div>)}</div><div className="signin-glass-foot"><span className="status-dot"/>Your ambition. A system behind it.</div></div><div className="signin-proof"><span><Icon name="check"/>Live job discovery</span><span><Icon name="check"/>Tailored documents</span><span><Icon name="check"/>Reviewed outreach</span></div></section>
      <section className="signin-card" aria-labelledby="signin-title"><span className="signin-welcome">WORKSPACE ACCESS</span><h2 id="signin-title">Make your next move.</h2><p>Access your private career command center.</p>
        {error && <div className="signin-error" role="alert">{error}</div>}
        {session.googleConfigured && <a className="google-signin" href="/api/auth/google/start"><svg aria-hidden="true" viewBox="0 0 24 24"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.4 3-7.4Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.2H3.1v2.6A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9l3.3-2.6Z"/><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.5 9.5 0 0 0 12 2a10 10 0 0 0-8.9 5.5l3.3 2.6A6 6 0 0 1 12 5.9Z"/></svg>Continue with Google</a>}
        {!session.googleLinked && session.googleConfigured && <p className="signin-note">First visit? Unlock below, then link Google to your private workspace.</p>}
        {session.passwordEnabled && <><button className="signin-alternative" type="button" onClick={()=>setShowPassword(v=>!v)} aria-expanded={showPassword}>Use workspace password</button>{showPassword && <form onSubmit={unlock}><label htmlFor="workspace-password">Workspace password</label><input autoComplete="current-password" id="workspace-password" type="password" value={password} onChange={e=>setPassword(e.target.value)} required maxLength="512"/><button className="signin-submit" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Open my workspace'}</button></form>}</>}
        <div className="signin-private"><span aria-hidden="true">◇</span> Private access to your saved workspace</div>
      </section></div><footer className="signin-footer">Veloce · Candidate Pipeline & Outbound Desk</footer></main>;
}

export function WorkspaceError({message,reference,onRetry,busy}) {
  return <main className="signin-page"><span className="signin-brand"><BrandMark/>Veloce</span><section className="workspace-recovery" role="alert"><span className="eyebrow">LET’S RECONNECT</span><h1>Your workspace is saved.</h1><p>{message || 'We couldn’t connect to your workspace. Try again in a moment.'}</p><button className="signin-submit" onClick={onRetry} disabled={busy}>{busy ? 'Reconnecting…' : 'Try again'}</button>{reference && <p className="muted tiny">Error reference: {reference}</p>}</section></main>;
}
