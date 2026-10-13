import Foundation
import UIKit
import UserNotifications
import WatchConnectivity
import WatchKit

/*
 * The watch's side of a workout, around WatchCore's SessionCore (the session as plain data and
 * every change to it as a pure, tested function; its header lists the sync cases). This class
 * only feeds it what arrives (snapshots from the phone, taps), saves the result after every change
 * so a relaunch mid-workout loses nothing, and sends the events it returns with transferUserInfo,
 * which the system queues and delivers even when the phone app is not running.
 *
 * Exercise animations: never part of the watch app. The phone sends the running workout's own,
 * as small GIF files (WatchBridgePlugin.sendClips); they are kept only while that workout runs and
 * deleted when it ends. Without them the page shows the exercise by name.
 */

/// One animation, as frames to cycle through.
struct ClipFrames {
    let images: [UIImage]
    let duration: Double
}

final class SessionStore: NSObject, ObservableObject, WCSessionDelegate, UNUserNotificationCenterDelegate {
    /// Everything the watch knows about the session, saved after every change.
    @Published private(set) var state = SessionState() {
        didSet { if !isDemo, state != oldValue { save() } }
    }

    var workout: ActiveWorkout? { state.workout }
    var ready: Ready? { state.ready }
    var entryIndex: Int { state.entryIndex }
    var unit: String { workout?.unit ?? state.unit }
    var weightStep: Double { unit == "lb" ? 5 : 2.5 }
    var restHaptics: Bool { state.settings.restHaptics ?? true }
    var crownStartsOnWeight: Bool { state.settings.crown == "weight" }

    /// Apple Health: the workout session, its heart rate, and the switch (WorkoutManager).
    let health = WorkoutManager()
    /// The running workout's animations, by exercise id, from the phone.
    @Published private(set) var clips: [String: ClipFrames] = [:]
    /// What happened to the animations, newest last (the hidden debug screen).
    @Published private(set) var clipLog: [String] = []
    @Published var weight: Double = 0
    @Published var reps: Double = 0
    @Published private(set) var restEndsAt: Date?
    @Published private(set) var restStartedAt: Date?
    /// A set picked by hand in an exercise (entry index → set index); otherwise the first not done.
    @Published private var picked: [Int: Int] = [:]

    /// When the set now up began: the end of the rest before it, or the start of the session.
    private var setStartedAt = Date()
    /// The rest running after a set, for that rest's heart rate once it is over.
    private var restAfter: (exId: String, entryIdx: Int, setIdx: Int, wid: String, from: Date)?
    private var restTimer: Timer?
    private static let stateKey = "sessionState"
    private static let restNotificationId = "opengym.rest"
    private static var clipDir: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("clips")
    }

    static let demoArgument = "-OpenGymWatchDemo"
    /// CI screenshots: "-OpenGymWatchScreen rest" opens the demo on that screen.
    static var demoScreen: String? { argument("-OpenGymWatchScreen") }
    /// CI: a synthetic clip (not exercise media) shown on the demo's first exercise.
    static var demoClip: String? { argument("-OpenGymWatchDemoClip") }
    private static func argument(_ name: String) -> String? {
        let a = ProcessInfo.processInfo.arguments
        guard let i = a.firstIndex(of: name), i + 1 < a.count else { return nil }
        return a[i + 1]
    }
    var isDemo: Bool { ProcessInfo.processInfo.arguments.contains(SessionStore.demoArgument) }

    override init() {
        super.init()
        if isDemo {
            startDemo()
        } else if let data = UserDefaults.standard.data(forKey: SessionStore.stateKey),
                  let saved = try? JSONDecoder().decode(SessionState.self, from: data) {
            // Relaunched (mid-workout or not): the session as it was, then the latest from the phone.
            state = saved
            loadTargets()
            if let w = saved.workout { health.start(workoutId: w.id) }
        }
        health.onStatus = { [weak self] in self?.sendStatus() }
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        if !isDemo { center.requestAuthorization(options: [.alert, .sound]) { _, _ in } }
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    private func save() {
        if let data = try? JSONEncoder().encode(state) { UserDefaults.standard.set(data, forKey: SessionStore.stateKey) }
    }

    /* ---------- what the views read ---------- */

    var entry: Entry? {
        guard let w = workout, w.entries.indices.contains(entryIndex) else { return nil }
        return w.entries[entryIndex]
    }

    var setIndex: Int? { setIndex(in: entryIndex) }
    func setIndex(in ei: Int) -> Int? { SessionCore.setIndex(state, entry: ei, picked: picked[ei]) }

    var progress: (done: Int, total: Int) { SessionCore.progress(state) }

    func pick(set si: Int, in ei: Int) {
        picked[ei] = si
        if ei == entryIndex { loadTargets() }
    }

    /// Paging to another exercise (a vertical swipe).
    func show(entry ei: Int) {
        guard ei != state.entryIndex else { return }
        state.entryIndex = ei
        loadTargets()
    }

    /// What the complications and the Smart Stack widget show (WidgetState).
    var widgetState: WidgetState {
        if let w = workout {
            let p = progress
            if let end = restEndsAt, end > Date() {
                return WidgetState(mode: "rest", title: entry?.name ?? w.name, detail: "", restEndsAt: end, done: p.done, total: p.total)
            }
            if let e = entry, let si = setIndex {
                let s = e.sets[si]
                let numbers = "\(formatNumber(s.w ?? 0)) \(w.unit) × \(formatNumber(s.r ?? 0))"
                let work = e.sets.filter { !$0.warmup }.count
                return WidgetState(mode: "set", title: e.name, detail: numbers, restEndsAt: nil, done: p.done, total: p.total,
                                   setLabel: "\(min(si + 1, max(1, work)))/\(max(1, work))")
            }
            return WidgetState(mode: "set", title: w.name, detail: "", restEndsAt: nil, done: p.done, total: p.total)
        }
        if let today = ready?.today {
            let total = today.entries.flatMap { $0.sets }.filter { !$0.warmup }.count
            return WidgetState(mode: "today", title: today.name, detail: "", restEndsAt: nil, done: 0, total: total)
        }
        return .idle
    }

    /* ---------- snapshots from the phone ---------- */

    func apply(json: String) {
        guard let data = json.data(using: .utf8),
              let snap = try? JSONDecoder().decode(Snapshot.self, from: data) else { return }
        DispatchQueue.main.async {
            let before = self.state
            let next = SessionCore.applySnapshot(before, snap)
            self.state = next
            if before.workout != nil && next.workout == nil {
                // Ended on the phone: the session here ends too.
                self.health.end(save: true)
                self.dropClips()
                self.skipRest()
            } else if next.workout != nil && next.workout?.id != before.workout?.id {
                // A workout this watch picks up (the app opened mid-workout, or the phone started one).
                self.setStartedAt = Date()
                self.picked = [:]
                self.health.start(workoutId: next.workout?.id)
            }
            if let rest = snap.active?.rest, next.workout?.id == snap.active?.id {
                let end = Date(timeIntervalSince1970: rest.endsAt / 1000)
                if end != self.restEndsAt { self.startRest(until: end, notify: true) }
            }
            self.health.syncSetting(next.settings.health)
            self.loadTargets()
        }
    }

    /// The weight and reps the crown starts from: the set's own target.
    func loadTargets() {
        guard let e = entry else { return }
        let s = setIndex.map { e.sets[$0] } ?? e.sets.last
        weight = s?.w ?? 0
        reps = s?.r ?? 0
    }

    /* ---------- what the lifter does here ---------- */

    func completeSet() {
        guard let w = workout, let e = entry, let si = setIndex else { return }
        let ei = entryIndex
        let now = Date()
        let setFrom = setStartedAt
        closeRest(at: now)
        let hr = health.stats(from: setFrom, to: now)
        let (next, event) = SessionCore.tick(state, entry: ei, set: si, w: weight, r: reps, at: now.timeIntervalSince1970 * 1000,
                                             id: UUID().uuidString, hr: hr)
        state = next
        if let event = event { send(event: event) }
        setStartedAt = now
        WKInterfaceDevice.current().play(.success)
        picked[ei] = nil
        let rest = e.restSec ?? w.restSec
        if rest > 0 {
            startRest(until: now.addingTimeInterval(rest), notify: true)
            restAfter = (e.id, ei, si, w.id ?? "", now)
        }
        // On to the next exercise once this one is done.
        if setIndex == nil, let w2 = workout,
           let nextEi = w2.entries.indices.first(where: { $0 > ei && w2.entries[$0].sets.contains(where: { !$0.done }) }) {
            state.entryIndex = nextEi
        }
        loadTargets()
    }

    /// Starts a ready session here, the phone asleep or not.
    func start(_ session: ReadySession) {
        let now = Date()
        let (next, event) = SessionCore.start(state, session, wid: "watch-" + UUID().uuidString,
                                              at: now.timeIntervalSince1970 * 1000, id: UUID().uuidString)
        state = next
        picked = [:]
        setStartedAt = now
        restAfter = nil
        loadTargets()
        health.start(workoutId: next.workout?.id)
        send(event: event)
        WKInterfaceDevice.current().play(.start)
    }

    /// Finishes the session: the phone saves it with its own Finish and save.
    func finish() {
        closeRest(at: Date())
        let (next, event) = SessionCore.finish(state, at: Date().timeIntervalSince1970 * 1000, id: UUID().uuidString)
        guard let ev = event else { return }
        health.end(save: true)
        skipRest()
        dropClips()
        state = next
        send(event: ev)
        WKInterfaceDevice.current().play(.stop)
    }

    func skipRest() {
        closeRest(at: Date())
        restTimer?.invalidate()
        restEndsAt = nil
        restStartedAt = nil
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [SessionStore.restNotificationId])
    }

    func addRest(_ seconds: TimeInterval) {
        guard let end = restEndsAt else { return }
        let start = restStartedAt
        startRest(until: end.addingTimeInterval(seconds), notify: true)
        restStartedAt = start
    }

    /// The rest as a timer here (with the app in front: the haptic pattern) and as a notification
    /// for its end (with the app not in front: banner and haptic from the system). A new rest or a
    /// skip takes the old one back.
    private func startRest(until end: Date, notify: Bool) {
        restTimer?.invalidate()
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [SessionStore.restNotificationId])
        guard end > Date() else { restEndsAt = nil; restStartedAt = nil; return }
        restEndsAt = end
        restStartedAt = Date()
        restTimer = Timer.scheduledTimer(withTimeInterval: end.timeIntervalSinceNow, repeats: false) { [weak self] _ in
            if self?.restHaptics ?? true { SessionStore.restOverHaptics() }
            DispatchQueue.main.async {
                self?.closeRest(at: Date())
                self?.restEndsAt = nil
                self?.restStartedAt = nil
            }
        }
        guard notify, !isDemo else { return }
        let content = UNMutableNotificationContent()
        content.title = String(localized: "Rest’s over. Next set!")
        if let e = entry, let si = setIndex {
            content.body = String(localized: "\(e.name), set \(si + 1)")
        }
        content.sound = restHaptics ? .default : nil
        content.interruptionLevel = .timeSensitive
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, end.timeIntervalSinceNow), repeats: false)
        center.add(UNNotificationRequest(identifier: SessionStore.restNotificationId, content: content, trigger: trigger))
    }

    /// The rest after a set is over (it ran out, was skipped, or the next set is done): its heart
    /// rate goes to that set, and the next set starts counting from here.
    private func closeRest(at end: Date) {
        guard let r = restAfter else { return }
        restAfter = nil
        setStartedAt = end
        guard let hr = health.stats(from: r.from, to: end) else { return }
        send(event: [
            "id": UUID().uuidString, "type": "setHr", "wid": r.wid, "exId": r.exId,
            "entryIdx": r.entryIdx, "setIdx": r.setIdx, "restHr": hr,
        ])
    }

    /// A short, alarm-like pattern on the wrist: three taps.
    static func restOverHaptics() {
        let device = WKInterfaceDevice.current()
        device.play(.notification)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { device.play(.success) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { device.play(.notification) }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    private func send(event: [String: Any]) {
        guard !isDemo, WCSession.isSupported(),
              let data = try? JSONSerialization.data(withJSONObject: event),
              let json = String(data: data, encoding: .utf8) else { return }
        // Queued by the system and delivered, in order, even when the phone app is not running.
        WCSession.default.transferUserInfo(["event": json])
    }

    /* ---------- the animations ---------- */

    private func log(_ line: String) {
        let stamp = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
        DispatchQueue.main.async { self.clipLog = Array((self.clipLog + ["\(stamp) \(line)"]).suffix(30)) }
    }

    /// The workout is over: its animations go, from memory and from the disk.
    func dropClips() {
        clips = [:]
        try? FileManager.default.removeItem(at: SessionStore.clipDir)
        log("clips deleted")
    }

    static func frames(of url: URL) -> ClipFrames? {
        guard let f = ClipCodec.decode(url) else { return nil }
        return ClipFrames(images: f.images.map { UIImage(cgImage: $0) }, duration: f.duration)
    }

    func session(_ session: WCSession, didReceive file: WCSessionFile) {
        // The file is gone once this returns: moved into the cache now.
        guard let exId = file.metadata?["exId"] as? String else { log("file without an exercise"); return }
        let dir = SessionStore.clipDir
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let dest = dir.appendingPathComponent(exId.replacingOccurrences(of: "/", with: "_") + ".gif")
        try? FileManager.default.removeItem(at: dest)
        guard (try? FileManager.default.moveItem(at: file.fileURL, to: dest)) != nil else { log("\(exId): could not keep the file"); return }
        guard let frames = SessionStore.frames(of: dest) else { log("\(exId): could not decode"); return }
        let wid = file.metadata?["wid"] as? String
        log("\(exId): \(frames.images.count) frames, \(String(format: "%.1f", frames.duration)) s")
        DispatchQueue.main.async {
            // Only for the workout running here; a late file of an earlier one is dropped.
            guard self.workout != nil, wid == nil || wid == self.workout?.id else {
                try? FileManager.default.removeItem(at: dest)
                self.log("\(exId): not for this workout, dropped")
                return
            }
            self.clips[exId] = frames
        }
    }

    /* ---------- WCSessionDelegate ---------- */

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        // The phone's latest snapshot: also what a watch app opened mid-workout picks the session up from.
        if let json = session.receivedApplicationContext["snapshot"] as? String { apply(json: json) }
        sendStatus()
    }

    /// What the phone's Settings → Apple Watch shows about this watch.
    func sendStatus() {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        send(event: ["id": UUID().uuidString, "type": "watchStatus", "health": health.status, "version": version,
                     "at": Date().timeIntervalSince1970 * 1000])
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        if let json = applicationContext["snapshot"] as? String { apply(json: json) }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        if let json = message["snapshot"] as? String { apply(json: json) }
    }

    /* ---------- the demo the CI screenshots show (text only; a synthetic clip at most) ---------- */

    private func startDemo() {
        let screen = SessionStore.demoScreen
        if screen != "empty" { apply(json: screen == "idle" ? SessionStore.demoReadyJSON : SessionStore.demoJSON) }
        DispatchQueue.main.async {
            if screen == "finish" { self.state.entryIndex = self.workout?.entries.count ?? 0 }
            if screen == "rest" { self.startRest(until: Date().addingTimeInterval(83), notify: false) }
            if let path = SessionStore.demoClip, let frames = SessionStore.frames(of: URL(fileURLWithPath: path)) {
                self.clips["0025"] = frames
                self.log("demo clip: \(frames.images.count) frames")
            }
            self.loadTargets()
        }
    }

    static let demoReadyJSON = """
    {"v":1,"unit":"kg","restSec":90,"active":null,"ready":{"today":{"routineIds":["r1"],"name":"Push day","entries":[
    {"id":"0025","name":"Bench Press","mode":"reps","restSec":120,"last":null,"sets":[{"w":62.5,"r":8,"sec":null,"done":false,"warmup":false}]}]},
    "others":[{"routineIds":["r2"],"name":"Pull day","entries":[]},{"routineIds":["r3"],"name":"Legs","entries":[]}]}}
    """

    static let demoJSON = """
    {"v":1,"unit":"kg","restSec":90,"ready":null,"active":{"id":"demo","name":"Push day","unit":"kg","cur":0,"restSec":90,"rest":null,"entries":[
    {"id":"0025","name":"Bench Press","mode":"reps","restSec":120,"last":"60 kg × 8, 60 kg × 8, 60 kg × 7","sets":[
    {"w":60,"r":8,"sec":null,"done":true,"warmup":false,"at":1},{"w":62.5,"r":8,"sec":null,"done":false,"warmup":false},{"w":62.5,"r":8,"sec":null,"done":false,"warmup":false}]},
    {"id":"0426","name":"Overhead Press","mode":"reps","restSec":null,"last":null,"sets":[
    {"w":40,"r":8,"sec":null,"done":false,"warmup":false},{"w":40,"r":8,"sec":null,"done":false,"warmup":false}]}]}}
    """
}
