import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';

/// Local SQLite database that tracks the sync state of every asset on this
/// device. This lets [SyncService] skip files that have already been uploaded
/// without hitting the server — making background syncs very fast after the
/// initial backup.
class LocalDbService {
  static LocalDbService? _instance;
  Database? _db;

  LocalDbService._();
  factory LocalDbService() => _instance ??= LocalDbService._();

  Future<Database> get db async => _db ??= await _open();

  Future<Database> _open() async {
    final dir = await getDatabasesPath();
    return openDatabase(
      join(dir, 'snapnest_sync.db'),
      version: 1,
      onCreate: (db, _) async {
        await db.execute('''
          CREATE TABLE sync_state (
            device_asset_id  TEXT PRIMARY KEY,
            checksum         TEXT NOT NULL,
            server_asset_id  TEXT,
            status           TEXT NOT NULL DEFAULT 'pending',
            -- pending | uploading | uploaded | failed
            error_message    TEXT,
            file_size        INTEGER NOT NULL,
            mime_type        TEXT NOT NULL,
            file_created_at  TEXT NOT NULL,
            synced_at        TEXT,
            created_at       TEXT NOT NULL DEFAULT (datetime('now'))
          )
        ''');
        await db.execute('CREATE INDEX idx_sync_status ON sync_state(status)');
        await db.execute('CREATE INDEX idx_sync_checksum ON sync_state(checksum)');

        await db.execute('''
          CREATE TABLE upload_sessions (
            session_id       TEXT PRIMARY KEY,
            device_asset_id  TEXT NOT NULL,
            checksum         TEXT NOT NULL,
            bytes_received   INTEGER NOT NULL DEFAULT 0,
            file_size        INTEGER NOT NULL,
            created_at       TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (device_asset_id) REFERENCES sync_state(device_asset_id)
          )
        ''');
      },
    );
  }

  // ── Sync state ──────────────────────────────────────────────────────────────

  Future<void> upsertAsset({
    required String deviceAssetId,
    required String checksum,
    required int fileSize,
    required String mimeType,
    required DateTime fileCreatedAt,
    String status = 'pending',
  }) async {
    final database = await db;
    await database.insert(
      'sync_state',
      {
        'device_asset_id': deviceAssetId,
        'checksum': checksum,
        'file_size': fileSize,
        'mime_type': mimeType,
        'file_created_at': fileCreatedAt.toIso8601String(),
        'status': status,
      },
      conflictAlgorithm: ConflictAlgorithm.ignore,
    );
  }

  Future<void> markUploading(String deviceAssetId) =>
      _updateStatus(deviceAssetId, 'uploading');

  Future<void> markUploaded(String deviceAssetId, String serverAssetId) async {
    final database = await db;
    await database.update(
      'sync_state',
      {'status': 'uploaded', 'server_asset_id': serverAssetId, 'synced_at': DateTime.now().toIso8601String()},
      where: 'device_asset_id = ?',
      whereArgs: [deviceAssetId],
    );
  }

  Future<void> markFailed(String deviceAssetId, String error) async {
    final database = await db;
    await database.update(
      'sync_state',
      {'status': 'failed', 'error_message': error},
      where: 'device_asset_id = ?',
      whereArgs: [deviceAssetId],
    );
  }

  Future<void> _updateStatus(String deviceAssetId, String status) async {
    final database = await db;
    await database.update(
      'sync_state',
      {'status': status},
      where: 'device_asset_id = ?',
      whereArgs: [deviceAssetId],
    );
  }

  Future<bool> isUploaded(String deviceAssetId) async {
    final database = await db;
    final rows = await database.query(
      'sync_state',
      columns: ['status'],
      where: 'device_asset_id = ? AND status = ?',
      whereArgs: [deviceAssetId, 'uploaded'],
      limit: 1,
    );
    return rows.isNotEmpty;
  }

  Future<Map<String, String>> getChecksumMap() async {
    final database = await db;
    final rows = await database.query('sync_state', columns: ['device_asset_id', 'checksum']);
    return {for (final r in rows) r['device_asset_id'] as String: r['checksum'] as String};
  }

  Future<List<Map<String, dynamic>>> getPendingAssets({int limit = 50}) async {
    final database = await db;
    return database.query(
      'sync_state',
      where: "status IN ('pending', 'failed')",
      orderBy: 'file_created_at DESC',
      limit: limit,
    );
  }

  Future<SyncStats> getStats() async {
    final database = await db;
    final rows = await database.rawQuery('''
      SELECT status, COUNT(*) AS cnt FROM sync_state GROUP BY status
    ''');
    int total = 0, uploaded = 0, pending = 0, failed = 0;
    for (final r in rows) {
      final cnt = r['cnt'] as int;
      total += cnt;
      switch (r['status'] as String) {
        case 'uploaded':
          uploaded += cnt;
        case 'pending':
        case 'uploading':
          pending += cnt;
        case 'failed':
          failed += cnt;
      }
    }
    return SyncStats(total: total, uploaded: uploaded, pending: pending, failed: failed);
  }

  // ── Upload session tracking ────────────────────────────────────────────────

  Future<void> saveSession(String deviceAssetId, String sessionId, String checksum, int fileSize) async {
    final database = await db;
    await database.insert('upload_sessions', {
      'session_id': sessionId,
      'device_asset_id': deviceAssetId,
      'checksum': checksum,
      'file_size': fileSize,
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<Map<String, dynamic>?> getSession(String deviceAssetId) async {
    final database = await db;
    final rows = await database.query(
      'upload_sessions',
      where: 'device_asset_id = ?',
      whereArgs: [deviceAssetId],
      limit: 1,
    );
    return rows.isEmpty ? null : rows.first;
  }

  Future<void> deleteSession(String deviceAssetId) async {
    final database = await db;
    await database.delete('upload_sessions', where: 'device_asset_id = ?', whereArgs: [deviceAssetId]);
  }
}

class SyncStats {
  final int total;
  final int uploaded;
  final int pending;
  final int failed;

  const SyncStats({
    required this.total,
    required this.uploaded,
    required this.pending,
    required this.failed,
  });

  double get progress => total == 0 ? 1.0 : uploaded / total;
}
