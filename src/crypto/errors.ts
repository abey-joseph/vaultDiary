/** The file is not a valid VDV1 file (bad magic, bad header, wrong length, truncated). */
export class FormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FormatError'
  }
}

/** Authentication failed: the data was modified, reordered, truncated or the key is wrong. */
export class IntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IntegrityError'
  }
}

/** The passphrase or recovery words do not open this vault. */
export class WrongSecretError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WrongSecretError'
  }
}

/** The recovery words are malformed (unknown word, wrong count, bad checksum). */
export class RecoveryPhraseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecoveryPhraseError'
  }
}
