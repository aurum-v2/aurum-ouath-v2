import { createOauthApi, type OauthApi } from './api'
import { buildSignInUrl } from './authorize'
import {
  createCallbackHandler,
  type CallbackHandler,
} from './callback'
import {
  resolveConfig,
  type ResolvedAurumAuthConfig,
} from './config'
import { createOauthPopup, type OauthPopup } from './popup'
import { createOauthStorage, type OauthStorage } from './storage'
import type { AurumAuthConfig, AurumAuthUser, OauthUserProfile } from './types'

export type AurumOauthClient = {
  config: ResolvedAurumAuthConfig
  storage: OauthStorage
  api: OauthApi
  popup: OauthPopup
  callback: CallbackHandler
  buildSignInUrl: (options?: {
    returnPath?: string
    preferredRedirectUri?: string
  }) => Promise<string>
  userFromProfile: (profile?: OauthUserProfile | null) => AurumAuthUser | null
}

export function userFromOauthProfile(
  profile?: OauthUserProfile | null,
): AurumAuthUser | null {
  if (!profile?.sub) return null
  const displayName =
    profile.name?.trim() ||
    profile.preferred_username?.trim() ||
    profile.email?.trim() ||
    'Member'
  return {
    id: profile.sub,
    username: profile.preferred_username,
    email: profile.email,
    firstName: profile.given_name,
    lastName: profile.family_name,
    displayName,
  }
}

/**
 * Create a namespaced Aurum OAuth client for one product/app.
 * Pass a unique `storageKey` per product so sessions do not collide.
 */
export function createAurumOauthClient(
  input: AurumAuthConfig,
): AurumOauthClient {
  const config = resolveConfig(input)
  const storage = createOauthStorage(config)
  const api = createOauthApi(config, storage)
  const popup = createOauthPopup(config, storage)
  const callback = createCallbackHandler(config, storage, api, popup)

  return {
    config,
    storage,
    api,
    popup,
    callback,
    buildSignInUrl: (options) => buildSignInUrl(config, storage, options),
    userFromProfile: userFromOauthProfile,
  }
}
