import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { randomBytes } from '../src/crypto/bytes'
import { blobSource, decryptToBlob, importMasterKey } from '../src/crypto/container'
import { VaultSession } from '../src/core/session'
import { FakeDrive } from '../src/drive/fake'
import { OfflineError, UPLOAD_SLICE } from '../src/drive/types'
import { createVaultFolder, type VaultLocation } from '../src/drive/vaultFolder'
import { newEntry, type Entry } from '../src/model/entry'
import { KV, VaultDB } from '../src/storage/db'
import { backoffDelay } from '../src/sync/backoff'
import { SyncEngine } from '../src/sync/sync'
import { UploadQueue } from '../src/sync/uploads'

let drive: FakeDrive
let location: VaultLocation
let mk: CryptoKey
let n = 0

beforeEach(async () => {
  drive = new FakeDrive()
  location = (await createVaultFolder(drive)).location
  mk = await importMasterKey(randomBytes(32))
})

async function device() {
  const db = new VaultDB(`test-${++n}`)
  await db.setKv(
    KV.vaultJson,
    JSON.stringify({ format: 'vaultdiary-vault', v: 1, vaultId: 'a'.repeat(32), wrappers: [] }),
  )
  // Like the app after setup: the first device has written vault.json to Drive.
  if (![...drive.files.values()].some((f) => f.name === 'vault.json' && !f.trashed)) {
    await db.setKv(KV.vaultDirty, true)
  }
  const session = await VaultSession.open(db, mk)
  const sync = new SyncEngine({
    db,
    session,
    getDrive: () => drive,
    getLocation: () => location,
    readOnly: false,
  })
  const uploads = new UploadQueue(
    db,
    () => drive,
    () => location,
  )
  return { db, session, sync, uploads }
}

async function reopen(d: Awaited<ReturnType<typeof device>>) {
  const session = await VaultSession.open(d.db, mk)
  const sync = new SyncEngine({
    db: d.db,
    session,
    getDrive: () => drive,
    getLocation: () => location,
    readOnly: false,
  })
  return {
    ...d,
    session,
    sync,
    uploads: new UploadQueue(
      d.db,
      () => drive,
      () => location,
    ),
  }
}

function entry(title: string, date = '2026-10-26'): Entry {
  return { ...newEntry(date), title, body: `Body of ${title}` }
}

function titles(s: VaultSession): string[] {
  return [...s.entries.values()].map((e) => e.title).sort()
}

function driveNames(): string[] {
  return [...drive.files.values()]
    .filter((f) => !f.trashed)
    .map((f) => drive.pathOf(f.id))
    .sort()
}

const later = (e: Entry, patch: Partial<Entry>): Entry => ({
  ...e,
  ...patch,
  updatedAt: new Date(Date.parse(e.updatedAt) + 1000 + Math.random() * 1000).toISOString(),
})

describe('sync', () => {
  it('uploads entries and a second device downloads them', async () => {
    const a = await device()
    await a.session.save(entry('one'))
    await a.session.save(entry('two', '2026-10-25'))
    await a.sync.sync()
    expect(a.sync.status).toMatchObject({ state: 'idle', pendingEntries: 0, problems: [] })
    const names = driveNames()
    expect(names.filter((p) => p.startsWith('VaultDiary/entries/'))).toHaveLength(2)
    expect(names).toContain('VaultDiary/index.vdi')
    // Drive file names are random ids only.
    expect(names.join(' ')).not.toMatch(/one|two|Body/)

    const b = await device()
    await b.sync.sync()
    expect(titles(b.session)).toEqual(['one', 'two'])
    expect(b.session.list().map((i) => i.kind)).toEqual(['entry', 'entry'])
  })

  it('shows summaries from index.vdi before entries are downloaded', async () => {
    const a = await device()
    for (let i = 0; i < 5; i++) await a.session.save(entry(`e${i}`))
    await a.sync.sync()
    const b = await device()
    const realDownload = drive.download.bind(drive)
    let summariesSeen = 0
    drive.download = async (id, p) => {
      summariesSeen = Math.max(summariesSeen, b.session.summaries.size)
      return realDownload(id, p)
    }
    await b.sync.sync()
    expect(summariesSeen).toBe(5)
    expect(b.session.summaries.size).toBe(0)
    expect(b.session.entries.size).toBe(5)
  })

  it('propagates edits and deletes', async () => {
    const a = await device()
    const e1 = entry('first')
    const e2 = entry('second')
    await a.session.save(e1)
    await a.session.save(e2)
    await a.sync.sync()
    const b = await device()
    await b.sync.sync()

    await b.session.save(later(e1, { title: 'first (edited on B)' }))
    await b.session.remove(e2.id)
    await b.sync.sync()
    await a.sync.sync()
    expect(titles(a.session)).toEqual(['first (edited on B)'])
    expect(await a.db.entries.count()).toBe(1)
  })

  it('keeps both versions as a conflict copy when both sides changed', async () => {
    const a = await device()
    const e = entry('shared')
    await a.session.save(e)
    await a.sync.sync()
    const b = await device()
    await b.sync.sync()

    await a.session.save(later(e, { body: 'A version' }))
    await b.session.save(later(e, { body: 'B version' }))
    await a.sync.sync()
    await b.sync.sync()
    await a.sync.sync()

    for (const d of [a, b]) {
      const all = [...d.session.entries.values()]
      expect(all).toHaveLength(2)
      expect(all.find((x) => x.id === e.id)?.body).toBe('A version')
      const copy = all.find((x) => x.id !== e.id)!
      expect(copy.title).toBe('shared (conflict copy)')
      expect(copy.body).toBe('B version')
    }
    expect(b.sync.status.pendingEntries).toBe(0)
  })

  it('keeps a local edit when the entry was deleted on another device', async () => {
    const a = await device()
    const e = entry('doomed')
    await a.session.save(e)
    await a.sync.sync()
    const b = await device()
    await b.sync.sync()
    await a.session.remove(e.id)
    await b.session.save(later(e, { body: 'edited while deleted elsewhere' }))
    await a.sync.sync()
    await b.sync.sync()
    await a.sync.sync()
    expect([...a.session.entries.values()].map((x) => x.body)).toEqual([
      'edited while deleted elsewhere',
    ])
  })

  it('keeps a remote edit when the entry was deleted locally', async () => {
    const a = await device()
    const e = entry('kept')
    await a.session.save(e)
    await a.sync.sync()
    const b = await device()
    await b.sync.sync()
    await b.session.save(later(e, { body: 'edited on B' }))
    await b.sync.sync()
    await a.session.remove(e.id)
    await a.sync.sync()
    expect([...a.session.entries.values()].map((x) => x.body)).toEqual(['edited on B'])
  })

  it('does not create a conflict when an upload reply was lost', async () => {
    const a = await device()
    const e = entry('lost reply')
    await a.session.save(e)
    const create = drive.createFile.bind(drive)
    drive.createFile = async (...args) => {
      await create(...args)
      throw new OfflineError()
    }
    await a.sync.sync()
    expect(a.sync.status.state).toBe('offline')
    drive.createFile = create
    await a.sync.sync()
    expect(titles(a.session)).toEqual(['lost reply'])
    expect(a.sync.status.pendingEntries).toBe(0)
  })

  it('never overwrites an edit made while sync was running', async () => {
    const a = await device()
    const e = entry('race')
    await a.session.save(e)
    await a.sync.sync()
    const b = await device()
    await b.sync.sync()
    await a.session.save(later(e, { body: 'remote edit' }))
    await a.sync.sync()

    const realDownload = drive.download.bind(drive)
    let edited = false
    drive.download = async (id, p) => {
      const blob = await realDownload(id, p)
      if (!edited) {
        edited = true
        await b.session.save(later(e, { body: 'typed during sync' }))
      }
      return blob
    }
    await b.sync.sync()
    drive.download = realDownload
    await b.sync.sync()
    const bodies = [...b.session.entries.values()].map((x) => x.body).sort()
    expect(bodies).toEqual(['remote edit', 'typed during sync'])
  })

  it('works offline and syncs when back online, also after a restart', async () => {
    let a = await device()
    drive.offline = true
    await a.session.save(entry('offline one'))
    await a.sync.sync()
    expect(a.sync.status).toMatchObject({ state: 'offline', pendingEntries: 1 })
    a = await reopen(a)
    expect(titles(a.session)).toEqual(['offline one'])
    drive.offline = false
    await a.sync.sync()
    expect(a.sync.status).toMatchObject({ state: 'idle', pendingEntries: 0 })
  })

  it('never wipes the offline copy when the Drive folder suddenly looks empty', async () => {
    const a = await device()
    for (let i = 0; i < 6; i++) await a.session.save(entry(`keep ${i}`))
    await a.db.setKv(KV.vaultDirty, true)
    await a.sync.sync()
    // The user trashes the whole VaultDiary folder: its children no longer list.
    for (const f of drive.files.values()) if (f.parent !== null) f.trashed = true
    await a.sync.sync()
    expect(a.session.entries.size).toBe(6)
    expect(await a.db.entries.count()).toBe(6)
    expect(a.sync.status.problems.join(' ')).toMatch(/disappeared from Google Drive/)
    expect(a.sync.status.problems.join(' ')).toMatch(/vault.json was missing/)
  })

  it('reports expired Google sign-in', async () => {
    const a = await device()
    drive.authExpired = true
    await a.sync.sync()
    expect(a.sync.status.state).toBe('needs-auth')
  })

  it('picks up a passphrase change made on another device', async () => {
    const a = await device()
    await a.db.setKv(KV.vaultDirty, true)
    await a.sync.sync()
    const b = await device()
    let received: string | null = null
    const sync = new SyncEngine({
      db: b.db,
      session: b.session,
      getDrive: () => drive,
      getLocation: () => location,
      readOnly: false,
      onVaultChanged: (json) => (received = json),
    })
    await b.db.setKv(
      KV.vaultJson,
      JSON.stringify({
        format: 'vaultdiary-vault',
        v: 1,
        vaultId: 'a'.repeat(32),
        wrappers: [],
        x: 1,
      }),
    )
    await sync.sync()
    expect(received).toContain('"vaultId"')
    expect(await b.db.getKv(KV.vaultJson)).toBe(received)
  })
})

describe('upload queue', () => {
  it('uploads an attachment with resumable slices, resumes after a drop and a restart', async () => {
    const a = await device()
    const size = 2 * UPLOAD_SLICE + 12345
    const plain = randomBytes(size)
    const att = await a.session.addAttachment(new File([plain], 'video.mp4', { type: 'video/mp4' }))
    expect(att).toMatchObject({ name: 'video.mp4', mime: 'video/mp4', size })

    drive.failSliceAt = 2
    await a.uploads.kick()
    const [item] = a.uploads.items()
    expect(item.uploaded).toBe(UPLOAD_SLICE)
    expect(item.attempts).toBe(1)
    expect(item.lastError).toMatch(/network drop/)
    a.uploads.stop()

    // "Close the app": a new queue on the same database resumes the same Drive session.
    const restarted = new UploadQueue(
      a.db,
      () => drive,
      () => location,
    )
    restarted.now = () => Date.now() + 60_000
    drive.failSliceAt = null
    const before = drive.slicesPut
    await restarted.kick()
    expect(drive.slicesPut - before).toBe(2)
    expect(await a.db.uploads.count()).toBe(0)

    const stored = [...drive.files.values()].find((f) => f.name === `${att.fileId}.vdf`)!
    const dec = await decryptToBlob(
      mk,
      blobSource(new Blob([new Uint8Array(stored.data)])),
      att.mime,
      {
        expectedId: att.fileId,
      },
    )
    expect(Buffer.from(await dec.arrayBuffer()).equals(Buffer.from(plain))).toBe(true)
  })

  it('waits while offline and retries with backoff', async () => {
    const a = await device()
    await a.session.addAttachment(new File([randomBytes(10)], 'a.bin'))
    drive.offline = true
    await a.uploads.kick()
    a.uploads.stop()
    expect(a.uploads.blocked).toBe('offline')
    const [item] = a.uploads.items()
    expect(item.nextAttemptAt).toBeGreaterThan(Date.now())
    drive.offline = false
    a.uploads.now = () => Date.now() + 10 * 60_000
    await a.uploads.kick()
    expect(a.uploads.items()).toHaveLength(0)
  })

  it('cancels a queued upload when the attachment is removed', async () => {
    const a = await device()
    const att = await a.session.addAttachment(new File([randomBytes(10)], 'a.bin'))
    await a.session.releaseFile(att.fileId)
    await a.uploads.kick()
    expect(driveNames().some((p) => p.includes(att.fileId))).toBe(false)
  })

  it('backoff grows and is capped', () => {
    const mid = () => 0.5
    expect(backoffDelay(1, mid)).toBe(2000)
    expect(backoffDelay(2, mid)).toBe(4000)
    expect(backoffDelay(20, mid)).toBe(600_000)
  })
})
