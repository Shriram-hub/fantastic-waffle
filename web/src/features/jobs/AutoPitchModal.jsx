import React,{useEffect,useState} from 'react';
import {useApp,api} from '../../shared/workspace.jsx';
import {Modal,Button,Field,Badge} from '../../shared/ui.jsx';
import {QueueNowButton} from '../../shared/QueueNowButton.jsx';

export function AutoPitchModal({jobId,close}) {
  const {data,tasks,perform,notify,setModal,setup={}}=useApp(),job=data.jobs.find(j=>j.id===jobId);
  const [pitch,setPitch]=useState(null),[domain,setDomain]=useState(''),[credits,setCredits]=useState(false),[search,setSearch]=useState(false),[ai,setAI]=useState(false),[reviewed,setReviewed]=useState(false),[error,setError]=useState('');
  const signature=JSON.stringify(tasks.tasks.filter(t=>['job.auto-pitch','contact.verify'].includes(t.kind)).map(t=>[t.id,t.status,t.updated_at]));
  async function refresh(){try{const r=await api(`/jobs/${jobId}/auto-pitch`);setPitch(r.pitch);setError('');}catch(e){setError(e.message);}}
  useEffect(()=>{void refresh();},[jobId,signature]);
  if(!job)return <Modal title="Opportunity unavailable" onClose={close}><p>This listing is no longer in your workspace.</p></Modal>;
  const working=pitch && ['queued','finding-contacts','tailoring-documents','drafting-pitch'].includes(pitch.status),verified=(pitch?.contacts || []).filter(c=>c.emailStatus==='verified' && !c.suppressed && !c.requiresDomainReview);
  async function reviewCampaign(){const campaign=data.campaigns.find(c=>c.id===pitch.campaignId);if(!campaign)throw Error('Wait for the workspace to refresh, then retry.');if(verified.length && campaign.contactIds.length!==verified.length)await api(`/campaigns/${campaign.id}`,{...campaign,contactIds:verified.map(c=>c.id)},'PATCH');setModal({type:'campaign-preview',id:campaign.id,jobId:job.id});}
  return <Modal title="From opportunity to introduction" onClose={close} wide>
    <h2>{job.title}</h2><p>{job.company} · {job.location}</p><p>Find company contacts, prepare two tailored PDFs and draft an introduction for this exact role. Sending requires a reviewed campaign.</p>
    {error && <p className="error-box" role="alert">{error}</p>}
    {pitch && <section className="notice"><Badge value={pitch.status}/>{pitch.warning && <p>{pitch.warning}</p>}{pitch.warnings?.map(w=><p className="hint" key={w}>{w}</p>)}{working && <><p>The worker is preparing your pitch. You can close this window and return later.</p><QueueNowButton/></>}</section>}
    {!working && <form className="stack mt" onSubmit={e=>{e.preventDefault();perform(async()=>{const r=await api(`/jobs/${jobId}/auto-pitch`,{companyDomain:domain,confirmedDomain:!!domain,allowCredits:credits,allowSearch:search,useAI:ai,sourceReviewed:reviewed});setPitch(r.pitch);notify(r.existing ? 'This preparation is already saved.' : 'Pitch preparation queued.');});}}>
      <Field label="Official company domain (optional)" hint="Enter only a domain you have checked on the company’s official website. We resolve it automatically when available."><input value={domain} onChange={e=>setDomain(e.target.value)} placeholder={pitch?.company?.domain || 'company.com'}/></Field>
      {job.requiresSourceReview && <label className="checkbox-group"><input type="checkbox" required checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>I reviewed the live listing and confirmed this employer and role</label>}
      <label className="checkbox-group"><input type="checkbox" checked={credits} disabled={!setup.hunterConfigured} onChange={e=>setCredits(e.target.checked)}/>Use Hunter search and mailbox-verification credits</label>
      <label className="checkbox-group"><input type="checkbox" checked={search} disabled={!setup.serpapiConfigured && !setup.braveConfigured} onChange={e=>setSearch(e.target.checked)}/>Use optional search credits for people and warm connections</label>
      <label className="checkbox-group"><input type="checkbox" checked={ai} disabled={!setup.aiConfigured} onChange={e=>setAI(e.target.checked)}/>Let Gemini select relevant résumé evidence (uses API credits)</label>
      <div className="form-actions"><Button primary type="submit">{pitch ? 'Prepare with these settings' : 'Prepare company pitch'}</Button><a className="btn" href={job.url} target="_blank" rel="noreferrer">Review source listing ↗</a></div>
    </form>}
    {!!pitch?.contacts?.length && <section className="form-section"><h3>{pitch.contacts.length} prospects · {verified.length} verified mailboxes</h3>{pitch.contacts.map(c=><div className="contact-row" key={c.id}><div className="grow"><strong>{c.name}</strong><p>{c.title} · {c.email || 'Email unavailable'}</p>{c.domainVerification?.hasMx && <p className="hint">Domain receives mail · {c.domainVerification.gateway}. Recipient verification: {c.emailStatus}.</p>}</div><Badge value={c.emailStatus}/>{c.email && c.emailStatus!=='verified' && <Button small onClick={()=>setModal({type:'verify',id:c.id})}>Verify mailbox</Button>}</div>)}</section>}
    {!!pitch?.contacts?.length && <section className="form-section"><span className="eyebrow">LINKEDIN COMPANION</span><h3>A personal connection, alongside your pitch.</h3><p>Copy a note and review it on LinkedIn. No connection request or message is sent automatically.</p>{pitch.contacts.map(c=>c.linkedIn && <LinkedInDraft key={c.id} contact={c} notify={notify}/>)}</section>}
    {pitch?.documents && <div className="document-downloads"><a className="btn" href={`/api/documents/${pitch.documents.id}/resume`}>Review résumé PDF</a><a className="btn" href={`/api/documents/${pitch.documents.id}/coverLetter`}>Review cover letter PDF</a></div>}
    {pitch?.campaignId && <div className="form-actions"><Button primary onClick={()=>perform(reviewCampaign)}>{verified.length ? `Review sequence for ${verified.length} verified contacts` : 'Preview draft (verification needed)'}</Button></div>}
  </Modal>;
}

export function LinkedInDraft({contact,notify}) {
  const {connectionNote,followUpDM}=contact.linkedIn;
  const source=(()=>{try{const u=new URL(contact.linkedinUrl);if(u.protocol==='https:' && /(^|\.)linkedin\.com$/.test(u.hostname) && u.pathname.startsWith('/in/'))return u.href;}catch{}return '';})();
  async function copy(value,open=false) {
    if(open)window.open(source || `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${contact.name} ${contact.company}`)}`,'_blank','noopener,noreferrer');
    try{await navigator.clipboard.writeText(value);notify('Copied. Review and send it yourself on LinkedIn.');}catch{notify('Clipboard access is unavailable. Select and copy the note below.',true);}
  }
  return <details className="linkedin-drafts"><summary>{contact.name} <small>{connectionNote.length}/200 characters</small></summary><p>{connectionNote}</p><div className="btn-row"><Button small onClick={()=>copy(connectionNote,true)}>{source ? 'Copy Note & Open LinkedIn Profile' : 'Copy Note & Find on LinkedIn'}</Button></div><small>AFTER THEY ACCEPT · {followUpDM.length}/450 characters</small><p>{followUpDM}</p><Button small onClick={()=>copy(followUpDM)}>Copy follow-up DM</Button></details>;
}
