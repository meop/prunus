// First-turn: inject vault profile as context. Qwen-Code HTML-escapes <>, use bracket tags.
import { runContextHook } from '../mod.ts'
await runContextHook('bracket', (ctx) => ({ hookSpecificOutput: { additionalContext: ctx } }))
