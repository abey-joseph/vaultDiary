import { registerSW } from 'virtual:pwa-register'

export function registerServiceWorker(): void {
  if (import.meta.env.DEV) return
  registerSW({ immediate: true })
}
