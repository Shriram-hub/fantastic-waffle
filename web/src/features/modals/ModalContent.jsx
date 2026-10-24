import {JobDocuments} from '../resume/JobDocuments.jsx';
import {startBrowserBatch} from '../../shared/browser-batch.mjs';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp, api, stages, split, fmt } from '../../shared/workspace.jsx';
import { Button, Badge, Heading, Empty, Panel, Field, Company, Modal, ConfirmAction, Sample } from '../../shared/ui.jsx';
import { AddJobModal } from '../jobs/AddJobModal.jsx';
import { ApplicationModal } from '../tracker/ApplicationModal.jsx';
import { ImportEmailModal } from '../tracker/ImportEmailModal.jsx';
import { ApolloModal } from '../outreach/ApolloModal.jsx';
import { CampaignPreview } from '../outreach/CampaignPreview.jsx';
import {AutoPitchModal} from '../jobs/AutoPitchModal.jsx';
import {ImportApplicationsModal} from '../tracker/ImportApplicationsModal.jsx';
export function ModalContent({ modal, close }) {
  const { data, perform, notify, go,setCareerJobId } = useApp(),
    [textValue, setText] = useState(""),
    [result, setResult] = useState(null);
  useEffect(() => {
    if(modal.type==='job') api(`/jobs/${modal.id}`).then(setResult).catch(e=>notify(e.message,true));
    if (modal.type === "task-logs")
      api(`/tasks/${modal.id}/logs`)
        .then(setResult)
        .catch((e) => notify(e.message, true));
  }, [modal.id, modal.type]);
  if (modal.type === "campaign-preview")
    return <CampaignPreview id={modal.id} jobId={modal.jobId} close={close} />;
  if(modal.type==="auto-pitch")return <AutoPitchModal jobId={modal.id} close={close}/>;
  if(modal.type==='import-applications')return <ImportApplicationsModal close={close}/>;
  if (modal.type === "apollo") return <ApolloModal close={close} />;
  if (modal.type === "job") {
    const j = result?.job?.id===modal.id ? result.job : data.jobs.find((j) => j.id === modal.id);
    return (
      <Modal title="A closer look" onClose={close} wide>
        <div className="spread">
          <Company name={j.company} />
          <Sample value={j.isDemo} />
        </div>
        <h2 className="detail-title">{j.title}</h2>
        <p className="detail-company">
          {j.company} · {j.location}
        </p>
        <div className="match-card">
          <strong>{j.match.score!==null ? `${j.match.score}% explained profile match` : 'Set target roles to personalize your match'}</strong>
          <ul>
            {j.match.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {j.semanticMatch && (
            <p>
              Semantic: {j.semanticMatch.score}% · {j.semanticMatch.model}
            </p>
          )}
        </div>
        {j.descriptionTruncated && !result?.job ? <p className="detail-description">Loading the full job description…</p> : <p className="detail-description">{j.description}</p>}
        <div className="app-detail-links">
          <Button onClick={()=>{setCareerJobId(j.id);close();go('career');}}>Prepare for interview</Button>
          {j.url && (
            <a className="btn" href={j.url} target="_blank" rel="noreferrer">
              Open original listing ↗
            </a>
          )}
          <Button
            onClick={() =>
              perform(
                () => api("/tailor", { jobId: j.id }),
                "Fact-preserving résumé version queued.",
              )
            }
          >
            Tailor résumé
          </Button>
          <Button
            primary
            onClick={() =>
              perform(async () => {
                await api("/applications/batch", { jobIds: [j.id] });
                close();
                go("applications");
              })
            }
          >
            Prepare application
          </Button>
        </div>
        <JobDocuments jobId={j.id}/>
        <p className="hint">
          Original requirements and eligibility always take precedence over a
          score.
        </p>
      </Modal>
    );
  }
  if(modal.type==='contact-detail') {
    const contact=data.contacts.find(c=>c.id===modal.id);
    return <Modal title="Contact details" onClose={close}>{contact ? <><div className="spread"><Company name={contact.company}/><Badge value={contact.emailStatus}/></div><h2 className="detail-title">{contact.name}</h2><p className="detail-company">{contact.title} · {contact.company}</p><p className="mono">{contact.email || 'Email not available'}</p><p className="hint">{contact.source}</p>{contact.linkedinUrl && <a className="btn mt" href={contact.linkedinUrl} target="_blank" rel="noreferrer">Open source profile ↗</a>}<div className="form-actions"><Button onClick={()=>{close();go('contacts');}}>Open Contact Discovery</Button></div></> : <p>Contact no longer available.</p>}</Modal>;
  }
  if (modal.type === "application")
    return <ApplicationModal id={modal.id} close={close} />;
  if (modal.type === "add-job") return <AddJobModal close={close} />;
  if (modal.type === "add-contact")
    return (
      <SimpleFormModal
        title="A new connection"
        fields={["name", "email", "company", "title"]}
        submit={(v) => api("/contacts", v)}
        close={close}
      />
    );
  if (modal.type === "import-email") return <ImportEmailModal close={close} />;
  if (modal.type === "import-contacts")
    return (
      <Modal title="Bring your contacts with you" onClose={close}>
        <p className="small muted">
          Up to 500 rows. Columns: name, email, company, title, email_status.
        </p>
        <form
          className="stack mt"
          onSubmit={(e) => {
            e.preventDefault();
            perform(async () => {
              const r = await api("/contacts/import", { csv: textValue });
              setResult(r);
            });
          }}
        >
          <input
            className="input"
            aria-label="CSV file"
            type="file"
            accept=".csv"
            onChange={async (e) => {
              const file = e.target.files[0];
              if (!file) return;
              if (file.size > 2000000)
                return notify("Choose a CSV under 2 MB.", true);
              setText(await file.text());
            }}
          />
          <textarea
            aria-label="CSV text"
            rows="9"
            value={textValue}
            onChange={(e) => setText(e.target.value)}
            placeholder="name,email,company,title,email_status"
          />
          <Button primary type="submit">
            Import contacts
          </Button>
        </form>
        {result && (
          <div className="readonly-result mt">
            {result.imported} imported · {result.skipped} skipped
            <br />
            {result.errors?.join("\n")}
          </div>
        )}
      </Modal>
    );
  if (modal.type === "personalize")
    return (
      <Modal title="A factual opening line" onClose={close}>
        <p className="small muted">
          The worker will send this contact’s role/company context and the
          selected job description to your model provider. It may incur API
          charges. Review the generated opener and its exact source quote before
          using it.
        </p>
        <form
          className="stack mt"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Object.fromEntries(new FormData(e.currentTarget));
            perform(async () => {
              await api(`/contacts/${modal.id}/personalize`, {
                confirmed: true,
                jobId: v.jobId || null,
              });
              close();
            });
          }}
        >
          <Field label="Relevant role (optional)">
            <select name="jobId">
              <option value="">Contact context only</option>
              {data.jobs
                .filter((j) => !j.isDemo)
                .slice(0, 100)
                .map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.company} · {j.title}
                  </option>
                ))}
            </select>
          </Field>
          <Button primary type="submit">
            Queue an opener
          </Button>
        </form>
      </Modal>
    );
  if (modal.type === "resume-text")
    return (
      <TextEditor
        title="Review extracted résumé text"
        initial={data.resume?.text || ""}
        submit={(value) => api("/resume/text", { text: value }, "PUT")}
        close={close}
      />
    );
  if (modal.type === "confirm-application")
    return (
      <TextEditor
        title="Record the employer’s confirmation"
        label="Confirmation reference / receipt"
        initial=""
        submit={(value) =>
          api(`/apply/${modal.id}/confirm`, { confirmationReference: value })
        }
        close={close}
      />
    );
  if (modal.type === "task-logs")
    return (
      <Modal title="Task activity" onClose={close}>
        <div className="timeline">
          {result?.logs?.map((l, i) => (
            <div className="timeline-item" key={i}>
              <strong>{fmt(l.at)}</strong>
              <p>{l.message}</p>
            </div>
          )) || "Loading…"}
        </div>
      </Modal>
    );
  if (modal.type === "token")
    return (
      <Modal title="Pair your browser assistant" onClose={close}>
        <p className="small muted">
          Copy this token into the extension popup. It grants access to queued
          application profiles and the résumé; keep it private. It expires in 24
          hours.
        </p>
        <pre className="code-box mt">{modal.token}</pre>
        <p className="hint">
          The token is shown only in this response. Revoke it from Connections
          when finished.
        </p>
      </Modal>
    );
  const descriptions = {
    'confirm-domain': `I checked the company’s official website and confirm that ${modal.domain} belongs to ${modal.company}. This confirms the domain only; mailbox verification remains separate.`,
    "clear-demo": "Remove only sample jobs, sample contacts, sample applications and their queued work. Your real profile, files, mailboxes and real records are retained.",
    reset: `This replaces your current profile, résumé, jobs, applications, contacts, campaigns, mailbox connections, and queued tasks${modal.demo ? " with fictional sample data" : ""}. Export your applications first if needed.`,
    extract:
      "The worker will send your résumé text to the configured model provider for structured extraction. This may incur API usage charges. Review every extracted value before using it.",
    share:
      "This creates a public, unlisted link to your uploaded résumé for seven days. Anyone with the link can view it. Link requests may include automated scanners; they do not prove a recruiter read the document.",
    embeddings: `The worker will send your résumé text and ${modal.ids?.length} selected job descriptions to the configured embedding provider. This may incur API usage charges.`,
    enrich:
      "Apollo may charge credits for this work-email enrichment lookup. Exact costs depend on your plan. Personal emails and phone numbers are not requested.",
    verify:
      "Hunter may charge credits to verify this contact’s work email. Catch-all, invalid, and unknown results remain blocked from sending.",
    'verify-contacts': `Verify ${modal.ids?.length || 0} selected work emails using Hunter. This may consume provider credits and is limited by your daily contact API budget. Unknown, catch-all and invalid results remain excluded.`,
    "browser-batch": `${Math.min(modal.ids?.length || 0,10)} selected opportunities will be queued for your paired Chrome extension. It fills recognized fields and your approved answers, then stops for review. It does not solve verification challenges or submit an application.`,
  };
  const action = async () => {
    if(modal.type==='confirm-domain')await api('/contacts/company-domain/confirm',{domain:modal.domain,company:modal.company,confirmed:true});
    if(modal.type==="clear-demo"){await api("/workspace/clear-demo-data",{confirmed:true});notify("Sample records removed.");}
    if (modal.type === "reset") {
      await api("/workspace/reset", {
        confirm: modal.demo ? "LOAD_DEMO" : "START_FRESH",
      });
      go(modal.demo ? "overview" : "profile");
    }
    if (modal.type === "extract") await api("/ai/extract", { confirmed: true });
    if (modal.type === "share") {
      const r = await api("/share/resume", { approved: true });
      notify(r.url);
    }
    if (modal.type === "embeddings")
      await api("/matching", { confirmed: true, jobIds: modal.ids });
    if (modal.type === "enrich")
      await api(`/contacts/${modal.id}/enrich`, { confirmCredits: true });
    if (modal.type === "verify")
      await api(`/contacts/${modal.id}/verify`, { confirmed: true });
    if(modal.type==='verify-contacts'){const r=await api('/contacts/verify-batch',{ids:modal.ids,confirmed:true});notify(`${r.queued} verification tasks queued.`);}
    if (modal.type === "browser-batch") {
      const result=await api('/apply/queue',{approved:true,jobIds:modal.ids.slice(0,10)});
      notify(await startBrowserBatch(result.taskIds.slice(0,10)));
    }
    close();
  };
  return (
    <Modal
      title={
        modal.type === "reset" ? "Start a new chapter?" : "Review this action"
      }
      onClose={close}
    >
      <p className="pre">{descriptions[modal.type]}</p>
      <div className="form-actions">
        <Button onClick={close}>Cancel</Button>
        <Button primary onClick={() => perform(action)}>
          Confirm
        </Button>
      </div>
    </Modal>
  );
}
export function TextEditor({ title, label = "Text", initial, submit, close }) {
  const { perform } = useApp(),
    [value, setValue] = useState(initial);
  return (
    <Modal title={title} onClose={close} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          perform(async () => {
            await submit(value);
            close();
          });
        }}
      >
        <Field label={label}>
          <textarea
            rows="15"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <div className="form-actions">
          <Button primary type="submit">
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function SimpleFormModal({ title, fields, submit, close }) {
  const { perform } = useApp();
  return (
    <Modal title={title} onClose={close}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const values = Object.fromEntries(new FormData(e.currentTarget));
          perform(async () => {
            await submit(values);
            close();
          });
        }}
      >
        {fields.map((name) => (
          <Field key={name} label={name[0].toUpperCase() + name.slice(1)}>
            <input
              className="input"
              type={name === "email" ? "email" : "text"}
              required
              name={name}
            />
          </Field>
        ))}
        <div className="form-actions">
          <Button primary type="submit">
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
