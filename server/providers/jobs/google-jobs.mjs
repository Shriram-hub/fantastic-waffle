import {remoteJSON} from '../http.mjs';
import {fail,hash,now,safeUrl,stripHtml,text} from '../../domain.mjs';

// These are optional metered aggregators. Public ATS feeds continue independently
// when a key, quota, or search consent is absent.
export async function fetchGoogleJobs(query,config={},fetcher=fetch) {
  const provider=config.GOOGLE_JOBS_PROVIDER || (config.JSEARCH_API_KEY ? 'JSearch' : 'SerpApi');
  const location=text(config.SEARCH_LOCATION || '',120),country=text(config.SEARCH_COUNTRY || '',2).toLowerCase();
  let data,rows;
  if(provider==='JSearch' && config.JSEARCH_API_KEY) {
    const url=new URL('https://jsearch.p.rapidapi.com/search');
    url.search=new URLSearchParams({query:`${text(query,150)}${location ? ` in ${location}` : ''}`,page:'1',num_pages:'1',date_posted:'week',...(country ? {country} : {})});
    data=await remoteJSON(url.href,{headers:{'X-RapidAPI-Key':config.JSEARCH_API_KEY,'X-RapidAPI-Host':'jsearch.p.rapidapi.com'}},fetcher,45000);
    if(!Array.isArray(data.data)) fail('JSearch returned an unexpected response.',502);
    rows=data.data.map(j=>({key:j.job_id,company:j.employer_name,title:j.job_title,location:[j.job_city,j.job_state,j.job_country].filter(Boolean).join(', '),remote:j.job_is_remote,type:j.job_employment_type,description:j.job_description,publishedAt:j.job_posted_at_datetime_utc,salary:j.job_min_salary ? `${j.job_min_salary} – ${j.job_max_salary || j.job_min_salary} ${j.job_salary_currency || ''} (${j.job_salary_period || 'provider range'})` : null,options:[{title:j.job_publisher,link:j.job_apply_link},...(j.apply_options || []).map(o=>({title:o.publisher,link:o.apply_link}))],companyWebsite:j.employer_website}));
  } else if(provider==='SerpApi' && config.SERPAPI_API_KEY) {
    const url=new URL('https://serpapi.com/search.json');
    url.search=new URLSearchParams({engine:'google_jobs',q:text(query,150),api_key:config.SERPAPI_API_KEY,...(location ? {location} : {}),...(country ? {gl:country} : {})});
    data=await remoteJSON(url.href,{},fetcher,45000);
    if(data.error) fail('Google Jobs search is unavailable. Check SerpApi access or quota.',502);
    if(!Array.isArray(data.jobs_results)) fail('Google Jobs returned an unexpected response.',502);
    rows=data.jobs_results.map(j=>({key:j.job_id,company:j.company_name,title:j.title,location:j.location,remote:j.detected_extensions?.work_from_home,type:j.detected_extensions?.schedule_type,description:j.description,publishedAt:null,postedLabel:j.detected_extensions?.posted_at,salary:j.detected_extensions?.salary,options:j.apply_options || []}));
  } else fail('Configure an optional JSearch or SerpApi key. Free public job sources still work.',503);
  return rows.map(j=>{
    const applyOptions=[...new Map(j.options.map(o=>({publisher:text(o.title || 'Company careers',80),url:safeUrl(o.link)})).filter(o=>o.url).map(o=>[o.url,o])).values()].slice(0,8);
    // Preserve the publisher's application link; never manufacture an apply URL.
    return {id:`google-jobs-${hash([provider,j.key || j.title,j.company]).slice(0,32)}`,company:text(j.company,150),title:text(j.title,200),location:text(j.location || 'Not listed',200),workMode:j.remote ? 'Remote' : /remote/i.test(j.location || '') ? 'Remote' : 'On-site',type:j.type || 'Not listed',salary:j.salary || 'Not listed',description:text(stripHtml(j.description),30000),source:'Google Jobs',aggregator:provider,applyOptions,url:applyOptions[0]?.url || '',tags:[],board:query,category:'Other',publishedAt:j.publishedAt || null,postedLabel:j.postedLabel || null,fetchedAt:now(),isDemo:false,archived:false};
  }).filter(j=>j.company && j.title && j.url);
}
