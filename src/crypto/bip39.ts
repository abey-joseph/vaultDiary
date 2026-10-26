// BIP39 English encoding of 256-bit recovery keys (24 words, 8-bit SHA-256 checksum).
// Only the mnemonic <-> entropy mapping is used; there is no BIP39 seed/PBKDF2 step.
import wordlistText from './bip39-english.txt?raw'
import { RecoveryPhraseError } from './errors'
import { equalBytes, own } from './bytes'

export const WORDLIST: readonly string[] = wordlistText.trim().split('\n')
if (WORDLIST.length !== 2048) throw new Error('BIP39 wordlist must have 2048 words')

const WORD_INDEX = new Map(WORDLIST.map((w, i) => [w, i]))

export const RECOVERY_WORD_COUNT = 24

export async function entropyToWords(entropy: Uint8Array): Promise<string[]> {
  if (entropy.length !== 32) throw new Error('Recovery key must be 32 bytes')
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', own(entropy)))
  // 256 entropy bits + 8 checksum bits = 264 bits = 24 x 11 bits.
  const bits = [...entropy, hash[0]]
  const words: string[] = []
  for (let w = 0; w < 24; w++) {
    let index = 0
    for (let b = 0; b < 11; b++) {
      const bit = w * 11 + b
      index = (index << 1) | ((bits[bit >> 3] >> (7 - (bit & 7))) & 1)
    }
    words.push(WORDLIST[index])
  }
  return words
}

/** Split user input into normalised words. Accepts any whitespace, case, and 4-letter prefixes. */
export function normaliseWords(input: string): string[] {
  return input
    .normalize('NFKD')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
    .map(expandWord)
}

function expandWord(word: string): string {
  if (WORD_INDEX.has(word)) return word
  // Every BIP39 English word is uniquely identified by its first four letters.
  if (word.length >= 4) {
    const matches = WORDLIST.filter((w) => w.startsWith(word.slice(0, 4)))
    if (matches.length === 1 && matches[0].startsWith(word)) return matches[0]
  }
  return word
}

export async function wordsToEntropy(input: string | string[]): Promise<Uint8Array<ArrayBuffer>> {
  const words = typeof input === 'string' ? normaliseWords(input) : input.map(expandWord)
  if (words.length !== RECOVERY_WORD_COUNT) {
    throw new RecoveryPhraseError(`Expected 24 recovery words, got ${words.length}.`)
  }
  const unknown = words.filter((w) => !WORD_INDEX.has(w))
  if (unknown.length) {
    throw new RecoveryPhraseError(`Not a recovery word: ${unknown.slice(0, 3).join(', ')}`)
  }
  const bytes = new Uint8Array(33)
  words.forEach((word, w) => {
    const index = WORD_INDEX.get(word)!
    for (let b = 0; b < 11; b++) {
      if ((index >> (10 - b)) & 1) {
        const bit = w * 11 + b
        bytes[bit >> 3] |= 1 << (7 - (bit & 7))
      }
    }
  })
  const entropy = bytes.slice(0, 32)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', entropy))
  if (!equalBytes(hash.subarray(0, 1), bytes.subarray(32, 33))) {
    throw new RecoveryPhraseError(
      'These words are not a valid recovery phrase (checksum failed). Check for a typo or a swapped word.',
    )
  }
  return entropy
}
