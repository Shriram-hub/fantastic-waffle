import {learnEmailPattern} from '../providers/contacts/permutator.mjs';
export async function companyPattern(store,domain) {
  const row=await store.db.prepare('SELECT body FROM companies WHERE domain=?').get(domain);
  return row ? JSON.parse(row.body) : {};
}
export async function observeCompanyEmails(store,company,contacts) {
  const old=await companyPattern(store,company.domain),learned=learnEmailPattern(contacts,company.domain,old.learnedPattern || company.learnedPattern);
  const next={...old,...company,...(learned ? {learnedPattern:learned,pattern:learned.pattern} : {})};
  await store.db.prepare('INSERT INTO companies(domain,name,body) VALUES(?,?,?) ON CONFLICT(domain) DO UPDATE SET body=excluded.body').run(company.domain,company.name || old.name || company.domain,JSON.stringify(next));
  Object.assign(company,next);return next;
}
