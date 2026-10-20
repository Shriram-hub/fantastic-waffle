import { accessAccount } from "./oauth.mjs";
import { remoteJSON } from "../http.mjs";
import { fail, hash } from "../../domain.mjs";
const encode = (v) => Buffer.from(v).toString("base64");
export function mimeMessage(message, sender, attachment) {
  for (const v of [
    message.to,
    sender,
    message.subject,
    message.inReplyTo || "",
    message.references || "",
    message.unsubscribeUrl || "",
  ])
    if (/[\r\n]/.test(v)) fail("Mail headers cannot contain newlines.");
  const boundary = `orbit-${hash([message.to, message.subject, message.body,message.messageKey || ""]).slice(0, 20)}`;
  const messageId = `<orbit-${hash([message.to, message.subject, message.body,message.messageKey || ""]).slice(0, 32)}@${sender.split("@")[1]}>`;
  const lines = [
    `From: ${sender}`,
    `To: ${message.to}`,
    `Subject: =?UTF-8?B?${encode(message.subject)}?=`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    ...(message.unsubscribeUrl ? [`List-Unsubscribe: <${message.unsubscribeUrl}>`, "List-Unsubscribe-Post: List-Unsubscribe=One-Click"] : []),
    ...(message.inReplyTo
      ? [
          `In-Reply-To: ${message.inReplyTo}`,
          `References: ${message.references || message.inReplyTo}`,
        ]
      : []),
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    encode(message.body)
      .match(/.{1,76}/g)
      .join("\r\n"),
  ];
  for(const file of (Array.isArray(attachment) ? attachment : attachment ? [attachment] : []))
    lines.push(
      `--${boundary}`,
      "Content-Type: application/octet-stream",
      `Content-Disposition: attachment; filename="${file.name.replace(/["\r\n/\\]/g, "_")}"`,
      "Content-Transfer-Encoding: base64",
      "",
      file.base64.match(/.{1,76}/g).join("\r\n"),
    );
  lines.push(`--${boundary}--`, "");
  return {
    raw: Buffer.from(lines.join("\r\n")).toString("base64url"),
    messageId,
  };
}
export async function sendNative(
  message,
  accountId,
  store,
  config,
  attachment,
  fetcher = fetch,
  beforeSend = () => {},
) {
  const a = await accessAccount(accountId, store, config, fetcher),
    headers = {
      Authorization: `Bearer ${a.tokens.access_token}`,
      "Content-Type": "application/json",
      Prefer: 'IdType="ImmutableId"',
    };
  if (a.provider === "google") {
    const mime = mimeMessage(message, a.email, attachment);
    await beforeSend({ internetMessageId: mime.messageId });
    let r;
    try {
      r = await fetcher(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          method: "POST",
          headers,
          signal: AbortSignal.timeout(20000),
          body: JSON.stringify({
            raw: mime.raw,
            ...(message.threadId ? { threadId: message.threadId } : {}),
          }),
        },
      );
    } catch {
      return {
        status: "unknown",
        error: "Gmail acceptance is unknown. Reconcile in the sent folder.",
      };
    }
    if (!r.ok)
      return {
        status: r.status >= 500 ? "unknown" : "failed",
        error: `Gmail returned HTTP ${r.status}.`,
      };
    let data;
    try {
      data = await r.json();
    } catch {
      return { status: "unknown", error: "Unreadable Gmail response." };
    }
    return data.id
      ? {
          status: "accepted",
          providerId: data.id,
          threadId: data.threadId,
          internetMessageId: mime.messageId,
        }
      : { status: "unknown", error: "Gmail did not return a message ID." };
  }
  const mime = mimeMessage(message,a.email,attachment);
  const draftUrl = message.replyToProviderId
    ? `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(message.replyToProviderId)}/createReply`
    : "https://graph.microsoft.com/v1.0/me/messages";
  const draft = await remoteJSON(draftUrl,{method:"POST",headers:{...headers,"Content-Type":"text/plain"},body:Buffer.from(mime.raw,"base64url").toString("base64")},fetcher);
  if (!draft.id) fail("Outlook did not return a draft ID.", 502);
  await beforeSend({
    providerId: draft.id,
    threadId: draft.conversationId,
    internetMessageId: draft.internetMessageId,
  });
  try {
    const r = await fetcher(
      `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(draft.id)}/send`,
      { method: "POST", headers, signal: AbortSignal.timeout(20000) },
    );
    return r.ok
      ? {
          status: "accepted",
          providerId: draft.id,
          threadId: draft.conversationId,
          internetMessageId: draft.internetMessageId,
        }
      : {
          status: r.status >= 500 ? "unknown" : "failed",
          error: `Outlook returned HTTP ${r.status}.`,
        };
  } catch {
    return {
      status: "unknown",
      error:
        "Outlook acceptance is unknown. Reconcile the stored draft/message ID.",
    };
  }
}
