import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { register as registerDisableProfile } from './profile/disable.ts'
import { register as registerEnableProfile } from './profile/enable.ts'
import { register as registerListProfiles } from './profile/list.ts'
import { register as registerCreateNote } from './note/create.ts'
import { register as registerDeleteNote } from './note/delete.ts'
import { register as registerReadNote } from './note/read.ts'
import { register as registerUpdateNote } from './note/update.ts'
import { register as registerListNotes } from './notes/list.ts'
import { register as registerSearchNotes } from './notes/search.ts'
import { register as registerUpdateNotes } from './notes/update.ts'

export function registerTools(server: McpServer): void {
  registerDisableProfile(server)
  registerEnableProfile(server)
  registerListProfiles(server)
  registerCreateNote(server)
  registerDeleteNote(server)
  registerReadNote(server)
  registerUpdateNote(server)
  registerListNotes(server)
  registerSearchNotes(server)
  registerUpdateNotes(server)
}
