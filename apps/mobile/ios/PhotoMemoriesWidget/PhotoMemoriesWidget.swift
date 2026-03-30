import WidgetKit
import SwiftUI

// ── App Group identifier (shared with the main app target) ───────────────────
private let appGroupId = "group.com.photoapp.mobile"

// ── Timeline entry ───────────────────────────────────────────────────────────

struct MemoryEntry: TimelineEntry {
    let date: Date
    let image: UIImage?
    let photoDate: String
    let hasPhoto: Bool
}

// ── Timeline provider ────────────────────────────────────────────────────────

struct PhotoMemoriesProvider: TimelineProvider {

    private let userDefaults = UserDefaults(suiteName: appGroupId)

    func placeholder(in context: Context) -> MemoryEntry {
        MemoryEntry(date: Date(), image: nil, photoDate: "A memory", hasPhoto: false)
    }

    func getSnapshot(in context: Context, completion: @escaping (MemoryEntry) -> Void) {
        completion(makeEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<MemoryEntry>) -> Void) {
        let entry = makeEntry()
        // Refresh every 4 hours — the BGAppRefreshTask in the main app will
        // write new data to UserDefaults before the widget wakes up.
        let nextUpdate = Calendar.current.date(byAdding: .hour, value: 4, to: Date())!
        let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
        completion(timeline)
    }

    private func makeEntry() -> MemoryEntry {
        var image: UIImage? = nil
        var photoDate = ""

        if let data = userDefaults?.data(forKey: "widget_photo_data") {
            image = UIImage(data: data)
        }
        if let dateStr = userDefaults?.string(forKey: "widget_photo_date"), !dateStr.isEmpty {
            photoDate = formatDate(dateStr)
        }

        return MemoryEntry(
            date: Date(),
            image: image,
            photoDate: photoDate,
            hasPhoto: image != nil
        )
    }

    private func formatDate(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: iso) else { return "" }

        let display = DateFormatter()
        display.dateStyle = .medium
        display.timeStyle = .none
        return display.string(from: date)
    }
}

// ── Widget view ───────────────────────────────────────────────────────────────

struct PhotoMemoriesWidgetView: View {
    var entry: MemoryEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        ZStack {
            if let image = entry.image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else {
                // Placeholder when no photo is loaded yet
                LinearGradient(
                    colors: [Color(.systemBlue).opacity(0.6), Color(.systemPurple).opacity(0.6)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                VStack(spacing: 8) {
                    Image(systemName: "photo.on.rectangle.angled")
                        .font(.system(size: 32, weight: .light))
                        .foregroundColor(.white.opacity(0.8))
                    Text("PhotoApp")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.7))
                }
            }

            // Bottom gradient + date label
            VStack {
                Spacer()
                if !entry.photoDate.isEmpty {
                    LinearGradient(
                        colors: [.black.opacity(0), .black.opacity(0.6)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(height: family == .systemSmall ? 44 : 56)
                    .overlay(
                        HStack {
                            Image(systemName: "memories")
                                .font(.system(size: 10, weight: .medium))
                                .foregroundColor(.white.opacity(0.85))
                            Text(entry.photoDate)
                                .font(.system(size: family == .systemSmall ? 10 : 12, weight: .medium))
                                .foregroundColor(.white.opacity(0.85))
                                .lineLimit(1)
                            Spacer()
                        }
                        .padding(.horizontal, 10)
                        .padding(.bottom, 6),
                        alignment: .bottom
                    )
                }
            }
        }
        .widgetBackground(Color.black)
    }
}

// ── Widget configuration ──────────────────────────────────────────────────────

struct PhotoMemoriesWidget: Widget {
    let kind = "PhotoMemoriesWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PhotoMemoriesProvider()) { entry in
            PhotoMemoriesWidgetView(entry: entry)
        }
        .configurationDisplayName("Photo Memories")
        .description("A random memory from your photo library.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

// ── Preview ───────────────────────────────────────────────────────────────────

#Preview(as: .systemSmall) {
    PhotoMemoriesWidget()
} timeline: {
    MemoryEntry(date: .now, image: nil, photoDate: "March 27, 2023", hasPhoto: false)
}

// ── Backport widgetBackground for iOS 15 compatibility ───────────────────────

extension View {
    @ViewBuilder
    func widgetBackground(_ color: Color) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(color, for: .widget)
        } else {
            background(color)
        }
    }
}
