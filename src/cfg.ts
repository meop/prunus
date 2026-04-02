import { join } from '@std/path'

import { SETTINGS } from './stng.ts'

const cfgDirPaths = SETTINGS.cfg.dirs.map((dir) => join(import.meta.dirname ?? '', '..', '..', dir, 'cfg')).reverse()

export const profilesDirs = cfgDirPaths.map((dir) => join(dir, 'profiles'))
