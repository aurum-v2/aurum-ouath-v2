# `@aurum-v2/oauth-v2`

Reusable **Continue with Aurum** (OAuth PKCE) package: config-driven storage, popup sign-in, React context, and hooks.

## Install (GitHub Packages)

```tsx
import { AurumAuthProvider, useAurumAuth } from '@aurum-v2/oauth-v2'

root.render(
  <AurumAuthProvider
    config={{
      clientId: import.meta.env.VITE_AURUM_OAUTH_CLIENT_ID,
      apiBaseUrl: import.meta.env.VITE_API_BASE_URL, // e.g. /api/v2
      storageKey: 'aup_ev', // unique per product
      redirectPath: '/oauth/callback',
      scopes: 'openid profile email',
    }}
  >
    <App />
  </AurumAuthProvider>,
)
```

```tsx
function Header() {
  const {
    user,
    isAuthenticated,
    loading,
    signingIn,
    signInWithPopup,
    signOut,
    signInHref,
  } = useAurumAuth()

  if (loading) return null

  if (!isAuthenticated) {
    return (
      <button
        type="button"
        disabled={signingIn}
        onClick={() => void signInWithPopup()}
      >
        Continue with Aurum
      </button>
      // or: <a href={signInHref()}>Continue with Aurum</a>
    )
  }

  return (
    <div>
      <span>{user?.displayName}</span>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  )
}
```

## OAuth callback route (app owns the page)

```tsx
import { useEffect, useState } from 'react'
import { useAurumAuth } from '@aurum-v2/oauth-v2'

export function OauthCallbackPage() {
  const { client } = useAurumAuth()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    void client.callback
      .handleCallbackParams({
        code: params.get('code'),
        state: params.get('state'),
        error: params.get('error'),
        errorDescription: params.get('error_description'),
      })
      .then((outcome) => {
        if (!outcome.ok) {
          setError(outcome.error)
          return
        }
        if (client.callback.isOauthPopupWindow()) {
          window.setTimeout(() => window.close(), 400)
          return
        }
        window.location.replace(outcome.returnPath)
      })
  }, [client])

  if (error) return <p>{error}</p>
  return <p>Completing Sign in with Aurum…</p>
}
```

## Config

| Field | Required | Notes |
|---|---|---|
| `clientId` | yes | SSO client id |
| `apiBaseUrl` | yes | e.g. `/api/v2` or `https://api.example.com/api/v2` |
| `storageKey` | yes | Namespace for tokens (`aup_ev`, `checkout`, …) |
| `redirectPath` | no | Default `/oauth/callback` |
| `scopes` | no | Default `openid profile email` |
| `promptConsent` | no | Default `true` |

Use a **different `storageKey` per product** so sessions never overwrite each other.

## Imperative (no React)

```ts
import { createAurumOauthClient } from '@aurum-v2/oauth-v2'

const client = createAurumOauthClient({
  clientId: '...',
  apiBaseUrl: '/api/v2',
  storageKey: 'my_app',
})

const url = await client.buildSignInUrl({ returnPath: '/' })
```
