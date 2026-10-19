import {hash,text} from '../../domain.mjs';
import {boardFromURL} from './ats-search.mjs';
import {remoteJSON} from '../http.mjs';
import curated from './boards.json' with {type:'json'};

export async function knownBoards(store) {
  return (await store.db.prepare("SELECT body FROM discovered_boards WHERE status='active' ORDER BY id LIMIT 300").all()).map(r=>JSON.parse(r.body));
}
export async function rememberBoards(jobs,store,queue) {
  const found=new Map();
  for(const job of jobs) for(const url of [job.url,...(job.applyOptions || []).map(o=>o.url)]) {
    const board=boardFromURL(url);
    if(board && !curated.some(b=>b.source===board.source && b.slug===board.slug)) found.set(`${board.source}:${board.slug}`,{...board,reference:url,company:text(job.company,150)});
  }
  for(const board of [...found.values()].slice(0,10)) {
    const key=hash([board.source,board.slug]),old=await store.db.prepare('SELECT checked_at FROM discovered_boards WHERE id=?').get(key);
    if(old && old.checked_at>Date.now()-7*86400000) continue;
    await store.db.prepare("INSERT INTO discovered_boards(id,source,slug,status,body,checked_at) VALUES(?,?,?,'pending',?,?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at")
      .run(key,board.source,board.slug,JSON.stringify(board),Date.now());
    await queue.enqueue('boards.verify',{id:key,board},{dedupeKey:`board-${key}-${Math.floor(Date.now()/(7*86400000))}`});
  }
}
export async function verifyBoard(task,store,fetcher=fetch) {
  const b=task.payload.board;
  if(!['Greenhouse','Lever','Ashby'].includes(b?.source) || !/^[\w-]{1,80}$/.test(b.slug)) return {status:'cancelled'};
  const url=b.source==='Greenhouse' ? `https://boards-api.greenhouse.io/v1/boards/${b.slug}/jobs` : b.source==='Lever' ? `https://api.lever.co/v0/postings/${b.slug}?mode=json` : `https://api.ashbyhq.com/posting-api/job-board/${b.slug}`;
  try {
    const data=await remoteJSON(url,{},fetcher),valid=b.source==='Lever' ? Array.isArray(data) : Array.isArray(data.jobs);
    if(!valid) throw Error('Invalid board');
    // Source links supply the company association. Guessing a slug alone is not
    // evidence that an unrelated company's similarly named board belongs here.
    await store.db.prepare("UPDATE discovered_boards SET status='active',checked_at=? WHERE id=?").run(Date.now(),task.payload.id);
    return {count:1};
  } catch {
    await store.db.prepare("UPDATE discovered_boards SET status='unavailable',checked_at=? WHERE id=?").run(Date.now(),task.payload.id);
    return {count:0};
  }
}
