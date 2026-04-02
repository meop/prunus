import { join } from '@std/path'

import { SETTINGS } from '../stng.ts'
import { type ParsedNote, parseFrontmatter } from './parser.ts'

export async function readNote(tree: string, path: string): Promise<ParsedNote> {
  const abs = join(SETTINGS.grove.path, tree, path)
  const content = await Deno.readTextFile(abs)
  return parseFrontmatter(content)
}
