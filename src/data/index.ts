import { DexieRepository } from './dexieRepository'
import type { Repository } from './repository'

/** The app-wide repository. Swap this for a synced implementation later. */
export const repo: Repository = new DexieRepository()

export type { Repository, NewRecord, RecordPatch } from './repository'
export { parseBackup, BACKUP_SCHEMA_VERSION, type BackupFile } from './backup'
