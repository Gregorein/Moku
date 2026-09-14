import type { PlatformAdapter } from './types'
import { TauriAdapter } from './tauri/adapter'
import { WebAdapter }   from './web/adapter'

export function detectAdapter(): PlatformAdapter {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    return new TauriAdapter()
  }
  return new WebAdapter()
}
