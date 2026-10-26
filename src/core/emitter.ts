export class Emitter {
  private listeners = new Set<() => void>()
  private _version = 0

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get version(): number {
    return this._version
  }

  protected emit(): void {
    this._version++
    for (const l of [...this.listeners]) l()
  }
}
