// Per-prompt: inject tree notes as context. Gemini CLI HTML-escapes < > in additionalContext.
import { runContextHook } from '../mod.ts'
await runContextHook('bracket', (ctx) => ({ hookSpecificOutput: { additionalContext: ctx } }))
