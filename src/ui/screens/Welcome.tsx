import { CLIENT_ID } from '../../core/config'
import { ErrorNote, Spinner } from '../components'
import { useController } from '../controllerContext'

export function Unconfigured() {
  return (
    <main className="gate">
      <h1>Vault Diary</h1>
      <p>
        This build has no Google OAuth client ID. Set <code>VITE_GOOGLE_CLIENT_ID</code> when
        building (see SETUP.md).
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
