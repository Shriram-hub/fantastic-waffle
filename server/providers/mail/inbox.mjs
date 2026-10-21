import { accessAccount } from "./oauth.mjs";
import {mailJSON as remoteJSON} from './http.mjs';
import { stripHtml, fail, now } from "../../domain.mjs";
const decode = s => Buffer.from(s || "", "base64url").toString("utf8");
const googleText = p => [p.mimeType === "text/plain" ? decode(p.body?.data) : p.mimeType === "text/html" ? stripHtml(decode(p.body?.data)) : "", ...(p.parts || []).map(googleText)].filter(Boolean).join("\n");
export async function syncMailbox(accountId, store, config, fetcher = fetch) {
  const a = await accessAccount(accountId, store, config, fetcher),
    headers = {
      Authorization: `Bearer ${a.tokens.access_token}`,
      Prefer: 'IdType="ImmutableId"'
    },
    messages = [];
  let next = {
    ...a.metadata
  };
  if (a.provider === "google") {
    let ids = [];
    let url;
    if (!next.historyId && !next.bootstrapHistoryId) {
      const bootstrap = await remoteJSON("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers
      }, fetcher);
      next.bootstrapHistoryId = bootstrap.historyId;
    }
    if (next.historyId) url = `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${encodeURIComponent(next.historyId)}&historyTypes=messageAdded&maxResults=100${next.pageToken ? `&pageToken=${encodeURIComponent(next.pageToken)}` : ""}`;else url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=newer_than%3A30d${next.pageToken ? `&pageToken=${encodeURIComponent(next.pageToken)}` : ""}`;
    let data;
    try {
      data = await remoteJSON(url, {
        headers
      }, fetcher);
    } catch (e) {
      if (e.message.includes("404") && next.historyId) {
        delete next.historyId;
        delete next.pageToken;
        next.needsBootstrap = true;
        await store.db.prepare("UPDATE mail_accounts SET metadata=? WHERE id=?").run(JSON.stringify(next), accountId);
        return {
          messages: [],
          more: true
        };
      }
      throw e;
    }
    if (next.historyId) ids = [...new Set((data.history || []).flatMap(h => (h.messagesAdded || []).map(m => m.message.id)))];else ids = (data.messages || []).map(m => m.id);
    for (const id of ids) {
      const key = `${accountId}:${id}`;
      if (await store.db.prepare("SELECT id FROM inbox_messages WHERE id=?").get(key)) continue;
      const m = await remoteJSON(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, {
          headers
        }, fetcher),
        head = name => m.payload?.headers?.find(h => h.name.toLowerCase() === name)?.value || "";
      messages.push({
        id: key,
        providerId: id,
        provider: "google",
        accountId,
        threadId: m.threadId,
        from: head("from"),
        subject: head("subject"),
        body: googleText(m.payload || {}).slice(0, 30000),
        internetMessageId: head("message-id"),
        receivedAt: new Date(Number(m.internalDate) || Date.now()).toISOString(),
        outbound: (m.labelIds || []).includes("SENT")
      });
    }
    if (data.nextPageToken) next.pageToken = data.nextPageToken;else {
      delete next.pageToken;
      const profile = await remoteJSON("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers
      }, fetcher);
      next.historyId = data.historyId || next.bootstrapHistoryId || profile.historyId;
      delete next.bootstrapHistoryId;
    }
  } else {
    const initial = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=id,subject,from,body,receivedDateTime,conversationId,internetMessageId&$top=50";
    const url = next.deltaLink || initial;
    if (!url.startsWith("https://graph.microsoft.com/v1.0/")) fail("Invalid stored Graph delta URL.", 500);
    const data = await remoteJSON(url, {
      headers
    }, fetcher);
    for (const m of data.value || []) {
      if (m["@removed"]) continue;
      const key = `${accountId}:${m.id}`;
      if (await store.db.prepare("SELECT id FROM inbox_messages WHERE id=?").get(key)) continue;
      messages.push({
        id: key,
        providerId: m.id,
        provider: "microsoft",
        accountId,
        threadId: m.conversationId,
        from: m.from?.emailAddress?.address || "",
        subject: m.subject || "",
        body: (m.body?.contentType === "html" ? stripHtml(m.body.content) : m.body?.content || "").slice(0, 30000),
        internetMessageId: m.internetMessageId,
        receivedAt: m.receivedDateTime || now(),
        outbound: false
      });
    }
    next.deltaLink = data["@odata.nextLink"] || data["@odata.deltaLink"] || next.deltaLink;
    next.pageToken = data["@odata.nextLink"] ? "next" : null;
  }
  for (const m of messages) await store.db.prepare("INSERT OR IGNORE INTO inbox_messages(id,provider,account_id,body) VALUES(?,?,?,?)").run(m.id, m.provider, accountId, JSON.stringify(m));
  next.lastSync = now();
  await store.db.prepare("UPDATE mail_accounts SET metadata=? WHERE id=?").run(JSON.stringify(next), accountId);
  return {
    messages,
    more: Boolean(next.pageToken)
  };
}
export async function watchMailbox(accountId, store, config, fetcher = fetch) {
  const a = await accessAccount(accountId, store, config, fetcher),
    headers = {
      Authorization: `Bearer ${a.tokens.access_token}`,
      "Content-Type": "application/json"
    };
  let metadata = {
    ...a.metadata
  };
  if (a.provider === "google") {
    if (!config.GOOGLE_PUBSUB_TOPIC) fail("Set GOOGLE_PUBSUB_TOPIC first.", 503);
    const watch = await remoteJSON("https://gmail.googleapis.com/gmail/v1/users/me/watch", {
      method: "POST",
      headers,
      body: JSON.stringify({
        topicName: config.GOOGLE_PUBSUB_TOPIC,
        labelIds: ["INBOX"],
        labelFilterBehavior: "include"
      })
    }, fetcher);
    metadata.watchExpires = new Date(Number(watch.expiration)).toISOString();
    metadata.bootstrapHistoryId ||= watch.historyId;
  } else {
    if (!config.PUBLIC_BASE_URL?.startsWith("https://")) fail("A public HTTPS base URL is required for Graph webhooks.", 503);
    const payload = {
      changeType: "created",
      notificationUrl: `${config.PUBLIC_BASE_URL}/api/webhooks/microsoft`,
      lifecycleNotificationUrl: `${config.PUBLIC_BASE_URL}/api/webhooks/microsoft`,
      resource: "me/mailFolders('inbox')/messages",
      expirationDateTime: new Date(Date.now() + 24 * 3600000).toISOString(),
      clientState: a.tokens.notificationSecret
    };
    const response = await remoteJSON(metadata.subscriptionId ? `https://graph.microsoft.com/v1.0/subscriptions/${metadata.subscriptionId}` : "https://graph.microsoft.com/v1.0/subscriptions", {
      method: metadata.subscriptionId ? "PATCH" : "POST",
      headers,
      body: JSON.stringify(metadata.subscriptionId ? {
        expirationDateTime: payload.expirationDateTime
      } : payload)
    }, fetcher);
    metadata.subscriptionId = response.id || metadata.subscriptionId;
    metadata.watchExpires = response.expirationDateTime;
  }
  await store.db.prepare("UPDATE mail_accounts SET metadata=? WHERE id=?").run(JSON.stringify(metadata), accountId);
  return {
    watchExpires: metadata.watchExpires
  };
}
