import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp, api, stages, split, fmt } from '../../shared/workspace.jsx';
import { Button, Badge, Heading, Empty, Panel, Field, Company, Modal, ConfirmAction, Sample } from '../../shared/ui.jsx';
import {MasterProfileVault} from './MasterProfileVault.jsx';
export function Profile() {
  const { data, vault, perform, notify, setModal } = useApp(),
    [draft, setDraft] = useState({
      ...data.profile,
      skills: data.profile.skills.join(", "),
      interests: data.profile.interests.join(", "),
    }),
    [qa, setQa] = useState(data.settings.qaBank || []),
    r = data.resume;
  const changed=useRef(new Set());
  const change = (key, value) => {changed.current.add(key);setDraft((v) => ({ ...v, [key]: value }));};
  const profileKey=JSON.stringify(data.profile);
  useEffect(()=>{setDraft(old=>{const next={...old};for(const [key,value] of Object.entries(data.profile))if(!changed.current.has(key))next[key]=['skills','interests'].includes(key) ? value.join(', ') : value;return next;});},[profileKey]);
  async function upload(file) {
    if (!file) return;
    if (file.size > 5000000) throw Error("Choose a file under 5 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let raw = "";
    for (const b of bytes) raw += String.fromCharCode(b);
    await api("/profile/parse-resume", { name: file.name, base64: btoa(raw) });
    notify("Résumé uploaded. We’re reading it and updating your job matches.");
  }
  return (
    <>
      <Heading
        title="Your profile & résumé"
        subtitle="Your experience guides your search. Save changes to update job matching automatically."
      />
      <div className="profile-grid">
        <div>
          <MasterProfileVault/>
          <details className="form-section"><summary>Search and outreach details</summary>
          <form
            className="legacy-profile-form"
            onSubmit={(e) => {
              e.preventDefault();
              perform(async () => {
                await api(
                  "/profile",
                  {
                    ...data.profile,
                    ...Object.fromEntries([...changed.current].map(key=>[key,draft[key]])),
                    skills: changed.current.has('skills') ? split(draft.skills) : data.profile.skills,
                    interests: changed.current.has('interests') ? split(draft.interests) : data.profile.interests,
                  },
                  "PUT",
                );
                changed.current.clear();
                notify("Profile saved. Your job search is updating automatically.");
              });
            }}
          >
            <h2>A little about you</h2>
            <p>
              Saved details are used for application packets and reviewed form
              filling.
            </p>
            <div className="form-grid">
              {[
                ["name", "Full name", "text"],
                ["email", "Email", "email"],
                ["phone", "Phone", "tel"],
                ["location", "Location", "text"],
                ["headline", "Professional headline", "text"],
                ["portfolio", "Portfolio", "url"],
                ["linkedin", "LinkedIn URL", "url"],
                ["github", "GitHub URL", "url"],
                ["noticePeriod", "Notice period", "text"],
                ["expectedSalary", "Expected salary / CTC", "text"],
                ["authorization", "Work authorization notes", "text"],
                ["skills", "Skills, separated by commas", "text"],
                [
                  "interests",
                  "Target roles or fields, separated by commas",
                  "text",
                ],
              ].map(([key, label, type]) => (
                <Field label={label} key={key}>
                  <input
                    className="input"
                    type={type}
                    value={draft[key] || ""}
                    onChange={(e) => change(key, e.target.value)}
                  />
                </Field>
              ))}
              <Field label="Work preference">
                <select
                  value={draft.workMode}
                  onChange={(e) => change("workMode", e.target.value)}
                >
                  {["Any", "Remote", "Hybrid", "On-site"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Your story">
                <textarea
                  rows="5"
                  value={draft.summary || ""}
                  onChange={(e) => change("summary", e.target.value)}
                />
              </Field>
            </div>
            <div className="form-actions">
              <Button primary type="submit">
                Save & update matches
              </Button>
            </div>
          </form>
          </details>
          <section className="form-section">
            <h2>Your approved answer bank</h2>
            <p>
              Exact question labels and answers for browser-assisted forms.
              Unknown eligibility or screening questions stay empty.
            </p>
            {qa.map((pair, i) => (
              <div className="qapair" key={i}>
                <input
                  className="input"
                  aria-label={`Question ${i + 1}`}
                  placeholder="Exact question label"
                  value={pair.question}
                  onChange={(e) =>
                    setQa(
                      qa.map((p, n) =>
                        n === i ? { ...p, question: e.target.value } : p,
                      ),
                    )
                  }
                />
                <input
                  className="input"
                  aria-label={`Answer ${i + 1}`}
                  placeholder="Your approved answer"
                  value={pair.answer}
                  onChange={(e) =>
                    setQa(
                      qa.map((p, n) =>
                        n === i ? { ...p, answer: e.target.value } : p,
                      ),
                    )
                  }
                />
                <button
                  className="icon-button"
                  onClick={() => setQa(qa.filter((_, n) => n !== i))}
                  aria-label="Remove answer"
                >
                  ×
                </button>
              </div>
            ))}
            <div className="form-actions">
              <Button
                onClick={() => setQa([...qa, { question: "", answer: "" }])}
              >
                + Add answer
              </Button>
              <Button
                primary
                onClick={() =>
                  perform(
                    () =>
                      api("/settings", { ...data.settings, qaBank: qa }, "PUT"),
                    "Answer bank saved.",
                  )
                }
              >
                Save answers
              </Button>
            </div>
          </section>
        </div>
        <div className="profile-side">
          <section className="form-section">
            <h2>Your résumé, ready to go.</h2>
            <p>PDF, DOCX, or TXT · Up to 5 MB</p>
            <label className="dropzone">
              <strong>Choose a résumé</strong>
              <small>Extraction runs in the background.</small>
              <input
                type="file"
                className="sr-only"
                accept=".pdf,.docx,.txt"
                onChange={(e) => perform(() => upload(e.target.files[0]))}
              />
            </label>
            {r && (
              <>
                <div className="file-card">
                  <span>▤</span>
                  <div className="grow">
                    <strong>{r.name}</strong>
                    <p>
                      {Math.ceil(r.size / 1000)} KB ·{" "}
                      {r.parseStatus || "Imported"}
                    </p>
                  </div>
                  <a href="/api/resume/download">Download</a>
                </div>
                {r.warning && <p className="notice">{r.warning}</p>}
                {r.suggestions?.skills?.length > 0 && (
                  <div className="readonly-result">
                    <strong>Detected skills to review</strong>
                    <p>{r.suggestions.skills.join(", ")}</p>
                    <Button
                      small
                      onClick={() =>
                        change(
                          "skills",
                          [
                            ...new Set([
                              ...split(draft.skills),
                              ...r.suggestions.skills,
                            ]),
                          ].join(", "),
                        )
                      }
                    >
                      Add to profile draft
                    </Button>
                  </div>
                )}
                <div className="btn-row mt">
                  <Button
                    small
                    onClick={() => setModal({ type: "resume-text" })}
                  >
                    Review text
                  </Button>
                  <Button small onClick={() => setModal({ type: "extract" })}>
                    Structured AI extraction
                  </Button>
                  <Button small onClick={() => setModal({ type: "share" })}>
                    Create résumé link
                  </Button>
                </div>
                {r.structured && (
                  <div className="mt">
                    <h3 className="secondary-heading">
                      Structured extraction · review before using
                    </h3>
                    <pre className="resume-structured">
                      {JSON.stringify(r.structured, null, 2)}
                    </pre>
                  </div>
                )}
              </>
            )}
          </section>
          <Panel
            title="Tailored versions"
            subtitle="Relevant existing bullets highlighted without inventing experience."
          >
            {vault.versions.length ? (
              vault.versions.map((v) => (
                <div className="resume-version" key={v.id}>
                  <strong>{v.title}</strong>
                  <p>{fmt(v.createdAt)}</p>
                  <a
                    className="btn small"
                    href={`/api/vault/${v.id}/download`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open / save as PDF
                  </a>
                </div>
              ))
            ) : (
              <Empty title="A stronger fit starts with your facts.">
                Choose Tailor on a job to create a printable version for review.
              </Empty>
            )}
          </Panel>
          {data.profile.resumeUrl && (
            <section className="form-section">
              <h2>Your résumé link</h2>
              <p>
                <a
                  href={data.profile.resumeUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open public résumé link ↗
                </a>
              </p>
              <div className="code-box">{data.profile.resumeUrl}</div>
              <p className="hint">
                Expires after seven days or when the original file changes.
                Views can include link scanners.
              </p>
              {vault.links
                .filter((link) => !link.revoked)
                .map((link) => (
                  <div className="spread mt" key={link.id}>
                    <span className="view-count">
                      {link.company && <strong>{link.company} · {link.contactName}<br/></strong>}{link.views} link requests · expires {fmt(link.expires)}{link.lastActivityAt && <><br/>Latest activity: {fmt(link.lastActivityAt)}</>}
                    </span>
                    <Button
                      small
                      onClick={() =>
                        perform(
                          () => api(`/share/${link.id}/revoke`, {}),
                          "Link revoked.",
                        )
                      }
                    >
                      Revoke
                    </Button>
                  </div>
                ))}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
