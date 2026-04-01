import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { register as registerReadNote } from './note/read_note.ts'
import { register as registerSearchNotes } from './note/search_notes.ts'
import { register as registerDisableProfile } from './profile/disable_profile.ts'
import { register as registerEnableProfile } from './profile/enable_profile.ts'
import { register as registerListProfiles } from './profile/list_profiles.ts'
import { register as registerCreateVault } from './vault/create_vault.ts'
import { register as registerDeleteVault } from './vault/delete_vault.ts'
import { register as registerListVaults } from './vault/list_vaults.ts'

export function registerTools(server: McpServer): void {
  registerCreateVault(server)
  registerDeleteVault(server)
  registerDisableProfile(server)
  registerEnableProfile(server)
  registerListProfiles(server)
  registerListVaults(server)
  registerReadNote(server)
  registerSearchNotes(server)
}
