import React from 'react';

export function ContactEmail({contact}){
  if(!contact.emailInferred)return <strong className="mono">{contact.email || 'Email lookup needed'}</strong>;
  const candidates=[...new Set([contact.email,...(contact.alternateEmails || [])].filter(Boolean))].slice(0,contact.emailPattern?.pattern?2:3);
  return <div><strong className="hint">No exact email found</strong>{candidates.length>0 && <details><summary>{candidates.length} unverified naming candidates</summary>{candidates.map(email=><p key={email} className="mono small">{email}</p>)}<p className="hint">These are naming suggestions. MX routing does not verify a mailbox.</p></details>}</div>;
}
