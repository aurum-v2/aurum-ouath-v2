function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomUrlSafeString(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes.buffer)
}

export async function createPkcePair(): Promise<{
  codeVerifier: string
  codeChallenge: string
}> {
  const codeVerifier = randomUrlSafeString(48)
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(codeVerifier),
  )
  return {
    codeVerifier,
    codeChallenge: base64UrlEncode(digest),
  }
}

export function createOAuthState(): string {
  return randomUrlSafeString(24)
}

export function createOAuthNonce(): string {
  return randomUrlSafeString(24)
}
