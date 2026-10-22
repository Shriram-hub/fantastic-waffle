export const kanbanColumns=[{id:'Saved',label:'Saved',stages:['Saved','Ready']},{id:'Applied',label:'Applied',stages:['Applied']},{id:'Outreach Sent',label:'Outreach Sent',stages:['Outreach Sent']},{id:'Assessment',label:'OA / Assessment',stages:['Assessment']},{id:'Interview',label:'Interviewing',stages:['Interview','Interview scheduled']},{id:'Offer',label:'Offer',stages:['Offer']},{id:'Archived',label:'Archived',stages:['Archived','Rejected','Withdrawn']}];
export const applicationColumn=application=>kanbanColumns.find(c=>c.stages.includes(application.stage))?.id || 'Saved';
export function applicationTransition(application,column) {
  if(!application || !kanbanColumns.some(c=>c.id===column))throw Error('Choose an application and a valid destination.');
  return applicationColumn(application)===column ? null : {stage:column};
}
