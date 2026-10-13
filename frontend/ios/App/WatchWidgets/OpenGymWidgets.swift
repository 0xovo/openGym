import SwiftUI
import WidgetKit

/*
 * openGym's complications and Smart Stack widget on the Apple Watch: the rest counting down while
 * resting, otherwise the set up next, or today's workout to start. Read from what the watch app
 * wrote (WidgetState, App Group). Text and SF Symbols only.
 *
 * The Smart Stack: high relevance only while the watch app runs a session (a rest, a set). Without
 * one this widget is quiet, so the iPhone's Live Activity for a workout running on the phone has
 * the stack instead of two cards saying the same thing.
 */
struct Entry: TimelineEntry {
    let date: Date
    let state: WidgetState

    var relevance: TimelineEntryRelevance? {
        switch state.mode {
        case "rest": return TimelineEntryRelevance(score: 100)
        case "set": return TimelineEntryRelevance(score: 60)
        case "today": return TimelineEntryRelevance(score: 10)
        default: return TimelineEntryRelevance(score: 0)
        }
    }
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry {
        Entry(date: Date(), state: WidgetState(mode: "set", title: "Bench Press", detail: "60 kg × 8", restEndsAt: nil))
    }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : Entry(date: Date(), state: WidgetState.read()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        let state = WidgetState.read()
        var entries = [Entry(date: Date(), state: state)]
        // When the rest is over the widget says so by itself; the app writes the next state then.
        if state.mode == "rest", let end = state.restEndsAt, end > Date() {
            entries.append(Entry(date: end, state: WidgetState(mode: "set", title: state.title, detail: "", restEndsAt: nil)))
        }
        completion(Timeline(entries: entries, policy: .never))
    }
}

struct WidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: Entry

    var body: some View {
        let s = entry.state
        switch family {
        case .accessoryCircular:
            if s.mode == "rest", let end = s.restEndsAt, end > entry.date {
                ProgressView(timerInterval: entry.date...end, countsDown: true) {
                    Image(systemName: "timer")
                } currentValueLabel: {
                    Text(timerInterval: entry.date...end, countsDown: true).monospacedDigit()
                }
                .progressViewStyle(.circular)
            } else {
                ZStack {
                    AccessoryWidgetBackground()
                    Image(systemName: s.mode == "today" ? "play.fill" : "dumbbell.fill").font(.title3)
                }
            }
        case .accessoryInline:
            if s.mode == "rest", let end = s.restEndsAt, end > entry.date {
                Text(timerInterval: entry.date...end, countsDown: true)
            } else {
                Text(verbatim: s.detail.isEmpty ? s.title : s.detail)
            }
        case .accessoryCorner:
            Image(systemName: s.mode == "rest" ? "timer" : "dumbbell.fill")
                .font(.title3)
                .widgetLabel {
                    if s.mode == "rest", let end = s.restEndsAt, end > entry.date {
                        Text(timerInterval: entry.date...end, countsDown: true)
                    } else {
                        Text(verbatim: s.title)
                    }
                }
        default:
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Image(systemName: s.mode == "rest" ? "timer" : s.mode == "today" ? "play.fill" : "dumbbell.fill")
                    Text(verbatim: s.mode == "rest" ? s.title : "openGym").lineLimit(1)
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
                if s.mode == "rest", let end = s.restEndsAt, end > entry.date {
                    Text(timerInterval: entry.date...end, countsDown: true)
                        .font(.system(.title2, design: .rounded).weight(.semibold).monospacedDigit())
                } else {
                    Text(verbatim: s.title)
                        .font(.system(.headline, design: .rounded))
                        .lineLimit(1)
                    if !s.detail.isEmpty {
                        Text(verbatim: s.detail).font(.system(.body, design: .rounded).monospacedDigit()).lineLimit(1)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

@main
struct OpenGymWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "OpenGymWorkout", provider: Provider()) { entry in
            WidgetView(entry: entry)
                .containerBackground(.black, for: .widget)
        }
        .configurationDisplayName("openGym")
        .description("Your rest, your next set, or today's workout.")
        .supportedFamilies([.accessoryRectangular, .accessoryCircular, .accessoryInline, .accessoryCorner])
    }
}
