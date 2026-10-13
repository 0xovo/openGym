import SwiftUI

/*
 * openGym on the Apple Watch: the workout running on the iPhone, one set at a time. The Digital
 * Crown sets the reps (or, after a tap on the weight, the weight) before "Done"; the rest counts
 * down here and taps the wrist when it is over. Text and SF Symbols only.
 */
@main
struct OpenGymWatchApp: App {
    @StateObject private var store = SessionStore()

    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(store)
        }
    }
}

struct RootView: View {
    @EnvironmentObject var store: SessionStore

    var body: some View {
        if store.workout == nil {
            VStack(spacing: 8) {
                Image(systemName: "dumbbell.fill").font(.title2).foregroundStyle(.green)
                Text("No workout running").font(.headline)
                Text("Start one on your iPhone and it shows up here.")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            .padding()
        } else if let end = store.restEndsAt, end > Date() {
            RestView(end: end)
        } else {
            SetView()
        }
    }
}

enum CrownTarget { case reps, weight }

struct SetView: View {
    @EnvironmentObject var store: SessionStore
    @State private var crown: CrownTarget = .reps

    private func number(_ v: Double) -> String {
        v.rounded() == v ? String(Int(v)) : String(format: "%.1f", v)
    }

    var body: some View {
        if let entry = store.entry {
            VStack(alignment: .leading, spacing: 4) {
                Text(entry.name).font(.headline).lineLimit(2).minimumScaleFactor(0.7)
                if let si = store.setIndex {
                    let warm = entry.sets[si].warmup
                    Text(warm ? "Warm-up \(si + 1) of \(entry.sets.count)" : "Set \(si + 1) of \(entry.sets.count)")
                        .font(.footnote).foregroundStyle(.secondary)
                    HStack(spacing: 6) {
                        Text("\(number(store.weight)) \(store.unit)")
                            .font(.title3.monospacedDigit())
                            .foregroundStyle(crown == .weight ? .green : .primary)
                            .onTapGesture { crown = .weight }
                        Text("×").foregroundStyle(.secondary)
                        Text(number(store.reps))
                            .font(.title3.monospacedDigit())
                            .foregroundStyle(crown == .reps ? .green : .primary)
                            .onTapGesture { crown = .reps }
                    }
                    .focusable(true)
                    .digitalCrownRotation(crownBinding, from: 0, through: crown == .weight ? 500 : 100,
                                          by: crown == .weight ? store.weightStep : 1, sensitivity: .low,
                                          isContinuous: false, isHapticFeedbackEnabled: true)
                    if let last = entry.last {
                        Text("Last time: \(last)").font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                    }
                    Button { store.completeSet() } label: {
                        Label("Done", systemImage: "checkmark")
                    }
                    .tint(.green)
                } else {
                    Label("All sets done", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                }
                HStack {
                    Button { store.move(by: -1) } label: { Image(systemName: "chevron.left") }
                        .disabled(store.entryIndex == 0)
                    Spacer()
                    Text("\(store.entryIndex + 1)/\(store.workout?.entries.count ?? 0)").font(.caption2).foregroundStyle(.secondary)
                    Spacer()
                    Button { store.move(by: 1) } label: { Image(systemName: "chevron.right") }
                        .disabled(store.entryIndex >= (store.workout?.entries.count ?? 1) - 1)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 4)
        }
    }

    private var crownBinding: Binding<Double> {
        Binding(
            get: { crown == .weight ? store.weight : store.reps },
            set: { v in if crown == .weight { store.weight = max(0, v) } else { store.reps = max(0, v.rounded()) } }
        )
    }
}

struct RestView: View {
    @EnvironmentObject var store: SessionStore
    let end: Date

    var body: some View {
        VStack(spacing: 8) {
            Text("Rest").font(.footnote).foregroundStyle(.secondary)
            Text(timerInterval: Date()...end, countsDown: true)
                .font(.system(size: 44, weight: .semibold, design: .rounded).monospacedDigit())
            if let e = store.entry, let si = store.setIndex {
                Text("Next: \(e.name), set \(si + 1)").font(.caption2).foregroundStyle(.secondary).lineLimit(2)
            }
            Button("Skip rest") { store.skipRest() }
        }
    }
}
