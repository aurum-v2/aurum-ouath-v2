import type { ResolvedAurumAuthConfig } from './config'
import { absoluteAuthorizeUrl, resolveRedirectUri } from './config'
import {
  createOAuthNonce,
  createOAuthState,
  createPkcePair,
} from './pkce'
import type { OauthStorage } from './storage'

export async function buildSignInUrl(
  config: ResolvedAurumAuthConfig,
  storage: OauthStorage,
  options?: {
    returnPath?: string
    preferredRedirectUri?: string
  },
): Promise<string> {
  const returnPath =
    options?.returnPath ??
    (typeof window !== 'undefined'
      ? `${window.location.pathname}${window.location.search}`
      : '/')

  const redirectUri = resolveRedirectUri(config, options?.preferredRedirectUri)
  const { codeVerifier, codeChallenge } = await createPkcePair()
  const state = createOAuthState()
  const nonce = createOAuthNonce()

  storage.saveOauthPending({
    state,
    nonce,
    codeVerifier,
    returnPath: returnPath.startsWith('/') ? returnPath : `/${returnPath}`,
    redirectUri,
  })

  const url = absoluteAuthorizeUrl(config)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', config.scopes)
  url.searchParams.set('state', state)
  url.searchParams.set('nonce', nonce)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  if (config.promptConsent) {
    url.searchParams.set('prompt', 'consent')
  }
  return url.toString()
}
