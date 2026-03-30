class AppUser {
  final String id;
  final String email;
  final String name;
  final bool isAdmin;

  const AppUser({
    required this.id,
    required this.email,
    required this.name,
    this.isAdmin = false,
  });

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
        id: json['id'] as String,
        email: json['email'] as String,
        name: json['name'] as String,
        isAdmin: json['isAdmin'] as bool? ?? false,
      );
}
