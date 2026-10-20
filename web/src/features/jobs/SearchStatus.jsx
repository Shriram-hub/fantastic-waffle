import React from 'react';
import {useApp,fmt} from '../../shared/workspace.jsx';
import {Icon} from '../../shared/Icon.jsx';
export function SearchStatus() {
  const {search}=useApp();
  if(!search) return null;
  const run=search.run,progress=run?.details,busy=['running','queued'].includes(run?.status),percent=progress?.sourcesTotal ? Math.min(100,Math.round(progress.sourcesChecked/progress.sourcesTotal*100)) : 0;
  return <section className={`search-status ${busy ? 'is-searching' : ''}`} aria-live="polite"><div className="search-status-title"><span className={`status-dot ${busy ? 'pulse' : ''}`}/><strong>{!search.preferences.enabled ? 'Automatic search paused' : busy ? 'Finding opportunities for you' : run?.status==='failed' ? 'Search interrupted — select Find new jobs to retry' : run?.status==='completed' ? 'Your search is up to date' : 'Preparing your live job feed'}</strong><span>{busy && progress ? `${progress.sourcesChecked}/${progress.sourcesTotal || '…'} sources checked` : run ? `Last search ${fmt(run.updated_at)}` : 'Search starts in the background'}</span></div>{busy && <progress max="100" value={percent} aria-label="Source search progress"/>}<div className="search-stat-row"><span><strong>{search.indexed.toLocaleString()}</strong> live jobs indexed</span>{search.plan.personalized && <span><strong>{(search.strongMatches ?? search.matches ?? 0).toLocaleString()}</strong> strong fits · {(search.adjacentMatches || 0).toLocaleString()} adjacent roles</span>}<span><strong>{progress?.scanned?.toLocaleString() || '0'}</strong> listings checked this search</span>{search.schedule && <span><Icon name="clock" size={15}/>Next search {fmt(search.schedule.next_run)}</span>}</div></section>;
}
