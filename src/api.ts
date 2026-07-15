import type { ResolvedAurumAuthConfig } from './config'
import { oauthEndpoint } from './config'
import type { OauthStorage } from './storage'
import type { OauthTokens, OauthUserProfile } from './types'

export type OauthTokenResponse = {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  id_token?: string
  scope?: string
}

/** Nest ResponseInterceptor may wrap payloads as `{ success, data }`. */
function unwrapPayload<T>(payload: unknown): T {
  if (
    payload &&
    typeof payload === 'object' &&
    'data' in payload &&
    ('success' in payload || 'message' in payload || 'error' in payload)
  ) {
    return (payload as { data: T }).data
  }
  return payload as T
}

async function postOauthJson<T>(
  config: ResolvedAurumAuthConfig,
  path: string,
  body: Record<string, string>,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(oauthEndpoint(config, path), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      credentials: 'omit',
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'network error'
    throw new Error(
      `OAuth token request failed (${detail}). Prefer a same-origin apiBaseUrl (e.g. /api/v2) with a dev proxy.`,
    )
  }

  const json = (await response.json().catch(() => null)) as unknown
  const data = unwrapPayload<
    T & { error?: string; error_description?: string; message?: string }
  >(json)

  if (!response.ok) {
    const message =
      (data && typeof data === 'object' && 'error_description' in data
        ? data.error_description
        : undefined) ||
      (data && typeof data === 'object' && 'message' in data
        ? (data as { message?: string }).message
        : undefined) ||
      (data && typeof data === 'object' && 'error' in data
        ? String((data as { error?: unknown }).error)
        : undefined) ||
      `OAuth request failed (${response.status})`
    throw new Error(
      typeof message === 'string'
        ? message
        : `OAuth request failed (${response.status})`,
    )
  }
  return data as T
}

export function createOauthApi(
  config: ResolvedAurumAuthConfig,
  storage: OauthStorage,
) {
  async function exchangeAuthorizationCode(input: {
    code: string
    redirectUri: string
    codeVerifier: string
  }): Promise<OauthTokens> {
    const raw = await postOauthJson<OauthTokenResponse>(
      config,
      '/oauth/token',
      {
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: config.clientId,
        code_verifier: input.codeVerifier,
      },
    )
    if (!raw?.access_token) {
      throw new Error('Token response missing access_token')
    }
    const tokens: OauthTokens = {
      accessToken: raw.access_token,
      refreshToken: raw.refresh_token,
      idToken: raw.id_token,
      expiresAt: Date.now() + (raw.expires_in || 900) * 1000,
      scope: raw.scope,
    }
    storage.saveOauthTokens(tokens)
    storage.syncOauthSessionIntoSessionStorage()
    return tokens
  }

  async function fetchOauthUserInfo(
    accessToken?: string,
  ): Promise<OauthUserProfile> {
    const token = accessToken || storage.getOauthTokens()?.accessToken
    if (!token) {
      throw new Error('Missing access token')
    }
    const response = await fetch(oauthEndpoint(config, '/oauth/userinfo'), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      credentials: 'omit',
    })
    const json = (await response.json().catch(() => null)) as unknown
    const data = unwrapPayload<
      OauthUserProfile & { error?: string; error_description?: string }
    >(json)
    if (!response.ok || !data?.sub) {
      throw new Error(
        data?.error_description || data?.error || 'Failed to load userinfo',
      )
    }
    storage.saveOauthUser(data)
    storage.syncOauthSessionIntoSessionStorage()
    return data
  }

  async function revokeOauthToken(): Promise<void> {
    const tokens = storage.getOauthTokens()
    if (!tokens?.accessToken) {
      storage.clearOauthSession()
      return
    }
    try {
      await postOauthJson(config, '/oauth/revoke', {
        token: tokens.accessToken,
        client_id: config.clientId,
        token_type_hint: 'access_token',
      })
    } catch {
      /* best-effort */
    }
    storage.clearOauthSession()
  }

  return {
    exchangeAuthorizationCode,
    fetchOauthUserInfo,
    revokeOauthToken,
  }
}

export type OauthApi = ReturnType<typeof createOauthApi>
