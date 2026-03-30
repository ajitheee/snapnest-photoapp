import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/user.dart';
import 'api_service.dart';

/// Manages authentication state across the app.
/// Exposes a [ValueNotifier<AppUser?>] so widgets can react to login/logout.
class AuthService extends ChangeNotifier {
  static const _serverUrlPrefKey = 'server_url';

  final ApiService _api;

  AppUser? _currentUser;
  AppUser? get currentUser => _currentUser;
  bool get isLoggedIn => _currentUser != null;

  AuthService(this._api);

  /// Restore session on cold start. Returns true if the stored token is valid.
  Future<bool> restoreSession() async {
    try {
      final baseUrl = await _api.getBaseUrl();
      if (baseUrl == null) return false;
      await _api.setBaseUrl(baseUrl);
      _currentUser = await _api.me();
      notifyListeners();
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<void> login(String serverUrl, String email, String password) async {
    await _api.setBaseUrl(serverUrl);
    final result = await _api.login(email, password);
    _currentUser = result.user;
    // Persist server URL for future launches
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_serverUrlPrefKey, serverUrl);
    notifyListeners();
  }

  Future<void> logout() async {
    await _api.logout();
    _currentUser = null;
    notifyListeners();
  }
}
