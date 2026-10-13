import Foundation

/*
 * What the phone sends the watch (frontend lib/watch-sync.js buildSnapshot), as the watch reads
 * it. Plain data, no media. Every field the phone may leave out is optional, so an older or a
 * newer phone never makes the watch fail to read a snapshot.
 */

struct Snapshot: Codable, Equatable {
    var v: Int
    var unit: String?
    var restSec: Double?
    var active: ActiveWorkout?
    var ready: Ready?
    var settings: WatchSettings?
}

/// What the watch can start by itself: today's planned session and a few other routines.
struct Ready: Codable, Equatable {
    var today: ReadySession?
    var others: [ReadySession]
}

struct ReadySession: Codable, Equatable {
    var routineIds: [String]
    var name: String
    var entries: [Entry]
}

struct ActiveWorkout: Codable, Equatable {
    var id: String?
    var name: String
    var unit: String
    var cur: Int
    var restSec: Double
    var rest: RestInfo?
    var entries: [Entry]
}

struct RestInfo: Codable, Equatable {
    var endsAt: Double
}

struct Entry: Codable, Equatable {
    var id: String
    var name: String
    var mode: String
    var restSec: Double?
    var last: String?
    var sets: [SetRow]
}

struct SetRow: Codable, Equatable {
    var w: Double?
    var r: Double?
    var sec: Double?
    var done: Bool
    var warmup: Bool
    /// When it was ticked (ms since 1970), on whichever side ticked it: the later tick wins.
    var at: Double?
}

/// The phone's Settings → Apple Watch (frontend lib/watch-settings.js).
struct WatchSettings: Codable, Equatable {
    /// Apple Health workout session (live heart rate, saved workouts).
    var health: Bool?
    /// The wrist taps when a rest is over.
    var restHaptics: Bool?
    /// What the Digital Crown turns first on a set: "reps" or "weight".
    var crown: String?
}
