import { join } from '@std/path'
import { config } from '../config.ts'
import { type ParsedNote, parseFrontmatter } from './parser.ts'

export async function readNote(vault: string, path: string): Promise<ParsedNote> {
  const abs = join(config.vault.base, vault, path)
  const content = await Deno.readTextFile(abs)
  return parseFrontmatter(content)
}
