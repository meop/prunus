import { join } from '@std/path'
import { parse } from '@std/toml'

export interface Settings {
  srv: {
    hostname?: string
    port?: number
    auth?: {
      token?: string
    }
  }
  log: {
    level?: string
  }
  db: {
    type?: string
    sqlite?: {
      path?: string
    }
    postgres?: {
      hostname?: string
      port?: number
      database?: string
      user?: string
      password?: string
    }
  }
  llm: {
    hostname?: string
    port?: number
    chat?: {
      model?: string
    }
    embed?: {
      model?: string
      dimension?: number
    }
  }
  vault?: {
    path?: string
    configDir?: string
    shape_interval?: number
  }
  search?: {
    vector_weight?: number
    fts_weight?: number
    vector_gate?: number
    dedup_threshold?: number
  }
}

const env = Deno.env.get('PRUNUS_ENV')
const filename = env ? `settings-${env}.toml` : 'settings.toml'
const settingsPath = join(import.meta.dirname ?? '', '..', filename)

export const settings = parse(await Deno.readTextFile(settingsPath)) as unknown as Settings
