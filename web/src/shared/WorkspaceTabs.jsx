import React,{useRef} from 'react';
import {workspaceFor} from './navigation.mjs';
export function WorkspaceTabs({route,go}){
  const workspace=workspaceFor(route),ref=useRef(null);return <div ref={ref} className="workspace-tabs" role="tablist" aria-label={`${workspace.title} tools`} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const i=workspace.tabs.findIndex(([key])=>key===route),next=event.key==='Home'?0:event.key==='End'?workspace.tabs.length-1:(i+(event.key==='ArrowRight'?1:-1)+workspace.tabs.length)%workspace.tabs.length;go(workspace.tabs[next][0]);requestAnimationFrame(()=>ref.current?.querySelectorAll('[role="tab"]')[next]?.focus());}}>{workspace.tabs.map(([key,label])=><button role="tab" key={key} aria-selected={key===route} tabIndex={key===route?0:-1} onClick={()=>go(key)}>{label}</button>)}</div>;
}
