import React,{useState} from 'react';
import {useApp,api} from './workspace.jsx';
import {Button} from './ui.jsx';
export function QueueNowButton(){const {perform,notify}=useApp(),[busy,setBusy]=useState(false);return <Button small disabled={busy} onClick={()=>perform(async()=>{setBusy(true);try{const r=await api('/queue/flush',{});notify(`${r.due} due tasks · ${r.message}`);}finally{setBusy(false);}})}>{busy ? 'Waking worker…' : 'Process queued tasks now'}</Button>;}
