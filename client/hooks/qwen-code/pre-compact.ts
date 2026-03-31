// Before compaction: ingest transcript delta.
import { runIngestHook } from '../mod.ts'
await runIngestHook('[prunus/compact]')
