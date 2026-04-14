import { join } from '@std/path'
import { parse } from '@std/toml'

export interface Stng {
  cfg: {
    dir: string
  }
  db: {
    postgres: {
      database: string
      hostname: string
      password: string
      port: number
      username: string
    }
    sqlite: {
      path: string
    }
    type: string
  }
  grove: {
    path: string
    shape: {
      interval: number
    }
  }
  llm: {
    chat: {
      model: string
    }
    embed: {
      dimension: number
      model: string
    }
    hostname: string
    port: number
  }
  log: {
    level: string
  }
  search: {
    dedup: {
      threshold: number
    }
    fts: {
      weight: number
    }
    vector: {
      gate: number
      weight: number
    }
  }
  srv: {
    auth: {
      token: string
    }
    hostname: string
    port: number
  }
}

const env = Deno.env.get('PRUNUS_ENV')
const filename = env ? `settings-${env}.toml` : 'settings.toml'
const settingsPath = join(import.meta.dirname ?? '', '..', filename)

// deno-lint-ignore no-explicit-any
const raw = parse(await Deno.readTextFile(settingsPath)) as any

export const SETTINGS: Stng = {
  cfg: {
    dir: Deno.env.get('PRUNUS_CFG_DIR') ?? raw.cfg?.dir ?? './cfg',
  },
  db: {
    postgres: {
      database: raw.db?.postgres?.database ?? '',
      hostname: raw.db?.postgres?.hostname ?? '',
      password: raw.db?.postgres?.password ?? '',
      port: raw.db?.postgres?.port ?? 5432,
      username: raw.db?.postgres?.username ?? '',
    },
    sqlite: {
      path: raw.db?.sqlite?.path ?? './.db',
    },
    type: raw.db?.type ?? 'sqlite',
  },
  grove: {
    path: raw.grove?.path ?? './.grove',
    shape: {
      interval: raw.grove?.shape?.interval ?? 20,
    },
  },
  llm: {
    chat: {
      model: raw.llm?.chat?.model ?? '',
    },
    embed: {
      dimension: raw.llm?.embed?.dimension ?? 1536,
      model: raw.llm?.embed?.model ?? '',
    },
    hostname: raw.llm?.hostname ?? 'localhost',
    port: raw.llm?.port ?? 11434,
  },
  log: {
    level: raw.log?.level ?? 'info',
  },
  search: {
    dedup: {
      threshold: raw.search?.dedup?.threshold ?? 0.85,
    },
    fts: {
      weight: raw.search?.fts?.weight ?? 0.4,
    },
    vector: {
      gate: raw.search?.vector?.gate ?? 0.8,
      weight: raw.search?.vector?.weight ?? 0.6,
    },
  },
  srv: {
    auth: {
      token: raw.srv?.auth?.token ?? '',
    },
    hostname: raw.srv?.hostname ?? '0.0.0.0',
    port: raw.srv?.port ?? 80,
  },
}
