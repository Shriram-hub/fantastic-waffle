import { now } from "../../domain.mjs";
export async function sendResend(
  message,
  config,
  attachment,
  key,
  fetcher = fetch,
) {
  const files=Array.isArray(attachment) ? attachment : attachment ? [attachment] : [];
  let response;
  try {
    response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${config.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify({
        from: config.EMAIL_FROM,
        to: [message.to],
        reply_to: message.replyTo,
        subject: message.subject,
        text: message.body,
        headers: {
          ...(message.unsubscribeUrl ? {"List-Unsubscribe":`<${message.unsubscribeUrl}>`,"List-Unsubscribe-Post":"List-Unsubscribe=One-Click"} : {}),
          ...(message.inReplyTo ? {"In-Reply-To":message.inReplyTo,"References":message.references || message.inReplyTo} : {}),
        },
        ...(files.length
          ? {
              attachments: files.map(file=>({filename:file.name,content:file.base64})),
            }
          : {}),
      }),
    });
  } catch {
    return {
      status: "unknown",
      error:
        "Provider acceptance is unknown after a network failure. Reconcile in Resend before retrying.",
    };
  }
  let data;
  try {
    data = await response.json();
  } catch {
    return {
      status: "unknown",
      error: "Provider response unreadable. Reconcile in Resend.",
    };
  }
  if (!response.ok)
    return {
      status: response.status >= 500 ? "unknown" : "failed",
      error: `Provider returned HTTP ${response.status}. ${response.status >= 500 ? "Reconcile in Resend before retrying." : "Check provider configuration and limits."}`,
    };
  if (!data.id)
    return {
      status: "unknown",
      error: "No provider message ID. Reconcile in Resend.",
    };
  return { status: "accepted", providerId: data.id, at: now() };
}
