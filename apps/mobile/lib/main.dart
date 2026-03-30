import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:workmanager/workmanager.dart';
import 'services/api_service.dart';
import 'services/auth_service.dart';
import 'services/local_db_service.dart';
import 'services/notification_service.dart';
import 'services/sync_service.dart';
import 'screens/login_screen.dart';
import 'screens/library_screen.dart';
import 'background/sync_worker.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Lock to portrait + portrait-upside-down
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // Register background sync callback before runApp (required by WorkManager)
  await Workmanager().initialize(syncCallbackDispatcher, isInDebugMode: kDebugMode);

  runApp(const PhotoApp());
}

class PhotoApp extends StatefulWidget {
  const PhotoApp({super.key});

  @override
  State<PhotoApp> createState() => _PhotoAppState();
}

class _PhotoAppState extends State<PhotoApp> {
  late final ApiService _api;
  late final AuthService _auth;
  late final SyncService _sync;
  late final LocalDbService _localDb;

  bool _loading = true;
  bool _loggedIn = false;

  @override
  void initState() {
    super.initState();
    _api = ApiService();
    _localDb = LocalDbService();
    _auth = AuthService(_api);
    _sync = SyncService(_api, _localDb);
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    final restored = await _auth.restoreSession();
    if (restored) {
      // Initialise push notifications once the user session is valid
      await NotificationService().initialise(_api);
      // Schedule periodic background sync (once a day on Wi-Fi + charging)
      await _scheduleBackgroundSync();
    }
    if (mounted) setState(() { _loading = false; _loggedIn = restored; });
  }

  Future<void> _scheduleBackgroundSync() async {
    await Workmanager().registerPeriodicTask(
      SyncWorker.taskId,
      SyncWorker.taskId,
      frequency: const Duration(hours: 24),
      constraints: Constraints(
        networkType: NetworkType.unmetered, // Wi-Fi only
        requiresCharging: true,
      ),
      existingWorkPolicy: ExistingWorkPolicy.keep,
    );
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'PhotoApp',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF1A73E8),
          brightness: Brightness.light,
        ),
        useMaterial3: true,
      ),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF1A73E8),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
      ),
      home: _loading
          ? const _SplashScreen()
          : _loggedIn
              ? LibraryScreen(api: _api, sync: _sync, auth: _auth)
              : LoginScreen(
                  auth: _auth,
                  onLoggedIn: () async {
                    await NotificationService().initialise(_api);
                    await _scheduleBackgroundSync();
                    if (mounted) setState(() => _loggedIn = true);
                  },
                ),
    );
  }
}

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: CircularProgressIndicator()),
    );
  }
}
