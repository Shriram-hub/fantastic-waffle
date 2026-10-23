import {Readable,Transform} from 'node:stream';
import {createGunzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {pipeline} from 'node:stream/promises';
import {boardFromURL,boardURL} from './ats-search.mjs';
import {hash,text,fail} from '../../domain.mjs';
function csvLine(line){const cells=[];let value='',quoted=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quoted && line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(c===',' && !quoted){cells.push(value);value='';}else value+=c;}cells.push(value);return cells;}
export const DIRECTORY_SOURCES=[
  {id:'cc0-ats',url:'https://raw.githubusercontent.com/moonie0201/ats-directory/main/companies.jsonl.gz',format:'jsonl',license:'CC0-1.0',reference:'https://github.com/moonie0201/ats-directory'},
  ...['keka','darwinbox','workday','greenhouse','lever','ashby','smartrecruiters','workable','recruitee'].map(provider=>({id:`community-${provider}`,provider,url:`https://raw.githubusercontent.com/Continuity1/d1_ats_scrapers/main/ats-companies/${provider}.csv`,format:'csv',license:'MIT',reference:'https://github.com/Continuity1/d1_ats_scrapers'})),
];
const providers={greenhouse:'Greenhouse',lever:'Lever',ashby:'Ashby',recruitee:'Recruitee',smartrecruiters:'SmartRecruiters',workable:'Workable'};
export function directoryBoard(row,source) {
  if(row.status && row.status!=='ok')return null;
  let board=row.url?boardFromURL(row.url):null;
  if(!board && providers[row.provider] && /^[\w-]{1,80}$/.test(row.slug || ''))board={source:row.provider==='lever' && row.region==='eu'?'Lever EU':providers[row.provider],slug:row.slug};
  if(!board)return null;
  return {...board,company:text(row.name,150),reference:row.url || boardURL(board),directoryReference:source.reference,license:source.license,directoryId:source.id,importedAt:new Date().toISOString()};
}
async function writeBoards(rows,store) {
  const unique=[...new Map(rows.map(b=>[hash([b.source,b.slug]),b])).entries()];
  if(!unique.length)return 0;
  await store.db.prepare(`INSERT INTO discovered_boards(id,source,slug,status,body,checked_at) VALUES ${unique.map(()=>"(?,?,?,'candidate',?,0)").join(',')} ON CONFLICT(id) DO UPDATE SET body=excluded.body,status=CASE WHEN discovered_boards.status='active' THEN 'active' ELSE 'candidate' END`).run(...unique.flatMap(([key,b])=>[key,b.source,b.slug,JSON.stringify(b)]));
  return unique.length;
}
export async function syncDirectories(store,queue,fetcher=fetch,taskId) {
  let imported=0,seen=0;const failures=[];
  for(const source of DIRECTORY_SOURCES)try {
    const response=await fetcher(source.url,{headers:{Accept:'application/octet-stream','User-Agent':'Veloce/1.0'},redirect:'error',signal:AbortSignal.timeout(120000)});
    if(!response.ok){await response.body?.cancel();throw Error(`HTTP ${response.status}`);}
    let bytes=0,lineBytes=0,buffer=[];const guard=new Transform({transform(chunk,_encoding,callback){bytes+=chunk.length;for(const byte of chunk){lineBytes=byte===10?0:lineBytes+1;if(lineBytes>15000)return callback(Error('Directory row exceeded its byte budget.'));}if(bytes>80000000)callback(Error('Directory download exceeded its byte budget.'));else callback(null,chunk);}});
    const input=Readable.fromWeb(response.body),completion=pipeline(...[input,...(source.url.endsWith('.gz')?[createGunzip()]:[]),guard]);completion.catch(()=>{});
    const lines=createInterface({input:guard,crlfDelay:Infinity});let headers;
    for await(const line of lines) {
      if(line.length>15000)continue;
      let row;
      try{if(source.format==='jsonl')row=JSON.parse(line);else {const values=csvLine(line);if(!headers){headers=values;continue;}row=Object.fromEntries(headers.map((h,i)=>[h,values[i] || '']));}}catch{continue;}
      seen++;const board=directoryBoard(row,source);if(board)buffer.push(board);
      if(buffer.length>=100){imported+=await writeBoards(buffer,store);buffer=[];}
      if(seen>200000)fail('Directory row safety limit reached.',422);
    }
    await completion;
    imported+=await writeBoards(buffer,store);if(taskId)await queue.log(taskId,`${source.id}: directory rows imported.`);
  }catch(error){failures.push(`${source.id}: ${/^HTTP \d+$/.test(error.message)?error.message:'Source temporarily unavailable.'}`);}
  const total=Number((await store.db.prepare('SELECT count(*) AS count FROM discovered_boards').get()).count),result={imported,scanned:seen,companies:total,failures,licenses:['CC0-1.0','MIT']};
  await store.db.prepare("INSERT INTO directory_sync(id,status,body,updated_at) VALUES('directories',?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,body=excluded.body,updated_at=excluded.updated_at").run(imported?'completed':'unavailable',JSON.stringify(result),Date.now());return result;
}
