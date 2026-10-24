import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp, api, stages, split, fmt } from '../../shared/workspace.jsx';
import { Button, Badge, Heading, Empty, Panel, Field } from '../../shared/ui.jsx';
import {SlideOver} from '../../shared/SlideOver.jsx';
const REPLY_CATEGORIES={interview:'Interview / Call Request',positive:'Positive / Referral Offered',ooo:'Out of Office',bounce:'Bounce / NDR',other:'Other update'};
export function Inbox() {
  const { data, accounts, perform, setModal,go } = useApp(),[filter,setFilter]=useState('all');
  const messages=data.inbox.filter(item=>filter==='all' || (item.category || 'other')===filter);
  return (
    <>
      <Heading
        title="The next step, without the guesswork."
        subtitle="Mailbox events become status suggestions, assessment links, and reviewed actions."
      >
        <Button onClick={() => setModal({ type: "import-email" })}>
          Paste an update
        </Button>
        {accounts.map((a) => (
          <Button
            primary
            key={a.id}
            onClick={() =>
              perform(
                () => api(`/mail/${a.id}/sync`, {}),
                "Mailbox sync queued.",
              )
            }
          >
            Sync {a.provider}
          </Button>
        ))}
      </Heading>
      {!accounts.length && (
        <div className="banner info"><Button small onClick={()=>go('connections')}>Connect mailbox</Button>
          <span>
            Connect Google or Microsoft in Connections for inbox sync. Pasted
            updates also work.
          </span>
        </div>
      )}
      <div className="inbox-filters focus-switch" role="group" aria-label="Reply category"><Button active={filter==='all'} onClick={()=>setFilter('all')}>All ({data.inbox.length})</Button>{Object.entries(REPLY_CATEGORIES).map(([key,label])=><Button key={key} active={filter===key} onClick={()=>setFilter(key)}>{label} ({data.inbox.filter(m=>(m.category || 'other')===key).length})</Button>)}</div>
      <Panel
        title="Application updates"
        subtitle="Only unique role matches can transition automatically when you opt in."
      >
        {messages.map((item) => (
          <InboxItem key={item.id} item={item} />
        ))}
        {!messages.length && (
          <Empty title="Room for good news.">
            Import a confirmation, interview invitation, assessment, or decision
            email.
          </Empty>
        )}
      </Panel>
    </>
  );
}
export function InboxItem({ item }) {
  const { data, accounts, perform,notify } = useApp(),
    [reply,setReply]=useState(false),[draft,setDraft]=useState(null),[replyText,setReplyText]=useState(''),[timeZone,setTimeZone]=useState(data.settings?.sendTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),[accountId,setAccountId]=useState(item.accountId || accounts[0]?.id || ''),[useAI,setUseAI]=useState(false),
    [applicationId, setApplication] = useState(item.applicationId || "");
  const held=['queued','sending','accepted','unknown'].includes(item.replyDelivery?.status);
  async function prepareReply(edited=false){const r=await api(`/inbox/${item.id}/draft-reply`,{accountId,timeZone,useAI:edited?false:useAI,confirmed:useAI,...(edited?{replyText}:{})});setDraft(r);setReplyText(r.body);setReply(true);}
  return (
    <article className={`inbox-item ${item.highPriority?'high-priority':''}`}>
      <div className="spread">
        <span className="small muted">
          {item.from || "Imported email"} ·{" "}
          {fmt(item.receivedAt || item.createdAt)}
        </span>
        <Badge value={item.status} />
      </div>
      <h3>{item.subject}</h3><div className="reply-meta"><span className="status-pill">{REPLY_CATEGORIES[item.category] || REPLY_CATEGORIES.other}</span>{item.highPriority && <strong>High priority</strong>}{item.replyDelivery && <span>Reply: {item.replyDelivery.status}</span>}</div>{item.replyDelivery?.error && <p className="hint" role="status">{item.replyDelivery.error}</p>}
      <p>{item.body.slice(0, 360)}</p>{item.body.length>360 && <details className="subtle-accordion"><summary>Read full message</summary><pre>{item.body}</pre></details>}
      {item.outOfOffice && <div className="notice">Return: {item.outOfOffice.returnDate || item.outOfOffice.returnText || 'not stated'}{item.outOfOffice.alternatives?.length>0 && <p>Referral addresses: <span className="mono">{item.outOfOffice.alternatives.join(', ')}</span>. Added with source evidence; mailbox verification is still required.</p>}</div>}
      {item.category!=='bounce' && item.type!=='Delivery failure' && item.from && <Button small disabled={held} onClick={()=>{setReply(true);setDraft(null);}}>Draft Reply</Button>}
      <SlideOver open={reply} onClose={()=>setReply(false)} title="Draft a threaded reply"><p className="hint">To: {draft?.to || item.from}. Drafts never send until you approve the displayed message.</p><Field label="Reply from"><select value={accountId} disabled={!!item.accountId} onChange={e=>{setAccountId(e.target.value);setDraft(null);}}><option value="">Choose mailbox</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.email}</option>)}</select></Field><Field label="Your time zone"><input value={timeZone} onChange={e=>{setTimeZone(e.target.value);setDraft(null);}} placeholder="Asia/Kolkata"/></Field><label className="checkbox-group"><input type="checkbox" checked={useAI} onChange={e=>{setUseAI(e.target.checked);setDraft(null);}}/>Use this message with the configured model</label><Button disabled={held} onClick={()=>perform(()=>prepareReply())}>Generate reply draft</Button>{draft && <><h3>{draft.subject}</h3><Field label="Edit reply"><textarea rows="12" maxLength="6000" value={replyText} onChange={e=>setReplyText(e.target.value)}/></Field><p className="hint">{draft.method}. Suggested slots do not check your calendar. Confirm your availability before sending.</p>{replyText!==draft.body?<Button onClick={()=>perform(()=>prepareReply(true))}>Save edits & refresh preview</Button>:<Button primary disabled={held} onClick={()=>perform(async()=>{await api(`/inbox/${item.id}/send-reply`,{approved:true,fingerprint:draft.fingerprint});setReply(false);notify('Your approved reply is queued in the original thread.');})}>Approve & send reply</Button>}</>}</SlideOver>
      {item.deadline && (
        <div className="notice mt">
          Deadline stated in email: <strong>{item.deadline}</strong>
          {item.links?.map((link) => (
            <p key={link}>
              <a href={link} target="_blank" rel="noreferrer">
                Open assessment / action link ↗
              </a>
            </p>
          ))}
        </div>
      )}
      {item.status === "Needs review" && (
        <div className="inline-form mt">
          <Field
            label={item.ambiguous ? "Choose the correct role" : "Application"}
          >
            <select
              value={applicationId}
              onChange={(e) => setApplication(e.target.value)}
            >
              <option value="">Choose an application</option>
              {data.applications.map((a) => {
                const j = data.jobs.find((j) => j.id === a.jobId);
                return (
                  <option key={a.id} value={a.id}>
                    {j?.company} · {j?.title}
                  </option>
                );
              })}
            </select>
          </Field>
          <Badge value={item.proposedStage || "No status detected"} />
          <Button
            small
            disabled={!applicationId || !item.proposedStage}
            primary
            onClick={() =>
              perform(
                () => api(`/inbox/${item.id}/accept`, { applicationId }),
                "Tracker updated from reviewed email.",
              )
            }
          >
            Apply suggestion
          </Button>
          <Button
            small
            onClick={() => perform(() => api(`/inbox/${item.id}/dismiss`, {}))}
          >
            Dismiss
          </Button>
        </div>
      )}
    </article>
  );
}
