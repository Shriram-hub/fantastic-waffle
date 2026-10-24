import {EXTRA_ATS,extraBoardURL} from './zero-key.mjs';
import {taskQueue} from '../../queue.mjs';
import {hash,text,fail} from '../../domain.mjs';
import {boardFromURL,boardURL} from './ats-search.mjs';
import {remoteJSON} from '../http.mjs';
import curated from './boards.json' with {type:'json'};
import {fetchJobs} from './index.mjs';
import {workdayBoard} from './public-ats.mjs';
import {careerURL,crawlCareerPage} from './career-pages.mjs';
import {indiaBoard,INDIA_ATS} from './india-ats.mjs';
const publicATS=['Greenhouse','Lever','Ashby','SmartRecruiters','Workable','Recruitee','Lever EU','Workday','Career Pages',...INDIA_ATS,...EXTRA_ATS];
const validBoard=b=>publicATS.includes(b?.source) && (EXTRA_ATS.includes(b.source)?!!extraBoardURL(b.source,b.slug):INDIA_ATS.includes(b.source)?!!indiaBoard(b.source,b.slug):b.source==='Workday' ? !!workdayBoard(b.slug) : b.source==='Career Pages' ? !!careerURL(b.slug) : /^[\w-]{1,80}$/.test(b.slug));
const curatedKeys=new Set(curated.map(b=>`${b.source}:${b.slug}`));

export async function knownBoards(store) {
  return (await store.db.prepare("SELECT body FROM discovered_boards WHERE status IN ('active','candidate') ORDER BY checked_at,id LIMIT 500").all()).map(r=>JSON.parse(r.body));
}
export async function rememberBoards(jobs,store,queue) {
  const found=new Map();
  for(const job of jobs) for(const url of [job.url,...(job.applyOptions || []).map(o=>o.url)]) {
    const board=boardFromURL(url);
    if(board && !curatedKeys.has(`${board.source}:${board.slug}`)) found.set(`${board.source}:${board.slug}`,{...board,reference:url,company:text(job.company,150)});
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
  if(!validBoard(b)) return {status:'cancelled'};
  const url=b.source==='Greenhouse' ? `https://boards-api.greenhouse.io/v1/boards/${b.slug}/jobs` : b.source==='Lever' ? `https://api.lever.co/v0/postings/${b.slug}?mode=json` : `https://api.ashbyhq.com/posting-api/job-board/${b.slug}`;
  try {
    let valid;
    if(b.source==='Career Pages') {const found=await crawlCareerPage(b.slug);valid=found.jobs.length>0 || found.boards.length>0;await rememberBoards(found.boards.map(board=>({url:boardURL(board)})),store,taskQueue(store));}
    else if(['Greenhouse','Lever','Ashby'].includes(b.source)){const data=await remoteJSON(url,{},fetcher);valid=b.source==='Lever' ? Array.isArray(data) : Array.isArray(data.jobs);}
    else {await fetchJobs(b.source,b.slug,fetcher);valid=true;}
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

export async function listCareerBoards(store) {
  return (await store.db.prepare('SELECT status,body,checked_at FROM discovered_boards ORDER BY checked_at DESC LIMIT 100').all()).map(r=>({...JSON.parse(r.body),status:r.status,checkedAt:Number(r.checked_at)}));
}
export async function addCareerURL(value,store,queue) {
  const url=careerURL(value);if(!url)fail('Enter a public HTTPS company career URL.');
  const board=boardFromURL(url) || {source:'Career Pages',slug:url},key=hash([board.source,board.slug]);
  const old=await store.db.prepare('SELECT status,checked_at FROM discovered_boards WHERE id=?').get(key);
  if(old && ['pending','active'].includes(old.status))return {id:key,board,status:old.status,existing:true};
  const total=await store.db.prepare('SELECT count(*) AS count FROM discovered_boards').get();if(Number(total.count)>=100000 && !old)fail('The monitored employer-directory limit is 100,000.',409);
  const body={...board,reference:url,addedBy:'owner',addedAt:new Date().toISOString()};
  await store.db.prepare("INSERT INTO discovered_boards(id,source,slug,status,body,checked_at) VALUES(?,?,?,'pending',?,?) ON CONFLICT(id) DO UPDATE SET status='pending',body=excluded.body,checked_at=excluded.checked_at").run(key,board.source,board.slug,JSON.stringify(body),Date.now());
  const task=await queue.enqueue('boards.verify',{id:key,board:body},{dedupeKey:`career-url:${key}:${Math.floor(Date.now()/3600000)}`});
  return {id:key,board,status:'pending',task};
}
