import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp, api, stages, split, fmt } from '../../shared/workspace.jsx';
import { Button, Badge, Heading, Empty, Panel, Field, Company, Modal, ConfirmAction, Sample } from '../../shared/ui.jsx';
import {SetupChecklist} from './SetupChecklist.jsx';
export function Connections() {
  const { data, accounts, integrations, setup={}, perform, notify, setModal } = useApp(),
    [settings, setSettings] = useState({
      ...data.settings,
      greenhouseBoards: (data.settings.greenhouseBoards || []).join(", "),
      leverBoards: (data.settings.leverBoards || []).join(", "),
      ashbyBoards: (data.settings.ashbyBoards || []).join(", "),
      sendTimeZone: data.settings.sendTimeZone || "UTC",
      dailySendLimit: data.settings.dailySendLimit || 30,
    });
  const update = (k, v) => setSettings((s) => ({ ...s, [k]: v }));
  return (
    <>
      <Heading
        title="Your tools, working together."
        subtitle="Explicit connections. Server-side secrets. A clear view of what is configured."
      />
      <SetupChecklist/>
      <section className="notice mb"><strong>Free job discovery is included</strong><p>Greenhouse, Lever, Ashby and public feeds work without API keys. Optional JSEARCH_API_KEY or SERPAPI_API_KEY broadens coverage through Google Jobs. Save these in Render → Environment, then enable Google Jobs in search sources.</p><p>JSearch: {setup.jsearchConfigured ? 'key saved' : 'not configured'} · SerpApi: {setup.serpapiConfigured ? 'key saved' : 'not configured'}. Source health shows whether live provider requests succeed.</p></section>
      <div className="provider-grid">
        <section className="connection-card">
          <div className="spread">
            <span className="provider-mark">G</span>
            <Badge
              value={
                accounts.some((a) => a.provider === "google")
                  ? "Connected"
                  : integrations.googleOAuth
                    ? "Ready to connect"
                    : "Needs server setup"
              }
            />
          </div>
          <h3>Google / Gmail</h3>
          <p>
            Read application updates, watch mailbox history through Pub/Sub, and
            send reviewed messages from your account.
          </p>
          <a className="btn small" href="/api/oauth/google/start">
            Connect Google
          </a>
        </section>
        <section className="connection-card">
          <div className="spread">
            <span className="provider-mark blue">M</span>
            <Badge
              value={
                accounts.some((a) => a.provider === "microsoft")
                  ? "Connected"
                  : integrations.microsoftOAuth
                    ? "Ready to connect"
                    : "Needs server setup"
              }
            />
          </div>
          <h3>Microsoft / Outlook</h3>
          <p>
            Use Graph delta sync and authenticated webhook notifications. Tokens
            are encrypted on the server.
          </p>
          <a className="btn small" href="/api/oauth/microsoft/start">
            Connect Microsoft
          </a>
        </section>
        {[
          ["Apollo", "Contact search & selected enrichment", "apollo"],
          ["Hunter", "Work-email verification", "hunter"],
          ["Adzuna", "Aggregator search using your target roles", "adzuna"],
          [
            setup.geminiConfigured ? "Gemini AI & embeddings" : "AI & embeddings",
            "Structured extraction and semantic matching",
            "ai",
          ],
        ].map(([name, description, key]) => (
          <section className="connection-card" key={key}>
            <div className="spread">
              <span className="provider-mark">{name[0]}</span>
              <Badge
                value={
                  integrations[key] ? "Key configured" : "Needs server key"
                }
              />
            </div>
            <h3>{name}</h3>
            <p>{description}. Keys belong in the server environment.</p>
          </section>
        ))}
      </div>
      <div className="content-grid mt">
        <form
          className="form-section"
          onSubmit={(e) => {
            e.preventDefault();
            perform(
              () =>
                api(
                  "/settings",
                  {
                    ...settings,
                    greenhouseBoards: split(settings.greenhouseBoards),
                    leverBoards: split(settings.leverBoards),
                    ashbyBoards: split(settings.ashbyBoards),
                  },
                  "PUT",
                ),
              "Settings saved.",
            );
          }}
        >
          <h2>Sources & automation settings</h2>
          <p>
            Remotive, Arbeitnow, and Himalayas are public feeds. Company-board slugs choose
            specific employers.
          </p>
          <div className="stack">
            {["greenhouse", "lever", "ashby"].map((source) => (
              <Field
                key={source}
                label={`${source[0].toUpperCase() + source.slice(1)} company slugs`}
                hint="Comma-separated; up to ten."
              >
                <input
                  className="input"
                  value={settings[`${source}Boards`]}
                  onChange={(e) => update(`${source}Boards`, e.target.value)}
                />
              </Field>
            ))}
            <Field
              label="Sending time zone (IANA)"
              hint="This is the campaign window’s time zone. Default UTC; no recipient location is guessed."
            >
              <input
                className="input"
                value={settings.sendTimeZone}
                onChange={(e) => update("sendTimeZone", e.target.value)}
              />
            </Field>
            <Field label="Daily send cap per account (1–50)">
              <input
                className="input"
                type="number"
                min="1"
                max="50"
                value={settings.dailySendLimit}
                onChange={(e) =>
                  update("dailySendLimit", Number(e.target.value))
                }
              />
            </Field>
            <label className="checkbox-group">
              <input
                type="checkbox"
                checked={settings.inboxAutoUpdate || false}
                onChange={(e) => update("inboxAutoUpdate", e.target.checked)}
              />
              Automatically advance uniquely matched inbox updates
            </label>
            <p className="hint">
              Ambiguous, older, regressive, and terminal-stage changes remain in
              review.
            </p>
            <label className="checkbox-group">
              <input
                type="checkbox"
                checked={settings.inboxUseAI || false}
                onChange={(e) => update("inboxUseAI", e.target.checked)}
              />
              Use the configured model for email classification
            </label>
            <p className="hint">
              If enabled, matched email content is sent to your model provider
              and may incur API usage charges.
            </p>
          </div>
          <div className="form-actions">
            <Button primary type="submit">
              Save settings
            </Button>
          </div>
        </form>
        <div>
          <Panel title="Connected mailboxes">
            {accounts.map((a) => (
              <div className="task-item" key={a.id}>
                <strong>{a.email}</strong>
                <p>
                  {a.provider} · Last sync {fmt(a.lastSync)}
                  <br />
                  Watch expires {fmt(a.watchExpires)}
                </p>
                <div className="btn-row mt">
                  <Button
                    small
                    onClick={() =>
                      perform(
                        () => api(`/mail/${a.id}/sync`, {}),
                        "Sync queued.",
                      )
                    }
                  >
                    Sync
                  </Button>
                  <Button
                    small
                    onClick={() =>
                      perform(
                        () => api(`/mail/${a.id}/watch`, {}),
                        "Watch setup / renewal queued.",
                      )
                    }
                  >
                    Enable push watch
                  </Button>
                  <Button
                    small
                    onClick={() =>
                      perform(
                        () => api(`/mail/${a.id}/disconnect`, {}),
                        "Mailbox disconnected.",
                      )
                    }
                  >
                    Disconnect
                  </Button>
                </div>
              </div>
            ))}
            {!accounts.length && (
              <Empty title="Bring your inbox into view.">
                OAuth setup requires server credentials and registered callback
                URLs.
              </Empty>
            )}
          </Panel>
          <section className="form-section">
            <h2>Browser application assistant</h2>
            <p>
              Download and extract the assistant. Open chrome://extensions,
              enable Developer mode, and load the orbit-extension folder.
              Generate a token, then pair it with this Orbit address.
              Tokens expire in 24 hours.
            </p>
            <div className="btn-row">
              <a className="btn primary" href="/api/extension/download">Download Chrome extension</a>
              <Button
                onClick={() =>
                  perform(async () => {
                    const result = await api("/extension/token", {});
                    setModal({ type: "token", token: result.token });
                  })
                }
              >
                Generate pairing token
              </Button>
              <Button
                onClick={() =>
                  perform(
                    () => api("/extension/token", {}, "DELETE"),
                    "Extension tokens revoked.",
                  )
                }
              >
                Revoke tokens
              </Button>
            </div>
          </section>
          <section className="form-section">
            <h2>Workspace controls</h2>
            <p>
              Reset replaces profile, files, records, queued tasks, and mailbox
              connections.
            </p>
            <div className="btn-row">
              <Button onClick={() => setModal({ type: "reset", demo: false })}>
                Start fresh
              </Button>
              <Button onClick={() => setModal({ type: "reset", demo: true })}>
                Load sample workspace
              </Button>
            </div>
          </section>
        </div>
      </div>
      <div className="notice">
        Queue driver: {integrations.queueDriver}. This is one private personal workspace.
        OAuth connects your mailboxes; separate user accounts are a future milestone.
      </div>
    </>
  );
}
