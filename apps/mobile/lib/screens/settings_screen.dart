import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/api_service.dart';
import '../services/auth_service.dart';
import '../services/local_db_service.dart';
import '../services/notification_service.dart';

class SettingsScreen extends StatefulWidget {
  final AuthService auth;
  final ApiService api;

  const SettingsScreen({super.key, required this.auth, required this.api});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final _localDb = LocalDbService();
  SyncStats? _stats;
  bool _wifiOnly = true;
  bool _requireCharging = true;
  bool _notificationsEnabled = true;

  @override
  void initState() {
    super.initState();
    _loadPrefs();
    _loadStats();
  }

  Future<void> _loadPrefs() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _wifiOnly = prefs.getBool('wifi_only') ?? true;
      _requireCharging = prefs.getBool('require_charging') ?? true;
      _notificationsEnabled = prefs.getBool('notifications_enabled') ?? true;
    });
  }

  Future<void> _loadStats() async {
    final stats = await _localDb.getStats();
    if (mounted) setState(() => _stats = stats);
  }

  Future<void> _setPref(String key, bool value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(key, value);
  }

  Future<void> _logout() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Sign out?'),
        content: const Text('Your backed-up photos will remain on the server.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Sign out')),
        ],
      ),
    );
    if (confirm != true) return;

    await NotificationService().unregister(widget.api);
    await widget.auth.logout();
    if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final user = widget.auth.currentUser;

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          // ── Account ────────────────────────────────────────────────────────
          _SectionHeader('Account'),
          ListTile(
            leading: CircleAvatar(
              backgroundColor: theme.colorScheme.primaryContainer,
              child: Text(
                (user?.name ?? '?').substring(0, 1).toUpperCase(),
                style: TextStyle(color: theme.colorScheme.onPrimaryContainer),
              ),
            ),
            title: Text(user?.name ?? ''),
            subtitle: Text(user?.email ?? ''),
          ),
          const Divider(height: 1),

          // ── Backup ─────────────────────────────────────────────────────────
          _SectionHeader('Backup'),
          if (_stats != null) ...[
            ListTile(
              leading: const Icon(Icons.cloud_done_outlined),
              title: const Text('Backed up'),
              trailing: Text(
                '${_stats!.uploaded} / ${_stats!.total}',
                style: theme.textTheme.bodyMedium,
              ),
            ),
            if (_stats!.failed > 0)
              ListTile(
                leading: Icon(Icons.warning_amber_outlined, color: theme.colorScheme.error),
                title: Text('Failed uploads', style: TextStyle(color: theme.colorScheme.error)),
                trailing: Text('${_stats!.failed}', style: TextStyle(color: theme.colorScheme.error)),
              ),
          ],
          SwitchListTile(
            secondary: const Icon(Icons.wifi),
            title: const Text('Wi-Fi only'),
            subtitle: const Text('Only back up when connected to Wi-Fi'),
            value: _wifiOnly,
            onChanged: (v) {
              setState(() => _wifiOnly = v);
              _setPref('wifi_only', v);
            },
          ),
          SwitchListTile(
            secondary: const Icon(Icons.battery_charging_full),
            title: const Text('Require charging'),
            subtitle: const Text('Only back up when plugged in'),
            value: _requireCharging,
            onChanged: (v) {
              setState(() => _requireCharging = v);
              _setPref('require_charging', v);
            },
          ),
          const Divider(height: 1),

          // ── Notifications ─────────────────────────────────────────────────
          _SectionHeader('Notifications'),
          SwitchListTile(
            secondary: const Icon(Icons.notifications_outlined),
            title: const Text('Backup notifications'),
            subtitle: const Text('Get notified when backup completes'),
            value: _notificationsEnabled,
            onChanged: (v) {
              setState(() => _notificationsEnabled = v);
              _setPref('notifications_enabled', v);
            },
          ),
          const Divider(height: 1),

          // ── iOS Widget ────────────────────────────────────────────────────
          _SectionHeader('Home Screen Widget'),
          ListTile(
            leading: const Icon(Icons.widgets_outlined),
            title: const Text('Photo Memories widget'),
            subtitle: const Text('Long-press your home screen → Widgets → PhotoApp'),
            onTap: () {},
          ),
          const Divider(height: 1),

          // ── Sign out ──────────────────────────────────────────────────────
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(foregroundColor: theme.colorScheme.error),
              icon: const Icon(Icons.logout),
              label: const Text('Sign out'),
              onPressed: _logout,
            ),
          ),
          const SizedBox(height: 32),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader(this.title);

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 20, 16, 4),
        child: Text(
          title.toUpperCase(),
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: Theme.of(context).colorScheme.outline,
                letterSpacing: 1.1,
              ),
        ),
      );
}
