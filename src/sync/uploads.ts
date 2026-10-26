// Upload queue for attachments. Items are encrypted Blobs in IndexedDB, so they survive closing
// the app and going offline; uploads use Drive resumable sessions, one 8 MiB slice at a time.
import { Emitter } from '../core/emitter'
import { AuthError, DriveError, OfflineError, UPLOAD_SLICE, type DriveClient } from '../drive/types'
import type { VaultLocation } from '../drive/vaultFolder'
import type { UploadRecord, VaultDB } from '../storage/db'
import { backoffDelay } from './backoff'

/** Drive keeps resumable sessions for a week; start over well before that. */
const SESSION_MAX_AGE = 5 * 24 * 3600_000

export interface UploadProgress {
  fileId: string
  size: number
  uploaded: number
  attempts: number
  lastError: string | null
  nextAttemptAt: number
  active: boolean
}

export type QueueBlock = null | 'offline' | 'auth'

export class UploadQueue extends Emitter {
  private readonly db: VaultDB
  private readonly getDrive: () => DriveClient | null
  private readonly getLocation: () => VaultLocation | null
  private running: Promise<void> | null = null
  private again = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private progress = new Map<string, UploadProgress>()
  private activeId: string | null = null
  blocked: QueueBlock = null
  now: () => number = Date.now

  constructor(
    db: VaultDB,
    getDrive: () => DriveClient | null,
    getLocation: () => VaultLocation | null,
  ) {
    super()
    this.db = db
    this.getDrive = getDrive
    this.getLocation = getLocation
  }

  items(): UploadProgress[] {
    return [...this.progress.values()]
  }

  async refresh(): Promise<void> {
    const records = await this.db.uploads.toArray()
    this.progress = new Map(records.map((r) => [r.fileId, this.toProgress(r)]))
    this.emit()
  }

  private toProgress(r: UploadRecord): UploadProgress {
    return {
      fileId: r.fileId,
      size: r.size,
      uploaded: r.uploaded,
      attempts: r.attempts,
      lastError: r.lastError,
      nextAttemptAt: r.nextAttemptAt,
      active: this.activeId === r.fileId,
    }
  }

  /** Start (or restart) processing. Safe to call often. */
  kick(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      try {
        do {
          this.again = false
          await this.drain()
        } while (this.again)
      } finally {
        this.running = null
      }
    })()
    return this.running
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(at: number) {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.kick(), Math.max(0, at - this.now()))
  }

  private async drain(): Promise<void> {
    await this.refresh()
    for (;;) {
      const drive = this.getDrive()
      const location = this.getLocation()
      if (!drive || !location) {
        this.blocked = 'auth'
        this.emit()
        return
      }
      const records = await this.db.uploads.orderBy('nextAttemptAt').toArray()
      if (!records.length) {
        this.blocked = null
        this.emit()
        return
      }
      const due = records.find((r) => r.nextAttemptAt <= this.now())
      if (!due) {
        this.schedule(records[0].nextAttemptAt)
        return
      }
      const outcome = await this.upload(drive, location, due)
      if (outcome === 'stop') return
    }
  }

  private async save(rec: UploadRecord, patch: Partial<UploadRecord>): Promise<UploadRecord> {
    const next = { ...rec, ...patch }
    // The item may have been removed meanwhile (attachment deleted): don't resurrect it.
    const updated = await this.db.uploads.update(rec.fileId, patch)
    if (updated) this.progress.set(rec.fileId, this.toProgress(next))
    this.emit()
    return next
  }

  private async upload(
    drive: DriveClient,
    location: VaultLocation,
    rec: UploadRecord,
  ): Promise<'next' | 'stop'> {
    const name = `${rec.fileId}.vdf`
    this.activeId = rec.fileId
    try {
      let status: Awaited<ReturnType<DriveClient['queryResumable']>> | null = null
      if (rec.sessionUrl && this.now() - rec.sessionStartedAt < SESSION_MAX_AGE) {
        try {
          status = await drive.queryResumable(rec.sessionUrl, rec.size)
        } catch (e) {
          if (!(e instanceof DriveError && (e.status === 404 || e.status === 410))) throw e
          status = null
        }
      }
      if (!status) {
        // An earlier attempt may have finished even though we never saw the reply.
        const existing = (await drive.findByName(location.filesId, name)).find(
          (f) => f.size === rec.size,
        )
        if (existing) {
          await this.finish(rec)
          return 'next'
        }
        const sessionUrl = await drive.startResumable(location.filesId, name, rec.size)
        rec = await this.save(rec, { sessionUrl, sessionStartedAt: this.now(), uploaded: 0 })
        status = { done: false, nextOffset: 0 }
      }
      while (!status.done) {
        const start = status.nextOffset
        rec = await this.save(rec, { uploaded: start })
        if (!(await this.db.uploads.get(rec.fileId))) return 'next' // cancelled
        const slice = rec.blob.slice(start, Math.min(rec.size, start + UPLOAD_SLICE))
        status = await drive.putSlice(rec.sessionUrl!, slice, start, rec.size)
      }
      if (status.file.size !== rec.size) {
        await drive.trash(status.file.id)
        throw new DriveError(0, 'Drive stored the wrong number of bytes; uploading again.')
      }
      await this.finish(rec)
      return 'next'
    } catch (e) {
      if (e instanceof AuthError) {
        this.blocked = 'auth'
        await this.save(rec, { lastError: 'Waiting for Google sign-in' })
        return 'stop'
      }
      const attempts = rec.attempts + 1
      const nextAttemptAt = this.now() + backoffDelay(attempts)
      const offline = e instanceof OfflineError
      this.blocked = offline ? 'offline' : null
      if (offline) this.schedule(nextAttemptAt)
      await this.save(rec, {
        attempts,
        nextAttemptAt,
        lastError: (e as Error).message,
        // A rejected session (e.g. 400) is not worth resuming.
        ...(e instanceof DriveError && !e.retryable ? { sessionUrl: null } : {}),
      })
      return offline ? 'stop' : 'next'
    } finally {
      this.activeId = null
    }
  }

  private async finish(rec: UploadRecord) {
    await this.db.uploads.delete(rec.fileId)
    this.progress.delete(rec.fileId)
    this.emit()
  }
}
