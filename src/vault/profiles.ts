import { join } from '@std/path'
import { config } from '../config.ts'

export async function loadProfile(vault: string, name: string): Promise<string> {
  if (!name) return ''
  try {
    return (await Deno.readTextFile(
      join(config.vault.base, vault, '.prunus', 'profiles', `${name}.md`),
    )).trim()
  } catch (e) {
    if (e instanceof Deno.errors.NotFound || e instanceof Deno.errors.PermissionDenied) return ''
    throw e
  }
}
