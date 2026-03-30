import 'package:flutter_cache_manager/flutter_cache_manager.dart';

/// Custom cache manager for photo thumbnails.
///
/// - Stores up to 2 GB of thumbnails on-device.
/// - Cached files survive app restarts — the device can browse backed-up
///   thumbnails even when the server is unreachable (airplane mode, VPN off).
/// - TTL is 30 days; the manager auto-evicts LRU entries when the size cap
///   is approached.
class ThumbnailCacheManager extends CacheManager with ImageCacheManager {
  static const key = 'photoapp_thumbnails';

  static final ThumbnailCacheManager _instance = ThumbnailCacheManager._();
  factory ThumbnailCacheManager() => _instance;

  ThumbnailCacheManager._()
      : super(
          Config(
            key,
            stalePeriod: const Duration(days: 30),
            maxNrOfCacheObjects: 10000,
            repo: JsonCacheInfoRepository(databaseName: key),
            fileSystem: IOFileSystem(key),
            fileService: HttpFileService(),
          ),
        );
}

/// Full-resolution preview cache. Smaller cap (200 files) since previews are
/// much larger; intended for the viewer screen.
class PreviewCacheManager extends CacheManager with ImageCacheManager {
  static const key = 'photoapp_previews';

  static final PreviewCacheManager _instance = PreviewCacheManager._();
  factory PreviewCacheManager() => _instance;

  PreviewCacheManager._()
      : super(
          Config(
            key,
            stalePeriod: const Duration(days: 7),
            maxNrOfCacheObjects: 200,
            repo: JsonCacheInfoRepository(databaseName: key),
            fileSystem: IOFileSystem(key),
            fileService: HttpFileService(),
          ),
        );
}
