import Foundation

/*
 * The session as the watch keeps it, and every change to it, as pure functions: the watch app's
 * SessionStore only calls these, saves the state after each, and sends the events they return.
 * Tested with `swift test` (Tests/WatchCoreTests), no watch needed.
 *
 * The sync, case by case (the phone's side: frontend lib/watch-sync.js):
 *
 *   watch app never opened before the workout started on the phone
 *       the phone keeps its snapshot as the application context, which the watch reads when it
 *       launches (applySnapshot): it picks the running workout up where the phone has it.
 *   watch app killed and relaunched mid-workout
 *       the whole state is saved after every change and restored at launch; then the latest
 *       snapshot is applied over it, with the watch's own unconfirmed ticks kept (below).
 *   phone asleep, locked in a pocket, app killed, Bluetooth off, out of range
 *       the watch runs the session alone; each tick, start and finish is an event sent with
 *       transferUserInfo, which the system queues and delivers, in order, when it can; the phone
 *       applies each one once, by its id.
 *   a snapshot older than the watch's own ticks (sent before the phone applied them)
 *       a tick stays pending until a snapshot shows that set done at the tick's time or later;
 *       until then the snapshot's copy of that set is replaced by the watch's.
 *   the same set changed on both sides
 *       the later tick (`at`) wins, on both sides: here in applySnapshot, on the phone in the
 *       workout screen's watch handler.
 *   finished on the watch while the phone was away
 *       the workout leaves the watch at once; a snapshot that still shows it running (the phone
 *       has not heard yet) does not bring it back.
 *   finished on the phone while the watch was away
 *       a snapshot without it ends it here; ticks the watch made meanwhile are still sent, and
 *       the phone writes them into the saved workout.
 *   started on the watch while the phone was away
 *       kept until the phone reports it back running; a snapshot without it does not end it.
 */

struct PendingTick: Codable, Equatable {
    var w: Double?
    var r: Double?
    var at: Double
}

struct SessionState: Codable, Equatable {
    var workout: ActiveWorkout?
    var ready: Ready?
    var settings = WatchSettings()
    var unit = "kg"
    var restSec: Double = 90
    /// A session started here that the phone has not reported back running yet.
    var startedHere: String?
    /// Sessions finished here that the phone may still report running for a while.
    var finishedHere: [String] = []
    /// Ticks made here, by "exerciseId#setIndex", until a snapshot shows them.
    var pending: [String: PendingTick] = [:]
    /// The exercise on screen.
    var entryIndex = 0
}

typealias Event = [String: Any]

enum SessionCore {
    static func key(_ exId: String, _ si: Int) -> String { "\(exId)#\(si)" }

    /// A snapshot from the phone, over what the watch has.
    static func applySnapshot(_ s0: SessionState, _ snap: Snapshot) -> SessionState {
        var s = s0
        s.ready = snap.ready
        if let u = snap.unit { s.unit = u }
        if let r = snap.restSec, r > 0 { s.restSec = r }
        if let st = snap.settings { s.settings = st }

        // A session started here that the phone has not reported back yet stays, whatever it sends.
        let unconfirmed = s.workout?.id != nil && s.workout?.id == s.startedHere
        guard var next = snap.active, !(next.id.map { s.finishedHere.contains($0) } ?? false) else {
            // No workout on the phone, or one the watch has finished already.
            if unconfirmed { return s }
            s.workout = nil
            s.pending = [:]
            return s
        }
        let same = next.id != nil && next.id == s.workout?.id
        if next.id != nil && next.id == s.startedHere { s.startedHere = nil }
        if !same && unconfirmed {
            // The phone runs a different workout than the one started here and not yet confirmed:
            // the watch keeps its own; the phone keeps its own (frontend: a start while another runs).
            return s
        }
        if !same {
            // Another workout (or the first one this watch sees): its own position, no old ticks.
            s.pending = [:]
            s.entryIndex = next.cur
        }
        // The watch's ticks the phone has not shown yet win; the later tick wins on a set both changed.
        for (ei, e) in next.entries.enumerated() {
            for (si, row) in e.sets.enumerated() {
                let k = key(e.id, si)
                guard let p = s.pending[k] else { continue }
                if row.done && (row.at ?? .infinity) >= p.at {
                    s.pending[k] = nil          // the phone has it (or a later change of its own)
                } else {
                    next.entries[ei].sets[si].done = true
                    next.entries[ei].sets[si].w = p.w ?? row.w
                    next.entries[ei].sets[si].r = p.r ?? row.r
                    next.entries[ei].sets[si].at = p.at
                }
            }
        }
        s.entryIndex = min(max(0, s.entryIndex), next.entries.count)   // the last page is Finish
        s.workout = next
        return s
    }

    /// A set ticked here: the state with it done, and the event for the phone.
    static func tick(_ s0: SessionState, entry ei: Int, set si: Int, w: Double, r: Double, at: Double, id: String, hr: [String: Double]? = nil) -> (SessionState, Event?) {
        guard var workout = s0.workout, workout.entries.indices.contains(ei), workout.entries[ei].sets.indices.contains(si) else { return (s0, nil) }
        var s = s0
        let e = workout.entries[ei]
        workout.entries[ei].sets[si].done = true
        workout.entries[ei].sets[si].w = w
        workout.entries[ei].sets[si].r = r
        workout.entries[ei].sets[si].at = at
        s.workout = workout
        s.pending[key(e.id, si)] = PendingTick(w: w, r: r, at: at)
        var event: Event = [
            "id": id, "type": "setDone", "wid": workout.id ?? "", "exId": e.id,
            "entryIdx": ei, "setIdx": si, "w": w, "r": r, "at": at,
        ]
        if let hr = hr { event["hr"] = hr }
        return (s, event)
    }

    /// A ready session started here.
    static func start(_ s0: SessionState, _ session: ReadySession, wid: String, at: Double, id: String) -> (SessionState, Event) {
        var s = s0
        s.workout = ActiveWorkout(id: wid, name: session.name, unit: s.unit, cur: 0, restSec: s.restSec, rest: nil, entries: session.entries)
        s.startedHere = wid
        s.pending = [:]
        s.entryIndex = 0
        return (s, ["id": id, "type": "start", "routineIds": session.routineIds, "wid": wid, "at": at])
    }

    /// The session finished here.
    static func finish(_ s0: SessionState, at: Double, id: String) -> (SessionState, Event?) {
        guard let w = s0.workout else { return (s0, nil) }
        var s = s0
        s.workout = nil
        s.pending = [:]
        s.startedHere = nil
        if let wid = w.id { s.finishedHere = Array((s.finishedHere + [wid]).suffix(5)) }
        return (s, ["id": id, "type": "finish", "wid": w.id ?? "", "at": at])
    }

    /// The set to do next in an exercise: the one picked, or the first not done.
    static func setIndex(_ s: SessionState, entry ei: Int, picked: Int? = nil) -> Int? {
        guard let w = s.workout, w.entries.indices.contains(ei) else { return nil }
        let sets = w.entries[ei].sets
        if let p = picked, sets.indices.contains(p), !sets[p].done { return p }
        return sets.firstIndex { !$0.done }
    }

    /// Sets done and sets in all, for the complication's ring.
    static func progress(_ s: SessionState) -> (done: Int, total: Int) {
        guard let w = s.workout else { return (0, 0) }
        let all = w.entries.flatMap { $0.sets }.filter { !$0.warmup }
        return (all.filter { $0.done }.count, all.count)
    }
}
