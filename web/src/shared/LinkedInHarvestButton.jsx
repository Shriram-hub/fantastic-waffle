import React from 'react';
import {useApp,api} from './workspace.jsx';
import {Button} from './ui.jsx';
export function LinkedInHarvestButton({company,domain='',role=''}) {
  const {data,busy,notify}=useApp();
  async function open(){const tab=window.open('about:blank','_blank');if(!tab){notify('Allow a new tab to open the LinkedIn harvest.',true);return;}tab.opener=null;try{const {url}=await api('/contacts/linkedin-launch',{company,domain,role:role || data.profile.interests?.[0] || '',targetCount:50});tab.location.href=url;}catch(e){tab.close();notify(e.message,true);}}
  return <Button small disabled={busy || data.isDemo || !company?.trim()} onClick={open}>Harvest on LinkedIn (Extension)</Button>;
}
