export type AurumAuthConfig = {
  /** OAuth client_id registered in Aurum SSO admin */
  clientId: string
  /**
   * API base for OAuth endpoints (`/oauth/authorize`, `/oauth/token`, …).
   * Prefer same-origin path in local Vite (e.g. `/api/v2`).
   */
  apiBaseUrl: string
  /**
   * Namespace for localStorage / sessionStorage / BroadcastChannel.
   * Use a unique value per product (e.g. `aup_ev`, `checkout`).
   */
  storageKey: string
  /**
   * Path (or absolute URI) for OAuth redirect_uri.
   * Default: `/oauth/callback` resolved against `window.location.origin`.
   */
  redirectPath?: string
  /** Space-separated scopes. Default: `openid profile email` */
  scopes?: string
  /** Always ask for consent in authorize. Default: true */
  promptConsent?: boolean
}

export type OauthPending = {
  state: string
  nonce: string
  codeVerifier: string
  returnPath: string
  redirectUri: string
}

export type OauthTokens = {
  accessToken: string
  refreshToken?: string
  idToken?: string
  expiresAt: number
  scope?: string
}

export type OauthUserProfile = {
  sub: string
  email?: string
  preferred_username?: string
  name?: string
  given_name?: string
  family_name?: string
}

export type AurumAuthUser = {
  id: string
  username?: string
  email?: string
  firstName?: string
  lastName?: string
  displayName: string
}

export type OauthBridgeResult =
  | {
      ok: true
      state: string
      at: number
      tokens?: OauthTokens
      user?: OauthUserProfile
    }
  | { ok: false; state?: string; error: string; at: number }

export type AurumOauthPopupResult =
  | {
      type: string
      ok: true
      state: string
      exchanged: true
      tokens?: OauthTokens
      user?: OauthUserProfile
    }
  | {
      type: string
      ok: false
      error: string
      errorDescription?: string
      state?: string
    }
