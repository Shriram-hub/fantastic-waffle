import { createContext, useContext } from 'react';
export const WorkspaceContext = createContext(null);
export const useApp = () => useContext(WorkspaceContext);
export const stages = [
  "Saved",
  "Ready",
  "Applied",
  "Assessment",
  "Interview",
  "Interview scheduled",
  "Offer",
  "Rejected",
  "Withdrawn",
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
  const response = await r.json();
  if (!r.ok) throw Error(response.error || "Request failed.");
  return response;
}
