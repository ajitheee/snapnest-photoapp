import 'package:flutter/material.dart';
import '../services/auth_service.dart';

class LoginScreen extends StatefulWidget {
  final AuthService auth;
  final VoidCallback onLoggedIn;

  const LoginScreen({super.key, required this.auth, required this.onLoggedIn});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _serverController = TextEditingController(text: 'https://192.168.86.108');
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();

  bool _loading = false;
  String? _error;
  bool _obscurePassword = true;

  @override
  void dispose() {
    _serverController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() { _loading = true; _error = null; });

    try {
      await widget.auth.login(
        _serverController.text.trim(),
        _emailController.text.trim(),
        _passwordController.text,
      );
      widget.onLoggedIn();
    } catch (e) {
      setState(() => _error = _friendlyError(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _friendlyError(Object e) {
    final msg = e.toString();
    if (msg.contains('401') || msg.contains('Unauthorized')) return 'Invalid email or password.';
    if (msg.contains('connection') || msg.contains('SocketException')) {
      return 'Cannot reach the server. Check the URL and your network.';
    }
    return 'Login failed. Please try again.';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Icon(Icons.photo_library_outlined, size: 64, color: theme.colorScheme.primary),
                    const SizedBox(height: 16),
                    Text(
                      'SnapNest',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Sign in to your self-hosted library',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.outline),
                    ),
                    const SizedBox(height: 40),
                    TextFormField(
                      controller: _serverController,
                      decoration: const InputDecoration(
                        labelText: 'Server URL',
                        hintText: 'https://192.168.86.108',
                        prefixIcon: Icon(Icons.dns_outlined),
                        border: OutlineInputBorder(),
                      ),
                      keyboardType: TextInputType.url,
                      autocorrect: false,
                      validator: (v) =>
                          (v == null || v.isEmpty) ? 'Enter your server URL' : null,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _emailController,
                      decoration: const InputDecoration(
                        labelText: 'Email',
                        prefixIcon: Icon(Icons.email_outlined),
                        border: OutlineInputBorder(),
                      ),
                      keyboardType: TextInputType.emailAddress,
                      autocorrect: false,
                      validator: (v) =>
                          (v == null || !v.contains('@')) ? 'Enter a valid email' : null,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _passwordController,
                      obscureText: _obscurePassword,
                      decoration: InputDecoration(
                        labelText: 'Password',
                        prefixIcon: const Icon(Icons.lock_outlined),
                        border: const OutlineInputBorder(),
                        suffixIcon: IconButton(
                          icon: Icon(_obscurePassword ? Icons.visibility : Icons.visibility_off),
                          onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                        ),
                      ),
                      validator: (v) =>
                          (v == null || v.isEmpty) ? 'Enter your password' : null,
                    ),
                    const SizedBox(height: 24),
                    if (_error != null) ...[
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.errorContainer,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          _error!,
                          style: TextStyle(color: theme.colorScheme.onErrorContainer),
                        ),
                      ),
                      const SizedBox(height: 16),
                    ],
                    FilledButton(
                      onPressed: _loading ? null : _submit,
                      style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      child: _loading
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : const Text('Sign in', style: TextStyle(fontSize: 16)),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
