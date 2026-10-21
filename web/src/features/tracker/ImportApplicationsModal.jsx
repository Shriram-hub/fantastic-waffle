import React,{useState} from 'react';
import {useApp,api} from '../../shared/workspace.jsx';
import {Modal,Button} from '../../shared/ui.jsx';
export function ImportApplicationsModal({close}) {
  const {perform,notify}=useApp(),[csv,setCSV]=useState(''),[result,setResult]=useState(null);
  return <Modal title="Restore application backup" onClose={close}><p>Import an Orbit CSV or up to 500 rows with Company, Role, Stage, URL and Notes. Existing application URLs are skipped.</p><form className="stack" onSubmit={e=>{e.preventDefault();perform(async()=>{setResult(await api('/applications/import',{csv}));});}}><input type="file" aria-label="Application CSV" accept=".csv,text/csv" onChange={async e=>{const file=e.target.files[0];if(!file)return;if(file.size>2000000)return notify('Choose a CSV under 2 MB.',true);setCSV(await file.text());}}/><textarea aria-label="Application CSV text" rows="8" value={csv} onChange={e=>setCSV(e.target.value)} placeholder="Company,Role,Stage,URL,Notes"/><Button primary type="submit" disabled={!csv.trim()}>Import applications</Button></form>{result && <div className="notice mt"><strong>{result.imported} imported · {result.skipped} already present</strong>{result.errors.map(error=><p key={error}>{error}</p>)}</div>}</Modal>;
}
