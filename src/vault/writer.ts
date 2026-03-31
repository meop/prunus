import { ensureDir } from '@std/fs'
import { dirname, join } from '@std/path'
import { config } from '../config.ts'
import { buildNoteContent, type Frontmatter } from './parser.ts'

// Per-(vault,path) async mutex: chained Promise so only one write runs at a time.
// Map entry is cleaned up once no further writes are queued.
const mutexes = new Map<string, Promise<void>>()

export async function writeNote(vault: string, path: string, fm: Frontmatter, body: string): Promise<void> {
  const key = `${vault}:${path}`
  const abs = join(config.vault.base, vault, path)

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
