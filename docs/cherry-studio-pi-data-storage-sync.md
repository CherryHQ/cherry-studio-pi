# Cherry Studio Pi Data Storage And Sync

> This document describes the current local-first Storage v2 data sync layer.
> Storage v2 is the authoritative durable data model; Redux, Dexie, and legacy
> app.db projections are runtime/cache compatibility surfaces.

## Goals

- Keep Redux as a UI state cache only.
- Store durable user data, preferences, model configuration, assistants, agents,
  conversations, knowledge, files, workbench shortcuts, and app records in Storage v2.
- Keep cache local, recoverable, and replaceable from Storage v2.
- Sync Storage v2 through WebDAV with deterministic record merge, tombstones,
  encrypted secret bundles, and safety snapshots.
- Minimize WebDAV request and file count by publishing Storage v2 rows as a
  content-addressed bundle instead of one remote file per row.
- Make sync status honest: success is reported only after the manifest is
  published, local sync state is committed, and runtime projection/hydration has
  completed when remote data was downloaded.

## Local Storage Layout

Authoritative database: `${userData}/Data/StorageV2/main.db`

Compatibility database: `${userData}/Data/app.db`

Tables:

- Storage v2 core tables: providers, provider credential secret refs, models,
  assistants, agents, skills, conversations, messages, message blocks, files,
  blobs, knowledge bases, app `kv_records`, sync tombstones, sync state, and
  sync conflicts.
- Storage v2 secret vault: encrypted local secret values referenced by durable
  records, for example model provider API keys and channel credentials.
- `app.db`: legacy app-scoped key/value, cache, sync state, conflicts, and
  workbench shortcut projection. It remains for compatibility but must not be
  treated as the only source of truth.

Contribution rules:

- New durable product data must be written to Storage v2, or mirrored to Storage
  v2 before it can be considered syncable.
- Redux state must be safe to rebuild from Storage v2 hydration.
- Dexie/runtime caches must either mirror into Storage v2 or be explicitly
  local-only.
- Sensitive values must use the Storage v2 secret vault and store only secret
  references in ordinary records.
- Model provider credentials require both the `provider_credentials` ref row and
  the encrypted secret vault bundle. Clearing a credential must publish a
  tombstone for the credential ref so older remote keys are not resurrected.
- Deletions must create tombstones when another device may need to converge.
- WebDAV sync tests should cover two isolated local instances through a real
  local WebDAV server whenever a sync contract changes.

## Sync Protocol

Remote root: `${webdavPath}/sync/v1`

Files:

- `manifest.json`: compact published index and generation number. This is the
  commit point for a successful sync.
- `storage-v2/bundle/<hash>.json`: content-addressed Storage v2 record bundle.
  The manifest points every Storage v2 record at the current bundle path.
- `storage-v2/blobs/*`: binary blob payloads referenced by file/blob records.
- `storage-v2/secrets/<hash>.json`: encrypted secret vault bundle. The path is
  based on the plaintext secret set hash, while ciphertext may be overwritten
  because encryption uses random IVs.
- `backups/*.zip`: full safety snapshots for disaster recovery only.
- `records/<scope>/<key>/<hash>.json`: legacy app-record compatibility files.
  These should stay small and are not the primary Storage v2 data path.

Merge rules:

- If only local changed since the last synced hash, upload local.
- If only remote changed since the last synced hash, apply remote.
- If both changed and hashes differ, choose the newest record by `updatedAt` and
  version so the client keeps moving. Equal timestamp/version conflicts are kept
  as unresolved conflict records for user-visible diagnosis.
- Deletes are tombstones, not immediate remote removals, so offline devices can converge.
- Remote bundle hash, secret hash, manifest generation, and sync lock ownership
  are checked before publishing the final manifest.
- Stale remote artifacts are pruned after the manifest has been published.

Runtime flow:

- Renderer mirror services flush Redux, Dexie, localStorage, conversation, file,
  and agent changes into Storage v2.
- Successful local Storage v2 writes emit a local-change signal. When auto sync
  is enabled, `DataSyncService` debounces those signals and triggers WebDAV sync.
- Before WebDAV sync, runtime mirrors are flushed with local-change notifications
  suppressed so sync preparation does not schedule a redundant sync.
- After remote data is downloaded, Storage v2 is projected/hydrated back into
  legacy runtime caches before the UI reports success.

The current implementation exposes IPC through `window.api.appData` and
`window.api.dataSync`.
