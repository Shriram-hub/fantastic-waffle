# Google sign-in for your private workspace

Orbit uses Google OpenID Connect for login and keeps its session in a secure,
HttpOnly cookie. The owner identity and hashed, revocable sessions persist in
the private database. This release protects one personal workspace; it does not
offer public registrations into a shared candidate profile.

## Existing Render deployment

Reuse the server environment variables already used for Gmail:

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Google Cloud **Web application** OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Matching client secret, server only |
| `TOKEN_ENCRYPTION_KEY` | Existing base64-encoded 32-byte key; keep it unchanged |
| `WORKSPACE_PASSWORD` | Existing owner password and initial Google-link verification |
| `PUBLIC_BASE_URL` | `https://orbit-a1jt.onrender.com` |

The authorized Google redirect URI remains:

`https://orbit-a1jt.onrender.com/api/oauth/google/callback`

No second callback or Gemini/Hunter/SerpApi key is needed. If Google Cloud still
shows a different callback, add the exact URI under **Google Auth Platform →
Clients → your Web client → Authorized redirect URIs**. In Testing mode, your
Google account must be in **Audience → Test users**.

1. Open Orbit and choose **Use workspace password**.
2. Unlock with your existing password.
3. Click **Link Google sign-in** in the top bar and choose your Google account.
4. Next time, use **Continue with Google** on the sign-in page.

The first link requires an authenticated password session before and after
Google consent. Unrelated Google accounts cannot claim or read the workspace.
Login requests only `openid email profile`. Connecting Gmail in **Connections**
is a separate authorization step for inbox scanning/sending.

## Database upgrade

New local SQLite workspaces create the authentication tables automatically.
Self-hosted Postgres with `DATABASE_AUTO_MIGRATE=true` adds them from
`server/db/runtime.sql`. Existing Supabase deployments using the restricted
`orbit_app` role and disabled auto-migration should apply
`server/db/private-auth.sql` once as the administrator before deployment. The
tables have RLS and server-role-only grants; they are not public browser APIs.
The hosted Orbit database has this migration applied.

Sessions expire after seven days. Signing out revokes the database session.
Changing `WORKSPACE_PASSWORD` also invalidates all existing login sessions.
Career-data resets preserve the linked owner and sessions. Explicit HTTP Basic
API clients remain supported; browsers use the sign-in screen and cookies.

## Diagnosing a loading failure

The recovery page offers **Try again** and an error reference. Unexpected server
failures log that reference, operation and source frames without request bodies,
tokens, provider responses or candidate data. Operators can use
`POST /api/internal/workspace-check` with the existing `X-Orbit-Scheduler` secret
to exercise the same bootstrap path and return only health, counts and setup
booleans. This check does not enqueue work or call paid providers.
