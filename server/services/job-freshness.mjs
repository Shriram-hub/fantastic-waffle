// Refreshing, re-indexing and source update timestamps never make a role new.
export function jobFreshness(job,clock=Date.now()) {
  const raw=job.postedAt || job.publishedAt,date=raw ? Date.parse(raw) : NaN,age=clock-date;
  const reliable=Number.isFinite(date) && age>=0 && job.publishedAtIsUpdate!==true && (job.source!=='Greenhouse' || job.publishedAtSource==='first_published');
  const firstMover=reliable && age<86400000;
  return {firstMover,firstMoverScore:firstMover?Math.max(1,Math.round(100-age/864000)):0,postedAgeHours:reliable?Math.floor(age/3600000):null};
}
