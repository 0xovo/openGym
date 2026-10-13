import Foundation
import ImageIO
import UIKit
import UserNotifications
import WatchConnectivity
import WatchKit

/*
 * The watch's side of a workout. The phone sends a snapshot of the running session (frontend
 * lib/watch-sync.js through ios/App/App/WatchBridgePlugin.swift); from then on the watch runs it
 * by itself, because the phone's page sleeps once the phone is locked in a pocket. A set ticked
 * here goes back as an event with transferUserInfo, which iOS delivers even when the phone app is
 * not running, and the phone applies it through its own workout screen.
 *
 * Exercise animations: never part of the watch app. The phone sends the running workout's own,
 * as small GIF files (WatchBridgePlugin.sendClips); they are kept here only while that workout runs
 * and deleted when it ends. Without them the page shows the exercise by name.
 */

/// One animation, as frames to cycle through.
struct ClipFrames {
    let images: [UIImage]
    let duration: Double
}

struct Snapshot: Codable {
    let v: Int
    let unit: String?
    let restSec: Double?
    let active: ActiveWorkout?
    let ready: Ready?
}

/// What the watch can start by itself: today's planned session and a few other routines.
struct Ready: Codable, Equatable {
    let today: ReadySession?
    let others: [ReadySession]
}

struct ReadySession: Codable, Equatable {
    let routineIds: [String]
    let name: String
    let entries: [Entry]
}

struct ActiveWorkout: Codable, Equatable {
    let id: String?
    let name: String
    let unit: String
    let cur: Int
    let restSec: Double
    let rest: RestInfo?
    var entries: [Entry]
}

struct RestInfo: Codable, Equatable {
    let endsAt: Double
}

struct Entry: Codable, Equatable {
    let id: String
    let name: String
    let mode: String
    let restSec: Double?
    let last: String?
    var sets: [SetRow]
}

struct SetRow: Codable, Equatable {
    var w: Double?
    var r: Double?
    let sec: Double?
    var done: Bool
    let warmup: Bool
}

final class SessionStore: NSObject, ObservableObject, WCSessionDelegate, UNUserNotificationCenterDelegate {
    /// The session as the watch has it, kept across a relaunch of the watch app.
    @Published private(set) var workout: ActiveWorkout? {
        didSet {
            guard !isDemo else { return }
            let d = UserDefaults.standard
            if let w = workout, let data = try? JSONEncoder().encode(w) { d.set(data, forKey: SessionStore.localKey) } else { d.removeObject(forKey: SessionStore.localKey) }
        }
    }
    @Published private(set) var ready: Ready?
    /// Apple Health: the workout session, its heart rate, and the switch (WorkoutManager).
    let health = WorkoutManager()
    /// The running workout's animations, by exercise id, from the phone.
    @Published private(set) var clips: [String: ClipFrames] = [:]
    private static var clipDir: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("clips")
    }
    /// When the set now up began: the end of the rest before it, or the start of the session.
    private var setStartedAt = Date()
    /// The rest running after a set, for that rest's heart rate once it is over.
    private var restAfter: (exId: String, entryIdx: Int, setIdx: Int, wid: String, from: Date)?
    private var unitDefault = "kg"
    private var restDefault: Double = 90
    /// A session started here that the phone has not reported back yet.
    private var startedHere: String? {
        didSet { if !isDemo { UserDefaults.standard.set(startedHere, forKey: SessionStore.startedKey) } }
    }
    private static let localKey = "localWorkout"
    private static let startedKey = "startedHere"
    @Published var entryIndex = 0
    @Published var weight: Double = 0
    @Published var reps: Double = 0
    @Published private(set) var restEndsAt: Date?
    @Published private(set) var restStartedAt: Date?
    /// A set picked by hand in an exercise (entry index → set index); otherwise the first not done.
    @Published private var picked: [Int: Int] = [:]

    /// Sets ticked here that the phone has not confirmed yet ("exerciseId#setIndex"): a snapshot
    /// sent before the phone applied them must not untick them.
    private var pending = Set<String>()
    private var restTimer: Timer?
    private static let savedKey = "snapshot"
    private static let restNotificationId = "opengym.rest"
    static let demoArgument = "-OpenGymWatchDemo"
    /// CI screenshots: "-OpenGymWatchScreen rest" opens the demo on that screen.
    static var demoScreen: String? {
        let a = ProcessInfo.processInfo.arguments
        guard let i = a.firstIndex(of: "-OpenGymWatchScreen"), i + 1 < a.count else { return nil }
        return a[i + 1]
    }
    var isDemo: Bool { ProcessInfo.processInfo.arguments.contains(SessionStore.demoArgument) }

    override init() {
        super.init()
        if isDemo {
            apply(json: SessionStore.demoScreen == "idle" ? SessionStore.demoReadyJSON : SessionStore.demoJSON)
            if SessionStore.demoScreen == "rest" {
                DispatchQueue.main.async { self.startRest(until: Date().addingTimeInterval(83), notify: false) }
            }
        } else {
            let d = UserDefaults.standard
            if let data = d.data(forKey: SessionStore.localKey), let w = try? JSONDecoder().decode(ActiveWorkout.self, from: data) {
                workout = w
                startedHere = d.string(forKey: SessionStore.startedKey)
                loadTargets()
            }
            if let saved = d.string(forKey: SessionStore.savedKey) { apply(json: saved) }
        }
        // The rest's end as a notification, also when the app is not in front (not in the demo:
        // the permission question would cover the screenshot).
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        if !isDemo { center.requestAuthorization(options: [.alert, .sound]) { _, _ in } }
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    /* ---------- what the views read ---------- */

    var entry: Entry? {
        guard let w = workout, w.entries.indices.contains(entryIndex) else { return nil }
        return w.entries[entryIndex]
    }

    /// The set to do next in the current exercise (the one picked, or the first not done), or nil
    /// when they are all done.
    var setIndex: Int? { setIndex(in: entryIndex) }

    func setIndex(in ei: Int) -> Int? {
        guard let w = workout, w.entries.indices.contains(ei) else { return nil }
        let sets = w.entries[ei].sets
        if let p = picked[ei], sets.indices.contains(p), !sets[p].done { return p }
        return sets.firstIndex(where: { !$0.done })
    }

    func pick(set si: Int, in ei: Int) {
        picked[ei] = si
        if ei == entryIndex { loadTargets() }
    }

    /// Paging to another exercise (Digital Crown or a vertical swipe).
    func show(entry ei: Int) {
        guard ei != entryIndex else { return }
        entryIndex = ei
        loadTargets()
    }

    var unit: String { workout?.unit ?? "kg" }
    var weightStep: Double { unit == "lb" ? 5 : 2.5 }

    /* ---------- snapshots from the phone ---------- */

    func apply(json: String) {
        guard let data = json.data(using: .utf8),
              let snap = try? JSONDecoder().decode(Snapshot.self, from: data) else { return }
        DispatchQueue.main.async {
            self.ready = snap.ready
            if let u = snap.unit { self.unitDefault = u }
            if let r = snap.restSec, r > 0 { self.restDefault = r }
            UserDefaults.standard.set(json, forKey: SessionStore.savedKey)
            guard var next = snap.active else {
                // A session started here that the phone has not heard of yet stays.
                if self.workout != nil && self.workout?.id == self.startedHere { return }
                if self.workout != nil { self.health.end(save: true) }
                self.dropClips()
                self.workout = nil
                self.pending.removeAll()
                self.skipRest()
                return
            }
            if next.id == self.startedHere { self.startedHere = nil }
            let sameWorkout = next.id != nil && next.id == self.workout?.id
            // Ticks made here and not yet on the phone stay ticked.
            for (ei, e) in next.entries.enumerated() {
                for (si, s) in e.sets.enumerated() {
                    let key = "\(e.id)#\(si)"
                    if s.done { self.pending.remove(key) } else if self.pending.contains(key) { next.entries[ei].sets[si].done = true }
                }
            }
            self.workout = next
            if !sameWorkout {
                self.entryIndex = next.cur
                self.setStartedAt = Date()
                if !self.isDemo { self.health.start() }
            }
            if let rest = next.rest {
                self.startRest(until: Date(timeIntervalSince1970: rest.endsAt / 1000), notify: true)
            }
            self.entryIndex = min(max(0, self.entryIndex), next.entries.count)   // the last page is Finish
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
        guard var w = workout, let e = entry, let si = setIndex else { return }
        let ei = entryIndex
        let now = Date()
        let setFrom = setStartedAt
        closeRest(at: now)
        w.entries[ei].sets[si].done = true
        w.entries[ei].sets[si].w = weight
        w.entries[ei].sets[si].r = reps
        pending.insert("\(e.id)#\(si)")
        workout = w
        var event: [String: Any] = [
            "id": UUID().uuidString,
            "type": "setDone",
            "wid": w.id ?? "",
            "exId": e.id,
            "entryIdx": ei,
            "setIdx": si,
            "w": weight,
            "r": reps,
            "at": now.timeIntervalSince1970 * 1000,
        ]
        if let hr = health.stats(from: setFrom, to: now) { event["hr"] = hr }
        send(event: event)
        setStartedAt = now
        WKInterfaceDevice.current().play(.success)
        let rest = e.restSec ?? w.restSec
        picked[ei] = nil
        if rest > 0 {
            startRest(until: now.addingTimeInterval(rest), notify: true)
            // after startRest, which closes any rest before it
            restAfter = (e.id, ei, si, w.id ?? "", now)
        }
        // On to the next exercise once this one is done.
        if setIndex == nil, let next = w.entries.indices.first(where: { $0 > ei && w.entries[$0].sets.contains(where: { !$0.done }) }) {
            entryIndex = next
        }
        loadTargets()
    }

    /// Starts a ready session here, the phone asleep or not: the watch's id and start time go to
    /// the phone, which starts the same session with them when it next runs.
    func start(_ session: ReadySession) {
        let id = "watch-" + UUID().uuidString
        let now = Date()
        startedHere = id
        workout = ActiveWorkout(id: id, name: session.name, unit: unitDefault, cur: 0, restSec: restDefault, rest: nil, entries: session.entries)
        entryIndex = 0
        picked = [:]
        pending.removeAll()
        loadTargets()
        setStartedAt = now
        restAfter = nil
        health.start()
        send(event: [
            "id": UUID().uuidString,
            "type": "start",
            "routineIds": session.routineIds,
            "wid": id,
            "at": now.timeIntervalSince1970 * 1000,
        ])
        WKInterfaceDevice.current().play(.start)
    }

    /// Finishes the session: the phone saves it with its own Finish and save.
    func finish() {
        guard let w = workout else { return }
        closeRest(at: Date())
        health.end(save: true)
        send(event: [
            "id": UUID().uuidString,
            "type": "finish",
            "wid": w.id ?? "",
            "at": Date().timeIntervalSince1970 * 1000,
        ])
        skipRest()
        dropClips()
        workout = nil
        startedHere = nil
        pending.removeAll()
        WKInterfaceDevice.current().play(.stop)
    }

    func move(by step: Int) {
        guard let w = workout, !w.entries.isEmpty else { return }
        entryIndex = min(max(0, entryIndex + step), w.entries.count - 1)
        loadTargets()
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
            SessionStore.restOverHaptics()
            DispatchQueue.main.async {
                self?.closeRest(at: Date())
                self?.restEndsAt = nil
                self?.restStartedAt = nil
            }
        }
        guard notify else { return }
        let content = UNMutableNotificationContent()
        content.title = String(localized: "Rest’s over. Next set!")
        if let e = entry, let si = setIndex {
            content.body = String(localized: "\(e.name), set \(si + 1)")
        }
        content.sound = .default
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
            "id": UUID().uuidString,
            "type": "setHr",
            "wid": r.wid,
            "exId": r.exId,
            "entryIdx": r.entryIdx,
            "setIdx": r.setIdx,
            "restHr": hr,
        ])
    }

    /// A short, alarm-like pattern on the wrist: three taps.
    static func restOverHaptics() {
        let device = WKInterfaceDevice.current()
        device.play(.notification)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { device.play(.success) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { device.play(.notification) }
    }

    /* ---------- notifications with the app in front ---------- */

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    private func send(event: [String: Any]) {
        guard WCSession.isSupported(),
              let data = try? JSONSerialization.data(withJSONObject: event),
              let json = String(data: data, encoding: .utf8) else { return }
        // Queued by the system and delivered even when the phone app is not running.
        WCSession.default.transferUserInfo(["event": json])
    }

    /* ---------- the animations ---------- */

    /// The workout is over: its animations go, from memory and from the disk.
    func dropClips() {
        clips = [:]
        try? FileManager.default.removeItem(at: SessionStore.clipDir)
    }

    static func decode(_ url: URL) -> ClipFrames? {
        guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        let count = CGImageSourceGetCount(src)
        guard count > 0 else { return nil }
        var images: [UIImage] = []
        var total = 0.0
        for i in 0..<count {
            guard let cg = CGImageSourceCreateImageAtIndex(src, i, nil) else { continue }
            images.append(UIImage(cgImage: cg))
            let props = CGImageSourceCopyPropertiesAtIndex(src, i, nil) as? [String: Any]
            let gif = props?[kCGImagePropertyGIFDictionary as String] as? [String: Any]
            let delay = (gif?[kCGImagePropertyGIFUnclampedDelayTime as String] as? Double) ?? (gif?[kCGImagePropertyGIFDelayTime as String] as? Double) ?? 0.1
            total += delay > 0.01 ? delay : 0.1
        }
        return images.isEmpty ? nil : ClipFrames(images: images, duration: total)
    }

    func session(_ session: WCSession, didReceive file: WCSessionFile) {
        // The file is gone once this returns: moved into the cache now.
        guard let exId = file.metadata?["exId"] as? String else { return }
        let dir = SessionStore.clipDir
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let dest = dir.appendingPathComponent(exId.replacingOccurrences(of: "/", with: "_") + ".gif")
        try? FileManager.default.removeItem(at: dest)
        guard (try? FileManager.default.moveItem(at: file.fileURL, to: dest)) != nil,
              let frames = SessionStore.decode(dest) else { return }
        let wid = file.metadata?["wid"] as? String
        DispatchQueue.main.async {
            // Only for the workout running here; a late file of an earlier one is dropped.
            guard self.workout != nil, wid == nil || wid == self.workout?.id else {
                try? FileManager.default.removeItem(at: dest)
                return
            }
            self.clips[exId] = frames
        }
    }

    /* ---------- WCSessionDelegate ---------- */

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        if let json = session.receivedApplicationContext["snapshot"] as? String { apply(json: json) }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        if let json = applicationContext["snapshot"] as? String { apply(json: json) }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        if let json = message["snapshot"] as? String { apply(json: json) }
    }

    /* ---------- the demo the CI screenshot shows ---------- */

    static let demoReadyJSON = """
    {"v":1,"unit":"kg","restSec":90,"active":null,"ready":{"today":{"routineIds":["r1"],"name":"Push day","entries":[
    {"id":"0025","name":"Bench Press","mode":"reps","restSec":120,"last":null,"sets":[{"w":62.5,"r":8,"sec":null,"done":false,"warmup":false}]}]},
    "others":[{"routineIds":["r2"],"name":"Pull day","entries":[]},{"routineIds":["r3"],"name":"Legs","entries":[]}]}}
    """

    static let demoJSON = """
    {"v":1,"unit":"kg","restSec":90,"ready":null,"active":{"id":"demo","name":"Push day","unit":"kg","cur":0,"restSec":90,"rest":null,"entries":[
    {"id":"0025","name":"Bench Press","mode":"reps","restSec":120,"last":"60 kg × 8, 60 kg × 8, 60 kg × 7","sets":[
    {"w":60,"r":8,"sec":null,"done":true,"warmup":false},{"w":62.5,"r":8,"sec":null,"done":false,"warmup":false},{"w":62.5,"r":8,"sec":null,"done":false,"warmup":false}]},
    {"id":"0426","name":"Overhead Press","mode":"reps","restSec":null,"last":null,"sets":[
    {"w":40,"r":8,"sec":null,"done":false,"warmup":false},{"w":40,"r":8,"sec":null,"done":false,"warmup":false}]}]}}
    """
}
