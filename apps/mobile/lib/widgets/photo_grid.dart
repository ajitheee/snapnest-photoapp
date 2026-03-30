import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../models/asset.dart';
import '../services/api_service.dart';
import '../services/cache_service.dart';

/// Virtualized photo grid. Groups assets by month and renders thumbnails with
/// the server URL prefixed so [CachedNetworkImage] can do offline caching.
class PhotoGrid extends StatelessWidget {
  final List<Asset> assets;
  final ApiService api;
  final void Function(Asset) onTap;

  const PhotoGrid({
    super.key,
    required this.assets,
    required this.api,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    if (assets.isEmpty) {
      return const Center(child: Text('No photos yet'));
    }

    // Group by YYYY-MM
    final grouped = _groupByMonth(assets);
    final keys = grouped.keys.toList()..sort((a, b) => b.compareTo(a));

    return CustomScrollView(
      slivers: [
        for (final key in keys) ...[
          SliverPersistentHeader(
            pinned: true,
            delegate: _MonthHeaderDelegate(label: _formatMonth(key)),
          ),
          SliverGrid(
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 3,
              crossAxisSpacing: 2,
              mainAxisSpacing: 2,
            ),
            delegate: SliverChildBuilderDelegate(
              (context, index) {
                final asset = grouped[key]![index];
                return _GridTile(
                  key: ValueKey(asset.id),
                  asset: asset,
                  api: api,
                  onTap: () => onTap(asset),
                );
              },
              childCount: grouped[key]!.length,
            ),
          ),
        ],
      ],
    );
  }

  Map<String, List<Asset>> _groupByMonth(List<Asset> assets) {
    final map = <String, List<Asset>>{};
    for (final a in assets) {
      final d = a.fileCreatedAt;
      final key = '${d.year}-${d.month.toString().padLeft(2, '0')}';
      (map[key] ??= []).add(a);
    }
    return map;
  }

  String _formatMonth(String key) {
    final parts = key.split('-');
    final dt = DateTime(int.parse(parts[0]), int.parse(parts[1]));
    const months = [
      '', 'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    return '${months[dt.month]} ${dt.year}';
  }
}

class _GridTile extends StatelessWidget {
  final Asset asset;
  final ApiService api;
  final VoidCallback onTap;

  const _GridTile({super.key, required this.asset, required this.api, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Stack(
        fit: StackFit.expand,
        children: [
          CachedNetworkImage(
            imageUrl: _thumbUrl(),
            cacheManager: ThumbnailCacheManager(),
            fit: BoxFit.cover,
            placeholder: (_, __) => Container(color: Colors.grey.shade200),
            errorWidget: (_, __, ___) => Container(
              color: Colors.grey.shade300,
              child: const Icon(Icons.broken_image, color: Colors.grey),
            ),
          ),
          if (asset.isVideo) _videoOverlay(),
          if (asset.isLivePhoto) _livePhotoOverlay(),
        ],
      ),
    );
  }

  String _thumbUrl() {
    // api._baseUrl is private; we build the URL using the public helper
    return api.thumbnailUrl(asset.id);
  }

  Widget _videoOverlay() => Positioned(
        bottom: 4,
        right: 4,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
          decoration: BoxDecoration(
            color: Colors.black54,
            borderRadius: BorderRadius.circular(4),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.play_circle_outline, size: 12, color: Colors.white),
              const SizedBox(width: 2),
              Text(
                _formatDuration(asset.duration ?? 0),
                style: const TextStyle(color: Colors.white, fontSize: 10),
              ),
            ],
          ),
        ),
      );

  Widget _livePhotoOverlay() => const Positioned(
        top: 4,
        left: 4,
        child: Icon(Icons.motion_photos_on, size: 16, color: Colors.white, shadows: [
          Shadow(color: Colors.black54, blurRadius: 4),
        ]),
      );

  String _formatDuration(int seconds) {
    final m = seconds ~/ 60;
    final s = seconds % 60;
    return '$m:${s.toString().padLeft(2, '0')}';
  }
}

class _MonthHeaderDelegate extends SliverPersistentHeaderDelegate {
  final String label;
  _MonthHeaderDelegate({required this.label});

  @override
  double get minExtent => 36;
  @override
  double get maxExtent => 36;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    return Container(
      color: Theme.of(context).scaffoldBackgroundColor,
      alignment: Alignment.centerLeft,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Text(
        label,
        style: Theme.of(context)
            .textTheme
            .titleSmall
            ?.copyWith(fontWeight: FontWeight.w600),
      ),
    );
  }

  @override
  bool shouldRebuild(_MonthHeaderDelegate old) => old.label != label;
}
