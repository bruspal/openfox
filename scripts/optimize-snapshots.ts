#!/usr/bin/env node
/**
 * Snapshot maintenance: de-duplicate stale streaming output from persisted
 * snapshots (see EventStore.migrateSnapshotStreams). Only streams that are
 * provably recoverable from the surviving result.output are dropped; pending,
 * interrupted, tool-truncated and non-redundant streams are kept.
 *
 * The migration is also auto-run in the background at server startup, so this
 * script is only needed to force it early (or when the server is stopped).
 * Either way, the migration itself creates a rollback backup
 * (`<db>.pre-de-dup.bak`) before its first rewrite.
 *
 * Usage:
 *   npm run optimize:snapshots -- --yes
 *
 * The `--yes` flag is mandatory to run it manually. Afterwards, run VACUUM to
 * physically shrink the file:
 *   sqlite3 <database-path> 'VACUUM;'
 */
import { loadConfig } from '../src/server/config.js'
import { initDatabase } from '../src/server/db/index.js'
import { EventStore } from '../src/server/events/index.js'
import { getDatabasePath } from '../src/cli/paths.js'

const REQUIRE_BACKUP = !process.argv.includes('--yes')

async function main(): Promise<void> {
  const config = loadConfig()
  // Mirror the server: an unset OPENFOX_DB_PATH (default './openfox.db') means
  // "use the platform data dir" (~/.local/share/openfox[-dev]/sessions.db).
  const dbPath =
    config.database.path !== './openfox.db'
      ? config.database.path
      : getDatabasePath(config.mode === 'development' ? 'development' : 'production')
  console.log(`[optimize-snapshots] Database: ${dbPath}`)

  if (REQUIRE_BACKUP) {
    console.error(
      '[optimize-snapshots] REFUSING: this rewrites persisted snapshots in place. ' +
        'The migration auto-creates a rollback backup, but run it with the --yes flag to proceed.',
    )
    process.exit(1)
  }

  const configWithPath = { ...config, database: { ...config.database, path: dbPath } }
  const db = initDatabase(configWithPath)
  const store = new EventStore(db)

  const report = await store.migrateSnapshotStreams()
  console.log('[optimize-snapshots] Migration report:')
  console.log(JSON.stringify(report, null, 2))

  const checkpoint = store.checkpointWal()
  console.log('[optimize-snapshots] WAL checkpoint:', JSON.stringify(checkpoint))

  if (report.skipped) {
    console.log('[optimize-snapshots] Nothing to do (snapshots already migrated).')
  } else {
    console.log(
      `[optimize-snapshots] Done: ${report.rewritten}/${report.scanned} snapshots rewritten, ` +
        `${report.droppedStreams} streams dropped, ~${((report.bytesBefore - report.bytesAfter) / 1048576).toFixed(1)}MB freed.`,
    )
    console.log('[optimize-snapshots] Rollback backup: ' + (report.backupPath ?? '(in-memory db, none)'))
    console.log('[optimize-snapshots] Tip: with the server stopped, run `VACUUM;` to physically shrink the file.')
  }

  db.close()
}

void main()
