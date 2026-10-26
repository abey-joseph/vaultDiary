import { createContext, useContext, useSyncExternalStore } from 'react'
import type { Controller } from '../core/controller'

export const ControllerContext = createContext<Controller | null>(null)

/** Re-renders whenever anything in the controller (session, sync, uploads) changes. */
export function useController(): Controller {
  const c = useContext(ControllerContext)
  if (!c) throw new Error('No controller')
  useSyncExternalStore(c.subscribe, () => c.version)
  return c
}
