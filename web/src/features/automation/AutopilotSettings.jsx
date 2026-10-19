import React, {useEffect,useState} from 'react';
import {useApp,api,fmt} from '../../shared/workspace.jsx';
import {Panel,Field,Button,Badge} from '../../shared/ui.jsx';
import {AutopilotReview} from './AutopilotReview.jsx';
import {AutopilotActivity} from './AutopilotActivity.jsx';

export function AutopilotSettings() {
  const {autopilot,accounts=[],perform,busy,go}=useApp();
  const [draft,setDraft]=useState(autopilot?.policy || null),[ack,setAck]=useState(false),[review,setReview]=useState(false),[retryConsent,setRetryConsent]=useState(false);
  useEffect(()=>{if(autopilot){setDraft(autopilot.policy);setAck(false);}},[autopilot ? autopilot.policy.id || 'default' : null]);
  if(!autopilot || !draft) return <Panel title="Autopilot Mode"><p className="panel-body">Loading your search settings…</p></Panel>;
  const set=(key,value)=>{setDraft(d=>({...d,[key]:value}));setAck(false);};
  const blockers=Object.entries(autopilot.blockers).flatMap(([stage,items])=>items.map(message=>({stage,message})));
  return <>
    <Panel title="Autopilot Mode" subtitle="Find matching jobs every two hours, look up company contacts, and prepare a focused pitch for each role."
      action={<Badge value={autopilot.policy.enabled ? 'Enabled' : 'Paused'}/> }>
      <form className="panel-body" onSubmit={event=>{event.preventDefault();perform(()=>api('/autopilot',{...draft,acknowledged:ack},'PUT'),'Autopilot settings saved.');}}>
        <label className="check"><input type="checkbox" checked={draft.enabled} onChange={e=>set('enabled',e.target.checked)}/>Enable Autopilot</label>
        <div className="form-grid mt">
          <Field label="Approval mode"><select value={draft.approvalMode} onChange={e=>set('approvalMode',e.target.value)}><option value="review">1-click review queue</option><option value="automatic">Full Autopilot — send automatically</option></select></Field>
          <Field label="Minimum match score"><input type="number" min="75" max="100" value={draft.minimumMatchScore} onChange={e=>set('minimumMatchScore',Number(e.target.value))}/></Field>
          <Field label="Max cold emails per day"><input type="number" min="1" max="50" value={draft.dailySendLimit} onChange={e=>set('dailySendLimit',Number(e.target.value))}/></Field>
          <Field label="Contacts per company"><input type="number" min="1" max="3" value={draft.contactsPerCompany} onChange={e=>set('contactsPerCompany',Number(e.target.value))}/></Field>
          <Field label="Your country (ISO code)" hint="For location-restricted remote jobs. For example IN, GB, or US."><input maxLength="2" value={draft.country || ''} placeholder="IN" onChange={e=>set('country',e.target.value.toUpperCase())}/></Field>
          <Field label="Max contact API calls per day" hint={`${autopilot.lookupsToday} reserved today. Apollo/Hunter may use account credits.`}><input type="number" min="1" max="100" value={draft.maxContactLookupsPerDay} onChange={e=>set('maxContactLookupsPerDay',Number(e.target.value))}/></Field>
          <Field label="Sending mailbox"><select value={draft.accountId} onChange={e=>set('accountId',e.target.value)}><option value="">Configured Resend sender</option>{accounts.map(a=><option value={a.id} key={a.id}>{a.email}</option>)}</select></Field>
          <Field label="Business-hours time zone" hint="Weekdays, 9–11 AM in this time zone, with 4–8 minutes between sends. Recipient time zones are not inferred."><input value={draft.timeZone} placeholder="Asia/Kolkata" onChange={e=>set('timeZone',e.target.value)}/></Field>
          <Field label="Include résumé"><select value={draft.resumeMode} onChange={e=>set('resumeMode',e.target.value)}><option value="link">Unlisted share link, valid for 7 days</option><option value="attachment">Original uploaded file attached</option></select></Field>
        </div>
        <label className="check mt"><input type="checkbox" checked={draft.allowContactCredits} onChange={e=>set('allowContactCredits',e.target.checked)}/>Allow contact lookups and enrichment using my Apollo/Hunter credits within this daily cap.</label>
        <label className="check mt"><input type="checkbox" checked={draft.useAI} onChange={e=>set('useAI',e.target.checked)}/>Use my configured AI provider to select relevant résumé excerpts. Otherwise use factual templates.</label>
        <label className="check mt"><input type="checkbox" checked={draft.useSearchAPI} onChange={e=>set('useSearchAPI',e.target.checked)}/>Use configured SerpApi credits for additional ATS board discovery, within the same API-call cap.</label>
        <label className="check mt"><input type="checkbox" checked={draft.followup} onChange={e=>set('followup',e.target.checked)}/>One follow-up after 4 business days, in the same thread; stop on reply. Requires a connected mailbox.</label>
        {draft.enabled && <label className="check mt"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>I approve these limits and résumé sharing. {draft.approvalMode==='automatic' ? 'Send prepared messages automatically.' : 'Prepare messages for my approval before sending.'} Anyone with the résumé link can open it until expiry.</label>}
        <div className="btn-row mt"><Button primary type="submit" disabled={busy || draft.enabled && !ack}>Save Autopilot settings</Button>
          {autopilot.policy.enabled && <Button onClick={()=>perform(()=>api('/autopilot',{...autopilot.policy,enabled:false},'PUT'),'Autopilot paused.')}>Pause now</Button>}
          <Button disabled={!autopilot.policy.enabled || busy} onClick={()=>perform(()=>api('/autopilot/sweep',{}),'Discovery schedule checked; source caches stay in effect.')}>Check discovery</Button>
        </div>
      </form>
      {blockers.length>0 && <div className="notice panel-body"><strong>Setup needed</strong><ul>{blockers.map(b=><li key={b.stage+b.message}>{b.message}</li>)}</ul><Button small onClick={()=>go('connections')}>Open Connections</Button></div>}
      {autopilot.matrix && <div className="panel-body"><strong>Your search plan</strong><p>{autopilot.matrix.target_roles.join(' · ') || 'Add target roles in My profile.'}</p><p>{autopilot.matrix.locations.join(' · ')} · {autopilot.matrix.ats_boards_to_watch.length} company boards, rotated each sweep</p>{autopilot.matrix.derivedRoles && <p className="small muted">Roles derived from résumé skills. Set your own target roles in My profile to refine them.</p>}</div>}
      <div className="panel-body spread"><p>{autopilot.reviewCount} prepared pitches · {autopilot.schedulerConfigured ? 'Cloud scheduler configured' : 'Scheduler runs while the server is awake'}</p><Button disabled={!autopilot.reviewCount} onClick={()=>setReview(true)}>Review pitches</Button></div>
    </Panel>
    <AutopilotActivity/>
    {!!autopilot.heldLookups?.length && <Panel title="Held provider lookups" subtitle="An interrupted request may already have used provider credits. Check your Apollo/Hunter usage before allowing another attempt."><div className="panel-body"><p>{autopilot.heldLookups.length} held requests. Today's original reservations still count toward the daily cap.</p><label className="check"><input type="checkbox" checked={retryConsent} onChange={e=>setRetryConsent(e.target.checked)}/>I checked provider usage and approve retrying these held requests; more credits may be consumed.</label><Button disabled={!retryConsent || !autopilot.policy.enabled || busy} onClick={()=>perform(async()=>{await api('/autopilot/retry-lookups',{approved:true,ids:autopilot.heldLookups.map(r=>r.id)});setRetryConsent(false);},'Held lookups released for retry.')}>Retry held lookups</Button></div></Panel>}
    {autopilot.runs.filter(r=>r.status==='blocked').slice(0,5).map(r=><div className="notice mb" key={r.id}><strong>Contact lookup needs attention</strong><p>{r.body.reason}</p></div>)}
    {review && <AutopilotReview close={()=>setReview(false)}/>}
  </>;
}
