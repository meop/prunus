import { join, resolve } from '@std/path'
import { settings } from './settings.ts'

const vaultPath = settings.vault?.path ?? './.vault'
const configDir = settings.vault?.configDir || join(resolve(vaultPath), '..', 'prunus-config')
const secretDir = join(resolve(configDir), '..', 'prunus-config-secret')

export const config = {
  db: {
    type: (settings.db?.type ?? 'sqlite') as 'postgres' | 'sqlite',
    sqliteDir: settings.db?.sqlite?.path ?? './.db',
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
    base: vaultPath,
    profilesDir: join(configDir, 'cfg', 'profiles'),
    secretProfilesDir: join(secretDir, 'cfg', 'profiles'),
    shapeInterval: settings.vault?.shape_interval ?? 20,
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
