/**
 * @overlive/twitch-oauth
 *
 * Framework-agnostic Twitch OAuth helpers. Use these in your server-side
 * code to drive the authorize redirect, exchange the code for tokens,
 * refresh expired access tokens, validate tokens, and revoke them.
 *
 * None of these helpers require a network framework — they use the
 * built-in `fetch` and return plain objects.
 */

const ID_BASE = 'https://id.twitch.tv'
const HELIX = 'https://api.twitch.tv/helix'

// ─── Scopes ───────────────────────────────────────────────────────────────────

/**
 * Twitch OAuth scopes. The union covers every scope referenced by overlive's
 * adapters and a handful of commonly useful adjacent ones. Extend as needed.
 */
export type TwitchScope =
  | 'channel:read:redemptions'
  | 'channel:read:subscriptions'
  | 'bits:read'
  | 'channel:moderate'
  | 'channel:read:ads'
  | 'moderator:read:followers'
  | 'moderator:read:chat_messages'
  | 'user:read:chat'
  | 'user:write:chat'
  | 'channel:read:hype_train'
  | 'channel:read:polls'
  | 'channel:read:predictions'
  | 'channel:read:goals'
  | 'channel:manage:redemptions'
  | 'moderator:read:chatters'

/**
 * The full set of scopes the @overlive/twitch adapter relies on to receive
 * every event type it knows how to normalize. Use as the default for a new
 * Twitch account in vspark.
 */
export const DEFAULT_SCOPES: TwitchScope[] = [
  'channel:read:redemptions',
  'channel:read:subscriptions',
  'bits:read',
  'channel:moderate',
  'channel:read:ads',
  'moderator:read:followers',
  'moderator:read:chat_messages',
  'user:read:chat',
  'user:write:chat',
]

// ─── Authorize URL ────────────────────────────────────────────────────────────

export interface BuildAuthorizeUrlParams {
  clientId: string
  redirectUri: string
  scopes: readonly TwitchScope[]
  /** CSRF state — generate per-request and verify on callback. */
  state: string
  /**
   * If `true`, force the consent screen even when the user has already
   * granted these scopes. Useful for the "Reconnect" flow.
   */
  forceVerify?: boolean
}

/**
 * Build the authorize URL the user should be redirected to. Uses the
 * authorization-code flow (response_type=code), so the callback handler
 * must exchange the code for tokens server-side via `exchangeCode`.
 */
export function buildAuthorizeUrl(params: BuildAuthorizeUrlParams): string {
  const url = new URL(`${ID_BASE}/oauth2/authorize`)
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', params.scopes.join(' '))
  url.searchParams.set('state', params.state)
  if (params.forceVerify) url.searchParams.set('force_verify', 'true')
  return url.toString()
}

// ─── Token shapes ─────────────────────────────────────────────────────────────

export interface TwitchTokens {
  accessToken: string
  refreshToken: string
  /** Seconds until the access token expires from the moment of issuance. */
  expiresIn: number
  /** Granted scopes (may be a subset of requested scopes). */
  scope: TwitchScope[]
  tokenType: 'bearer'
}

// ─── Code exchange ────────────────────────────────────────────────────────────

export interface ExchangeCodeParams {
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
}

/**
 * Exchange an authorization code for an access + refresh token pair.
 * Call this from your `/auth/twitch/callback` handler.
 */
export async function exchangeCode(params: ExchangeCodeParams): Promise<TwitchTokens> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
  })
  const res = await fetch(`${ID_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Twitch token exchange failed: ${res.status} ${res.statusText} — ${text}`)
  }
  return parseTokenResponse(await res.json())
}

// ─── Token refresh ────────────────────────────────────────────────────────────

export interface RefreshAccessTokenParams {
  clientId: string
  clientSecret: string
  refreshToken: string
}

/**
 * Use a refresh token to mint a new access token. Twitch may rotate the
 * refresh token in the response — always persist whichever refresh token
 * comes back, not the one you sent in.
 *
 * Throws if Twitch returns 400/401 (which usually means the refresh token
 * was revoked or expired). Callers should treat that as "needs reauth".
 */
export async function refreshAccessToken(params: RefreshAccessTokenParams): Promise<TwitchTokens> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
  })
  const res = await fetch(`${ID_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Twitch token refresh failed: ${res.status} ${res.statusText} — ${text}`)
  }
  return parseTokenResponse(await res.json())
}

// ─── Validate ─────────────────────────────────────────────────────────────────

export interface ValidateResult {
  clientId: string
  login: string
  userId: string
  scopes: TwitchScope[]
  /** Seconds until the access token expires. */
  expiresIn: number
}

/**
 * Validate an access token via Twitch's `/oauth2/validate` endpoint. Returns
 * the granted scopes, the authorized user's identity, and time-to-expiry —
 * useful for warning the user when scopes are missing for the events they
 * care about, and for proactively refreshing before expiry.
 *
 * Throws if Twitch returns non-200 (token is invalid/expired).
 */
export async function validateAccessToken(accessToken: string): Promise<ValidateResult> {
  const res = await fetch(`${ID_BASE}/oauth2/validate`, {
    headers: { Authorization: `OAuth ${accessToken}` },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Twitch token validate failed: ${res.status} ${res.statusText} — ${text}`)
  }
  const json = (await res.json()) as Record<string, unknown>
  return {
    clientId: String(json['client_id'] ?? ''),
    login: String(json['login'] ?? ''),
    userId: String(json['user_id'] ?? ''),
    scopes: ((json['scopes'] as string[] | undefined) ?? []) as TwitchScope[],
    expiresIn: Number(json['expires_in'] ?? 0),
  }
}

// ─── Revoke ───────────────────────────────────────────────────────────────────

export interface RevokeAccessTokenParams {
  clientId: string
  accessToken: string
}

/**
 * Revoke an access token, terminating the user's authorization. Call this
 * when deleting an account from vspark so no dangling Twitch authorizations
 * remain. Idempotent — Twitch returns 200 even if the token was already
 * invalid.
 */
export async function revokeAccessToken(params: RevokeAccessTokenParams): Promise<void> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    token: params.accessToken,
  })
  const res = await fetch(`${ID_BASE}/oauth2/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Twitch token revoke failed: ${res.status} ${res.statusText} — ${text}`)
  }
}

// ─── User identity ────────────────────────────────────────────────────────────

export interface AuthorizedUser {
  id: string
  login: string
  displayName: string
  profileImageUrl: string
}

/**
 * Fetch the authorized user's identity via Helix. Use this after exchanging
 * the code to label the new account and persist its broadcasterId/login.
 */
export async function fetchAuthorizedUser(
  accessToken: string,
  clientId: string,
): Promise<AuthorizedUser> {
  const res = await fetch(`${HELIX}/users`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': clientId,
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Twitch /users failed: ${res.status} ${res.statusText} — ${text}`)
  }
  const json = (await res.json()) as { data?: Array<Record<string, unknown>> }
  const user = json.data?.[0]
  if (!user) throw new Error('Twitch /users returned no user data')
  return {
    id: String(user['id'] ?? ''),
    login: String(user['login'] ?? ''),
    displayName: String(user['display_name'] ?? ''),
    profileImageUrl: String(user['profile_image_url'] ?? ''),
  }
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function parseTokenResponse(json: unknown): TwitchTokens {
  const o = json as Record<string, unknown>
  return {
    accessToken: String(o['access_token'] ?? ''),
    refreshToken: String(o['refresh_token'] ?? ''),
    expiresIn: Number(o['expires_in'] ?? 0),
    scope: ((o['scope'] as string[] | undefined) ?? []) as TwitchScope[],
    tokenType: 'bearer',
  }
}
