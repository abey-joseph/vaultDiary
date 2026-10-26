import { describe, expect, it } from 'vitest'
import { randomId, utf8 } from '../src/crypto/bytes'
import { entropyToWords, normaliseWords, wordsToEntropy } from '../src/crypto/bip39'
import { decryptBytes, encryptBytes } from '../src/crypto/container'
import { RecoveryPhraseError, WrongSecretError } from '../src/crypto/errors'
import {
  changePassphrase,
  createVault,
  importMasterKeyFromRecovery,
  parseVault,
  unlockWithPassphrase,
  unwrapWithRecoveryWords,
} from './helpers'

describe('BIP39', () => {
  it('matches the reference vectors', async () => {
    expect((await entropyToWords(new Uint8Array(32))).join(' ')).toBe('abandon '.repeat(23) + 'art')
    expect((await entropyToWords(new Uint8Array(32).fill(0xff))).join(' ')).toBe(
      'zoo '.repeat(23) + 'vote',
    )
    expect((await entropyToWords(new Uint8Array(32).fill(0x7f))).join(' ')).toBe(
      'legal winner thank year wave sausage worth useful '.repeat(2) +
        'legal winner thank year wave sausage worth title',
    )
    expect((await entropyToWords(new Uint8Array(32).fill(0x80))).join(' ')).toBe(
      'letter advice cage absurd amount doctor acoustic avoid '.repeat(2) +
        'letter advice cage absurd amount doctor acoustic bless',
    )
  })

  it('round trips and accepts messy input', async () => {
    const entropy = crypto.getRandomValues(new Uint8Array(32))
    const words = await entropyToWords(entropy)
    const messy = words.map((w, i) => (i % 2 ? w.toUpperCase() : w.slice(0, 4))).join('\n  ')
    expect(normaliseWords(messy)).toEqual(words)
    expect(Buffer.from(await wordsToEntropy(messy)).equals(Buffer.from(entropy))).toBe(true)
  })

  it('rejects bad checksums, unknown words and wrong counts', async () => {
    const words = await entropyToWords(new Uint8Array(32))
    const swapped = [...words]
    swapped[0] = 'zoo'
    await expect(wordsToEntropy(swapped)).rejects.toThrow(/checksum/)
    await expect(wordsToEntropy(words.slice(1))).rejects.toThrow(/24/)
    await expect(wordsToEntropy([...words.slice(1), 'notaword'])).rejects.toThrow(
      RecoveryPhraseError,
    )
  })
})

describe('vault.json', () => {
  it('unlocks with the passphrase and with the recovery words to the same MK', async () => {
    const { vault, mk, recoveryWords } = await createVault('correct horse battery')
    expect(recoveryWords).toHaveLength(24)
    const parsed = parseVault(JSON.stringify(vault))
    const id = randomId()
    const enc = await encryptBytes(mk, id, 'entry', utf8('hello'))

    const viaPass = await unlockWithPassphrase(parsed, 'correct horse battery')
    expect(new TextDecoder().decode(await decryptBytes(viaPass, enc))).toBe('hello')

    const viaWords = await importMasterKeyFromRecovery(parsed, recoveryWords.join(' '))
    expect(new TextDecoder().decode(await decryptBytes(viaWords, enc))).toBe('hello')
  })

  it('fails cleanly on a wrong passphrase', async () => {
    const { vault } = await createVault('correct horse battery')
    await expect(unlockWithPassphrase(vault, 'correct horse battery!')).rejects.toThrow(
      WrongSecretError,
    )
    await expect(unlockWithPassphrase(vault, '')).rejects.toThrow('Wrong passphrase.')
  })

  it('fails cleanly on wrong (but valid) recovery words', async () => {
    const { vault } = await createVault('correct horse battery')
    const other = await entropyToWords(crypto.getRandomValues(new Uint8Array(32)))
    await expect(unwrapWithRecoveryWords(vault, other)).rejects.toThrow(WrongSecretError)
    await expect(unwrapWithRecoveryWords(vault, other)).rejects.toThrow(/do not belong/)
  })

  it('normalises the passphrase (NFC)', async () => {
    const { vault } = await createVault('café au lait please')
    await expect(unlockWithPassphrase(vault, 'café au lait please')).resolves.toBeTruthy()
  })

  it('changing the passphrase only re-wraps the MK', async () => {
    const { vault, mk, recoveryWords } = await createVault('first passphrase')
    const enc = await encryptBytes(mk, randomId(), 'entry', utf8('kept'))
    const passkeySlot = { type: 'webauthn-prf' as const, credentialId: 'future' }
    const withSlot = { ...vault, wrappers: [...vault.wrappers, passkeySlot] }
    const changed = await changePassphrase(withSlot, 'first passphrase', 'second passphrase')
    expect(changed.vaultId).toBe(vault.vaultId)
    expect(changed.wrappers.find((w) => w.type === 'recovery')).toEqual(
      vault.wrappers.find((w) => w.type === 'recovery'),
    )
    expect(changed.wrappers).toContainEqual(passkeySlot)
    await expect(unlockWithPassphrase(changed, 'first passphrase')).rejects.toThrow(
      WrongSecretError,
    )
    const mk2 = await unlockWithPassphrase(changed, 'second passphrase')
    expect(new TextDecoder().decode(await decryptBytes(mk2, enc))).toBe('kept')
    const mk3 = await importMasterKeyFromRecovery(changed, recoveryWords)
    expect(new TextDecoder().decode(await decryptBytes(mk3, enc))).toBe('kept')
    await expect(changePassphrase(changed, 'nope nope nope', 'x')).rejects.toThrow(WrongSecretError)
  })
})
