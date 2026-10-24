import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp, api, stages, split, fmt } from '../../shared/workspace.jsx';
import { Button, Badge, Heading, Empty, Panel, Field, Company, Modal, ConfirmAction, Sample } from '../../shared/ui.jsx';
import { AutopilotSettings } from './AutopilotSettings.jsx';
export function Automation({showSettings=true}) {
  const { tasks, data, perform, setModal } = useApp();
  const [queueView,setQueueView]=useState('browser');
  return (
    <>
      <Heading
        title="Work in motion."
        subtitle="Background imports, parsing, matching, outreach, and browser-assisted applications."
      />
      {showSettings && <AutopilotSettings/>}<div className="focus-switch" role="group" aria-label="Worker queues"><Button active={queueView==='browser'} onClick={()=>setQueueView('browser')}>Browser applications</Button><Button active={queueView==='tasks'} onClick={()=>setQueueView('tasks')}>Background tasks</Button></div><div hidden={queueView!=='browser'}>
      <Panel
        title="Browser application queue"
        subtitle="The extension fills supported fields. You review and submit yourself."
      >
        {tasks.applications.map((t) => {
          const a = data.applications.find((a) => a.id === t.application_id),
            j = a && data.jobs.find((j) => j.id === a.jobId);
          return (
            <div className="task-item" key={t.id}>
              <div className="spread">
                <strong>
                  {j?.company} · {j?.title}
                </strong>
                <Badge value={t.status} />
              </div>
              {t.details.report?.missing?.length > 0 && (
                <p>Needs attention: {t.details.report.missing.join(" · ")}</p>
              )}
              {t.status !== "confirmed" && (
                <div className="btn-row mt">
                  {["blocked", "needs-review"].includes(t.status) && (
                    <Button
                      small
                      onClick={() =>
                        perform(
                          () => api(`/apply/${t.id}/requeue`, {}),
                          "Application requeued for the extension.",
                        )
                      }
                    >
                      Queue fill again
                    </Button>
                  )}
                  <Button
                    small
                    onClick={() =>
                      setModal({ type: "confirm-application", id: t.id })
                    }
                  >
                    Record employer confirmation
                  </Button>
                </div>
              )}
            </div>
          );
        })}
        {!tasks.applications.length && (
          <Empty title="A little less form filling.">
            Select jobs in the feed and choose Browser-assisted fill. Pair the
            extension in Connections.
          </Empty>
        )}
      </Panel>
      </div><div hidden={queueView!=='tasks'}><Panel
        title="Background tasks"
        subtitle="Discovery, contact lookups, drafts, and sends run in the hosted background worker."
      >
        {tasks.tasks.map((t) => (
          <div className="task-item" key={t.id}>
            <div className="spread">
              <div>
                <strong>{t.kind}</strong>
                <p>
                  Scheduled {fmt(t.run_at)} · Attempts {t.attempts}/
                  {t.max_attempts}
                </p>
              </div>
              <Badge value={t.status} />
            </div>
            {t.error && <p className="task-error">{t.error}</p>}
            <div className="btn-row mt">
              <Button
                small
                onClick={() => setModal({ type: "task-logs", id: t.id })}
              >
                View logs
              </Button>
              {t.status === "queued" && (
                <Button
                  small
                  onClick={() =>
                    perform(() => api(`/tasks/${t.id}/cancel`, {}))
                  }
                >
                  Cancel
                </Button>
              )}
              {t.status === "failed" && !t.kind.startsWith("campaign.") && t.kind!=='inbox.reply' && (
                <Button
                  small
                  onClick={() => perform(() => api(`/tasks/${t.id}/retry`, {}))}
                >
                  Retry
                </Button>
              )}
            </div>
          </div>
        ))}
        {!tasks.tasks.length && (
          <Empty title="Ready when you are.">
            Imports, matching, parsing, and email jobs will appear here.
          </Empty>
        )}
      </Panel></div>
    </>
  );
}
