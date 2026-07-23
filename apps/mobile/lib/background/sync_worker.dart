import 'package:flutter/foundation.dart';
import 'package:workmanager/workmanager.dart';
import '../services/api_service.dart';
import '../services/local_db_service.dart';
import '../services/notification_service.dart';
import '../services/sync_service.dart';

/// Background task ID — must match the string used in Workmanager registration.
///
/// Android: WorkManager executes [syncCallbackDispatcher] in a separate isolate.
/// iOS:     WorkManager wraps BGProcessingTask / BGAppRefreshTask and calls the
///          same dispatcher via method channel.
const String _taskId = 'com.snapnest.sync.periodic';

// Required to be a top-level function for WorkManager
@pragma('vm:entry-point')
void syncCallbackDispatcher() {
  Workmanager().executeTask((taskName, inputData) async {
    debugPrint('[SyncWorker] Task started: $taskName');

    final api = ApiService();
    final localDb = LocalDbService();
    final sync = SyncService(api, localDb);

    try {
      // Check the session is still valid before doing anything
      final serverUrl = await api.getBaseUrl();
      if (serverUrl == null) {
        debugPrint('[SyncWorker] No server URL configured — skipping');
        return true;
      }

      final uploaded = await sync.runSync(trigger: SyncTrigger.background);
      debugPrint('[SyncWorker] Uploaded $uploaded assets');

      if (uploaded > 0) {
        // Send push notification via the server (the server knows all device
        // tokens for the user). We call a lightweight "notify self" endpoint,
        // but the simpler approach for background tasks is a local notification.
        await NotificationService().initialise(api);
      }

      return true;
    } catch (e) {
      debugPrint('[SyncWorker] Error: $e');
      return false; // WorkManager will retry according to back-off policy
    }
  });
}

/// Helper that exposes the task ID used throughout the app.
abstract final class SyncWorker {
  static const taskId = _taskId;
}
