import React, { useEffect, useRef } from 'react';
import { useApp } from './workspace.jsx';
export const Sample = ({value}) => value ? <span className="badge sample">SAMPLE</span> : null;
export function Button({
  children,
  onClick,
  type = "button",
  primary = false,
  small = false,
  disabled = false,
  active,
  ...rest
}) {
  return (
    <button
      type={type}
      className={`btn${primary ? " primary" : ""}${small ? " small" : ""}${active ? " active" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active===undefined?undefined:active}
      {...rest}
    >
      {children}
    </button>
  );
}
export function Badge({ value }) {
  return <span className={`badge ${value}`}>{value}</span>;
}
export function Heading({ title, subtitle, children }) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="btn-row">{children}</div>
    </div>
  );
}
export function Empty({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Panel({ title, subtitle, children, action }) {
  return (
    <section className="panel page-section">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Field({ label, children, hint }) {
  return (
    <label className="field">
      {label}
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Company({name,jobId,logo}) {
  const [failed,setFailed]=React.useState(false);
  useEffect(()=>setFailed(false),[jobId,logo]);
  return <span className="company-mark" role="img" aria-label={name ? `${name} logo` : undefined}>{jobId && logo && !failed ? <img src={`/api/jobs/${encodeURIComponent(jobId)}/logo`} loading="lazy" decoding="async" alt="" onError={()=>setFailed(true)}/> : name?.split(/\s+/).map(part=>part[0]).slice(0,2).join('') || 'V'}</span>;
}
export function Modal({ title, children, onClose, wide = false,className='' }) {
  const titleId=React.useId();
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    const previous=document.activeElement;
    el.showModal();
    const cancel = (e) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener("cancel", cancel);
    return () => {el.removeEventListener("cancel",cancel);if(el.open)el.close();requestAnimationFrame(()=>{if(previous?.isConnected && !document.querySelector('dialog[open]'))previous.focus({preventScroll:true});});};
  }, []);
  return (
    <dialog
      ref={ref}
      className={`${wide ? "wide" : ""} ${className}`}
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === ref.current) {
          const rect = ref.current.getBoundingClientRect();
          if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          ×
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function ConfirmAction({ label, explanation, onConfirm, primary = false }) {
  const { perform } = useApp();
  return (
    <Button
      primary={primary}
      onClick={() => {
        if (window.confirm(explanation)) perform(onConfirm);
      }}
    >
      {label}
    </Button>
  );
}