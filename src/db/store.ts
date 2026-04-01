export interface NoteParams {
  vault: string
  path: string
  id: string
  summary: string
  projects: string[]
  embed: number[] | null
  embedModel: string | null
  contentHash: string
}

export interface NoteRecord {
  id: string
  contentHash: string | null
  embedModel: string | null
  projects: string[]
}

export interface SearchResult {
  id: string
  path: string
  summary: string
  projects: string[]
  score: number
}

export interface SearchParams {
  vault: string
  queryEmbedding: number[]
  query: string
  limit: number
  vectorWeight: number
  ftsWeight: number
  vectorGate: number
}

export interface Store {
  init(): Promise<void>
  close(): Promise<void>

  upsertNote(p: NoteParams): Promise<void>
  deleteNote(vault: string, path: string): Promise<void>
  getNoteByPath(vault: string, path: string): Promise<NoteRecord | null>
  getNoteById(id: string): Promise<{ vault: string; path: string } | null>
  searchNotes(p: SearchParams): Promise<SearchResult[]>
  searchNotesFts(vault: string, query: string, limit: number): Promise<SearchResult[]>
  getNotesNeedingReindex(currentModel: string): Promise<Array<{ vault: string; path: string }>>
  checkDuplicate(vault: string, embed: number[], threshold: number): Promise<boolean>

  resolveNoteTarget(vault: string, target: string): Promise<string | null>
  upsertLinks(sourceId: string, targets: Array<{ targetId: string; type: string }>): Promise<void>
  getNoteEmbed(vault: string, path: string): Promise<number[] | null>
  getSourcesLinkingTo(targetId: string): Promise<Array<{ id: string; vault: string; path: string }>>
}
