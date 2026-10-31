import { CLIENT_ID, CLIENT_ID_PROBLEM } from '../../core/config'
import { ErrorNote, Spinner } from '../components'
import { useController } from '../controllerContext'

export function Unconfigured() {
  return (
    <main className="gate">
      <h1>Vault Diary</h1>
      <p>{CLIENT_ID_PROBLEM}</p>
      <p>
        Put the client ID from Google Cloud (APIs &amp; Services → Credentials) into{' '}
        <code>VITE_GOOGLE_CLIENT_ID</code> — in <code>.env.local</code> for <code>npm run dev</code>
        (then restart it), or in the repository variable <code>GOOGLE_CLIENT_ID</code> for deployed
        builds. See SETUP.md.
      </p>
    </main>
  )
}

export function Welcome() {
  const c = useController()
  return (
    <main className="gate">
      <div className="logo" aria-hidden="true">
        🔒
      </div>
      <h1>Vault Diary</h1>
      <p className="lead">
        A private diary, encrypted on this device and stored in your own Google Drive.
      </p>
      <ul className="bullets">
        <li>Only you can read it: everything is encrypted before it leaves this device.</li>
        <li>Vault Diary can only see the files it creates in your Drive.</li>
        <li>Works offline once set up.</li>
      </ul>
      <ErrorNote message={c.error} onClose={() => c.clearError()} />
      {!c.online && <p className="muted">You're offline. Connect to sign in the first time.</p>}
      <button
        className="primary big"
        disabled={!c.online || !c.auth.ready}
        onClick={() => void c.signIn()}
      >
        Sign in with Google
      </button>
      {c.online && !c.auth.ready && CLIENT_ID && <Spinner label="Loading Google sign-in…" />}
      <p className="small muted">
        <a href="./recovery.html" download>
          Download the offline recovery tool
        </a>
      </p>
    </main>
  )
}

export function Finding() {
  return (
    <main className="gate">
      <h1>Vault Diary</h1>
      <Spinner label="Looking for your VaultDiary folder in Google Drive…" />
    </main>
  )
}
