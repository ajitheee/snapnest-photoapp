import 'dart:io';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'api_service.dart';

/// Top-level handler for background FCM messages (must be a top-level function).
@pragma('vm:entry-point')
Future<void> _firebaseBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
  debugPrint('[FCM background] ${message.notification?.title}: ${message.notification?.body}');
}

/// Initialises Firebase Messaging, requests permission, registers the FCM
/// token with the backend, and wires up foreground notification display.
class NotificationService {
  static NotificationService? _instance;
  factory NotificationService() => _instance ??= NotificationService._();
  NotificationService._();

  final _localNotifications = FlutterLocalNotificationsPlugin();
  bool _initialised = false;

  static const _androidChannel = AndroidNotificationChannel(
    'snapnest_default',
    'SnapNest',
    description: 'Backup status and shared album activity',
    importance: Importance.defaultImportance,
  );

  Future<void> initialise(ApiService api) async {
    if (_initialised) return;
    _initialised = true;

    // ── Firebase ────────────────────────────────────────────────────────────
    await Firebase.initializeApp();
    FirebaseMessaging.onBackgroundMessage(_firebaseBackgroundHandler);

    final messaging = FirebaseMessaging.instance;

    // Request permission (iOS shows a native dialog; Android 13+ also needs it)
    await messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );

    // ── Local notification display (foreground) ───────────────────────────
    await _localNotifications.initialize(
      const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(),
      ),
    );

    // Create Android notification channel
    if (Platform.isAndroid) {
      await _localNotifications
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(_androidChannel);
    }

    FirebaseMessaging.onMessage.listen((message) => _showLocalNotification(message));

    // ── Register token with backend ───────────────────────────────────────
    final token = await messaging.getToken();
    if (token != null) {
      final platform = Platform.isIOS ? 'IOS' : 'ANDROID';
      await _registerToken(api, token, platform);
    }

    // Re-register on token refresh
    messaging.onTokenRefresh.listen((newToken) async {
      final platform = Platform.isIOS ? 'IOS' : 'ANDROID';
      await _registerToken(api, newToken, platform);
    });
  }

  Future<void> _registerToken(ApiService api, String token, String platform) async {
    try {
      await api.registerDevice(token, platform);
    } catch (e) {
      debugPrint('[Notifications] Failed to register token: $e');
    }
  }

  void _showLocalNotification(RemoteMessage message) {
    final notification = message.notification;
    if (notification == null) return;

    _localNotifications.show(
      notification.hashCode,
      notification.title,
      notification.body,
      NotificationDetails(
        android: AndroidNotificationDetails(
          _androidChannel.id,
          _androidChannel.name,
          channelDescription: _androidChannel.description,
          icon: '@mipmap/ic_launcher',
        ),
        iOS: const DarwinNotificationDetails(sound: 'default'),
      ),
    );
  }

  Future<void> unregister(ApiService api) async {
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) await api.unregisterDevice(token);
      await FirebaseMessaging.instance.deleteToken();
    } catch (_) {}
  }
}
