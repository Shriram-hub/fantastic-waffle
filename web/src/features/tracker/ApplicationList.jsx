import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp, api, stages, split, fmt } from '../../shared/workspace.jsx';
import { Button, Badge, Heading, Empty, Panel, Field, Company, Modal, ConfirmAction, Sample } from '../../shared/ui.jsx';
export function ApplicationList({ list }) {
  const { data, setModal } = useApp();
  return list.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>ROLE & COMPANY</th>
            <th>STAGE</th>
            <th>UPDATED</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((a) => {
            const j = data.jobs.find((j) => j.id === a.jobId);
            return (
              <tr key={a.id}>
                <td>
                  <div className="flex">
                    <Company name={j?.company} />
                    <div>
                      <strong>{j?.title}</strong>
                      <span className="muted">
                        {j?.company} <Sample value={j?.isDemo} />
                      </span>
                    </div>
                  </div>
                </td>
                <td>
                  <Badge value={a.stage} />
                </td>
                <td>{fmt(a.updatedAt)}</td>
                <td>
                  <Button
                    small
                    onClick={() => setModal({ type: "application", id: a.id })}
                  >
                    View
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty title="Your first opportunity is waiting.">
      Save a job or add an application to get started.
    </Empty>
  );
}