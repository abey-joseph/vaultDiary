// Google Identity Services token client. Scope: drive.file only. Tokens live in memory only.

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const GSI_SRC = 'https://accounts.google.com/gsi/client'

interface TokenResponse {
  access_token?: string
  expires_in?: number | string
  scope?: string
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void
}

interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string
    scope: string
    callback: (r: TokenResponse) => void
    error_callback?: (e: { type?: string; message?: string }) => void
  }): TokenClient
  revoke(token: string, done?: () => void): void
  hasGrantedAllScopes(r: TokenResponse, scope: string): boolean
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } }
  }
}

export interface TokenSource {
  getToken(): string | null
  markExpired(): void
}

let scriptPromise: Promise<GoogleOAuth2> | null = null

function loadGsi(): Promise<GoogleOAuth2> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google.accounts.oauth2)
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<GoogleOAuth2>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GSI_SRC
    script.async = true
    script.onload = () => {
      const oauth2 = window.google?.accounts?.oauth2
      if (oauth2) resolve(oauth2)
      else reject(new Error('Google sign-in failed to initialise.'))
    }
    script.onerror = () => {
      scriptPromise = null
      script.remove()
      reject(new Error('Could not load Google sign-in. Are you online?'))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

export class GoogleAuth implements TokenSource {
  private token: string | null = null
  private expiresAt = 0
  private client: TokenClient | null = null
  private oauth2: GoogleOAuth2 | null = null
  private pending: { resolve: () => void; reject: (e: Error) => void } | null = null
  private expiryTimer: ReturnType<typeof setTimeout> | null = null
  private readonly clientId: string
  private readonly onChange: () => void

  constructor(clientId: string, onChange: () => void) {
    this.clientId = clientId
    this.onChange = onChange
  }

  /** Load Google's script early so a later tap can open the popup synchronously. */
  async preload(): Promise<void> {
    if (this.client) return
    this.oauth2 = await loadGsi()
    this.client = this.oauth2.initTokenClient({
      client_id: this.clientId,
      scope: DRIVE_SCOPE,
      callback: (r) => this.handle(r),
      error_callback: (e) => {
        const message =
          e.type === 'popup_closed'
            ? 'The Google window was closed before signing in.'
            : e.type === 'popup_failed_to_open'
              ? 'The Google sign-in window was blocked. Allow pop-ups for this site and try again.'
              : e.message || 'Google sign-in failed.'
        this.pending?.reject(new Error(message))
        this.pending = null
      },
    })
  }

  get ready(): boolean {
    return this.client !== null
  }

  hasToken(): boolean {
    return this.getToken() !== null
  }

  getToken(): string | null {
    if (this.token && Date.now() < this.expiresAt) return this.token
    return null
  }

  markExpired(): void {
    if (!this.token) return
    this.token = null
    this.onChange()
  }

  /**
   * Must run inside a user gesture (tap/click) so the popup isn't blocked.
   * `prompt: ''` skips the consent screen when the user already agreed.
   */
  signIn(firstTime = false): Promise<void> {
    if (!this.client) return Promise.reject(new Error('Google sign-in is still loading.'))
    this.pending?.reject(new Error('Superseded'))
    const promise = new Promise<void>((resolve, reject) => {
      this.pending = { resolve, reject }
    })
    this.client.requestAccessToken({ prompt: firstTime ? 'consent' : '' })
    return promise
  }

  private handle(r: TokenResponse) {
    const pending = this.pending
    this.pending = null
    if (r.error || !r.access_token) {
      pending?.reject(new Error(r.error_description || r.error || 'Google sign-in failed.'))
      return
    }
    if (this.oauth2 && !this.oauth2.hasGrantedAllScopes(r, DRIVE_SCOPE)) {
      pending?.reject(
        new Error('Vault Diary needs permission to see the files it creates in your Drive.'),
      )
      return
    }
    this.token = r.access_token
    const seconds = Number(r.expires_in ?? 3600)
    // Treat the token as expired a minute early so uploads don't fail half-way.
    this.expiresAt = Date.now() + Math.max(60, seconds - 60) * 1000
    if (this.expiryTimer) clearTimeout(this.expiryTimer)
    this.expiryTimer = setTimeout(() => this.markExpired(), this.expiresAt - Date.now())
    this.onChange()
    pending?.resolve()
  }

  signOut(): void {
    const token = this.token
    this.token = null
    this.expiresAt = 0
    if (token && this.oauth2) this.oauth2.revoke(token)
    this.onChange()
  }
}

/** Dev/test stand-in that is always signed in. */
export class FakeAuth implements TokenSource {
  private signedIn = false
  private readonly onChange: () => void
  constructor(onChange: () => void) {
    this.onChange = onChange
  }
  ready = true
  async preload() {}
  hasToken() {
    return this.signedIn
  }
  getToken() {
    return this.signedIn ? 'fake-token' : null
  }
  markExpired() {
    this.signedIn = false
    this.onChange()
  }
  async signIn() {
    this.signedIn = true
    this.onChange()
  }
  signOut() {
    this.signedIn = false
    this.onChange()
  }
}
