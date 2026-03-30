import 'package:flutter/material.dart';
import '../services/sync_service.dart';
import '../services/local_db_service.dart';

/// Compact status bar shown at the top of [LibraryScreen].
/// Displays live sync progress, a "Back up now" button, and the last-synced
/// timestamp. Animates smoothly between states.
class BackupStatusBar extends StatelessWidget {
  final SyncService sync;
  final LocalDbService localDb;
  final VoidCallback onBackupNow;

  const BackupStatusBar({
    super.key,
    required this.sync,
    required this.localDb,
    required this.onBackupNow,
  });

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: sync,
      builder: (context, _) {
        final progress = sync.progress;
        final theme = Theme.of(context);

        if (progress.isRunning) {
          return _RunningBar(progress: progress, theme: theme);
        }

        return _IdleBar(localDb: localDb, onBackupNow: onBackupNow, theme: theme);
      },
    );
  }
}

class _RunningBar extends StatelessWidget {
  final SyncProgress progress;
  final ThemeData theme;

  const _RunningBar({required this.progress, required this.theme});

  @override
  Widget build(BuildContext context) {
    return Container(
      color: theme.colorScheme.primaryContainer,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  value: progress.fraction > 0 ? progress.fraction : null,
                  color: theme.colorScheme.onPrimaryContainer,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  progress.currentFileName != null
                      ? 'Backing up: ${progress.currentFileName}'
                      : 'Backing up…',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onPrimaryContainer,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Text(
                '${progress.done} / ${progress.total}',
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.onPrimaryContainer,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(2),
            child: LinearProgressIndicator(
              value: progress.fraction > 0 ? progress.fraction : null,
              minHeight: 3,
              backgroundColor: theme.colorScheme.primary.withOpacity(0.2),
              valueColor: AlwaysStoppedAnimation<Color>(theme.colorScheme.primary),
            ),
          ),
        ],
      ),
    );
  }
}

class _IdleBar extends StatefulWidget {
  final LocalDbService localDb;
  final VoidCallback onBackupNow;
  final ThemeData theme;

  const _IdleBar({required this.localDb, required this.onBackupNow, required this.theme});

  @override
  State<_IdleBar> createState() => _IdleBarState();
}

class _IdleBarState extends State<_IdleBar> {
  SyncStats? _stats;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final stats = await widget.localDb.getStats();
    if (mounted) setState(() => _stats = stats);
  }

  @override
  Widget build(BuildContext context) {
    final stats = _stats;

    if (stats == null) return const SizedBox.shrink();

    final allDone = stats.pending == 0 && stats.failed == 0;

    return Container(
      color: allDone
          ? widget.theme.colorScheme.surfaceVariant
          : widget.theme.colorScheme.secondaryContainer,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          Icon(
            allDone ? Icons.cloud_done_outlined : Icons.cloud_upload_outlined,
            size: 18,
            color: allDone
                ? widget.theme.colorScheme.onSurfaceVariant
                : widget.theme.colorScheme.onSecondaryContainer,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              allDone
                  ? '${stats.uploaded} photos backed up'
                  : '${stats.pending} photo${stats.pending == 1 ? '' : 's'} waiting to back up',
              style: widget.theme.textTheme.bodySmall?.copyWith(
                color: allDone
                    ? widget.theme.colorScheme.onSurfaceVariant
                    : widget.theme.colorScheme.onSecondaryContainer,
              ),
            ),
          ),
          if (!allDone)
            TextButton(
              onPressed: widget.onBackupNow,
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: const Text('Back up now'),
            ),
        ],
      ),
    );
  }
}
