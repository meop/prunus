import { config } from '../config.ts'
import { PgStore } from './pg.ts'
import { SqliteStore } from './sqlite.ts'
import type { Store } from './store.ts'

let _store: Store | null = null

export function getStore(): Store {
  if (!_store) throw new Error('Store not initialized — call initStore() first')
  return _store
}

export async function initStore(): Promise<Store> {
  if (config.db.type === 'postgres') {
    _store = new PgStore()
  } else {
    _store = new SqliteStore()
  }
  await _store.init()
  return _store
}
