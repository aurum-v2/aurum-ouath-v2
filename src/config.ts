import type { AurumAuthConfig } from './types'

export type ResolvedAurumAuthConfig = {
  clientId: string
  apiBaseUrl: string
  storageKey: string
  redirectPath: string
  scopes: string
  promptConsent: boolean
  messageType: string
  channelName: string
  popupNamePrefix: string
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, '')
}

function sanitizeStorageKey(key: string): string {
  const cleaned = key.trim().replace(/[^a-zA-Z0-9_-]/g, '_')
  if (!cleaned) {
    throw new Error('@mjornales15/oauth-v2: storageKey must be a non-empty string')
  }
  return cleaned
}

export function resolveConfig(config: AurumAuthConfig): ResolvedAurumAuthConfig {
  const storageKey = sanitizeStorageKey(config.storageKey)
  if (!config.clientId?.trim()) {
    throw new Error('@mjornales15/oauth-v2: clientId is required')
  }
  if (!config.apiBaseUrl?.trim()) {
    throw new Error('@mjornales15/oauth-v2: apiBaseUrl is required')
  }

  return {
    clientId: config.clientId.trim(),
    apiBaseUrl: trimTrailingSlash(config.apiBaseUrl.trim()),
    storageKey,
    redirectPath: config.redirectPath?.trim() || '/oauth/callback',
    scopes: config.scopes?.trim() || 'openid profile email',
    promptConsent: config.promptConsent !== false,
    messageType: `${storageKey}_oauth_result`,
    channelName: `${storageKey}-oauth`,
    popupNamePrefix: `${storageKey}_oauth_`,
  }
}

export function resolveRedirectUri(
  config: ResolvedAurumAuthConfig,
  preferred?: string,
): string {
  if (typeof window === 'undefined') {
    return preferred || config.redirectPath
  }

  const fromOrigin = config.redirectPath.startsWith('http')
    ? config.redirectPath
    : `${window.location.origin}${
        config.redirectPath.startsWith('/')
          ? config.redirectPath
          : `/${config.redirectPath}`
      }`

  if (preferred) {
    try {
      const preferredUrl = new URL(preferred)
      if (preferredUrl.origin === window.location.origin) {
        return preferred
      }
    } catch {
      /* ignore invalid preferred */
    }
  }

  return fromOrigin
}

export function oauthEndpoint(
  config: ResolvedAurumAuthConfig,
  path: string,
): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${config.apiBaseUrl}${normalized}`
}

export function absoluteAuthorizeUrl(
  config: ResolvedAurumAuthConfig,
): URL {
  const path = oauthEndpoint(config, '/oauth/authorize')
  return new URL(path, typeof window !== 'undefined' ? window.location.origin : undefined)
}
