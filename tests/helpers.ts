import { importMasterKey } from '../src/crypto/container'
import { wipe } from '../src/crypto/bytes'
import { unwrapWithRecoveryWords, type VaultFile } from '../src/crypto/vault'

export * from '../src/crypto/vault'

export async function importMasterKeyFromRecovery(vault: VaultFile, words: string | string[]) {
  const raw = await unwrapWithRecoveryWords(vault, words)
  try {
    return await importMasterKey(raw)
  } finally {
    wipe(raw)
  }
}
