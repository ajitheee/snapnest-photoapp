import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import '../models/asset.dart';
import '../services/api_service.dart';
import '../services/cache_service.dart';

class AssetViewerResult {
  final List<Asset> assets;
  final Set<String> deletedIds;

  const AssetViewerResult({required this.assets, required this.deletedIds});
}

class AssetViewerScreen extends StatefulWidget {
  final Asset asset;
  final ApiService api;
  final List<Asset> allAssets;

  const AssetViewerScreen({
    super.key,
    required this.asset,
    required this.api,
    required this.allAssets,
  });

  @override
  State<AssetViewerScreen> createState() => _AssetViewerScreenState();
}

class _AssetViewerScreenState extends State<AssetViewerScreen>
    with SingleTickerProviderStateMixin {
  late final PageController _pageController;
  late int _currentIndex;
  late List<Asset> _assets;
  final Set<String> _deletedIds = {};
  bool _showOverlay = true;
  bool _actionInProgress = false;

  // Pinch-to-minimize state
  double _dismissScale = 1.0;
  Offset _dismissOffset = Offset.zero;
  bool _isPinchDismissing = false;
  int _pointerCount = 0;
  double _initialPinchScale = 1.0;
  static const _dismissThreshold = 0.65;

  // Animation for snap-back or dismiss
  late final AnimationController _dismissAnimController;
  late Animation<double> _scaleAnim;
  late Animation<Offset> _offsetAnim;
  late Animation<double> _opacityAnim;

  // Track pinch center for offset during dismiss
  Offset _pinchFocalPoint = Offset.zero;
  Offset _pinchStartFocalPoint = Offset.zero;

  @override
  void initState() {
    super.initState();
    _assets = List.of(widget.allAssets);
    _currentIndex = _assets.indexWhere((a) => a.id == widget.asset.id);
    if (_currentIndex == -1) _currentIndex = 0;
    _pageController = PageController(initialPage: _currentIndex);

    _dismissAnimController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 250),
    );
    _scaleAnim = AlwaysStoppedAnimation(1.0);
    _offsetAnim = AlwaysStoppedAnimation(Offset.zero);
    _opacityAnim = AlwaysStoppedAnimation(1.0);
  }

  @override
  void dispose() {
    _pageController.dispose();
    _dismissAnimController.dispose();
    super.dispose();
  }

  Asset get _current => _assets[_currentIndex];

  void _pop() {
    Navigator.pop(
      context,
      AssetViewerResult(assets: _assets, deletedIds: _deletedIds),
    );
  }

  Future<void> _toggleFavorite() async {
    if (_actionInProgress) return;
    setState(() => _actionInProgress = true);
    try {
      final updated = await widget.api.toggleFavorite(_current.id);
      setState(() {
        _assets[_currentIndex] = updated;
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _actionInProgress = false);
    }
  }

  Future<void> _toggleArchive() async {
    if (_actionInProgress) return;
    setState(() => _actionInProgress = true);
    try {
      final updated = await widget.api.toggleArchive(_current.id);
      setState(() {
        _assets[_currentIndex] = updated;
      });
      if (mounted && updated.isArchived) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Moved to archive')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _actionInProgress = false);
    }
  }

  Future<void> _deleteAsset() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Photo'),
        content: const Text('This photo will be moved to Recently Deleted.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
    if (confirm != true) return;

    setState(() => _actionInProgress = true);
    try {
      await widget.api.softDelete(_current.id);
      _deletedIds.add(_current.id);
      setState(() {
        _assets.removeAt(_currentIndex);
        if (_assets.isEmpty) {
          _pop();
          return;
        }
        if (_currentIndex >= _assets.length) {
          _currentIndex = _assets.length - 1;
        }
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _actionInProgress = false);
    }
  }

  Future<void> _shareAsset() async {
    final url = widget.api.thumbnailUrl(_current.id, size: 'large');
    await Share.share('${_current.fileName}\n$url');
  }

  void _onScaleStart(ScaleStartDetails details) {
    if (details.pointerCount >= 2) {
      _isPinchDismissing = true;
      _initialPinchScale = _dismissScale;
      _pinchStartFocalPoint = details.focalPoint;
      _pinchFocalPoint = details.focalPoint;
      _dismissAnimController.stop();
    }
    _pointerCount = details.pointerCount;
  }

  void _onScaleUpdate(ScaleUpdateDetails details) {
    if (!_isPinchDismissing || details.pointerCount < 2) return;
    _pointerCount = details.pointerCount;
    _pinchFocalPoint = details.focalPoint;

    final newScale = (_initialPinchScale * details.scale).clamp(0.3, 1.0);
    final focalDelta = details.focalPoint - _pinchStartFocalPoint;

    setState(() {
      _dismissScale = newScale;
      _dismissOffset = focalDelta;
    });
  }

  void _onScaleEnd(ScaleEndDetails details) {
    if (!_isPinchDismissing) return;
    _isPinchDismissing = false;
    _pointerCount = 0;

    if (_dismissScale <= _dismissThreshold) {
      _animateDismiss();
    } else {
      _animateSnapBack();
    }
  }

  void _animateSnapBack() {
    _scaleAnim = Tween<double>(begin: _dismissScale, end: 1.0)
        .animate(CurvedAnimation(parent: _dismissAnimController, curve: Curves.easeOutCubic));
    _offsetAnim = Tween<Offset>(begin: _dismissOffset, end: Offset.zero)
        .animate(CurvedAnimation(parent: _dismissAnimController, curve: Curves.easeOutCubic));
    _opacityAnim = AlwaysStoppedAnimation(1.0);

    _dismissAnimController.reset();
    _dismissAnimController.addListener(_onAnimTick);
    _dismissAnimController.forward().then((_) {
      _dismissAnimController.removeListener(_onAnimTick);
      if (mounted) {
        setState(() {
          _dismissScale = 1.0;
          _dismissOffset = Offset.zero;
        });
      }
    });
  }

  void _animateDismiss() {
    _scaleAnim = Tween<double>(begin: _dismissScale, end: 0.2)
        .animate(CurvedAnimation(parent: _dismissAnimController, curve: Curves.easeInCubic));
    _offsetAnim = Tween<Offset>(begin: _dismissOffset, end: _dismissOffset)
        .animate(CurvedAnimation(parent: _dismissAnimController, curve: Curves.easeInCubic));
    _opacityAnim = Tween<double>(begin: _bgOpacity, end: 0.0)
        .animate(CurvedAnimation(parent: _dismissAnimController, curve: Curves.easeInCubic));

    _dismissAnimController.reset();
    _dismissAnimController.addListener(_onAnimTick);
    _dismissAnimController.forward().then((_) {
      _dismissAnimController.removeListener(_onAnimTick);
      if (mounted) _pop();
    });
  }

  void _onAnimTick() {
    if (mounted) {
      setState(() {
        _dismissScale = _scaleAnim.value;
        _dismissOffset = _offsetAnim.value;
      });
    }
  }

  double get _bgOpacity => _dismissScale < 1.0
      ? ((_dismissScale - 0.3) / 0.7).clamp(0.0, 1.0)
      : 1.0;

  @override
  Widget build(BuildContext context) {
    final animating = _dismissAnimController.isAnimating;
    final bgOp = animating ? (_opacityAnim.value) : _bgOpacity;

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: Container(
        color: Colors.black.withOpacity(bgOp),
        child: GestureDetector(
          onTap: () => setState(() => _showOverlay = !_showOverlay),
          onScaleStart: _onScaleStart,
          onScaleUpdate: _onScaleUpdate,
          onScaleEnd: _onScaleEnd,
          child: Stack(
            fit: StackFit.expand,
            children: [
              // Photo page view with pinch-to-minimize transform
              Transform(
                alignment: Alignment.center,
                transform: Matrix4.identity()
                  ..translate(_dismissOffset.dx, _dismissOffset.dy)
                  ..scale(_dismissScale),
                child: PageView.builder(
                  controller: _pageController,
                  itemCount: _assets.length,
                  physics: _isPinchDismissing || _dismissScale < 1.0
                      ? const NeverScrollableScrollPhysics()
                      : null,
                  onPageChanged: (i) => setState(() => _currentIndex = i),
                  itemBuilder: (context, index) {
                    final asset = _assets[index];
                    return CachedNetworkImage(
                      imageUrl: widget.api.thumbnailUrl(asset.id, size: 'large'),
                      cacheManager: PreviewCacheManager(),
                      fit: BoxFit.contain,
                      placeholder: (_, __) => const Center(
                        child: CircularProgressIndicator(color: Colors.white),
                      ),
                      errorWidget: (_, __, ___) => const Center(
                        child: Icon(Icons.broken_image, color: Colors.white54, size: 64),
                      ),
                    );
                  },
                ),
              ),

              // Top overlay — back button + live photo badge
              if (_dismissScale == 1.0 && !animating)
                AnimatedOpacity(
                  opacity: _showOverlay ? 1.0 : 0.0,
                  duration: const Duration(milliseconds: 200),
                  child: Container(
                    decoration: const BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [Colors.black54, Colors.transparent],
                        stops: [0.0, 0.3],
                      ),
                    ),
                    child: SafeArea(
                      child: Row(
                        children: [
                          IconButton(
                            icon: const Icon(Icons.arrow_back, color: Colors.white),
                            onPressed: _pop,
                          ),
                          const Spacer(),
                          if (_current.isLivePhoto)
                            Container(
                              margin: const EdgeInsets.only(right: 8),
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: Colors.black45,
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: const Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(Icons.motion_photos_on, color: Colors.white, size: 14),
                                  SizedBox(width: 4),
                                  Text('LIVE', style: TextStyle(color: Colors.white, fontSize: 11)),
                                ],
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                ),

              // Bottom metadata + action bar overlay
              if (_dismissScale == 1.0 && !animating)
                AnimatedOpacity(
                  opacity: _showOverlay ? 1.0 : 0.0,
                  duration: const Duration(milliseconds: 200),
                  child: Align(
                    alignment: Alignment.bottomCenter,
                    child: Container(
                      decoration: const BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.bottomCenter,
                          end: Alignment.topCenter,
                          colors: [Colors.black87, Colors.transparent],
                          stops: [0.0, 0.5],
                        ),
                      ),
                      padding: const EdgeInsets.fromLTRB(16, 40, 16, 16),
                      child: SafeArea(
                        top: false,
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _current.fileName,
                              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w500),
                              overflow: TextOverflow.ellipsis,
                            ),
                            const SizedBox(height: 4),
                            Text(
                              _formatDate(_current.fileCreatedAt),
                              style: const TextStyle(color: Colors.white70, fontSize: 13),
                            ),
                            if (_current.locationCity != null)
                              Text(
                                [_current.locationCity, _current.locationCountry]
                                    .whereType<String>()
                                    .join(', '),
                                style: const TextStyle(color: Colors.white70, fontSize: 13),
                              ),
                            const SizedBox(height: 16),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceAround,
                              children: [
                                _actionButton(
                                  icon: _current.isFavorite
                                      ? Icons.favorite
                                      : Icons.favorite_border,
                                  label: 'Favorite',
                                  color: _current.isFavorite ? Colors.red : Colors.white,
                                  onTap: _toggleFavorite,
                                ),
                                _actionButton(
                                  icon: Icons.share_outlined,
                                  label: 'Share',
                                  onTap: _shareAsset,
                                ),
                                _actionButton(
                                  icon: _current.isArchived
                                      ? Icons.unarchive_outlined
                                      : Icons.archive_outlined,
                                  label: _current.isArchived ? 'Unarchive' : 'Archive',
                                  onTap: _toggleArchive,
                                ),
                                _actionButton(
                                  icon: Icons.delete_outline,
                                  label: 'Delete',
                                  color: Colors.white,
                                  onTap: _deleteAsset,
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _actionButton({
    required IconData icon,
    required String label,
    Color color = Colors.white,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: _actionInProgress ? null : onTap,
      child: Opacity(
        opacity: _actionInProgress ? 0.5 : 1.0,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: color, size: 26),
            const SizedBox(height: 4),
            Text(label, style: TextStyle(color: color, fontSize: 11)),
          ],
        ),
      ),
    );
  }

  String _formatDate(DateTime dt) {
    const months = [
      '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${months[dt.month]} ${dt.day}, ${dt.year}  '
        '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }
}
