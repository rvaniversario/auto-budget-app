import { DexieRepository } from './dexieRepository'
export { DEFAULT_DEBT_PLAN } from './dexieRepository'
import type { Repository } from './repository'

const dexieRepository = new DexieRepository()

/** The app-wide repository. Screens and hooks use this, never Dexie directly. */
export const repo: Repository = dexieRepository

/** The underlying database, for the sync engine only. */
export const localDatabase = dexieRepository.db

export type { Repository, NewRecord, RecordPatch } from './repository'
export { parseBackup, BACKUP_SCHEMA_VERSION, type BackupFile } from './backup'
export { onLocalChange } from './db'
