import 'package:flutter/material.dart';
import '../models/asset.dart';
import '../services/api_service.dart';
import '../services/auth_service.dart';
import '../services/local_db_service.dart';
import '../services/sync_service.dart';
import '../widgets/backup_status_bar.dart';
import '../widgets/photo_grid.dart';
import 'asset_viewer_screen.dart';
import 'settings_screen.dart';

class LibraryScreen extends StatefulWidget {
  final ApiService api;
  final SyncService sync;
  final AuthService auth;

  const LibraryScreen({
    super.key,
    required this.api,
    required this.sync,
    required this.auth,
  });

  @override
  State<LibraryScreen> createState() => _LibraryScreenState();
}

class _LibraryScreenState extends State<LibraryScreen> {
  final _localDb = LocalDbService();
  List<Asset> _assets = [];
  int _total = 0;
  int _page = 1;
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;

  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _load();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _load({bool refresh = false}) async {
    if (refresh) {
      _page = 1;
      setState(() { _loading = true; _error = null; });
    }
    try {
      final result = await widget.api.getAssets(page: _page);
      if (mounted) {
        setState(() {
          if (refresh || _page == 1) {
            _assets = result.assets;
          } else {
            _assets = [..._assets, ...result.assets];
          }
          _total = result.total;
          _loading = false;
          _loadingMore = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 200) {
      _loadNextPage();
    }
  }

  void _loadNextPage() {
    if (_loadingMore || _assets.length >= _total) return;
    _page++;
    _loadingMore = true;
    _load();
  }

  Future<void> _backupNow() async {
    try {
      final count = await widget.sync.runSync();
      if (mounted && count > 0) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Backed up $count photo${count == 1 ? '' : 's'}')),
        );
        await _load(refresh: true);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Backup failed: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Photos', style: TextStyle(fontWeight: FontWeight.w600)),
            if (_total > 0)
              Text('$_total items', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.normal)),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => SettingsScreen(auth: widget.auth, api: widget.api),
              ),
            ),
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(52),
          child: BackupStatusBar(
            sync: widget.sync,
            localDb: _localDb,
            onBackupNow: _backupNow,
          ),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: () => _load(refresh: true),
        child: _buildBody(),
      ),
    );
  }

  Widget _buildBody() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Could not load photos', style: TextStyle(color: Theme.of(context).colorScheme.error)),
            const SizedBox(height: 12),
            OutlinedButton(onPressed: () => _load(refresh: true), child: const Text('Retry')),
          ],
        ),
      );
    }

    return PhotoGrid(
      assets: _assets,
      api: widget.api,
      onTap: (asset) async {
        final result = await Navigator.push<AssetViewerResult>(
          context,
          MaterialPageRoute(
            builder: (_) => AssetViewerScreen(
              asset: asset,
              api: widget.api,
              allAssets: _assets,
            ),
          ),
        );
        if (result != null && mounted) {
          setState(() {
            _assets = result.assets
                .where((a) => !result.deletedIds.contains(a.id))
                .toList();
            _total -= result.deletedIds.length;
          });
        }
      },
    );
  }
}
