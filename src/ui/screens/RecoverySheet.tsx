import { createPortal } from 'react-dom'
import { useController } from '../controllerContext'

export function RecoverySheet({ words }: { words: string[] }) {
  const c = useController()
  // Rendered outside #root so print CSS can hide the whole app and show only this sheet.
  return createPortal(
    <div className="recovery-sheet" aria-hidden="true">
      <h1>Vault Diary — recovery sheet</h1>
      <p>
        These 24 words unlock your diary if you forget your passphrase. Anyone who has them and your
        Google Drive files can read your diary. Keep this sheet somewhere safe and private.
      </p>
      <table>
        <tbody>
          {Array.from({ length: 8 }, (_, row) => (
            <tr key={row}>
              {[0, 8, 16].map((col) => (
                <td key={col}>
                  <span className="word-num">{row + col + 1}.</span> {words[row + col]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <dl>
        <dt>Vault id</dt>
        <dd>{c.pendingSetup?.vault.vaultId ?? c.vault?.vaultId}</dd>
        <dt>Created</dt>
        <dd>{new Date().toLocaleDateString()}</dd>
        {c.account?.email && (
          <>
            <dt>Google account</dt>
            <dd>{c.account.email}</dd>
          </>
        )}
      </dl>
      <h2>If the app is ever gone</h2>
      <ol>
        <li>Download the VaultDiary folder from drive.google.com (right-click → Download).</li>
        <li>
          Open <strong>recovery.html</strong> (offline recovery tool from the app's Settings, or
          from the project's <em>recovery</em> folder) in any browser, pick the download and enter
          these words. Or run <em>recover.py</em>.
        </li>
      </ol>
    </div>,
    document.body,
  )
}
