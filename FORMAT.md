# Vault Diary file format, version 1

This document is the complete description of what Vault Diary stores. Anyone with this document,
the files, and the passphrase or the 24 recovery words can decrypt everything without the app.
`recovery/recover.py` is a reference implementation in about 500 lines of Python.

All cryptography is standard: **AES-256-GCM** (128-bit tag, 96-bit IV), **Argon2id** (v1.3),
**HKDF-SHA256**, **BIP39** English word encoding. Nothing is home-made.

## 1. Folder layout

The app creates a normal, visible folder in the user's Google Drive:

```
VaultDiary/
  vault.json              master key, wrapped once per unlock method (plain JSON)
  index.vdi               encrypted index of entry summaries (optional, rebuildable)
  entries/<id>.vde        one encrypted diary entry each
  files/<id>.vdf          one encrypted attachment each
```

- `<id>` is 128 random bits written as 32 lowercase hex characters (`[0-9a-f]{32}`). Ids carry no
  information. File names, sizes rounded up to whole chunks, and timestamps are the only things
  Google can see.
- The Drive folder also carries the app property `vaultdiary=root` so the app can find it even if
  it is renamed or moved. Recovery tools do not need this.
- Tools must identify files by their **contents** (the `VDV1` magic and the header's `kind` and
  `id`), not by name: Drive may rename duplicates (`abc (1).vde`) and zips may nest folders.
- If two files claim the same entry id, the one whose decrypted `updatedAt` is later wins.

## 2. Keys

```
MK  (master key)      256 random bits, generated once at setup. Never stored unwrapped.
FK  (file key)        256 random bits, one per encrypted file, stored wrapped by MK in its header.
KEK (key-encryption)  derived from a passphrase or the recovery key; wraps MK in vault.json.
```

Changing the passphrase only replaces the passphrase wrapper in `vault.json`. MK, every file key
and every encrypted file stay exactly the same.

## 3. vault.json

```json
{
  "format": "vaultdiary-vault",
  "v": 1,
  "vaultId": "3f2c…32 hex…",
  "createdAt": "2026-10-26T04:00:00.000Z",
  "updatedAt": "2026-10-26T04:00:00.000Z",
  "wrappers": [
    {
      "type": "passphrase",
      "kdf": {
        "name": "argon2id",
        "version": 19,
        "memoryKiB": 65536,
        "iterations": 3,
        "parallelism": 1,
        "salt": "<base64, 16 bytes>"
      },
      "iv": "<base64, 12 bytes>",
      "ct": "<base64, 48 bytes = 32-byte MK + 16-byte tag>"
    },
    {
      "type": "recovery",
      "kdf": {
        "name": "hkdf-sha256",
        "salt": "<base64, 16 bytes>",
        "info": "VaultDiary v1 recovery key"
      },
      "iv": "<base64, 12 bytes>",
      "ct": "<base64, 48 bytes>"
    }
  ]
}
```

Base64 is standard RFC 4648 with `+/` and `=` padding.

### 3.1 Passphrase wrapper

```
password = UTF-8( NFC-normalise(passphrase) )
KEK      = Argon2id(password, salt, m = memoryKiB, t = iterations, p = parallelism,
                    version 0x13, output length 32 bytes)
MK       = AES-256-GCM-Decrypt(key = KEK, iv, ct, AAD = ASCII "VDV1/mk/<vaultId>/passphrase")
```

The app writes m = 65536 KiB (64 MiB), t = 3, p = 1. Readers accept 8192 ≤ m ≤ 1048576,
1 ≤ t ≤ 32, 1 ≤ p ≤ 16 and refuse anything else (protects against a hostile vault.json).

### 3.2 Recovery wrapper

The recovery key is 256 random bits, shown once as 24 BIP39 English words: the 256 bits followed by
the first 8 bits of SHA-256(recovery key) are split into 24 groups of 11 bits, each indexing the
standard 2048-word list (big-endian, most significant bit first). Every word is uniquely
identified by its first four letters.

```
KEK = HKDF-SHA256(IKM = recovery key (32 bytes), salt, info = UTF-8(info), length 32)
MK  = AES-256-GCM-Decrypt(key = KEK, iv, ct, AAD = ASCII "VDV1/mk/<vaultId>/recovery")
```

This is plain BIP39 entropy encoding only; there is no BIP39 PBKDF2 "seed" step.

### 3.3 Reserved: passkey wrapper

`"type": "webauthn-prf"` is reserved for a future WebAuthn PRF passkey wrapper (Phase 2). Readers
must ignore wrapper types they do not understand and writers must keep them unchanged.

## 4. Encrypted container (`.vde`, `.vdf`, `.vdi`)

Every encrypted file uses the same container:

| Offset | Length | Content                                           |
| ------ | ------ | ------------------------------------------------- |
| 0      | 4      | magic bytes `56 44 56 31` (ASCII `VDV1`)          |
| 4      | 4      | header length `H`, unsigned 32-bit **big-endian** |
| 8      | H      | header, UTF-8 JSON object (2 ≤ H ≤ 65536)         |
| 8 + H  | …      | chunk 0, chunk 1, … chunk N−1, nothing after      |

### 4.1 Header

```json
{
  "v": 1,
  "kind": "entry",
  "id": "9b1d…32 hex…",
  "alg": "A256GCM",
  "chunkSize": 4194304,
  "chunkCount": 1,
  "size": 1234,
  "key": { "iv": "<base64, 12 bytes>", "ct": "<base64, 48 bytes>" }
}
```

| Field        | Meaning                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------- |
| `v`          | format version, always `1`                                                                         |
| `kind`       | `"entry"` (`.vde`), `"file"` (`.vdf`) or `"index"` (`.vdi`)                                        |
| `id`         | the file's id; equals the `<id>` in its file name when written by the app                          |
| `alg`        | always `"A256GCM"`                                                                                 |
| `chunkSize`  | plaintext bytes per chunk; the app always writes 4 MiB (4194304). Readers must accept 1 … 67108864 |
| `chunkCount` | `max(1, ceil(size / chunkSize))`, must match exactly                                               |
| `size`       | total plaintext length in bytes                                                                    |
| `key`        | the file key wrapped by MK (below)                                                                 |

Key order and whitespace in the header are not significant. Unknown extra fields must be ignored.

### 4.2 File key

```
FK = AES-256-GCM-Decrypt(key = MK, iv = key.iv, ct = key.ct,
                         AAD = ASCII "VDV1/filekey/<kind>/<id>")
```

Because `kind` and `id` are in the AAD, an attacker can't relabel a file or move its key to
another file.

### 4.3 Chunks

The plaintext is split into chunks of `chunkSize` bytes; the last chunk holds the remainder
(`size − (chunkCount − 1) × chunkSize` bytes, which is 0 for an empty file — an empty file still
has exactly one chunk). Each chunk is stored as:

```
IV (12 random bytes, fresh per chunk) | AES-256-GCM ciphertext | 16-byte tag
```

with

```
AAD(i) = ASCII "VDV1/chunk/<id>/<i>/<last>"     i = 0-based decimal index, last = "1" or "0"
```

So a chunk of `n` plaintext bytes occupies `n + 28` bytes, and the total file length must be
exactly `8 + H + size + 28 × chunkCount`. Readers must reject:

- a wrong magic, header length, version, algorithm, kind, id or count (format error);
- a file shorter or longer than that exact length (truncated / trailing data);
- any chunk whose tag fails (tampered, reordered — the index is in the AAD — or truncated:
  dropping the last chunk and editing the header fails because the new last chunk was encrypted
  with `last = 0`);
- a header `id` that differs from the expected id, when the expected id is known.

Readers must not output any plaintext of a chunk whose tag failed. Streaming readers that write
earlier chunks to disk must delete the partial output when a later chunk fails.

## 5. Plaintext payloads

All payloads are UTF-8 JSON. All metadata lives inside the ciphertext.

### 5.1 Entry (`kind: "entry"`)

```json
{
  "id": "9b1d…",
  "date": "2026-10-26",
  "createdAt": "2026-10-26T07:15:00.000Z",
  "updatedAt": "2026-10-26T07:20:41.512Z",
  "title": "Morning walk",
  "body": "Markdown **text**",
  "tags": [],
  "mood": 4,
  "attachments": [
    { "fileId": "51c0…", "name": "IMG_0042.jpg", "mime": "image/jpeg", "size": 2311420 }
  ]
}
```

- `id` must equal the header `id`.
- `date` is the calendar day `YYYY-MM-DD` in the writer's local time zone.
- `createdAt`, `updatedAt` are ISO 8601 UTC timestamps.
- `body` is Markdown (CommonMark/GFM).
- `tags` is an array of strings (always empty in Phase 1).
- `mood` is an integer 1 (awful) … 5 (great), or `null`.
- `attachments[].fileId` is the id of a `files/<fileId>.vdf` container; `name`, `mime` and `size`
  are the original file's name, MIME type and byte length.
- Readers must keep fields they don't know.

A **conflict copy** is an ordinary entry with a new id and " (conflict copy)" appended to the
title. It is created when the same entry was edited on two devices before they synced.

### 5.2 Attachment (`kind: "file"`)

The raw bytes of the original file. Name and type are stored in the entry that references it.

### 5.3 Index (`kind: "index"`)

```json
{
  "v": 1,
  "generatedAt": "2026-10-26T07:21:00.000Z",
  "entries": [
    {
      "id": "9b1d…",
      "date": "2026-10-26",
      "createdAt": "…",
      "updatedAt": "…",
      "title": "Morning walk",
      "mood": 4,
      "tags": [],
      "attachmentCount": 1,
      "excerpt": "First 160 characters of the body as plain text…"
    }
  ]
}
```

The index only speeds up the first load on a new device. It can always be rebuilt from the
entries and may be stale or missing; recovery tools ignore it. Its container `id` is random.

## 6. Backup zip

The app's "Encrypted backup" is a standard zip (stored, no compression, UTF-8 names) containing
`VaultDiary/vault.json`, `VaultDiary/index.vdi`, `VaultDiary/entries/*.vde` and
`VaultDiary/files/*.vdf` exactly as they are on Drive. It contains no plaintext.

## 7. Versioning

A future incompatible change will use a new magic (`VDV2`) and/or `v: 2`. Version 1 readers must
refuse those rather than guess.
