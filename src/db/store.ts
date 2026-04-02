export interface NoteParams {
  tree: string
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
  tree: string
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
  deleteNote(tree: string, path: string): Promise<void>
  getNoteByPath(tree: string, path: string): Promise<NoteRecord | null>
  getNoteById(id: string): Promise<{ tree: string; path: string } | null>
  searchNotes(p: SearchParams): Promise<SearchResult[]>
  searchNotesFts(tree: string, query: string, limit: number): Promise<SearchResult[]>
  getNotesNeedingSurvey(currentModel: string): Promise<Array<{ tree: string; path: string }>>
  checkDuplicate(tree: string, embed: number[], threshold: number): Promise<boolean>

  resolveNoteTarget(tree: string, target: string): Promise<string | null>
  upsertLinks(sourceId: string, targets: Array<{ targetId: string; type: string }>): Promise<void>
  getNoteEmbed(tree: string, path: string): Promise<number[] | null>
  getSourcesLinkingTo(targetId: string): Promise<Array<{ id: string; tree: string; path: string }>>
}
