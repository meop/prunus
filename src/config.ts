import { settings } from './settings.ts'

if (!settings.vault?.path) throw new Error('Missing required setting: vault.path')

export const config = {
  db: {
    type: (settings.db?.type ?? 'sqlite') as 'postgres' | 'sqlite',
    sqlitePath: settings.db?.sqlite?.path ?? './prunus.db',
    hostname: settings.db?.postgres?.hostname ?? '',
    port: settings.db?.postgres?.port ?? 5432,
    database: settings.db?.postgres?.database ?? '',
    user: settings.db?.postgres?.user ?? '',
    password: settings.db?.postgres?.password ?? '',
  },
  llm: {
    baseUrl: `http://${settings.llm?.hostname ?? 'localhost'}:${settings.llm?.port ?? 11434}`,
    chatModel: settings.llm?.chat?.model ?? '',
    embedDimension: settings.llm?.embed?.dimension ?? 1536,
    embedModel: settings.llm?.embed?.model ?? '',
  },
  vault: {
    base: settings.vault.path,
  },
  server: {
    hostname: settings.srv?.hostname ?? '0.0.0.0',
    port: settings.srv?.port ?? 9100,
    authToken: settings.srv?.auth?.token ?? '',
  },
  search: {
    vectorWeight: settings.search?.vector_weight ?? 0.6,
    ftsWeight: settings.search?.fts_weight ?? 0.4,
    vectorGate: settings.search?.vector_gate ?? 0.8,
    dedupThreshold: settings.search?.dedup_threshold ?? 0.85,
  },
}
