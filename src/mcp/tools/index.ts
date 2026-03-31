import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { register as registerCreateNote } from './note/create_note.ts'
import { register as registerCreateProfile } from './profile/create_profile.ts'
import { register as registerCreateVault } from './vault/create_vault.ts'
import { register as registerDeleteNote } from './note/delete_note.ts'
import { register as registerDeleteProfile } from './profile/delete_profile.ts'
import { register as registerDeleteVault } from './vault/delete_vault.ts'
import { register as registerListProfiles } from './profile/list_profiles.ts'
import { register as registerListVaults } from './vault/list_vaults.ts'
import { register as registerReadNote } from './note/read_note.ts'
import { register as registerSearchNotes } from './note/search_notes.ts'
import { register as registerSuggestLinks } from './note/suggest_links.ts'
import { register as registerUpdateNote } from './note/update_note.ts'
import { register as registerUpdateProfile } from './profile/update_profile.ts'

export function registerTools(server: McpServer): void {
  registerCreateNote(server)
  registerCreateProfile(server)
  registerCreateVault(server)
  registerDeleteNote(server)
  registerDeleteProfile(server)
  registerDeleteVault(server)
  registerListProfiles(server)
  registerListVaults(server)
  registerReadNote(server)
  registerSearchNotes(server)
  registerSuggestLinks(server)
  registerUpdateNote(server)
  registerUpdateProfile(server)
}
