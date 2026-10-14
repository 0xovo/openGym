import HealthKit
import SwiftUI
import WatchKit
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
 *   hold    a timed set: the seconds on the crown, Start, then a ring counting down, Stop
 *   finish  after the last exercise, one round button
 *   summary the workout at its end: time, sets, volume, heart rate, calories, records; Done
 * Exercises are vertical pages (swipe), with the system's page indicator. Each kind of set has its
 * own look: a warm-up is orange and says so, a per-side set says Left or Right, a bodyweight set
 * shows the reps (and added weight, when there is some), a superset says so and goes in turns.
 *
 * Battery: nothing ticks while nothing runs (no timers at the start screen), the animation and the
 * rest ring slow down or stop with the wrist down (Always On), the heart rate redraws at most every
 * few seconds (WorkoutManager), and each animation is decoded once when it arrives.
 */
@main
struct OpenGymWatchApp: App {
    @WKApplicationDelegateAdaptor private var delegate: WatchAppDelegate

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(delegate.store)
                .tint(Theme.accent)
                .background(Color.black)
                .modifier(DemoEnvironment())
        }
    }
}

/// Owns the session, so HealthKit's launch for a workout started on the iPhone (WatchBridgePlugin
/// openOnWatch → startWatchApp) reaches it even before the first view is drawn.
final class WatchAppDelegate: NSObject, WKApplicationDelegate {
    let store = SessionStore()

    func handle(_ workoutConfiguration: HKWorkoutConfiguration) {
        store.openedForWorkout()
    }
}

/// CI's screenshots: the largest text size, or the screen as in Always On, when asked for.
struct DemoEnvironment: ViewModifier {
    func body(content: Content) -> some View {
        if SessionStore.demoAX {
            content.environment(\.dynamicTypeSize, .accessibility5)
        } else if SessionStore.demoAOD {
            content.environment(\.isLuminanceReduced, true)
        } else {
            content
        }
    }
}

enum Theme {
    /// The app's default accent (frontend/src/index.css --green, dark).
    static let accent = Color(red: 0x30 / 255, green: 0xd1 / 255, blue: 0x58 / 255)
    /// Warm-up sets (the app's --orange).
    static let warmup = Color(red: 1, green: 0x9f / 255, blue: 0x0a / 255)
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
            if let summary = store.summary {
                SummaryView(summary: summary)
            } else if store.workout == nil {
                IdleView()
            } else if let end = store.holdEndsAt {
                HoldView(end: end)
            } else if let end = store.restEndsAt, end > Date() {
                RestView(end: end)
            } else {
                ExercisePager()
            }
        }
        // Any touch: the rest-over alarm was noticed (it would tap once more otherwise).
        .simultaneousGesture(TapGesture().onEnded { store.ackRestOver() })
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

/// A word in a small capsule: "Warm-up", "Left", "Superset".
struct Tag: View {
    let text: Text
    let color: Color

    var body: some View {
        text
            .font(.system(.caption2, design: .rounded).weight(.bold))
            .textCase(.uppercase)
            .foregroundStyle(color)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .padding(.horizontal, 6)
            .padding(.vertical, 1)
            .background(Capsule().fill(color.opacity(0.18)))
    }
}

/// The phone is out of reach and events wait on the watch: a small sign, said in words to VoiceOver.
struct OfflineSign: View {
    @EnvironmentObject var store: SessionStore

    var body: some View {
        if store.offline {
            Image(systemName: "iphone.slash")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
                .accessibilityLabel(Text("Saved on the watch, syncs later"))
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
    @State private var confirmSkip = false
    @FocusState private var crownFocus: Bool
    @ScaledMetric(relativeTo: .title) private var doneSizeScaled: CGFloat = 58
    /// Large enough to hit, small enough to leave room for the numbers at the largest text sizes.
    private var doneSize: CGFloat { min(doneSizeScaled, 70) }

    var body: some View {
        if let w = store.workout, w.entries.indices.contains(index) {
            let entry = w.entries[index]
            let si = store.setIndex(in: index)
            let current = index == store.entryIndex
            VStack(spacing: 0) {
                header(entry)
                Spacer(minLength: 2)
                if let si = si {
                    let row = entry.sets[si]
                    tags(entry, row)
                    if entry.isCardio {
                        Text("Log this one on your iPhone.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .minimumScaleFactor(0.7)
                    } else if entry.isTimed {
                        SecondsView(seconds: current ? store.seconds : (row.sec ?? 0))
                            .focusable(current)
                            .focused($crownFocus)
                            .digitalCrownRotation(secondsBinding, from: 5, through: 600, by: 5, sensitivity: .low,
                                                  isContinuous: false, isHapticFeedbackEnabled: true)
                    } else {
                        let side = row.sideUp.flatMap { row.sides?[$0] }
                        NumbersView(weight: current ? store.weight : (side?.w ?? row.w ?? 0),
                                    reps: current ? store.reps : (side?.r ?? row.r ?? 0),
                                    unit: w.unit, warmup: row.warmup, bodyweight: entry.isBodyweight, target: $target)
                            .focusable(current)
                            .focused($crownFocus)
                            .digitalCrownRotation(crownBinding, from: 0, through: target == .weight ? 500 : 100,
                                                  by: target == .weight ? store.weightStep : 1, sensitivity: .low,
                                                  isContinuous: false, isHapticFeedbackEnabled: true)
                    }
                    Spacer(minLength: 2)
                    primaryButton(entry, current: current)
                    Spacer(minLength: 4)
                    SetDots(entry: entry, current: si, skipped: { store.isSkipped(entry.id, $0) }) { store.pick(set: $0, in: index) }
                } else {
                    let left = entry.sets.contains { !$0.done }
                    Image(systemName: left ? "forward.circle" : "checkmark.circle.fill")
                        .font(.system(size: 40))
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                    Text(left ? LocalizedStringKey("Tap a dot to do a skipped set.") : LocalizedStringKey("All sets done"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .minimumScaleFactor(0.7)
                    Spacer(minLength: 4)
                    SetDots(entry: entry, current: nil, skipped: { store.isSkipped(entry.id, $0) }) { store.pick(set: $0, in: index) }
                }
            }
            .padding(.horizontal, 4)
            // The set's layout is fixed (crown, Done, dots on one screen): text grows up to a size
            // that still fits; the start screen and the summary scroll and grow all the way.
            .dynamicTypeSize(...DynamicTypeSize.accessibility2)
            .onAppear {
                if SessionStore.demoScreen == "weight" || store.crownStartsOnWeight { target = .weight }
                if entry.isBodyweight && !store.crownStartsOnWeight { target = .reps }
                if current { crownFocus = true }
            }
            .onChange(of: store.entryIndex) { ei in if ei == index { crownFocus = true } }
            .confirmationDialog(Text("Skip this set?"), isPresented: $confirmSkip) {
                Button("Skip set") { store.skipSet() }
                Button("Cancel", role: .cancel) {}
            }
        }
    }

    @ViewBuilder private func header(_ entry: Entry) -> some View {
        HStack(alignment: .top, spacing: 6) {
            if let clip = store.clips[entry.id] {
                ClipView(clip: clip).frame(width: 30, height: 30)
            }
            Text(entry.name)
                .font(.system(.footnote, design: .rounded).weight(.semibold))
                .lineLimit(2)
                .minimumScaleFactor(0.75)
                .frame(maxWidth: .infinity, alignment: .leading)
            OfflineSign()
            HeartRateBadge(health: store.health)
        }
    }

    /// Warm-up, the side up next, superset: what kind of set this is, above the numbers.
    @ViewBuilder private func tags(_ entry: Entry, _ row: SetRow) -> some View {
        let side = row.sideUp
        if row.warmup || side != nil || entry.group != nil {
            HStack(spacing: 4) {
                if row.warmup { Tag(text: Text("Warm-up"), color: Theme.warmup) }
                if side == "L" { Tag(text: Text("Left"), color: .cyan) }
                if side == "R" { Tag(text: Text("Right"), color: .cyan) }
                if entry.group != nil { Tag(text: Text("Superset"), color: .purple) }
            }
        }
    }

    @ViewBuilder private func primaryButton(_ entry: Entry, current: Bool) -> some View {
        Group {
            if entry.isTimed {
                RoundButton(systemImage: "play.fill", label: Text("Start hold"), size: doneSize) { store.startHold() }
            } else {
                RoundButton(systemImage: "checkmark", label: Text("Done"), size: doneSize) { store.completeSet() }
            }
        }
        .disabled(!current)
        // A long press: skip this set instead (VoiceOver: an action of its own).
        .simultaneousGesture(LongPressGesture(minimumDuration: 0.8).onEnded { _ in if current { confirmSkip = true } })
        .accessibilityAction(named: Text("Skip set")) { store.skipSet() }
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

    private var secondsBinding: Binding<Double> {
        Binding(
            get: { store.seconds },
            set: { v in
                guard index == store.entryIndex else { return }
                store.seconds = max(5, (v / 5).rounded() * 5)
            }
        )
    }
}

/// Weight × reps in big rounded numerals. The one the crown turns carries the crown symbol under
/// it; a tap on the other hands the crown to that one. A bodyweight set shows the reps, and the
/// added weight small ("+5 kg") or "Bodyweight". A warm-up is in orange.
struct NumbersView: View {
    @EnvironmentObject var store: SessionStore
    @ScaledMetric(relativeTo: .largeTitle) private var size: CGFloat = 32
    let weight: Double
    let reps: Double
    let unit: String
    let warmup: Bool
    var bodyweight = false
    @Binding var target: CrownTarget

    var body: some View {
        Group {
            if bodyweight {
                VStack(spacing: 0) {
                    value(formatNumber(reps), suffix: nil, active: target == .reps, label: Text("Reps")) { target = .reps }
                    Button { target = .weight } label: {
                        HStack(spacing: 2) {
                            if weight > 0 {
                                Text(verbatim: "+\(formatNumber(weight)) \(unit)")
                            } else {
                                Text("Bodyweight")
                            }
                            Image(systemName: "digitalcrown.arrow.clockwise.fill").font(.system(size: 8)).opacity(target == .weight ? 1 : 0)
                        }
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.secondary)
                        .frame(minHeight: 24)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(weight > 0 ? Text(verbatim: "+\(formatNumber(weight)) \(unit)") : Text("Bodyweight"))
                    .accessibilityHint(Text("Turn the Digital Crown to change it."))
                }
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    value(formatNumber(weight), suffix: unit, active: target == .weight, label: Text("Weight")) { target = .weight }
                    Text(verbatim: "×").font(.system(size: 18, weight: .medium, design: .rounded)).foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                    value(formatNumber(reps), suffix: nil, active: target == .reps, label: Text("Reps")) { target = .reps }
                }
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.5)
        .foregroundStyle(warmup ? Theme.warmup : Color.white)
    }

    private func value(_ text: String, suffix: String?, active: Bool, label: Text, tap: @escaping () -> Void) -> some View {
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
        // VoiceOver: "Weight, 62.5 kg", swipe up or down to change it, as the crown does.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(Text(verbatim: suffix.map { "\(text) \($0)" } ?? text))
        .accessibilityHint(Text("Turn the Digital Crown to change it."))
        .accessibilityAddTraits(active ? .isSelected : [])
        .accessibilityAdjustableAction { direction in
            let isWeight = suffix != nil
            let step = isWeight ? store.weightStep : 1
            let d: Double
            switch direction {
            case .increment: d = step
            case .decrement: d = -step
            @unknown default: d = 0
            }
            if isWeight { store.weight = max(0, store.weight + d) } else { store.reps = max(0, store.reps + d) }
        }
    }
}

/// A hold's seconds, before it starts: big, the crown turns them in fives.
struct SecondsView: View {
    @EnvironmentObject var store: SessionStore
    @ScaledMetric(relativeTo: .largeTitle) private var size: CGFloat = 36
    let seconds: Double

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(verbatim: formatNumber(seconds)).font(.system(size: size, weight: .semibold, design: .rounded).monospacedDigit())
                Text(verbatim: "s").font(.system(size: 13, weight: .medium, design: .rounded)).foregroundStyle(.secondary)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.5)
            Image(systemName: "digitalcrown.arrow.clockwise.fill").font(.system(size: 9)).foregroundStyle(.secondary)
        }
        .frame(minHeight: Theme.tap)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Hold"))
        .accessibilityValue(Text(Duration.seconds(seconds), format: .units(allowed: [.minutes, .seconds], width: .wide)))
        .accessibilityHint(Text("Turn the Digital Crown to change it."))
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: store.seconds = min(600, store.seconds + 5)
            case .decrement: store.seconds = max(5, store.seconds - 5)
            @unknown default: break
            }
        }
    }
}

/// One dot per set: filled when done, ringed when it is the one up, orange and small for a warm-up,
/// half-filled for a per-side set with one side done, hollow and dim when skipped. A tap picks a set.
struct SetDots: View {
    let entry: Entry
    let current: Int?
    let skipped: (Int) -> Bool
    let pick: (Int) -> Void

    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(entry.sets.enumerated()), id: \.offset) { pair in
                let s = pair.element
                let color = s.warmup ? Theme.warmup : Color.white
                let half = !s.done && (s.sides.map { $0.L.done || $0.R.done } ?? false)
                Circle()
                    .fill(s.done ? color : (half ? color.opacity(0.5) : Theme.dim))
                    .overlay(Circle().stroke(color, lineWidth: pair.offset == current ? 1.5 : 0))
                    .overlay(Circle().stroke(Color.white.opacity(0.35), style: StrokeStyle(lineWidth: 1, dash: [1.5, 1.5]))
                        .opacity(skipped(pair.offset) && !s.done ? 1 : 0))
                    .frame(width: s.warmup ? 6 : 9, height: s.warmup ? 6 : 9)
                    .frame(width: 16, height: 16)
                    .contentShape(Rectangle())
                    .onTapGesture { if !s.done { pick(pair.offset) } }
            }
        }
        // VoiceOver: "Set 2 of 4, 1 done", swipe up or down to pick another set.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Set \((current ?? 0) + 1) of \(entry.sets.count)"))
        .accessibilityValue(Text("\(entry.sets.filter { $0.done }.count) done"))
        .accessibilityAdjustableAction { direction in
            let open = entry.sets.indices.filter { !entry.sets[$0].done }
            guard let cur = current, let at = open.firstIndex(of: cur) else { return }
            switch direction {
            case .increment: if at + 1 < open.count { pick(open[at + 1]) }
            case .decrement: if at > 0 { pick(open[at - 1]) }
            @unknown default: break
            }
        }
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
            if store.offline {
                Text("Saved on the watch, syncs later").font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
        }
        .padding(.horizontal, 6)
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
        .confirmationDialog("Finish workout?", isPresented: $confirming) {
            Button("Finish and save") { store.finish() }
            Button("Cancel", role: .cancel) {}
        }
    }
}

/* ---------- the rest, and a hold: a ring counting down ---------- */

/// A ring that empties from `start` to `end`. With the wrist down (Always On) it moves once a
/// second, not four times: the screen is updated rarely then anyway, and each update costs.
struct CountdownRing: View {
    let start: Date
    let end: Date
    var color: Color = Theme.accent
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        TimelineView(.periodic(from: .now, by: dimmed ? 1 : 0.25)) { ctx in
            let total = max(1, end.timeIntervalSince(start))
            let left = max(0, end.timeIntervalSince(ctx.date))
            ZStack {
                Circle().stroke(Theme.dim, lineWidth: 7)
                Circle()
                    .trim(from: 0, to: CGFloat(left / total))
                    .stroke(color.opacity(dimmed ? 0.6 : 1), style: StrokeStyle(lineWidth: 7, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
        }
        .accessibilityHidden(true)
    }
}

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
                CountdownRing(start: store.restStartedAt ?? end.addingTimeInterval(-90), end: end)
                VStack(spacing: 1) {
                    Text("Rest").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                    Text(timerInterval: Date()...end, countsDown: true)
                        .font(.system(size: countdownSize, weight: .semibold, design: .rounded).monospacedDigit())
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                        .multilineTextAlignment(.center)
                    if let e = store.entry, let si = store.setIndex {
                        Group {
                            if let side = store.sideUp {
                                Text("Next: \(e.name), set \(si + 1)") + Text(verbatim: " · ") + Text(side == "L" ? LocalizedStringKey("Left") : LocalizedStringKey("Right"))
                            } else {
                                Text("Next: \(e.name), set \(si + 1)")
                            }
                        }
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .minimumScaleFactor(0.7)
                        .multilineTextAlignment(.center)
                    }
                    if store.offline {
                        Text("Saved on the watch, syncs later")
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
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
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
    }
}

/// A timed set running: the ring counts the hold down; Stop ends it early with what it lasted.
struct HoldView: View {
    @EnvironmentObject var store: SessionStore
    let end: Date
    @Environment(\.isLuminanceReduced) private var dimmed
    @ScaledMetric(relativeTo: .largeTitle) private var countdownSize: CGFloat = 42

    var body: some View {
        VStack(spacing: 2) {
            ZStack {
                CountdownRing(start: store.holdStartedAt ?? end, end: end, color: .cyan)
                VStack(spacing: 1) {
                    Text(store.entry?.name ?? "").font(.caption2.weight(.semibold)).foregroundStyle(.secondary).lineLimit(1)
                    Text(timerInterval: Date()...end, countsDown: true)
                        .font(.system(size: countdownSize, weight: .semibold, design: .rounded).monospacedDigit())
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                        .multilineTextAlignment(.center)
                    Text("Hold").font(.caption2).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 18)
            }
            .aspectRatio(1, contentMode: .fit)
            .padding(.horizontal, 6)
            HStack {
                Spacer()
                EdgeButton(systemImage: "stop.fill", label: Text("Stop")) { store.endHold(early: true) }
            }
            .opacity(dimmed ? 0 : 1)
        }
        .ignoresSafeArea(edges: .bottom)
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
    }
}

/* ---------- the end of a workout ---------- */

struct SummaryView: View {
    @EnvironmentObject var store: SessionStore
    let summary: WorkoutSummary

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: summary.endedOnPhone ? "iphone" : "checkmark.circle.fill")
                        .foregroundStyle(Theme.accent)
                        .accessibilityHidden(true)
                    Text(summary.endedOnPhone ? LocalizedStringKey("Ended on your iPhone") : LocalizedStringKey("Workout saved"))
                        .font(.system(.headline, design: .rounded))
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(verbatim: summary.name).font(.footnote).foregroundStyle(.secondary)
                if let d = summary.duration { stat(Text("Time"), Text(verbatim: SummaryView.duration(d))) }
                stat(Text("Sets"), Text(verbatim: "\(summary.sets)"))
                if summary.volume > 0 {
                    stat(Text("Volume"), Text(verbatim: "\(summary.volume.formatted(.number.precision(.fractionLength(0)))) \(summary.unit)"))
                }
                if let avg = summary.hrAvg, let top = summary.hrMax {
                    stat(Text("Heart rate"), Text("\(Int(avg)) avg · \(Int(top)) max"), color: .red)
                }
                if let kcal = summary.calories {
                    stat(Text("Calories"), Text(Measurement(value: kcal, unit: UnitEnergy.kilocalories),
                                                format: .measurement(width: .abbreviated, usage: .asProvided,
                                                                     numberFormatStyle: .number.precision(.fractionLength(0)))))
                }
                if !summary.prs.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        Label { Text("Personal records") } icon: { Image(systemName: "trophy.fill").foregroundStyle(.yellow) }
                            .font(.caption.weight(.semibold))
                        ForEach(summary.prs, id: \.self) { name in
                            Text(verbatim: name).font(.footnote)
                        }
                    }
                    .accessibilityElement(children: .combine)
                    .padding(.top, 2)
                }
                if store.offline {
                    Label { Text("Saved on the watch, syncs later") } icon: { Image(systemName: "iphone.slash") }
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Button { store.closeSummary() } label: {
                    Text("Done").frame(maxWidth: .infinity, minHeight: Theme.tap)
                }
                .tint(Theme.accent)
                .padding(.top, 4)
            }
            .padding(.horizontal, 4)
        }
    }

    private func stat(_ label: Text, _ value: Text, color: Color = .white) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            label.font(.caption2).foregroundStyle(.secondary)
            value.font(.system(.title3, design: .rounded).weight(.semibold).monospacedDigit()).foregroundStyle(color)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    /// "52 min", "1 h 5 min", in the watch's language.
    static func duration(_ seconds: Double) -> String {
        let f = DateComponentsFormatter()
        f.allowedUnits = seconds >= 3600 ? [.hour, .minute] : [.minute]
        f.unitsStyle = .short
        return f.string(from: max(60, seconds)) ?? ""
    }
}

/* ---------- an exercise's animation, sent by the phone for this workout ---------- */

/// Decoded once, when it arrived (SessionStore.frames); here only cycled through, and not at all
/// with the wrist down.
struct ClipView: View {
    let clip: ClipFrames
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 12, paused: dimmed)) { ctx in
            let t = ctx.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: max(0.1, clip.duration))
            let i = dimmed ? 0 : min(clip.images.count - 1, Int(t / max(0.1, clip.duration) * Double(clip.images.count)))
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
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Heart rate"))
            .accessibilityValue(Text(verbatim: "\(Int(hr.rounded()))"))
        } else if health.measuring {
            HStack(spacing: 2) {
                Image(systemName: "heart").font(.system(size: 9))
                Text("measuring").font(.caption2)
            }
            .foregroundStyle(.secondary)
        }
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
