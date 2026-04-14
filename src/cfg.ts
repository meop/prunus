import { join } from '@std/path'

import { SETTINGS } from './stng.ts'

const cfgBasePath = SETTINGS.cfg.dir.startsWith('/')
  ? SETTINGS.cfg.dir
  : join(import.meta.dirname ?? '', '..', SETTINGS.cfg.dir)

export const profilesDir = join(cfgBasePath, 'profiles')
