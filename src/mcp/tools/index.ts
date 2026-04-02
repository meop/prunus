import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { register as registerDisableProfile } from './profile/disable.ts'
import { register as registerEnableProfile } from './profile/enable.ts'
import { register as registerListProfiles } from './profile/list.ts'
import { register as registerContribute } from './tree/update.ts'
import { register as registerCreateTree } from './tree/create.ts'
import { register as registerDeleteTree } from './tree/delete.ts'
import { register as registerListTrees } from './tree/list.ts'
import { register as registerReadNote } from './tree/read.ts'
import { register as registerSearchNotes } from './tree/search.ts'

export function registerTools(server: McpServer): void {
  registerContribute(server)
  registerCreateTree(server)
  registerDeleteTree(server)
  registerDisableProfile(server)
  registerEnableProfile(server)
  registerListProfiles(server)
  registerListTrees(server)
  registerReadNote(server)
  registerSearchNotes(server)
}
