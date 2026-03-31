// After each turn: ingest transcript delta (Stop fires per turn, not per session).
import { runIngestHook } from '../mod.ts'
await runIngestHook('[prunus]')
