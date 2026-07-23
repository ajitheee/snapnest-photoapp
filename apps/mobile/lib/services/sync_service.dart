import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:photo_manager/photo_manager.dart';
import '../models/asset.dart' as models;
import 'api_service.dart';
import 'local_db_service.dart';

/// Chunk size for resumable uploads: 5 MB.
const _chunkSize = 5 * 1024 * 1024;

/// Maximum assets to check/upload in a single background run.
const _batchSize = 50;

enum SyncTrigger { manual, background, wifi }

class SyncProgress {
  final int total;
  final int done;
  final int failed;
  final String? currentFileName;
  final bool isRunning;

  const SyncProgress({
    this.total = 0,
    this.done = 0,
    this.failed = 0,
    this.currentFileName,
    this.isRunning = false,
  });

  double get fraction => total == 0 ? 0.0 : done / total;
}

/// Orchestrates background photo backup. Can be called from:
///  - [SyncWorker] (WorkManager / BGTaskScheduler background task)
///  - UI "Backup now" button
///  - Foreground service (Android)
class SyncService extends ChangeNotifier {
  final ApiService _api;
  final LocalDbService _db;

  SyncProgress _progress = const SyncProgress();
  SyncProgress get progress => _progress;

  bool _cancelled = false;

  SyncService(this._api, this._db);

  void cancel() => _cancelled = true;

  /// Entry point. Returns the number of assets successfully uploaded.
  Future<int> runSync({SyncTrigger trigger = SyncTrigger.manual}) async {
    _cancelled = false;
    _updateProgress(const SyncProgress(isRunning: true));

    try {
      // 1. Request photo library access
      final permission = await PhotoManager.requestPermissionExtend();
      if (!permission.isAuth) {
        _updateProgress(const SyncProgress(isRunning: false));
        return 0;
      }

      // 2. Enumerate all device assets
      final albums = await PhotoManager.getAssetPathList(type: RequestType.common);
      final deviceAssets = <AssetEntity>[];
      for (final album in albums) {
        final assets = await album.getAssetListRange(start: 0, end: await album.assetCountAsync);
        deviceAssets.addAll(assets);
      }

      // Deduplicate by asset ID
      final seen = <String>{};
      final unique = deviceAssets.where((a) => seen.add(a.id)).toList();

      // 3. Register new assets in local DB (first-time scan)
      for (final entity in unique) {
        final file = await entity.file;
        if (file == null) continue;
        await _db.upsertAsset(
          deviceAssetId: entity.id,
          checksum: '', // will be computed below when actually uploading
          fileSize: await file.length(),
          mimeType: _mimeType(entity),
          fileCreatedAt: entity.createDateTime,
        );
      }

      // 4. Filter to only pending/failed assets
      final pending = unique.where((e) => !_isCached(e.id)).toList();
      if (pending.isEmpty) {
        _updateProgress(const SyncProgress(isRunning: false));
        return 0;
      }

      // Work in batches to avoid memory pressure
      final batch = pending.take(_batchSize).toList();
      _updateProgress(SyncProgress(total: batch.length, isRunning: true));

      // 5. Compute checksums for this batch
      final checksumMap = <String, String>{};
      for (final entity in batch) {
        if (_cancelled) break;
        final file = await entity.file;
        if (file == null) continue;
        checksumMap[entity.id] = await _computeChecksum(file);
      }

      // 6. Bulk hash-check: ask server which ones are new
      final allChecksums = checksumMap.values.toList();
      final missingChecksums = await _api.checkHashes(allChecksums);
      final missingSet = Set<String>.from(missingChecksums);

      // Mark already-uploaded items straight away
      for (final entry in checksumMap.entries) {
        if (!missingSet.contains(entry.value)) {
          await _db.markUploaded(entry.key, 'dedup-${entry.value}');
        }
      }

      // 7. Upload missing assets
      int uploaded = 0;
      int done = 0;

      for (final entity in batch) {
        if (_cancelled) break;

        final checksum = checksumMap[entity.id];
        if (checksum == null || !missingSet.contains(checksum)) {
          done++;
          continue;
        }

        final file = await entity.file;
        if (file == null) { done++; continue; }

        _updateProgress(SyncProgress(
          total: batch.length,
          done: done,
          currentFileName: entity.title ?? entity.id,
          isRunning: true,
        ));

        final success = await _uploadAsset(entity, file, checksum);
        if (success) uploaded++;
        done++;
      }

      _updateProgress(SyncProgress(total: batch.length, done: done, isRunning: false));
      return uploaded;
    } catch (e) {
      _updateProgress(const SyncProgress(isRunning: false));
      rethrow;
    }
  }

  Future<bool> _uploadAsset(AssetEntity entity, File file, String checksum) async {
    await _db.markUploading(entity.id);
    try {
      final fileSize = await file.length();
      final mimeType = _mimeType(entity);

      models.Asset? uploadedAsset;

      if (fileSize <= _chunkSize) {
        // Small file: single-shot upload
        uploadedAsset = await _api.uploadAsset(
          file,
          fileCreatedAt: entity.createDateTime,
          deviceAssetId: entity.id,
        );
      } else {
        // Large file: resumable chunked upload
        uploadedAsset = await _resumableUpload(entity, file, checksum, fileSize, mimeType);
      }

      if (uploadedAsset != null) {
        await _db.markUploaded(entity.id, uploadedAsset.id);

        // Handle Live Photo: also upload the video companion
        if (entity.type == AssetType.image) {
          await _tryUploadLivePhotoVideo(uploadedAsset.id, entity);
        }
        return true;
      }
      return false;
    } catch (e) {
      await _db.markFailed(entity.id, e.toString());
      return false;
    }
  }

  Future<models.Asset?> _resumableUpload(
    AssetEntity entity,
    File file,
    String checksum,
    int fileSize,
    String mimeType,
  ) async {
    // Check for existing session
    final savedSession = await _db.getSession(entity.id);

    String sessionId;
    int startOffset;

    if (savedSession != null && savedSession['checksum'] == checksum) {
      sessionId = savedSession['session_id'] as String;
      startOffset = savedSession['bytes_received'] as int;
    } else {
      final session = await _api.createUploadSession(
        checksum: checksum,
        fileName: entity.title ?? entity.id,
        fileSize: fileSize,
        mimeType: mimeType,
        deviceAssetId: entity.id,
      );
      sessionId = session.sessionId;
      startOffset = session.bytesReceived;
      await _db.saveSession(entity.id, sessionId, checksum, fileSize);
    }

    // Stream chunks from startOffset
    final raf = await file.open();
    try {
      int offset = startOffset;
      while (offset < fileSize) {
        if (_cancelled) return null;
        await raf.setPosition(offset);
        final bytesToRead = (fileSize - offset).clamp(0, _chunkSize);
        final buffer = await raf.read(bytesToRead);
        await _api.uploadChunk(sessionId: sessionId, offset: offset, bytes: buffer);
        offset += buffer.length;
      }
    } finally {
      await raf.close();
    }

    final asset = await _api.completeUploadSession(
      sessionId: sessionId,
      fileCreatedAt: entity.createDateTime,
      deviceAssetId: entity.id,
    );
    await _db.deleteSession(entity.id);
    return asset;
  }

  Future<void> _tryUploadLivePhotoVideo(String serverAssetId, AssetEntity entity) async {
    try {
      // photo_manager exposes the live photo video via originFile on iOS
      // and via getLivePhoto on Android (Pixel motion photos)
      final liveVideo = await entity.originFile;
      if (liveVideo != null &&
          (liveVideo.path.endsWith('.mov') || liveVideo.path.endsWith('.mp4'))) {
        await _api.attachLiveVideo(serverAssetId, liveVideo);
      }
    } catch (_) {
      // Live photo video upload is best-effort — don't fail the parent asset
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  final _uploadedCache = <String>{};

  bool _isCached(String deviceAssetId) => _uploadedCache.contains(deviceAssetId);

  void _updateProgress(SyncProgress p) {
    _progress = p;
    notifyListeners();
  }

  Future<String> _computeChecksum(File file) async {
    final bytes = await file.readAsBytes();
    return sha256.convert(bytes).toString();
  }

  String _mimeType(AssetEntity entity) {
    if (entity.type == AssetType.video) return 'video/mp4';
    final ext = (entity.title ?? '').split('.').last.toLowerCase();
    return switch (ext) {
      'jpg' || 'jpeg' => 'image/jpeg',
      'png' => 'image/png',
      'gif' => 'image/gif',
      'heic' || 'heif' => 'image/heic',
      'webp' => 'image/webp',
      _ => 'image/jpeg',
    };
  }
}
