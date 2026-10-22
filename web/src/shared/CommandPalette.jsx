import React,{useEffect,useId,useRef,useState} from 'react';
import {useApp,api} from './workspace.jsx';
import {commandResults,executeCommand} from './commands.mjs';
import {Modal} from './ui.jsx';
import {Icon} from './Icon.jsx';
export function CommandPalette({close}) {
  const app=useApp(),[query,setQuery]=useState(''),[active,setActive]=useState(0),listId=useId(),results=commandResults(query,app.data),ref=useRef(null);
  useEffect(()=>{ref.current?.focus();},[]);
  useEffect(()=>{document.getElementById(`${listId}-${active}`)?.scrollIntoView({block:'nearest'});},[active]);
  function run(item){if(!item)return;close();Promise.resolve(executeCommand(item,app,{api})).catch(e=>app.notify(e.message,true));}
  return <Modal title="Command center" onClose={close} wide className="command-dialog"><div className="command-search"><Icon name="jobs"/><input ref={ref} role="combobox" aria-label="Search commands, jobs, contacts and applications" aria-autocomplete="list" aria-controls={listId} aria-expanded="true" aria-activedescendant={results[active] ? `${listId}-${active}` : undefined} placeholder="Search your workspace or run a command…" value={query} onChange={e=>{setQuery(e.target.value);setActive(0);}} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setActive(v=>(v+1)%Math.max(1,results.length));}if(e.key==='ArrowUp'){e.preventDefault();setActive(v=>(v-1+results.length)%Math.max(1,results.length));}if(e.key==='Enter'){e.preventDefault();run(results[active]);}}}/><kbd>esc</kbd></div><div className="command-results" role="listbox" id={listId} aria-label="Workspace results">{results.map((item,i)=><button key={`${item.type}:${item.id}`} id={`${listId}-${i}`} role="option" aria-selected={i===active} className={`command-option ${i===active ? 'selected' : ''}`} onMouseMove={()=>setActive(i)} onClick={()=>run(item)}><Icon name={item.icon}/><span><strong>{item.label}</strong><small>{item.hint}</small></span><span className="command-type">{item.type==='command' ? 'Run' : item.type}</span></button>)}{!results.length && <p className="empty">No results. Try a company, role, name or command.</p>}</div><div className="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> select</span><span>{results.length} results</span></div></Modal>;
}
