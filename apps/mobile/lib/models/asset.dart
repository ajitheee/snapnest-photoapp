/// Mirrors the server-side Asset model.
class Asset {
  final String id;
  final String ownerId;
  final String? deviceAssetId;
  final String fileName;
  final String mimeType;
  final AssetType type;
  final DateTime fileCreatedAt;
  final int fileSizeBytes;
  final bool isFavorite;
  final bool isArchived;
  final bool isLivePhoto;
  final double? locationLat;
  final double? locationLng;
  final String? locationCity;
  final String? locationCountry;
  final int? width;
  final int? height;
  final int? duration;
  final DateTime createdAt;

  const Asset({
    required this.id,
    required this.ownerId,
    this.deviceAssetId,
    required this.fileName,
    required this.mimeType,
    required this.type,
    required this.fileCreatedAt,
    required this.fileSizeBytes,
    this.isFavorite = false,
    this.isArchived = false,
    this.isLivePhoto = false,
    this.locationLat,
    this.locationLng,
    this.locationCity,
    this.locationCountry,
    this.width,
    this.height,
    this.duration,
    required this.createdAt,
  });

  factory Asset.fromJson(Map<String, dynamic> json) => Asset(
        id: json['id'] as String,
        ownerId: json['ownerId'] as String,
        deviceAssetId: json['deviceAssetId'] as String?,
        fileName: json['fileName'] as String,
        mimeType: json['mimeType'] as String,
        type: AssetType.fromString(json['type'] as String),
        fileCreatedAt: DateTime.parse(json['fileCreatedAt'] as String),
        fileSizeBytes: int.parse(json['fileSizeBytes'].toString()),
        isFavorite: json['isFavorite'] as bool? ?? false,
        isArchived: json['isArchived'] as bool? ?? false,
        isLivePhoto: json['isLivePhoto'] as bool? ?? false,
        locationLat: (json['locationLat'] as num?)?.toDouble(),
        locationLng: (json['locationLng'] as num?)?.toDouble(),
        locationCity: json['locationCity'] as String?,
        locationCountry: json['locationCountry'] as String?,
        width: json['width'] as int?,
        height: json['height'] as int?,
        duration: json['duration'] as int?,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );

  String get thumbnailUrl => '/api/assets/$id/thumbnail?size=small';
  String get previewUrl => '/api/assets/$id/thumbnail?size=large';
  bool get isVideo => type == AssetType.video;
}

enum AssetType {
  image,
  video,
  other;

  static AssetType fromString(String s) => switch (s.toUpperCase()) {
        'IMAGE' => AssetType.image,
        'VIDEO' => AssetType.video,
        _ => AssetType.other,
      };
}
