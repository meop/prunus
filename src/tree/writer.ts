import { ensureDir } from '@std/fs'
import { dirname, join } from '@std/path'

import { SETTINGS } from '../stng.ts'
import { buildNoteContent, type Frontmatter } from './parser.ts'

// Per-(tree,path) async mutex: chained Promise so only one write runs at a time.
// Map entry is cleaned up once no further writes are queued.
const mutexes = new Map<string, Promise<void>>()

export async function writeNote(tree: string, path: string, fm: Frontmatter, body: string): Promise<void> {
  const key = `${tree}:${path}`
  const abs = join(SETTINGS.grove.path, tree, path)

  const prev = mutexes.get(key) ?? Promise.resolve()
  let unlock!: () => void
  const lock = new Promise<void>((r) => {
    unlock = r
  })
  mutexes.set(key, lock)

  try {
    await prev
    await ensureDir(dirname(abs))
    await Deno.writeTextFile(abs, buildNoteContent(fm, body))
  } finally {
    unlock()
    if (mutexes.get(key) === lock) mutexes.delete(key)
  }
}
