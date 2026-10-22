import { createContext, useContext } from 'react';
export const WorkspaceContext = createContext(null);
export const useApp = () => useContext(WorkspaceContext);
export const stages = [
  "Saved",
  "Ready",
  "Applied",
  "Outreach Sent",
  "Assessment",
  "Interview",
  "Interview scheduled",
  "Offer",
  "Rejected",
  "Withdrawn",
  "Archived",
];
export const split = (s) =>
    String(s || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  fmt = (value) =>
    value
      ? new Date(value).toLocaleString(undefined, {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";
export async function api(
  path,
  data,
  method = data === undefined ? "GET" : "POST",
) {
  const r = await fetch(`/api${path}`, {
    method,
    ...(data === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }),
  });
  let response;
  try{response=await r.json();}catch{throw Object.assign(Error('The server is starting or temporarily unavailable. Please retry.'),{status:r.status});}
  if (!r.ok) {
    if(r.status===401 && response.code==='AUTH_REQUIRED')window.dispatchEvent(new Event('orbit:auth-required'));
    throw Object.assign(Error(response.error || "Request failed."),{status:r.status,reference:response.reference});
  }
  return response;
}
