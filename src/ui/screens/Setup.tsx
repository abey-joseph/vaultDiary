import { useState, type FormEvent } from 'react'
import { passphraseProblem } from '../../crypto/vault'
import { normaliseWords } from '../../crypto/bip39'
import { ErrorNote, PassphraseInput, Spinner } from '../components'
import { useController } from '../controllerContext'
import { printRecoverySheet } from '../print'
import { RecoverySheet } from './RecoverySheet'

type Step = 'intro' | 'passphrase' | 'words' | 'confirm'

function pickThree(): number[] {
  const picks = new Set<number>()
  const buf = new Uint32Array(1)
  while (picks.size < 3) {
    crypto.getRandomValues(buf)
    picks.add(buf[0] % 24)
  }
  return [...picks].sort((a, b) => a - b)
}

export function Setup() {
  const c = useController()
  const [step, setStep] = useState<Step>('intro')
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [wroteDown, setWroteDown] = useState(false)
  const [answers, setAnswers] = useState<string[]>(['', '', ''])
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const words = c.pendingSetup?.recoveryWords ?? []
  const [picks, setPicks] = useState(pickThree)

  if (c.readOnly) {
    return (
      <main className="gate">
        <h1>No vault yet</h1>
        <p>This is a read-only copy of Vault Diary. Create your vault in the main app first.</p>
      </main>
    )
  }

  const problem = p1 ? passphraseProblem(p1) : null

  const submitPassphrase = async (e: FormEvent) => {
    e.preventDefault()
    if (passphraseProblem(p1) || p1 !== p2) return
    await c.beginSetup(p1)
    setP1('')
    setP2('')
    setStep('words')
  }

  const submitConfirm = async (e: FormEvent) => {
    e.preventDefault()
    const ok = picks.every((index, i) => normaliseWords(answers[i])[0] === words[index])
    if (!ok) {
      setConfirmError("At least one word doesn't match. Check what you wrote down.")
      return
    }
    setConfirmError(null)
    await c.finishSetup()
  }

  return (
    <main className="gate wide">
      <p className="steps" aria-label="Progress">
        {(['passphrase', 'words', 'confirm'] as Step[]).map((s, i) => (
          <span key={s} className={step === s ? 'current' : ''}>
            {i + 1}
          </span>
        ))}
      </p>

      {step === 'intro' && (
        <>
          <h1>Create your vault</h1>
          <p>
            Vault Diary encrypts everything on this device with a key that only you can unlock.
            There is no "reset password" email: if you lose both your passphrase and your recovery
            words, nobody can recover your diary.
          </p>
          <button className="primary big" onClick={() => setStep('passphrase')}>
            Start
          </button>
        </>
      )}

      {step === 'passphrase' && (
        <form className="stack" onSubmit={submitPassphrase}>
          <h1>Choose a passphrase</h1>
          <p>
            You'll type this to unlock your diary. A few unrelated words are strong and easy to
            remember.
          </p>
          <PassphraseInput
            id="sp1"
            label="Passphrase"
            value={p1}
            onChange={setP1}
            autoComplete="new-password"
            autoFocus
          />
          {problem && <p className="hint warn">{problem}</p>}
          <PassphraseInput
            id="sp2"
            label="Repeat passphrase"
            value={p2}
            onChange={setP2}
            autoComplete="new-password"
          />
          {p2 && p1 !== p2 && <p className="hint warn">The two passphrases don't match.</p>}
          {c.busy ? (
            <Spinner label="Generating keys…" />
          ) : (
            <button className="primary big" type="submit" disabled={!p1 || !!problem || p1 !== p2}>
              Continue
            </button>
          )}
        </form>
      )}

      {step === 'words' && (
        <div className="stack">
          <h1>Your recovery words</h1>
          <p>
            These 24 words unlock your diary if you forget your passphrase. Write them down on
            paper, in order, and keep them somewhere safe.{' '}
            <strong>They are shown only once.</strong>
          </p>
          <ol className="word-grid">
            {words.map((w, i) => (
              <li key={i}>
                <span className="word-num">{i + 1}</span> {w}
              </li>
            ))}
          </ol>
          <button className="ghost" onClick={() => printRecoverySheet()}>
            Print recovery sheet
          </button>
          <label className="check">
            <input
              type="checkbox"
              checked={wroteDown}
              onChange={(e) => setWroteDown(e.target.checked)}
            />
            I have written down or printed all 24 words.
          </label>
          <button
            className="primary big"
            disabled={!wroteDown}
            onClick={() => {
              setAnswers(['', '', ''])
              setPicks(pickThree())
              setStep('confirm')
            }}
          >
            Continue
          </button>
          <RecoverySheet words={words} />
        </div>
      )}

      {step === 'confirm' && (
        <form className="stack" onSubmit={submitConfirm}>
          <h1>Check your words</h1>
          <p>Type these words from your list to show you have them.</p>
          {picks.map((index, i) => (
            <div className="field" key={index}>
              <label htmlFor={`cw${i}`}>Word #{index + 1}</label>
              <input
                id={`cw${i}`}
                value={answers[i]}
                onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? e.target.value : a)))}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                autoFocus={i === 0}
              />
            </div>
          ))}
          <ErrorNote message={confirmError} />
          <ErrorNote message={c.error} onClose={() => c.clearError()} />
          {c.busy ? (
            <Spinner label="Saving your vault to Google Drive…" />
          ) : (
            <button className="primary big" type="submit" disabled={answers.some((a) => !a.trim())}>
              Create vault
            </button>
          )}
          <button type="button" className="link" onClick={() => setStep('words')}>
            Show the words again
          </button>
        </form>
      )}

      {step !== 'intro' && step !== 'confirm' && (
        <button
          className="link"
          onClick={() => {
            c.cancelSetup()
            setStep('intro')
          }}
        >
          Start over
        </button>
      )}
    </main>
  )
}
