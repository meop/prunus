// First-turn: inject vault profile as context. Claude Code does not HTML-escape additionalContext.
import { runContextHook } from '../mod.ts'
await runContextHook('xml', (ctx) => ({ additionalContext: ctx }))
