import type { ResolvedAurumAuthConfig } from './config'
import { buildSignInUrl } from './authorize'
import type { OauthStorage } from './storage'
import type {
  AurumOauthPopupResult,
  OauthBridgeResult,
  OauthTokens,
  OauthUserProfile,
} from './types'

const POPUP_FEATURES =
  'width=500,height=640,menubar=no,toolbar=no,location=yes,status=no,resizable=yes,scrollbars=yes'

function popupFeatures(): string {
  const width = 500
  const height = 640
  const left = Math.max(
    0,
    Math.round(window.screenX + (window.outerWidth - width) / 2),
  )
  const top = Math.max(
    0,
    Math.round(window.screenY + (window.outerHeight - height) / 2),
  )
  return `${POPUP_FEATURES},left=${left},top=${top}`
}

export function createOauthPopup(
  config: ResolvedAurumAuthConfig,
  storage: OauthStorage,
) {
  function isAurumOauthPopupResult(
    data: unknown,
  ): data is AurumOauthPopupResult {
    if (!data || typeof data !== 'object') return false
    const msg = data as { type?: unknown }
    return msg.type === config.messageType
  }

  function applyOauthSessionPayload(input: {
    tokens?: OauthTokens
    user?: OauthUserProfile
  }): boolean {
    if (input.tokens?.accessToken) {
      storage.saveOauthTokens(input.tokens)
    }
    if (input.user?.sub) {
      storage.saveOauthUser(input.user)
    }
    storage.syncOauthSessionIntoSessionStorage()
    return storage.hasOauthSession()
  }

  function notifyOauthOpener(result: AurumOauthPopupResult): void {
    const bridge: OauthBridgeResult = result.ok
      ? {
          ok: true,
          state: result.state,
          at: Date.now(),
          tokens: result.tokens,
          user: result.user,
        }
      : {
          ok: false,
          state: result.state,
          error: result.errorDescription || result.error,
          at: Date.now(),
        }
    storage.publishOauthBridgeResult(bridge)

    try {
      const channel = new BroadcastChannel(config.channelName)
      channel.postMessage(result)
      channel.close()
    } catch {
      /* ignore */
    }

    if (window.opener && !window.opener.closed) {
      try {
        window.opener.postMessage(result, window.location.origin)
      } catch {
        /* opener may be severed after cross-origin hops */
      }
    }

    storage.writeOauthPing({
      at: Date.now(),
      state: result.state,
      ok: result.ok,
    })
  }

  function isOauthPopupWindow(): boolean {
    try {
      if (window.opener && !window.opener.closed) return true
    } catch {
      /* ignore */
    }
    return window.name.startsWith(config.popupNamePrefix)
  }

  function sessionReady(): boolean {
    storage.syncOauthSessionIntoSessionStorage()
    return storage.hasOauthSession()
  }

  async function openOauthPopup(options?: {
    returnPath?: string
    preferredRedirectUri?: string
    onSessionMaybeReady?: () => void
  }): Promise<{ mode: 'popup' } | { mode: 'redirect' }> {
    storage.clearOauthBridgeResult()

    const authorizeUrl = await buildSignInUrl(config, storage, options)
    const pending = storage.peekOauthPending()
    if (!pending) {
      throw new Error('Failed to prepare OAuth request')
    }

    const popupName = `${config.popupNamePrefix}${pending.state.slice(0, 12)}`
    const popup = window.open(authorizeUrl, popupName, popupFeatures())
    if (!popup) {
      window.location.assign(authorizeUrl)
      return { mode: 'redirect' }
    }

    try {
      popup.focus()
    } catch {
      /* ignore */
    }

    return new Promise((resolve, reject) => {
      let settled = false
      let channel: BroadcastChannel | null = null
      let closedAt: number | null = null

      const cleanup = () => {
        window.removeEventListener('message', onMessage)
        window.removeEventListener('storage', onStorage)
        window.removeEventListener('focus', onFocus)
        window.clearInterval(tick)
        window.clearTimeout(failSafeTimer)
        try {
          channel?.close()
        } catch {
          /* ignore */
        }
      }

      const finish = (value: { mode: 'popup' } | Error) => {
        if (settled) return
        settled = true
        cleanup()
        if (value instanceof Error) {
          reject(value)
          return
        }
        try {
          if (!popup.closed) popup.close()
        } catch {
          /* ignore */
        }
        resolve(value)
      }

      const trySucceed = (): boolean => {
        if (!sessionReady()) return false
        options?.onSessionMaybeReady?.()
        finish({ mode: 'popup' })
        return true
      }

      const acceptBridge = (
        bridge: OauthBridgeResult | AurumOauthPopupResult,
      ) => {
        const state = 'state' in bridge ? bridge.state : undefined
        if (state && state !== pending.state) return

        if (bridge.ok) {
          const tokens =
            'tokens' in bridge
              ? (bridge.tokens as OauthTokens | undefined)
              : undefined
          const user =
            'user' in bridge
              ? (bridge.user as OauthUserProfile | undefined)
              : undefined
          if (tokens || user) {
            applyOauthSessionPayload({ tokens, user })
          }
          options?.onSessionMaybeReady?.()

          if (trySucceed()) return
          let attempts = 0
          const waitId = window.setInterval(() => {
            if (settled) {
              window.clearInterval(waitId)
              return
            }
            attempts += 1
            if (trySucceed() || attempts >= 50) {
              window.clearInterval(waitId)
              if (!settled && !sessionReady()) {
                finish(
                  new Error('Sign in did not complete. Please try again.'),
                )
              }
            }
          }, 100)
          return
        }

        const message =
          'error' in bridge && typeof bridge.error === 'string'
            ? bridge.error
            : 'Sign in was cancelled'
        window.setTimeout(() => {
          if (settled) return
          if (sessionReady()) {
            trySucceed()
            return
          }
          finish(new Error(message))
        }, 1500)
      }

      const onMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return
        if (!isAurumOauthPopupResult(event.data)) return
        acceptBridge(event.data)
      }

      const onStorage = (event: StorageEvent) => {
        const { keys } = storage
        if (
          event.key === keys.result ||
          event.key === keys.tokens ||
          event.key === keys.user ||
          event.key === keys.ping
        ) {
          options?.onSessionMaybeReady?.()
          if (event.key === keys.result && event.newValue) {
            try {
              acceptBridge(JSON.parse(event.newValue) as OauthBridgeResult)
              return
            } catch {
              /* fall through */
            }
          }
          trySucceed()
        }
      }

      const onFocus = () => {
        options?.onSessionMaybeReady?.()
        trySucceed()
      }

      try {
        channel = new BroadcastChannel(config.channelName)
        channel.onmessage = (event: MessageEvent) => {
          acceptBridge(event.data as AurumOauthPopupResult)
        }
      } catch {
        channel = null
      }

      window.addEventListener('message', onMessage)
      window.addEventListener('storage', onStorage)
      window.addEventListener('focus', onFocus)

      const tick = window.setInterval(() => {
        if (settled) return

        options?.onSessionMaybeReady?.()
        if (trySucceed()) return

        if (popup.closed) {
          if (closedAt == null) closedAt = Date.now()
          if (Date.now() - closedAt < 12000) return
          const bridge = storage.readOauthBridgeResult()
          if (bridge) {
            acceptBridge(bridge)
            return
          }
          if (sessionReady()) {
            finish({ mode: 'popup' })
            return
          }
          finish(new Error('Sign in window was closed'))
        }
      }, 100)

      const failSafeTimer = window.setTimeout(
        () => {
          if (!settled) {
            if (trySucceed()) return
            finish(new Error('Sign in timed out. Please try again.'))
          }
        },
        5 * 60 * 1000,
      )
    })
  }

  return {
    isAurumOauthPopupResult,
    applyOauthSessionPayload,
    notifyOauthOpener,
    isOauthPopupWindow,
    openOauthPopup,
  }
}

export type OauthPopup = ReturnType<typeof createOauthPopup>
