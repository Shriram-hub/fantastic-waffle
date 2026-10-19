import React,{useState,useEffect} from 'react';
import {useApp,api} from '../../shared/workspace.jsx';
import {Modal,Button,Badge} from '../../shared/ui.jsx';

export function AutopilotReview({close}) {
  const {perform,autopilot,busy}=useApp(),[batch,setBatch]=useState(null),[error,setError]=useState(''),[approved,setApproved]=useState(false);
  useEffect(()=>{api('/autopilot/review').then(setBatch).catch(e=>setError(e.message));},[]);
  const blocked=!!autopilot?.blockers.sending.length || !autopilot?.policy.enabled;
  return <Modal title="Review your Autopilot pitches" onClose={close} wide>
    {error && <p className="error-box">{error}</p>}
    {!batch ? <p>Preparing your review…</p> : <>
      <p className="mb">{batch.messages.length} messages, each tied to a specific job. The worker adds a unique unsubscribe link when sending.</p>
      {batch.messages.map(m=><article className="email-preview mb" key={m.campaignId}><div className="email-header">To <strong>{m.to}</strong><br/>Subject <strong>{m.subject}</strong><br/><Badge value="Verified"/> · {m.method}</div><div className="email-body">{m.body}</div>{m.attachment && <p className="attachment">Attachment: {m.attachment}</p>}{m.sequence?.enabled && <div className="notice"><strong>Follow-up after {m.sequence.afterBusinessDays} business days</strong><p>{m.sequence.body}</p></div>}</article>)}
      {blocked && <p className="notice">{autopilot?.blockers.sending.join(' ') || 'Enable Autopilot before approving.'}</p>}
      <label className="check mt"><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)}/>I reviewed all {batch.messages.length} messages and approve their recipients, content, résumé, and selected follow-ups.</label>
      <div className="btn-row mt"><Button primary disabled={busy || blocked || !approved || !batch.messages.length} onClick={()=>perform(async()=>{await api('/autopilot/approve',{approved:true,confirmCount:batch.messages.length,fingerprint:batch.fingerprint});close();},'Reviewed pitches queued.')}>Approve all {batch.messages.length} messages</Button><Button onClick={close}>Close</Button></div>
    </>}
  </Modal>;
}
