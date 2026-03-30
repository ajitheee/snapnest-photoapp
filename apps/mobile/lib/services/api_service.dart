import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../models/asset.dart';
import '../models/user.dart';

/// Central HTTP client. All API calls go through here.
/// Base URL is read from SharedPreferences (set on the login screen).
class ApiService {
  static const _tokenKey = 'jwt_token';
  static const _baseUrlKey = 'server_url';

  final FlutterSecureStorage _secureStorage;
  late final Dio _dio;
  String? _baseUrl;

  ApiService({FlutterSecureStorage? storage})
      : _secureStorage = storage ?? const FlutterSecureStorage() {
    _dio = Dio()
      ..interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) async {
            final token = await _secureStorage.read(key: _tokenKey);
            if (token != null) {
              options.headers['Authorization'] = 'Bearer $token';
            }
            handler.next(options);
          },
          onError: (error, handler) {
            // Surface readable messages for UI layer
            handler.next(error);
          },
        ),
      );
  }

  // ── Configuration ──────────────────────────────────────────────────────────

  Future<void> setBaseUrl(String url) async {
    _baseUrl = url.endsWith('/') ? url.substring(0, url.length - 1) : url;
    await _secureStorage.write(key: _baseUrlKey, value: _baseUrl);
  }

  Future<String?> getBaseUrl() async {
    _baseUrl ??= await _secureStorage.read(key: _baseUrlKey);
    return _baseUrl;
  }

  String _url(String path) => '$_baseUrl/api$path';

  // ── Auth ───────────────────────────────────────────────────────────────────

  Future<({AppUser user, String token})> login(String email, String password) async {
    final res = await _dio.post(_url('/auth/login'), data: {'email': email, 'password': password});
    final token = res.data['access_token'] as String;
    await _secureStorage.write(key: _tokenKey, value: token);
    final user = AppUser.fromJson(res.data['user'] as Map<String, dynamic>);
    return (user: user, token: token);
  }

  Future<AppUser> register(String name, String email, String password) async {
    final res = await _dio.post(_url('/auth/register'), data: {'name': name, 'email': email, 'password': password});
    return AppUser.fromJson(res.data as Map<String, dynamic>);
  }

  Future<AppUser> me() async {
    final res = await _dio.get(_url('/auth/me'));
    return AppUser.fromJson(res.data as Map<String, dynamic>);
  }

  Future<void> logout() async {
    await _secureStorage.delete(key: _tokenKey);
  }

  // ── Assets ─────────────────────────────────────────────────────────────────

  Future<({List<Asset> assets, int total})> getAssets({int page = 1, int limit = 50}) async {
    final res = await _dio.get(_url('/assets'), queryParameters: {'page': page, 'limit': limit});
    final list = (res.data['assets'] as List).map((e) => Asset.fromJson(e as Map<String, dynamic>)).toList();
    return (assets: list, total: res.data['total'] as int);
  }

  Future<Asset> getAsset(String id) async {
    final res = await _dio.get(_url('/assets/$id'));
    return Asset.fromJson(res.data as Map<String, dynamic>);
  }

  String thumbnailUrl(String assetId, {String size = 'small'}) =>
      '${_url('/assets/$assetId/thumbnail')}?size=$size';

  // ── Incremental sync: bulk hash check ─────────────────────────────────────

  /// Returns the subset of [checksums] that are NOT yet in the user's library.
  Future<List<String>> checkHashes(List<String> checksums) async {
    final res = await _dio.post(_url('/assets/check-hashes'), data: {'checksums': checksums});
    return List<String>.from(res.data['missing'] as List);
  }

  // ── Resumable upload session ───────────────────────────────────────────────

  Future<({String sessionId, int bytesReceived, bool resumed})> createUploadSession({
    required String checksum,
    required String fileName,
    required int fileSize,
    required String mimeType,
    String? deviceAssetId,
  }) async {
    final res = await _dio.post(_url('/assets/upload-session'), data: {
      'checksum': checksum,
      'fileName': fileName,
      'fileSize': fileSize.toString(),
      'mimeType': mimeType,
      if (deviceAssetId != null) 'deviceAssetId': deviceAssetId,
    });
    return (
      sessionId: res.data['sessionId'] as String,
      bytesReceived: res.data['bytesReceived'] as int,
      resumed: res.data['resumed'] as bool,
    );
  }

  Future<({int bytesReceived, bool complete})> uploadChunk({
    required String sessionId,
    required int offset,
    required List<int> bytes,
    void Function(int sent, int total)? onProgress,
  }) async {
    final formData = FormData.fromMap({
      'chunk': MultipartFile.fromBytes(bytes, filename: 'chunk'),
    });
    final res = await _dio.post(
      _url('/assets/upload-session/$sessionId/chunk'),
      data: formData,
      queryParameters: {'offset': offset},
      onSendProgress: onProgress,
    );
    return (
      bytesReceived: res.data['bytesReceived'] as int,
      complete: res.data['complete'] as bool,
    );
  }

  Future<Asset> completeUploadSession({
    required String sessionId,
    DateTime? fileCreatedAt,
    String? deviceAssetId,
  }) async {
    final res = await _dio.post(_url('/assets/upload-session/$sessionId/complete'), data: {
      if (fileCreatedAt != null) 'fileCreatedAt': fileCreatedAt.toIso8601String(),
      if (deviceAssetId != null) 'deviceAssetId': deviceAssetId,
    });
    return Asset.fromJson(res.data as Map<String, dynamic>);
  }

  // ── Standard (single-request) upload ─────────────────────────────────────
  // Used for files under ~10 MB where chunking is unnecessary

  Future<Asset> uploadAsset(
    File file, {
    DateTime? fileCreatedAt,
    String? deviceAssetId,
    void Function(int sent, int total)? onProgress,
  }) async {
    final formData = FormData.fromMap({
      'file': await MultipartFile.fromFile(file.path, filename: file.path.split('/').last),
      if (fileCreatedAt != null) 'fileCreatedAt': fileCreatedAt.toIso8601String(),
      if (deviceAssetId != null) 'deviceAssetId': deviceAssetId,
    });
    final res = await _dio.post(
      _url('/assets/upload'),
      data: formData,
      onSendProgress: onProgress,
    );
    return Asset.fromJson(res.data as Map<String, dynamic>);
  }

  // ── Live Photo companion video ────────────────────────────────────────────

  Future<Asset> attachLiveVideo(String assetId, File videoFile) async {
    final formData = FormData.fromMap({
      'file': await MultipartFile.fromFile(videoFile.path, filename: videoFile.path.split('/').last),
    });
    final res = await _dio.post(_url('/assets/$assetId/live-video'), data: formData);
    return Asset.fromJson(res.data as Map<String, dynamic>);
  }

  // ── Devices (push tokens) ─────────────────────────────────────────────────

  Future<void> registerDevice(String token, String platform, {String? appVersion}) async {
    await _dio.post(_url('/devices/register'), data: {
      'token': token,
      'platform': platform,
      if (appVersion != null) 'appVersion': appVersion,
    });
  }

  Future<void> unregisterDevice(String token) async {
    await _dio.delete(_url('/devices/$token'));
  }

  // ── Memories ──────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getMemories() async {
    final res = await _dio.get(_url('/memories'));
    return res.data as Map<String, dynamic>;
  }
}
