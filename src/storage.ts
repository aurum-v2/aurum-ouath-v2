import type { ResolvedAurumAuthConfig } from './config'
import type {
  OauthBridgeResult,
  OauthPending,
  OauthTokens,
  OauthUserProfile,
} from './types'

type StorageKeys = {
  pending: string
  pendingLocalPrefix: string
  result: string
  tokens: string
  user: string
  ping: string
}

export function storageKeys(config: ResolvedAurumAuthConfig): StorageKeys {
  const k = config.storageKey
  return {
    pending: `${k}_oauth_pending`,
    pendingLocalPrefix: `${k}_oauth_pending:`,
    result: `${k}_oauth_result`,
    tokens: `${k}_oauth_tokens`,
    user: `${k}_oauth_user`,
    ping: `${k}_oauth_ping`,
  }
}

function readJson<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeJson(storage: Storage, key: string, value: unknown): void {
  storage.setItem(key, JSON.stringify(value))
}

export function createOauthStorage(config: ResolvedAurumAuthConfig) {
  const keys = storageKeys(config)

  function saveOauthPending(pending: OauthPending): void {
    writeJson(sessionStorage, keys.pending, pending)
    writeJson(localStorage, `${keys.pendingLocalPrefix}${pending.state}`, pending)
  }

  function peekOauthPending(): OauthPending | null {
    return readJson<OauthPending>(sessionStorage, keys.pending)
  }

  function consumeOauthPending(state?: string): OauthPending | null {
    const fromSession = readJson<OauthPending>(sessionStorage, keys.pending)
    sessionStorage.removeItem(keys.pending)

    if (state) {
      const localKey = `${keys.pendingLocalPrefix}${state}`
      const fromLocal = readJson<OauthPending>(localStorage, localKey)
      localStorage.removeItem(localKey)
      if (fromLocal) return fromLocal
    }

    if (fromSession) {
      localStorage.removeItem(
        `${keys.pendingLocalPrefix}${fromSession.state}`,
      )
      return fromSession
    }

    return null
  }

  function getOauthPendingByState(state: string): OauthPending | null {
    return (
      readJson<OauthPending>(
        localStorage,
        `${keys.pendingLocalPrefix}${state}`,
      ) ||
      (() => {
        const session = peekOauthPending()
        return session?.state === state ? session : null
      })()
    )
  }

  function publishOauthBridgeResult(result: OauthBridgeResult): void {
    writeJson(localStorage, keys.result, result)
    try {
      const channel = new BroadcastChannel(config.channelName)
      channel.postMessage(result)
      channel.close()
    } catch {
      /* BroadcastChannel unsupported */
    }
  }

  function clearOauthBridgeResult(): void {
    localStorage.removeItem(keys.result)
  }

  function readOauthBridgeResult(): OauthBridgeResult | null {
    return readJson<OauthBridgeResult>(localStorage, keys.result)
  }

  function saveOauthTokens(tokens: OauthTokens): void {
    writeJson(sessionStorage, keys.tokens, tokens)
    writeJson(localStorage, keys.tokens, tokens)
  }

  function getOauthTokens(): OauthTokens | null {
    return (
      readJson<OauthTokens>(sessionStorage, keys.tokens) ||
      readJson<OauthTokens>(localStorage, keys.tokens)
    )
  }

  function saveOauthUser(user: OauthUserProfile): void {
    writeJson(sessionStorage, keys.user, user)
    writeJson(localStorage, keys.user, user)
  }

  function getOauthUser(): OauthUserProfile | null {
    return (
      readJson<OauthUserProfile>(sessionStorage, keys.user) ||
      readJson<OauthUserProfile>(localStorage, keys.user)
    )
  }

  function syncOauthSessionIntoSessionStorage(): void {
    const tokens = readJson<OauthTokens>(localStorage, keys.tokens)
    const user = readJson<OauthUserProfile>(localStorage, keys.user)
    if (tokens) writeJson(sessionStorage, keys.tokens, tokens)
    if (user) writeJson(sessionStorage, keys.user, user)
  }

  function hasOauthSession(): boolean {
    syncOauthSessionIntoSessionStorage()
    return Boolean(getOauthTokens()?.accessToken && getOauthUser()?.sub)
  }

  function clearOauthSession(): void {
    sessionStorage.removeItem(keys.pending)
    sessionStorage.removeItem(keys.tokens)
    sessionStorage.removeItem(keys.user)
    localStorage.removeItem(keys.tokens)
    localStorage.removeItem(keys.user)
    localStorage.removeItem(keys.result)
  }

  function writeOauthPing(payload: {
    at: number
    state?: string
    ok: boolean
  }): void {
    try {
      localStorage.setItem(keys.ping, JSON.stringify(payload))
    } catch {
      /* ignore */
    }
  }

  return {
    keys,
    saveOauthPending,
    peekOauthPending,
    consumeOauthPending,
    getOauthPendingByState,
    publishOauthBridgeResult,
    clearOauthBridgeResult,
    readOauthBridgeResult,
    saveOauthTokens,
    getOauthTokens,
    saveOauthUser,
    getOauthUser,
    syncOauthSessionIntoSessionStorage,
    hasOauthSession,
    clearOauthSession,
    writeOauthPing,
  }
}

export type OauthStorage = ReturnType<typeof createOauthStorage>
