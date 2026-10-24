import React,{useEffect,useId,useRef} from 'react';
export function SlideOver({open,onClose,title,children}){
  const ref=useRef(null),close=useRef(onClose),label=useId();close.current=onClose;
  useEffect(()=>{const el=ref.current;if(!open){if(el.open)el.close?.();return;}const previous=document.activeElement;if(el.showModal)el.showModal();else el.setAttribute('open','');const cancel=event=>{event.preventDefault();close.current();};el.addEventListener('cancel',cancel);return()=>{el.removeEventListener('cancel',cancel);if(el.open)el.close?.();if(previous?.isConnected)previous.focus({preventScroll:true});};},[open]);
  return <dialog ref={ref} hidden={!open} className="slide-over" aria-labelledby={label} onClick={event=>{if(event.target===ref.current){const r=ref.current.getBoundingClientRect();if(event.clientX<r.left || event.clientX>r.right)onClose();}}}><header className="drawer-head"><h2 id={label}>{title}</h2><button className="icon-button" onClick={onClose} aria-label={`Close ${title}`}>×</button></header><div className="drawer-body">{children}</div></dialog>;
}
