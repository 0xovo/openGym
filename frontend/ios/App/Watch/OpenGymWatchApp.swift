import SwiftUI
import WidgetKit

/*
 * openGym on the Apple Watch, laid out like the watch's own apps: one primary action per screen
 * as a big round button in the middle, secondary actions small at the edges, the Digital Crown as
 * the obvious value control, black background, the accent colour only on the primary action.
 *
 *   start   today's workout as one big Start, the other routines in a short list below
 *   set     weight × reps in big rounded numerals, the round Done, the set dots; the crown turns
 *           the reps (or the weight, after a tap on it), marked by the crown symbol under it
 *   rest    a full-screen ring around a huge countdown, +15 s and Skip as small round buttons
 *   finish  after the last exercise, one round button
 * Exercises are vertical pages (swipe), with the system's page indicator.
 */
@main
struct OpenGymWatchApp: App {
    @StateObject private var store = SessionStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .tint(Theme.accent)
                .background(Color.black)
        }
    }
}

enum Theme {
    /// The app's default accent (frontend/src/index.css --green, dark).
    static let accent = Color(red: 0x30 / 255, green: 0xd1 / 255, blue: 0x58 / 255)
    static let dim = Color.white.opacity(0.14)
    /// The smallest a thing a finger has to hit may be.
    static let tap: CGFloat = 44
}

func formatNumber(_ v: Double) -> String {
    v.rounded() == v ? String(Int(v)) : String(format: "%.1f", v)
}

struct RootView: View {
    @EnvironmentObject var store: SessionStore

    var body: some View {
        Group {
            if store.workout == nil {
                IdleView()
            } else if let end = store.restEndsAt, end > Date() {
                RestView(end: end)
            } else {
                ExercisePager()
            }
        }
        // The complication's Start: today's workout, when none runs yet.
        .onOpenURL { url in
            if url.host == "start", store.workout == nil, let today = store.ready?.today { store.start(today) }
        }
        .onChange(of: store.widgetState) { state in
            guard !store.isDemo else { return }
            state.write()
            WidgetCenter.shared.reloadAllTimelines()
        }
    }
}

/* ---------- a big round primary button ---------- */

struct RoundButton: View {
    let systemImage: String
    let label: Text
    var size: CGFloat = 76
    /// The label under the button, said in words (on by default: "Done" under the check).
    var caption = true
    let action: () -> Void
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        VStack(spacing: 3) {
            Button(action: action) {
                Image(systemName: systemImage)
                    .font(.system(size: size * 0.42, weight: .bold))
                    .foregroundStyle(dimmed ? Theme.accent : Color.black)
                    .frame(width: size, height: size)
                    .background(Circle().fill(dimmed ? Color.clear : Theme.accent))
                    .overlay(Circle().stroke(Theme.accent, lineWidth: dimmed ? 2 : 0))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
            if caption { label.font(.caption2.weight(.semibold)).foregroundStyle(.secondary).lineLimit(1) }
        }
    }
}

/// A small round secondary button at an edge: an SF Symbol on a dim disc, a 44 pt target.
struct EdgeButton: View {
    let systemImage: String
    let label: Text
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: Theme.tap, height: Theme.tap)
                .background(Circle().fill(Theme.dim))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/* ---------- no workout: start one ---------- */

struct IdleView: View {
    @EnvironmentObject var store: SessionStore
    @State private var debug = false

    var body: some View {
        content
            // Hidden: a long press shows what arrived from the phone (animations, sync, heart rate).
            .onLongPressGesture(minimumDuration: 2) { debug = true }
            .sheet(isPresented: $debug) { DebugView() }
    }

    @ViewBuilder private var content: some View {
        if let ready = store.ready, ready.today != nil || !ready.others.isEmpty {
            ScrollView {
                VStack(spacing: 10) {
                    if let today = ready.today {
                        Text(today.name)
                            .font(.system(.headline, design: .rounded))
                            .lineLimit(2)
                            .minimumScaleFactor(0.7)
                            .multilineTextAlignment(.center)
                        RoundButton(systemImage: "play.fill", label: Text("Start workout")) { store.start(today) }
                    }
                    if !ready.others.isEmpty {
                        VStack(spacing: 4) {
                            ForEach(Array(ready.others.enumerated()), id: \.offset) { pair in
                                Button { store.start(pair.element) } label: {
                                    HStack {
                                        Text(pair.element.name).lineLimit(1).minimumScaleFactor(0.8)
                                        Spacer(minLength: 4)
                                        Image(systemName: "play.fill").font(.caption2).foregroundStyle(.secondary)
                                    }
                                    .frame(minHeight: Theme.tap)
                                    .padding(.horizontal, 10)
                                    .background(RoundedRectangle(cornerRadius: 12).fill(Theme.dim))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.top, 6)
                    }
                }
                .padding(.horizontal, 4)
            }
        } else {
            VStack(spacing: 10) {
                Image(systemName: "dumbbell.fill")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(.secondary)
                Text("No workout running")
                    .font(.headline)
                    .multilineTextAlignment(.center)
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
        // Vertical pages, swiped; the crown belongs to the numbers on the page (like a volume).
        TabView(selection: Binding(get: { store.entryIndex }, set: { store.show(entry: $0) })) {
            ForEach(Array((store.workout?.entries ?? []).enumerated()), id: \.offset) { pair in
                ExercisePage(index: pair.offset).tag(pair.offset)
            }
            FinishPage().tag(store.workout?.entries.count ?? 0)
        }
        .tabViewStyle(.verticalPage)
    }
}

enum CrownTarget { case reps, weight }

struct ExercisePage: View {
    @EnvironmentObject var store: SessionStore
    let index: Int
    @State private var target: CrownTarget = .reps
    @FocusState private var crownFocus: Bool
    @ScaledMetric(relativeTo: .title) private var doneSize: CGFloat = 58

    var body: some View {
        if let w = store.workout, w.entries.indices.contains(index) {
            let entry = w.entries[index]
            let si = store.setIndex(in: index)
            let current = index == store.entryIndex
            VStack(spacing: 0) {
                HStack(alignment: .top, spacing: 6) {
                    if let clip = store.clips[entry.id] {
                        ClipView(clip: clip).frame(width: 30, height: 30)
                    }
                    Text(entry.name)
                        .font(.system(.footnote, design: .rounded).weight(.semibold))
                        .lineLimit(2)
                        .minimumScaleFactor(0.75)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    HeartRateBadge(health: store.health)
                }
                Spacer(minLength: 2)
                if let si = si {
                    let row = entry.sets[si]
                    NumbersView(weight: current ? store.weight : (row.w ?? 0),
                                reps: current ? store.reps : (row.r ?? 0),
                                unit: w.unit, warmup: row.warmup, target: $target)
                        .focusable(current)
                        .focused($crownFocus)
                        .digitalCrownRotation(crownBinding, from: 0, through: target == .weight ? 500 : 100,
                                              by: target == .weight ? store.weightStep : 1, sensitivity: .low,
                                              isContinuous: false, isHapticFeedbackEnabled: true)
                    Spacer(minLength: 2)
                    RoundButton(systemImage: "checkmark", label: Text("Done"), size: doneSize) { store.completeSet() }
                        .disabled(!current)
                    Spacer(minLength: 4)
                    SetDots(entry: entry, current: si) { store.pick(set: $0, in: index) }
                } else {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 44))
                        .foregroundStyle(.secondary)
                    Text("All sets done").font(.footnote).foregroundStyle(.secondary)
                    Spacer(minLength: 4)
                    SetDots(entry: entry, current: nil) { _ in }
                }
            }
            .padding(.horizontal, 4)
            .onAppear {
                if SessionStore.demoScreen == "weight" || store.crownStartsOnWeight { target = .weight }
                if current { crownFocus = true }
            }
            .onChange(of: store.entryIndex) { ei in if ei == index { crownFocus = true } }
        }
    }

    private var crownBinding: Binding<Double> {
        Binding(
            get: { target == .weight ? store.weight : store.reps },
            set: { v in
                guard index == store.entryIndex else { return }
                if target == .weight { store.weight = max(0, v) } else { store.reps = max(0, v.rounded()) }
            }
        )
    }
}

/// Weight × reps in big rounded numerals. The one the crown turns carries the crown symbol under
/// it; a tap on the other hands the crown to that one.
struct NumbersView: View {
    @ScaledMetric(relativeTo: .largeTitle) private var size: CGFloat = 32
    let weight: Double
    let reps: Double
    let unit: String
    let warmup: Bool
    @Binding var target: CrownTarget

    var body: some View {
        VStack(spacing: 1) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                value(formatNumber(weight), suffix: unit, active: target == .weight) { target = .weight }
                Text(verbatim: "×").font(.system(size: 18, weight: .medium, design: .rounded)).foregroundStyle(.secondary)
                value(formatNumber(reps), suffix: nil, active: target == .reps) { target = .reps }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.55)
            if warmup { Text("Warm-up").font(.caption2).foregroundStyle(.secondary) }
        }
    }

    private func value(_ text: String, suffix: String?, active: Bool, tap: @escaping () -> Void) -> some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(verbatim: text).font(.system(size: size, weight: .semibold, design: .rounded).monospacedDigit())
                if let s = suffix { Text(verbatim: s).font(.system(size: 12, weight: .medium, design: .rounded)).foregroundStyle(.secondary) }
            }
            Image(systemName: "digitalcrown.arrow.clockwise.fill")
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
                .opacity(active ? 1 : 0)
        }
        .padding(.horizontal, 4)
        .frame(minHeight: Theme.tap)
        .contentShape(Rectangle())
        .onTapGesture(perform: tap)
    }
}

/// One dot per set: filled when done, ringed when it is the one up. A tap picks a set.
struct SetDots: View {
    let entry: Entry
    let current: Int?
    let pick: (Int) -> Void

    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(entry.sets.enumerated()), id: \.offset) { pair in
                let s = pair.element
                Circle()
                    .fill(s.done ? Color.white : Theme.dim)
                    .overlay(Circle().stroke(Color.white, lineWidth: pair.offset == current ? 1.5 : 0))
                    .frame(width: s.warmup ? 6 : 9, height: s.warmup ? 6 : 9)
                    .frame(width: 16, height: 16)
                    .contentShape(Rectangle())
                    .onTapGesture { if !s.done { pick(pair.offset) } }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(entry.sets.filter { $0.done }.count)/\(entry.sets.count)"))
    }
}

/// After the last exercise: one round button, finish and save (on the phone, as its Finish and save).
struct FinishPage: View {
    @EnvironmentObject var store: SessionStore
    @State private var confirming = false

    var body: some View {
        VStack(spacing: 8) {
            Text(verbatim: store.workout?.name ?? "")
                .font(.system(.footnote, design: .rounded).weight(.semibold))
                .lineLimit(2)
                .multilineTextAlignment(.center)
            RoundButton(systemImage: "flag.checkered", label: Text("Finish workout")) { confirming = true }
        }
        .padding(.horizontal, 6)
        .confirmationDialog("Finish workout?", isPresented: $confirming) {
            Button("Finish and save") { store.finish() }
            Button("Cancel", role: .cancel) {}
        }
    }
}

/* ---------- the rest ---------- */

struct RestView: View {
    @EnvironmentObject var store: SessionStore
    let end: Date
    @Environment(\.isLuminanceReduced) private var dimmed
    @ScaledMetric(relativeTo: .largeTitle) private var countdownSize: CGFloat = 42

    var body: some View {
        // The ring and the countdown in it take the space above the two corner buttons, so nothing
        // overlaps on any size (it did on 46 mm when the ring filled the whole screen).
        VStack(spacing: 2) {
            ZStack {
                TimelineView(.periodic(from: .now, by: 0.25)) { ctx in
                    let total = max(1, end.timeIntervalSince(store.restStartedAt ?? end.addingTimeInterval(-90)))
                    let left = max(0, end.timeIntervalSince(ctx.date))
                    ZStack {
                        Circle().stroke(Theme.dim, lineWidth: 7)
                        Circle()
                            .trim(from: 0, to: CGFloat(left / total))
                            .stroke(Theme.accent, style: StrokeStyle(lineWidth: 7, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                    }
                }
                VStack(spacing: 1) {
                    Text("Rest").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                    Text(timerInterval: Date()...end, countsDown: true)
                        .font(.system(size: countdownSize, weight: .semibold, design: .rounded).monospacedDigit())
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                        .multilineTextAlignment(.center)
                    if let e = store.entry, let si = store.setIndex {
                        Text("Next: \(e.name), set \(si + 1)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                }
                .padding(.horizontal, 18)
            }
            .aspectRatio(1, contentMode: .fit)
            .padding(.horizontal, 6)
            // Always On: the countdown stays, the buttons go (nothing to tap with the wrist down).
            HStack {
                EdgeButton(systemImage: "goforward.15", label: Text("+15s")) { store.addRest(15) }
                Spacer()
                EdgeButton(systemImage: "forward.end.fill", label: Text("Skip")) { store.skipRest() }
            }
            .opacity(dimmed ? 0 : 1)
        }
        .ignoresSafeArea(edges: .bottom)
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
                .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .accessibilityHidden(true)
    }
}

/* ---------- Apple Health ---------- */

/// "♥ 128" while the workout session measures it; nothing otherwise.
struct HeartRateBadge: View {
    @ObservedObject var health: WorkoutManager

    var body: some View {
        if let hr = health.heartRate {
            HStack(spacing: 2) {
                Image(systemName: "heart.fill").font(.system(size: 9))
                Text(verbatim: "\(Int(hr.rounded()))").font(.caption2.monospacedDigit())
            }
            .foregroundStyle(.red)
        } else if health.measuring {
            HStack(spacing: 2) {
                Image(systemName: "heart").font(.system(size: 9))
                Text("measuring").font(.caption2)
            }
            .foregroundStyle(.secondary)
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
        .frame(minHeight: Theme.tap)
    }
}

/* ---------- hidden: what arrived from the phone ---------- */

struct DebugView: View {
    @EnvironmentObject var store: SessionStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: "workout: \(store.workout?.id ?? "none")").font(.caption2)
                Text(verbatim: "pending ticks: \(store.state.pending.count)").font(.caption2)
                Text(verbatim: "started here: \(store.state.startedHere ?? "-")").font(.caption2)
                Text(verbatim: "clips: \(store.clips.count)").font(.caption2)
                Text(verbatim: "health: \(store.health.enabled ? "on" : "off"), \(store.health.running ? "running" : "idle")").font(.caption2)
                Divider()
                ForEach(Array(store.clipLog.reversed().enumerated()), id: \.offset) { pair in
                    Text(verbatim: pair.element).font(.system(size: 10)).foregroundStyle(.secondary)
                }
            }
        }
    }
}
