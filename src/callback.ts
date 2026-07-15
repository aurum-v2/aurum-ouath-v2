import type { OauthApi } from './api'
import type { ResolvedAurumAuthConfig } from './config'
import type { OauthPopup } from './popup'
import type { OauthStorage } from './storage'
import type { OauthTokens, OauthUserProfile } from './types'

export type ExchangeOk = {
  ok: true
  state: string
  tokens: OauthTokens
  user: OauthUserProfile
  returnPath: string
}

export type ExchangeFail = {
  ok: false
  state?: string
  error: string
  errorCode: string
}

export type ExchangeOutcome = ExchangeOk | ExchangeFail

function profileFromIdToken(idToken?: string): OauthUserProfile | null {
  if (!idToken) return null
  try {
    const payload = idToken.split('.')[1]
    if (!payload) return null
    const json = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    ) as Record<string, unknown>
    if (typeof json.sub !== 'string' || !json.sub) return null
    const given =
      typeof json.given_name === 'string' ? json.given_name : undefined
    const family =
      typeof json.family_name === 'string' ? json.family_name : undefined
    const preferred =
      typeof json.preferred_username === 'string'
        ? json.preferred_username
        : typeof json.username === 'string'
          ? json.username
          : undefined
    const email = typeof json.email === 'string' ? json.email : undefined
    const name =
      typeof json.name === 'string'
        ? json.name
        : [given, family].filter(Boolean).join(' ') || undefined
    return {
      sub: json.sub,
      email,
      preferred_username: preferred,
      name,
      given_name: given,
      family_name: family,
    }
  } catch {
    return null
  }
}

export function createCallbackHandler(
  config: ResolvedAurumAuthConfig,
  storage: OauthStorage,
  api: OauthApi,
  popup: OauthPopup,
) {
  const inflightExchanges = new Map<string, Promise<ExchangeOutcome>>()
  const finishedExchanges = new Map<string, ExchangeOutcome>()

  async function runCodeExchange(input: {
    code: string
    state: string
  }): Promise<ExchangeOutcome> {
    const lockKey = `${input.state}:${input.code}`
    const finished = finishedExchanges.get(lockKey)
    if (finished) return finished

    const existing = inflightExchanges.get(lockKey)
    if (existing) return existing

    const promise = (async (): Promise<ExchangeOutcome> => {
      const pending = storage.getOauthPendingByState(input.state)

      if (!pending) {
        const tokens = storage.getOauthTokens()
        const user = storage.getOauthUser()
        if (tokens?.accessToken && user?.sub) {
          return {
            ok: true,
            state: input.state,
            tokens,
            user,
            returnPath: '/',
          }
        }
        return {
          ok: false,
          state: input.state,
          errorCode: 'expired',
          error: 'OAuth session expired. Please try again.',
        }
      }

      try {
        const tokens = await api.exchangeAuthorizationCode({
          code: input.code,
          redirectUri: pending.redirectUri,
          codeVerifier: pending.codeVerifier,
        })

        let user: OauthUserProfile
        try {
          user = await api.fetchOauthUserInfo(tokens.accessToken)
        } catch {
          const fromId = profileFromIdToken(tokens.idToken)
          if (!fromId) {
            throw new Error('Failed to load user profile')
          }
          storage.saveOauthUser(fromId)
          user = fromId
        }

        storage.consumeOauthPending(input.state)

        const outcome: ExchangeOk = {
          ok: true,
          state: input.state,
          tokens,
          user,
          returnPath: pending.returnPath || '/',
        }

        popup.notifyOauthOpener({
          type: config.messageType,
          ok: true,
          state: input.state,
          exchanged: true,
          tokens,
          user,
        })

        return outcome
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Failed to complete Aurum sign in'
        const outcome: ExchangeFail = {
          ok: false,
          state: input.state,
          errorCode: 'exchange_failed',
          error: message,
        }
        popup.notifyOauthOpener({
          type: config.messageType,
          ok: false,
          error: outcome.errorCode,
          errorDescription: message,
          state: input.state,
        })
        return outcome
      }
    })()

    inflightExchanges.set(lockKey, promise)
    const outcome = await promise
    finishedExchanges.set(lockKey, outcome)
    inflightExchanges.delete(lockKey)
    return outcome
  }

  async function handleCallbackParams(input: {
    code?: string | null
    state?: string | null
    error?: string | null
    errorDescription?: string | null
  }): Promise<ExchangeOutcome> {
    if (input.error) {
      const description =
        input.errorDescription || input.error || 'Sign in was cancelled'
      popup.notifyOauthOpener({
        type: config.messageType,
        ok: false,
        error: input.error,
        errorDescription: description,
        state: input.state || undefined,
      })
      return {
        ok: false,
        state: input.state || undefined,
        errorCode: input.error,
        error: description,
      }
    }

    if (!input.code || !input.state) {
      popup.notifyOauthOpener({
        type: config.messageType,
        ok: false,
        error: 'missing_params',
        errorDescription: 'Missing OAuth callback parameters.',
        state: input.state || undefined,
      })
      return {
        ok: false,
        state: input.state || undefined,
        errorCode: 'missing_params',
        error: 'Missing OAuth callback parameters.',
      }
    }

    return runCodeExchange({ code: input.code, state: input.state })
  }

  return {
    runCodeExchange,
    handleCallbackParams,
    isOauthPopupWindow: popup.isOauthPopupWindow,
  }
}

export type CallbackHandler = ReturnType<typeof createCallbackHandler>
