import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { remoteJSON } from "../http.mjs";
import { fail, hash } from "../../domain.mjs";
const b64 = v => Buffer.from(v).toString("base64url");
export function tokenCipher(config) {
  const key = Buffer.from(config.TOKEN_ENCRYPTION_KEY || "", "base64");
  if (key.length !== 32) fail("TOKEN_ENCRYPTION_KEY must contain a base64-encoded 32-byte key.", 503);
  return {
    seal(value) {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv),
        data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      return [iv, cipher.getAuthTag(), data].map(b64).join(".");
    },
    open(value) {
      try {
        const [iv, tag, data] = value.split(".").map(s => Buffer.from(s, "base64url")),
          cipher = createDecipheriv("aes-256-gcm", key, iv);
        cipher.setAuthTag(tag);
        return JSON.parse(Buffer.concat([cipher.update(data), cipher.final()]).toString());
      } catch {
        fail("Stored credentials could not be decrypted. Reconnect the account.", 503);
      }
    }
  };
}
export function oauthConfig(provider, config) {
  const google = provider === "google";
  if (!google && provider !== "microsoft") fail("Unsupported OAuth provider.");
  const clientId = config[google ? "GOOGLE_CLIENT_ID" : "MICROSOFT_CLIENT_ID"],
    clientSecret = config[google ? "GOOGLE_CLIENT_SECRET" : "MICROSOFT_CLIENT_SECRET"];
  if (!clientId || !clientSecret) fail("Configure the provider client ID and secret first.", 503);
  const base = (config.PUBLIC_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
  return {
    clientId,
    clientSecret,
    redirect: `${base}/api/oauth/${provider}/callback`,
    auth: google ? "https://accounts.google.com/o/oauth2/v2/auth" : "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: google ? "https://oauth2.googleapis.com/token" : "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: google ? "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send" : "offline_access User.Read Mail.Read Mail.Send Mail.ReadWrite"
  };
}
export async function startOAuth(provider, store, config) {
  const options = oauthConfig(provider, config),
    cipher = tokenCipher(config),
    state = b64(randomBytes(32)),
    verifier = b64(randomBytes(32));
  await store.db.prepare("DELETE FROM oauth_states WHERE expires<?").run(Date.now());
  await store.db.prepare("INSERT INTO oauth_states(id,secret,expires) VALUES(?,?,?)").run(hash(state), cipher.seal({
    provider,
    verifier
  }), Date.now() + 600000);
  const url = new URL(options.auth);
  url.search = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirect,
    response_type: "code",
    scope: options.scope,
    state,
    code_challenge: b64(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
    ...(provider === "google" ? {
      access_type: "offline",
      prompt: "consent"
    } : {})
  });
  return url.href;
}
export async function completeOAuth(provider, code, state, store, config, fetcher = fetch) {
  const cipher = tokenCipher(config),
    options = oauthConfig(provider, config),
    row = await store.db.prepare("SELECT * FROM oauth_states WHERE id=?").get(hash(state || ""));
  if (!row || row.expires < Date.now()) fail("OAuth state expired. Start the connection again.", 403);
  const saved = cipher.open(row.secret);
  if (saved.provider !== provider) fail("OAuth provider mismatch.", 403);
  await store.db.prepare("DELETE FROM oauth_states WHERE id=?").run(row.id);
  const tokens = await remoteJSON(options.token, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      redirect_uri: options.redirect,
      grant_type: "authorization_code",
      code,
      code_verifier: saved.verifier
    }).toString()
  }, fetcher);
  if (!tokens.access_token || !tokens.refresh_token) fail("Offline access was not granted. Reconnect with consent.", 400);
  const user = await remoteJSON(provider === "google" ? "https://gmail.googleapis.com/gmail/v1/users/me/profile" : "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`
    }
  }, fetcher);
  const email = (user.emailAddress || user.mail || user.userPrincipalName || "").toLowerCase();
  if (!email) fail("The provider did not return a mailbox address.", 502);
  const accountId = hash([provider, email]);
  const existing = await store.db.prepare("SELECT metadata FROM mail_accounts WHERE id=?").get(accountId);
  await store.db.prepare("INSERT INTO mail_accounts(id,provider,email,secret,metadata) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET secret=excluded.secret,metadata=excluded.metadata").run(accountId, provider, email, cipher.seal({
    ...tokens,
    expires_at: Date.now() + tokens.expires_in * 1000,
    notificationSecret: b64(randomBytes(32))
  }), "{}");
  return {
    accountId,
    email,
    provider
  };
}
export async function listAccounts(store) {
  return (await store.db.prepare("SELECT id,provider,email,metadata FROM mail_accounts").all()).map(a => {
    const m = JSON.parse(a.metadata);
    return {
      id: a.id,
      provider: a.provider,
      email: a.email,
      lastSync: m.lastSync || null,
      watchExpires: m.watchExpires || null
    };
  });
}
export async function accessAccount(id, store, config, fetcher = fetch) {
  let row = await store.db.prepare("SELECT * FROM mail_accounts WHERE id=?").get(id);
  if (!row) fail("Connect a mailbox first.", 404);
  const cipher = tokenCipher(config);
  let tokens = cipher.open(row.secret);
  if (tokens.expires_at < Date.now() + 60000) {
    const opts = oauthConfig(row.provider, config);
    const refreshed = await remoteJSON(opts.token, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token
      }).toString()
    }, fetcher);
    if (!refreshed.access_token) fail("Mailbox token refresh failed. Reconnect.", 503);
    tokens = {
      ...tokens,
      ...refreshed,
      refresh_token: refreshed.refresh_token || tokens.refresh_token,
      expires_at: Date.now() + refreshed.expires_in * 1000
    };
    await store.db.prepare("UPDATE mail_accounts SET secret=? WHERE id=?").run(cipher.seal(tokens), id);
  }
  return {
    ...row,
    tokens,
    metadata: JSON.parse(row.metadata)
  };
}
