import Flutter
import UIKit
import BackgroundTasks
import FirebaseCore
import FirebaseMessaging
import WidgetKit

@main
@objc class AppDelegate: FlutterAppDelegate {

    // Background task identifiers — must match Info.plist BGTaskSchedulerPermittedIdentifiers
    static let syncTaskId        = "com.snapnest.snapnestMobile.sync"
    static let widgetRefreshId   = "com.snapnest.snapnestMobile.widget-refresh"

    override func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {

        // ── Firebase ─────────────────────────────────────────────────────
        FirebaseApp.configure()
        Messaging.messaging().delegate = self

        // ── APNs ─────────────────────────────────────────────────────────
        UNUserNotificationCenter.current().delegate = self
        application.registerForRemoteNotifications()

        // ── Background tasks ─────────────────────────────────────────────
        registerBackgroundTasks()

        GeneratedPluginRegistrant.register(with: self)
        return super.application(application, didFinishLaunchingWithOptions: launchOptions)
    }

    // ── APNs token ───────────────────────────────────────────────────────────

    override func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Messaging.messaging().apnsToken = deviceToken
    }

    // ── Background task registration ─────────────────────────────────────────

    private func registerBackgroundTasks() {
        // BGProcessingTask: heavy sync, runs when device is idle + charging on Wi-Fi
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: AppDelegate.syncTaskId,
            using: nil
        ) { task in
            self.handleSyncTask(task as! BGProcessingTask)
        }

        // BGAppRefreshTask: lightweight widget data refresh (runs more frequently)
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: AppDelegate.widgetRefreshId,
            using: nil
        ) { task in
            self.handleWidgetRefresh(task as! BGAppRefreshTask)
        }
    }

    // Called when the app moves to the background — schedule next run
    override func applicationDidEnterBackground(_ application: UIApplication) {
        scheduleSyncTask()
        scheduleWidgetRefresh()
    }

    private func scheduleSyncTask() {
        let request = BGProcessingTaskRequest(identifier: AppDelegate.syncTaskId)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = true       // require charging
        request.earliestBeginDate = Date(timeIntervalSinceNow: 60 * 60)  // earliest: 1 hour from now
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            print("[BGTask] Failed to schedule sync: \(error)")
        }
    }

    private func scheduleWidgetRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: AppDelegate.widgetRefreshId)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 4 * 60 * 60)  // earliest: 4 hours
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            print("[BGTask] Failed to schedule widget refresh: \(error)")
        }
    }

    // ── Task handlers ────────────────────────────────────────────────────────

    private func handleSyncTask(_ task: BGProcessingTask) {
        // Re-schedule for next time immediately
        scheduleSyncTask()

        // Flutter's WorkManager plugin handles the actual Dart work; we just
        // need to satisfy the BGProcessingTask contract by marking it complete
        // once the WorkManager callback finishes. WorkManager notifies via a
        // MethodChannel. For simplicity we mark complete after a short delay —
        // WorkManager will continue in its own queue.
        task.expirationHandler = {
            task.setTaskCompleted(success: false)
        }

        // Give WorkManager up to 25 seconds to start its Dart isolate
        DispatchQueue.global().asyncAfter(deadline: .now() + 25) {
            task.setTaskCompleted(success: true)
        }
    }

    private func handleWidgetRefresh(_ task: BGAppRefreshTask) {
        scheduleWidgetRefresh()

        // Fetch a random memory photo from the server and write it to the
        // shared App Group container so the widget can read it.
        task.expirationHandler = {
            task.setTaskCompleted(success: false)
        }

        WidgetDataFetcher.shared.fetchAndSave { success in
            task.setTaskCompleted(success: success)
        }
    }
}

// ── FCM delegate ─────────────────────────────────────────────────────────────

extension AppDelegate: MessagingDelegate {
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        // The Flutter firebase_messaging plugin handles token registration
        // with the backend via its own channel — nothing extra needed here.
        print("[FCM] Token refreshed: \(fcmToken?.prefix(16) ?? "nil")…")
    }
}

// ── UNUserNotificationCenter delegate ────────────────────────────────────────

extension AppDelegate {
    override func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // Show notification banner even when app is in foreground
        if #available(iOS 14.0, *) {
            completionHandler([.banner, .badge, .sound])
        } else {
            completionHandler([.alert, .badge, .sound])
        }
    }
}

// ── Widget data fetcher ───────────────────────────────────────────────────────

/// Fetches a random memory photo URL from the API and writes it to the shared
/// App Group container. The WidgetKit extension reads from the same container.
final class WidgetDataFetcher {
    static let shared = WidgetDataFetcher()
    private init() {}

    private let appGroupId = "group.com.snapnest.snapnestMobile"
    private let userDefaults: UserDefaults? = UserDefaults(suiteName: "group.com.snapnest.snapnestMobile")

    func fetchAndSave(completion: @escaping (Bool) -> Void) {
        guard
            let serverUrl = userDefaults?.string(forKey: "server_url"),
            let token = userDefaults?.string(forKey: "jwt_token"),
            let url = URL(string: "\(serverUrl)/api/memories")
        else {
            completion(false)
            return
        }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        URLSession.shared.dataTask(with: request) { data, response, error in
            guard let data = data, error == nil,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let randomPhoto = json["randomPhoto"] as? [String: Any],
                  let assetId = randomPhoto["id"] as? String
            else {
                completion(false)
                return
            }

            let thumbUrl = "\(serverUrl)/api/assets/\(assetId)/thumbnail?size=large"
            self.downloadThumbnail(thumbUrl: thumbUrl, token: token) { imageData in
                guard let imageData = imageData else {
                    completion(false)
                    return
                }
                self.userDefaults?.set(imageData, forKey: "widget_photo_data")
                self.userDefaults?.set(thumbUrl, forKey: "widget_photo_url")
                self.userDefaults?.set(
                    (randomPhoto["fileCreatedAt"] as? String) ?? "",
                    forKey: "widget_photo_date"
                )
                // Tell WidgetKit to reload all timelines
                WidgetCenter.shared.reloadAllTimelines()
                completion(true)
            }
        }.resume()
    }

    private func downloadThumbnail(thumbUrl: String, token: String, completion: @escaping (Data?) -> Void) {
        guard let url = URL(string: thumbUrl) else { completion(nil); return }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: request) { data, _, _ in
            completion(data)
        }.resume()
    }
}
