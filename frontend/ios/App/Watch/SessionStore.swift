import Foundation
import WatchConnectivity
import WatchKit

/*
 * The watch's side of a workout. The phone sends a snapshot of the running session (frontend
 * lib/watch-sync.js through ios/App/App/WatchBridgePlugin.swift); from then on the watch runs it
 * by itself, because the phone's page sleeps once the phone is locked in a pocket. A set ticked
 * here goes back as an event with transferUserInfo, which iOS delivers even when the phone app is
 * not running, and the phone applies it through its own workout screen.
 *
 * Text only: no exercise animations or pictures on the watch.
 */

struct Snapshot: Codable {
    let v: Int
    let active: ActiveWorkout?
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

final class SessionStore: NSObject, ObservableObject, WCSessionDelegate {
    @Published private(set) var workout: ActiveWorkout?
    @Published var entryIndex = 0
    @Published var weight: Double = 0
    @Published var reps: Double = 0
    @Published private(set) var restEndsAt: Date?

    /// Sets ticked here that the phone has not confirmed yet ("exerciseId#setIndex"): a snapshot
    /// sent before the phone applied them must not untick them.
    private var pending = Set<String>()
    private var restTimer: Timer?
    private static let savedKey = "snapshot"
    static let demoArgument = "-OpenGymWatchDemo"

    override init() {
        super.init()
        if ProcessInfo.processInfo.arguments.contains(SessionStore.demoArgument) {
            apply(json: SessionStore.demoJSON)
        } else if let saved = UserDefaults.standard.string(forKey: SessionStore.savedKey) {
            apply(json: saved)
        }
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

    /// The set to do next in the current exercise, or nil when they are all done.
    var setIndex: Int? {
        entry?.sets.firstIndex(where: { !$0.done })
    }

    var unit: String { workout?.unit ?? "kg" }
    var weightStep: Double { unit == "lb" ? 5 : 2.5 }

    /* ---------- snapshots from the phone ---------- */

    func apply(json: String) {
        guard let data = json.data(using: .utf8),
              let snap = try? JSONDecoder().decode(Snapshot.self, from: data) else { return }
        DispatchQueue.main.async {
            guard var next = snap.active else {
                self.workout = nil
                self.pending.removeAll()
                self.restEndsAt = nil
                return
            }
            let sameWorkout = next.id != nil && next.id == self.workout?.id
            // Ticks made here and not yet on the phone stay ticked.
            for (ei, e) in next.entries.enumerated() {
                for (si, s) in e.sets.enumerated() {
                    let key = "\(e.id)#\(si)"
                    if s.done { self.pending.remove(key) } else if self.pending.contains(key) { next.entries[ei].sets[si].done = true }
                }
            }
            self.workout = next
            if !sameWorkout { self.entryIndex = next.cur }
            if let rest = next.rest {
                self.startRest(until: Date(timeIntervalSince1970: rest.endsAt / 1000))
            }
            self.entryIndex = min(max(0, self.entryIndex), max(0, next.entries.count - 1))
            self.loadTargets()
            UserDefaults.standard.set(json, forKey: SessionStore.savedKey)
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
        w.entries[ei].sets[si].done = true
        w.entries[ei].sets[si].w = weight
        w.entries[ei].sets[si].r = reps
        pending.insert("\(e.id)#\(si)")
        workout = w
        send(event: [
            "id": UUID().uuidString,
            "type": "setDone",
            "wid": w.id ?? "",
            "exId": e.id,
            "entryIdx": ei,
            "setIdx": si,
            "w": weight,
            "r": reps,
            "at": Date().timeIntervalSince1970 * 1000,
        ])
        WKInterfaceDevice.current().play(.success)
        let rest = e.restSec ?? w.restSec
        if rest > 0 { startRest(until: Date().addingTimeInterval(rest)) }
        // On to the next exercise once this one is done.
        if setIndex == nil, let next = w.entries.indices.first(where: { $0 > ei && w.entries[$0].sets.contains(where: { !$0.done }) }) {
            entryIndex = next
        }
        loadTargets()
    }

    func move(by step: Int) {
        guard let w = workout, !w.entries.isEmpty else { return }
        entryIndex = min(max(0, entryIndex + step), w.entries.count - 1)
        loadTargets()
    }

    func skipRest() {
        restTimer?.invalidate()
        restEndsAt = nil
    }

    private func startRest(until end: Date) {
        restTimer?.invalidate()
        guard end > Date() else { restEndsAt = nil; return }
        restEndsAt = end
        restTimer = Timer.scheduledTimer(withTimeInterval: end.timeIntervalSinceNow, repeats: false) { [weak self] _ in
            WKInterfaceDevice.current().play(.notification)
            DispatchQueue.main.async { self?.restEndsAt = nil }
        }
    }

    private func send(event: [String: Any]) {
        guard WCSession.isSupported(),
              let data = try? JSONSerialization.data(withJSONObject: event),
              let json = String(data: data, encoding: .utf8) else { return }
        // Queued by the system and delivered even when the phone app is not running.
        WCSession.default.transferUserInfo(["event": json])
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

    static let demoJSON = """
    {"v":1,"active":{"id":"demo","name":"Push day","unit":"kg","cur":0,"restSec":90,"rest":null,"entries":[
    {"id":"0025","name":"Bench Press","mode":"reps","restSec":120,"last":"60 kg × 8, 60 kg × 8, 60 kg × 7","sets":[
    {"w":60,"r":8,"sec":null,"done":true,"warmup":false},{"w":62.5,"r":8,"sec":null,"done":false,"warmup":false},{"w":62.5,"r":8,"sec":null,"done":false,"warmup":false}]},
    {"id":"0426","name":"Overhead Press","mode":"reps","restSec":null,"last":null,"sets":[
    {"w":40,"r":8,"sec":null,"done":false,"warmup":false},{"w":40,"r":8,"sec":null,"done":false,"warmup":false}]}]}}
    """
}
