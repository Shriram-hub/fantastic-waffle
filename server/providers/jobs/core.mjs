import {
  fail,
  id,
  now,
  safeUrl,
  stripHtml,
  text,
  emailValid,
  hash,
} from "../../domain.mjs";
import { remoteJSON } from "../http.mjs";
const mode = (s) =>
  /remote/i.test(s) ? "Remote" : /hybrid/i.test(s) ? "Hybrid" : "On-site";
const slugValid = (s) => /^[a-zA-Z0-9_-]{1,80}$/.test(s);
export function boardList(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  const unique = [...new Set(list.map((s) => text(s, 80)).filter(Boolean))];
  if (unique.length > 10 || unique.some((s) => !slugValid(s)))
    fail(
      "Use up to 10 job-board slugs per provider (letters, numbers, hyphens, underscores).",
    );
  return unique;
}
export async function fetchCoreJobs(source, board = "", fetcher = fetch) {
  if (!["Remotive", "Greenhouse", "Lever", "Lever EU"].includes(source))
    fail("Unsupported job source.");
  if (source !== "Remotive" && !slugValid(board))
    fail("Enter a valid company job-board slug.");
  let jobs = [];
  if (source === "Remotive") {
    const data = await remoteJSON(
      "https://remotive.com/api/remote-jobs",
      {},
      fetcher,
    );
    if (!Array.isArray(data.jobs))
      fail("Remotive returned an unexpected response.", 502);
    jobs = data.jobs.map((j) => ({
      id: `remotive-${j.id}`,
      company: j.company_name,
      companyLogo:safeUrl(j.company_logo),
      title: j.title,
      location: j.candidate_required_location || "Remote",
      workMode: "Remote",
      salary: j.salary || "Not listed",
      tags: j.tags || [],
      category: j.category || "Other",
      type: j.job_type?.replaceAll("_", " ") || "Not listed",
      url: safeUrl(j.url),
      description: stripHtml(j.description),
      publishedAt: j.publication_date || null,
    }));
  }
  if (source === "Greenhouse") {
    const data = await remoteJSON(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`,
      {},
      fetcher,
    );
    if (!Array.isArray(data.jobs))
      fail("Greenhouse returned an unexpected response.", 502);
    jobs = data.jobs.map((j) => ({
      id: `greenhouse-${board}-${j.id}`,
      company: board,
      title: j.title,
      location: j.location?.name || "Not listed",
      workMode: mode(j.location?.name || ""),
      salary: "Not listed",
      tags: (j.departments || []).map((d) => d.name),
      category: j.departments?.[0]?.name || "Other",
      type: "Not listed",
      url: safeUrl(j.absolute_url),
      description: stripHtml(j.content),
      publishedAt: j.first_published || null,
      publishedAtSource: 'first_published',
      updatedAt: j.updated_at || null,
    }));
  }
  if (source === "Lever" || source === 'Lever EU') {
    const data = await remoteJSON(
      `https://${source==='Lever EU'?'api.eu.lever.co':'api.lever.co'}/v0/postings/${encodeURIComponent(board)}?mode=json`,
      {},
      fetcher,
    );
    if (!Array.isArray(data))
      fail("Lever returned an unexpected response.", 502);
    jobs = data.map((j) => ({
      id: `lever-${board}-${j.id}`,
      company: board,
      title: j.text,
      location: j.categories?.location || "Not listed",
      workMode: mode(
        `${j.workplaceType || ""} ${j.categories?.location || ""}`,
      ),
      salary: j.salaryRange
        ? `${j.salaryRange.currency || ""} ${j.salaryRange.min || ""} – ${j.salaryRange.max || ""} / ${j.salaryRange.interval || ""}`
        : "Not listed",
      tags: [j.categories?.team, j.categories?.department].filter(Boolean),
      category: j.categories?.team || "Other",
      type: j.categories?.commitment || "Not listed",
      url: safeUrl(j.applyUrl || j.hostedUrl),
      description: stripHtml(
        [
          j.descriptionPlain || j.description,
          ...(j.lists || []).map((l) => `${l.text} ${l.content}`),
        ].join(" "),
      ),
      publishedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    }));
  }
  return jobs
    .filter((j) => j.title && j.url)
    .slice(0, 1000)
    .map((j) => ({
      ...j,
      company: text(j.company, 150),
      title: text(j.title, 200),
      location: text(j.location, 250),
      description: text(j.description, 30000),
      source,
      board,
      isDemo: false,
      archived: false,
      fetchedAt: now(),
    }));
}

export function extractSchemaOrgJobPostings(html,baseUrl) {
  const jobs=[],seen=new Set(),date=v=>Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
  let visited=0;
  const visit=(node,depth=0)=>{
    if(!node || typeof node!=='object' || depth>12 || ++visited>6000)return;
    if(Array.isArray(node)){node.slice(0,500).forEach(n=>visit(n,depth+1));return;}
    if([].concat(node['@type'] || []).some(t=>/(?:^|[\/#])JobPosting$/.test(t))) {
      let url;try{url=safeUrl(new URL(node.url || node['@id'] || baseUrl,baseUrl).href);}catch{}
      const title=text(node.title,200),company=text(node.hiringOrganization?.name,150);
      if(url && title) {
        const locations=[].concat(node.jobLocation || []).map(l=>typeof l==='string'?l:[l.address?.addressLocality,l.address?.addressRegion,typeof l.address?.addressCountry==='string'?l.address.addressCountry:l.address?.addressCountry?.name].filter(Boolean).join(', ')).filter(Boolean);
        const remote=[].concat(node.jobLocationType || []).includes('TELECOMMUTE'),restrictions=[].concat(node.applicantLocationRequirements || []).map(l=>typeof l==='string'?l:l.name).filter(Boolean),key=hash([url,title,locations]);
        if(!seen.has(key)){seen.add(key);jobs.push({id:`schema-${key.slice(0,32)}`,company:company || 'Company not listed',title,location:locations.join(' · ') || (remote?(restrictions.join(', ') || 'Remote'):'Not listed'),workMode:remote?'Remote':mode(locations.join(' ')),description:text(stripHtml(node.description),30000),url,publishedAt:date(node.datePosted),expiresAt:date(node.validThrough),type:[].concat(node.employmentType || []).join(', ') || 'Not listed',salary:'Not listed',tags:[].concat(node.skills || []).filter(s=>typeof s==='string').slice(0,30),category:text(node.occupationalCategory,150) || 'Other',source:'Career Pages',board:baseUrl,companyLogo:safeUrl(node.hiringOrganization?.logo),locationRestrictions:restrictions,requiresSourceReview:!company,isDemo:false,archived:false,fetchedAt:now()});}
      }
    }
    Object.values(node).filter(v=>v && typeof v==='object').slice(0,500).forEach(n=>visit(n,depth+1));
  };
  for(const block of String(html).slice(0,1500000).matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))try{visit(JSON.parse(block[1]));}catch{}
  return jobs.slice(0,500);
}
