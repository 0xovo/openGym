import SwiftUI

/*
 * openGym on the Apple Watch: the workout running on the iPhone, one exercise per page. The
 * Digital Crown or a vertical swipe pages through the exercises; on a page, one big number (the
 * set's weight × reps) and one main action, Done. A tap on the number opens the crown editor for
 * reps and weight. The rest counts down full screen and taps the wrist when it is over.
 * Text and SF Symbols, in the app's accent colour.
 */
@main
struct OpenGymWatchApp: App {
    @StateObject private var store = SessionStore()

    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(store).tint(Theme.accent)
        }
    }
}

enum Theme {
    /// The app's default accent (frontend/src/index.css --green, dark).
    static let accent = Color(red: 0x30 / 255, green: 0xd1 / 255, blue: 0x58 / 255)
}

func formatNumber(_ v: Double) -> String {
    v.rounded() == v ? String(Int(v)) : String(format: "%.1f", v)
}

struct RootView: View {
    @EnvironmentObject var store: SessionStore

    var body: some View {
        if store.workout == nil {
            IdleView()
        } else if let end = store.restEndsAt, end > Date() {
            RestView(end: end)
        } else {
            ExercisePager()
        }
    }
}

/* ---------- no workout: start one ---------- */

struct IdleView: View {
    @EnvironmentObject var store: SessionStore

    var body: some View {
        if let ready = store.ready, ready.today != nil || !ready.others.isEmpty {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    if let today = ready.today {
                        Text("Today").font(.caption2).foregroundStyle(.secondary)
                        Button { store.start(today) } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(today.name)
                                    .font(.system(.headline, design: .rounded))
                                    .lineLimit(2)
                                Label("Start workout", systemImage: "play.fill")
                                    .font(.footnote)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Theme.accent)
                    }
                    ForEach(Array(ready.others.enumerated()), id: \.offset) { pair in
                        Button { store.start(pair.element) } label: {
                            HStack {
                                Text(pair.element.name).lineLimit(1)
                                Spacer(minLength: 4)
                                Image(systemName: "play.fill").font(.caption2).foregroundStyle(Theme.accent)
                            }
                        }
                    }
                    HealthToggle(health: store.health)
                }
            }
        } else {
            VStack(spacing: 10) {
                Image(systemName: "dumbbell.fill")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(Theme.accent)
                Text("No workout running")
                    .font(.headline)
                Text("Start one on your iPhone and it shows up here.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 8)
        }
    }
}

/* ---------- the exercises, one per page ---------- */

struct ExercisePager: View {
    @EnvironmentObject var store: SessionStore

    var body: some View {
        // Vertical pages: the Digital Crown and a vertical swipe both move between exercises.
        TabView(selection: Binding(get: { store.entryIndex }, set: { store.show(entry: $0) })) {
            ForEach(Array((store.workout?.entries ?? []).enumerated()), id: \.offset) { pair in
                ExercisePage(index: pair.offset).tag(pair.offset)
            }
            FinishPage().tag(store.workout?.entries.count ?? 0)
        }
        .tabViewStyle(.verticalPage)
    }
}

/// After the last exercise: one action, finish and save (on the phone, as its Finish and save).
struct FinishPage: View {
    @EnvironmentObject var store: SessionStore
    @State private var confirming = false

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "flag.checkered")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(Theme.accent)
            Text(store.workout?.name ?? "")
                .font(.system(.headline, design: .rounded))
                .lineLimit(2)
                .multilineTextAlignment(.center)
            Button { confirming = true } label: {
                Label("Finish workout", systemImage: "checkmark")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
        }
        .padding(.horizontal, 6)
        .confirmationDialog("Finish workout?", isPresented: $confirming) {
            Button("Finish and save") { store.finish() }
            Button("Cancel", role: .cancel) {}
        }
    }
}

struct ExercisePage: View {
    @EnvironmentObject var store: SessionStore
    let index: Int
    @State private var editing = false

    var body: some View {
        if let w = store.workout, w.entries.indices.contains(index) {
            let entry = w.entries[index]
            let si = store.setIndex(in: index)
            VStack(spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text(entry.name)
                        .font(.system(.headline, design: .rounded))
                        .lineLimit(2)
                        .minimumScaleFactor(0.75)
                    Spacer(minLength: 4)
                    VStack(alignment: .trailing, spacing: 0) {
                        Text("\(index + 1)/\(w.entries.count)")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                        HeartRateBadge(health: store.health)
                    }
                }
                if let clip = store.clips[entry.id] {
                    ClipView(clip: clip).frame(height: 54)
                }
                SetDots(entry: entry, current: si) { store.pick(set: $0, in: index) }
                if let si = si {
                    let target = entry.sets[si]
                    Button { editing = true } label: {
                        BigNumbers(weight: index == store.entryIndex ? store.weight : (target.w ?? 0),
                                   reps: index == store.entryIndex ? store.reps : (target.r ?? 0),
                                   unit: w.unit, warmup: target.warmup)
                    }
                    .buttonStyle(.plain)
                    Button { store.completeSet() } label: {
                        Label("Done", systemImage: "checkmark")
                            .font(.system(.body, design: .rounded).weight(.semibold))
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
                    .disabled(index != store.entryIndex)
                } else {
                    Spacer()
                    Label("All sets done", systemImage: "checkmark.circle.fill")
                        .font(.system(.body, design: .rounded))
                        .foregroundStyle(Theme.accent)
                    Spacer()
                }
            }
            .padding(.horizontal, 6)
            .sheet(isPresented: $editing) { AdjustView() }
            .onAppear { if SessionStore.demoScreen == "adjust" && index == store.entryIndex { editing = true } }
        }
    }
}

/// One dot per set: filled when done, ringed when it is the one up. A tap picks a set.
struct SetDots: View {
    let entry: Entry
    let current: Int?
    let pick: (Int) -> Void

    var body: some View {
        HStack(spacing: 5) {
            ForEach(Array(entry.sets.enumerated()), id: \.offset) { pair in
                let s = pair.element
                Circle()
                    .fill(s.done ? Theme.accent : Color.gray.opacity(0.35))
                    .overlay(Circle().stroke(Theme.accent, lineWidth: pair.offset == current ? 2 : 0))
                    .frame(width: s.warmup ? 7 : 10, height: s.warmup ? 7 : 10)
                    .onTapGesture { if !s.done { pick(pair.offset) } }
            }
            Spacer(minLength: 0)
        }
    }
}

struct BigNumbers: View {
    let weight: Double
    let reps: Double
    let unit: String
    let warmup: Bool

    var body: some View {
        VStack(spacing: 0) {
            if warmup {
                Text("Warm-up").font(.caption2).foregroundStyle(.secondary)
            }
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(formatNumber(weight))
                    .font(.system(size: 34, weight: .semibold, design: .rounded).monospacedDigit())
                Text(unit).font(.footnote).foregroundStyle(.secondary)
                Text("×").font(.title3).foregroundStyle(.secondary).padding(.horizontal, 2)
                Text(formatNumber(reps))
                    .font(.system(size: 34, weight: .semibold, design: .rounded).monospacedDigit())
            }
            .minimumScaleFactor(0.6)
            .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
    }
}

/* ---------- the crown editor ---------- */

enum CrownTarget { case reps, weight }

struct AdjustView: View {
    @EnvironmentObject var store: SessionStore
    @Environment(\.dismiss) private var dismiss
    @State private var target: CrownTarget = .reps

    var body: some View {
        VStack(spacing: 8) {
            // What the crown turns: reps or the weight (no segmented picker on watchOS).
            HStack(spacing: 6) {
                CrownChoice(title: Text("Reps"), on: target == .reps) { target = .reps }
                CrownChoice(title: Text(store.unit), on: target == .weight) { target = .weight }
            }
            Text(formatNumber(target == .weight ? store.weight : store.reps))
                .font(.system(size: 52, weight: .semibold, design: .rounded).monospacedDigit())
                .foregroundStyle(Theme.accent)
                .focusable(true)
                .digitalCrownRotation(crownBinding, from: 0, through: target == .weight ? 500 : 100,
                                      by: target == .weight ? store.weightStep : 1, sensitivity: .low,
                                      isContinuous: false, isHapticFeedbackEnabled: true)
            if let last = store.entry?.last {
                Text("Last time: \(last)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
            }
            Button {
                store.completeSet()
                dismiss()
            } label: {
                Label("Done", systemImage: "checkmark").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
        }
    }

    private var crownBinding: Binding<Double> {
        Binding(
            get: { target == .weight ? store.weight : store.reps },
            set: { v in
                if target == .weight { store.weight = max(0, v) } else { store.reps = max(0, v.rounded()) }
            }
        )
    }
}

/* ---------- the rest ---------- */

struct RestView: View {
    @EnvironmentObject var store: SessionStore
    let end: Date

    var body: some View {
        VStack(spacing: 6) {
            ZStack {
                Circle().stroke(Color.gray.opacity(0.25), lineWidth: 6)
                TimelineView(.periodic(from: .now, by: 0.5)) { ctx in
                    let total = max(1, end.timeIntervalSince(store.restStartedAt ?? end.addingTimeInterval(-90)))
                    let left = max(0, end.timeIntervalSince(ctx.date))
                    Circle()
                        .trim(from: 0, to: CGFloat(left / total))
                        .stroke(Theme.accent, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                }
                Text(timerInterval: Date()...end, countsDown: true)
                    .font(.system(size: 34, weight: .semibold, design: .rounded).monospacedDigit())
                    .multilineTextAlignment(.center)
            }
            .padding(6)
            if let e = store.entry, let si = store.setIndex {
                Text("Next: \(e.name), set \(si + 1)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            HStack {
                Button { store.addRest(15) } label: { Text("+15s") }
                Button { store.skipRest() } label: { Label("Skip", systemImage: "forward.fill") }
                    .tint(Theme.accent)
            }
            .font(.footnote)
        }
    }
}

/* ---------- Apple Health ---------- */

/// "♥ 128" while the workout session measures it; nothing otherwise.
struct HeartRateBadge: View {
    @ObservedObject var health: WorkoutManager

    var body: some View {
        if let hr = health.heartRate {
            Label("\(Int(hr.rounded()))", systemImage: "heart.fill")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.red)
                .labelStyle(.titleAndIcon)
        }
    }
}

/// Off until switched on: then the workout runs as an Apple Health workout session (heart rate per
/// set, the app kept awake with the wrist down) and is saved to Apple Health when it ends.
struct HealthToggle: View {
    @ObservedObject var health: WorkoutManager

    var body: some View {
        Toggle(isOn: Binding(
            get: { health.enabled },
            set: { on in
                if on { health.requestAuthorization { ok in health.enabled = ok } } else { health.enabled = false }
            }
        )) {
            Label("Apple Health", systemImage: "heart.fill")
        }
        .tint(Theme.accent)
        .font(.footnote)
    }
}

/* ---------- an exercise's animation, sent by the phone for this workout ---------- */

struct ClipView: View {
    let clip: ClipFrames

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 12)) { ctx in
            let t = ctx.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: max(0.1, clip.duration))
            let i = min(clip.images.count - 1, Int(t / max(0.1, clip.duration) * Double(clip.images.count)))
            Image(uiImage: clip.images[i])
                .resizable()
                .scaledToFit()
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .accessibilityHidden(true)
    }
}

struct CrownChoice: View {
    let title: Text
    let on: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            title
                .font(.footnote.weight(.semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 4)
                .background(Capsule().fill(on ? Theme.accent : Color.gray.opacity(0.25)))
                .foregroundStyle(on ? Color.black : Color.primary)
        }
        .buttonStyle(.plain)
    }
}
