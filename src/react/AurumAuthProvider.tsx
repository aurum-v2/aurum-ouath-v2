import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  createAurumOauthClient,
  type AurumOauthClient,
} from '../client'
import type {
  AurumAuthConfig,
  AurumAuthUser,
  AurumOauthPopupResult,
} from '../types'

export type AurumAuthContextValue = {
  user: AurumAuthUser | null
  loading: boolean
  isAuthenticated: boolean
  signingIn: boolean
  clientId: string
  storageKey: string
  refresh: () => Promise<void>
  signInWithPopup: (returnPath?: string) => Promise<void>
  beginSignIn: (returnPath?: string) => Promise<string>
  /** Relative path to your app's OAuth start route (default `/oauth/start`). */
  signInHref: (returnPath?: string, startPath?: string) => string
  signOut: () => Promise<void>
  /** Low-level client for callback pages / advanced use */
  client: AurumOauthClient
}

const AurumAuthContext = createContext<AurumAuthContextValue | null>(null)

export type AurumAuthProviderProps = {
  config: AurumAuthConfig
  /**
   * Absolute redirect URI override (must match current origin when set).
   * Useful when env provides a registered redirect URI.
   */
  preferredRedirectUri?: string
  children: ReactNode
}

export function AurumAuthProvider({
  config,
  preferredRedirectUri,
  children,
}: AurumAuthProviderProps) {
  const client = useMemo(
    () =>
      createAurumOauthClient({
        clientId: config.clientId,
        apiBaseUrl: config.apiBaseUrl,
        storageKey: config.storageKey,
        redirectPath: config.redirectPath,
        scopes: config.scopes,
        promptConsent: config.promptConsent,
      }),
    [
      config.clientId,
      config.apiBaseUrl,
      config.storageKey,
      config.redirectPath,
      config.scopes,
      config.promptConsent,
    ],
  )
  const preferredRef = useRef(preferredRedirectUri)
  preferredRef.current = preferredRedirectUri

  const [user, setUser] = useState<AurumAuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [signingIn, setSigningIn] = useState(false)

  const applyOauthUser = useCallback((): AurumAuthUser | null => {
    client.storage.syncOauthSessionIntoSessionStorage()
    const oauthUser = client.userFromProfile(client.storage.getOauthUser())
    if (!oauthUser) return null
    setUser({ ...oauthUser })
    return oauthUser
  }, [client])

  const refresh = useCallback(
    async (opts?: { soft?: boolean }) => {
      if (!opts?.soft) setLoading(true)
      try {
        const oauthUser = client.userFromProfile(client.storage.getOauthUser())
        if (oauthUser) {
          setUser({ ...oauthUser })
        }

        const tokens = client.storage.getOauthTokens()
        if (tokens?.accessToken) {
          if (tokens.expiresAt > Date.now()) {
            try {
              await client.api.fetchOauthUserInfo(tokens.accessToken)
              applyOauthUser()
              return
            } catch {
              if (applyOauthUser()) return
              if (!opts?.soft) {
                client.storage.clearOauthSession()
                setUser(null)
              }
              return
            }
          }
          if (applyOauthUser()) return
        }

        if (!oauthUser && !opts?.soft) {
          setUser(null)
        }
      } finally {
        if (!opts?.soft) setLoading(false)
      }
    },
    [applyOauthUser, client],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const { storage, popup, config: resolved } = client
    const { keys } = storage

    const applyIfReady = () => {
      if (storage.hasOauthSession()) applyOauthUser()
    }

    const onStorage = (event: StorageEvent) => {
      if (
        event.key === keys.tokens ||
        event.key === keys.user ||
        event.key === keys.result ||
        event.key === keys.ping
      ) {
        if (event.key === keys.result && event.newValue) {
          try {
            const bridge = JSON.parse(event.newValue) as {
              ok?: boolean
              tokens?: Parameters<typeof popup.applyOauthSessionPayload>[0]['tokens']
              user?: Parameters<typeof popup.applyOauthSessionPayload>[0]['user']
            }
            if (bridge.ok) {
              popup.applyOauthSessionPayload({
                tokens: bridge.tokens,
                user: bridge.user,
              })
            }
          } catch {
            /* ignore */
          }
        }
        applyIfReady()
      }
    }

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data as AurumOauthPopupResult | null
      if (!popup.isAurumOauthPopupResult(data)) return
      if (data.ok) {
        popup.applyOauthSessionPayload({
          tokens: data.tokens,
          user: data.user,
        })
        applyOauthUser()
      }
    }

    let channel: BroadcastChannel | null = null
    try {
      channel = new BroadcastChannel(resolved.channelName)
      channel.onmessage = (event: MessageEvent) => {
        const data = event.data as AurumOauthPopupResult
        if (data?.ok) {
          popup.applyOauthSessionPayload({
            tokens: data.tokens,
            user: data.user,
          })
        }
        applyIfReady()
      }
    } catch {
      channel = null
    }

    window.addEventListener('storage', onStorage)
    window.addEventListener('message', onMessage)
    window.addEventListener('focus', applyIfReady)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('message', onMessage)
      window.removeEventListener('focus', applyIfReady)
      try {
        channel?.close()
      } catch {
        /* ignore */
      }
    }
  }, [applyOauthUser, client])

  const beginSignIn = useCallback(
    async (returnPath?: string) => {
      return client.buildSignInUrl({
        returnPath,
        preferredRedirectUri: preferredRef.current,
      })
    },
    [client],
  )

  const signInWithPopup = useCallback(
    async (returnPath?: string) => {
      setSigningIn(true)

      const pollId = window.setInterval(() => {
        if (client.storage.hasOauthSession()) applyOauthUser()
      }, 100)

      try {
        await client.popup.openOauthPopup({
          returnPath,
          preferredRedirectUri: preferredRef.current,
          onSessionMaybeReady: () => {
            if (client.storage.hasOauthSession()) applyOauthUser()
          },
        })

        const started = Date.now()
        while (Date.now() - started < 8000) {
          client.storage.syncOauthSessionIntoSessionStorage()
          if (applyOauthUser()) break
          await new Promise((r) => window.setTimeout(r, 100))
        }

        if (!applyOauthUser()) {
          throw new Error('Sign in did not complete. Please try again.')
        }
      } finally {
        window.clearInterval(pollId)
        setSigningIn(false)
      }
    },
    [applyOauthUser, client],
  )

  const signInHref = useCallback(
    (returnPath?: string, startPath = '/oauth/start') => {
      const path =
        returnPath ??
        (typeof window !== 'undefined'
          ? `${window.location.pathname}${window.location.search}`
          : '/')
      const base = startPath.startsWith('/') ? startPath : `/${startPath}`
      return `${base}?return=${encodeURIComponent(path)}`
    },
    [],
  )

  const signOut = useCallback(async () => {
    await client.api.revokeOauthToken()
    setUser(null)
  }, [client])

  const value = useMemo<AurumAuthContextValue>(
    () => ({
      user,
      loading,
      isAuthenticated: Boolean(user),
      signingIn,
      clientId: client.config.clientId,
      storageKey: client.config.storageKey,
      refresh: () => refresh(),
      signInWithPopup,
      beginSignIn,
      signInHref,
      signOut,
      client,
    }),
    [
      user,
      loading,
      signingIn,
      client,
      refresh,
      signInWithPopup,
      beginSignIn,
      signInHref,
      signOut,
    ],
  )

  return (
    <AurumAuthContext.Provider value={value}>
      {children}
    </AurumAuthContext.Provider>
  )
}

export function useAurumAuth(): AurumAuthContextValue {
  const ctx = useContext(AurumAuthContext)
  if (!ctx) {
    throw new Error('useAurumAuth must be used within AurumAuthProvider')
  }
  return ctx
}
