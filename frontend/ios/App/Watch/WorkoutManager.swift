import Foundation
import HealthKit

/*
 * Apple Health on the watch, behind its switch (on the watch's start screen, and in the phone's
 * Settings → Apple Watch, which wins when it is set): a strength-training workout session as soon
 * as a workout starts here or is picked up from the phone, showing the live heart rate and keeping
 * the watch app running with the wrist down (so the rest still taps the wrist on time), and the
 * workout saved to Apple Health when it ends. Off, nothing of this runs and nothing is asked.
 *
 * The heart rate arrives two ways at once, whichever is first: the workout builder's statistics
 * and an anchored query on heart-rate samples, which carry their own time (the sets' and rests'
 * heart rates are worked out from those times). Until the first reading: "measuring".
 * The permission is asked when the switch is turned on (or the phone turns it on), at the start
 * screen, never in the middle of the first set.
 */
final class WorkoutManager: NSObject, ObservableObject, HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate {
    static let enabledKey = "healthEnabled"

    @Published var enabled: Bool = UserDefaults.standard.bool(forKey: WorkoutManager.enabledKey) {
        didSet { UserDefaults.standard.set(enabled, forKey: WorkoutManager.enabledKey) }
    }
    @Published private(set) var heartRate: Double?
    @Published private(set) var running = false
    /// A session runs and no reading has come yet.
    var measuring: Bool { running && heartRate == nil }

    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var query: HKAnchoredObjectQuery?
    /// Every reading of the session, by its own time, for each set's and rest's heart rate.
    private var samples: [(Date, Double)] = []
    private let bpm = HKUnit.count().unitDivided(by: .minute())
    /// A workout to measure (started here or picked up), even before the permission answer.
    private var wanted = false

    /// { avg, max } over a stretch of the session, or nil without readings in it.
    func stats(from start: Date, to end: Date) -> [String: Double]? {
        let inside = samples.filter { $0.0 >= start && $0.0 <= end }.map { $0.1 }
        guard !inside.isEmpty else { return nil }
        let avg = inside.reduce(0, +) / Double(inside.count)
        return ["avg": avg.rounded(), "max": (inside.max() ?? avg).rounded()]
    }

    /// Asks for what the session needs: saving workouts, reading the heart rate.
    func requestAuthorization(_ done: @escaping (Bool) -> Void) {
        guard HKHealthStore.isHealthDataAvailable() else { done(false); return }
        let share: Set<HKSampleType> = [HKObjectType.workoutType()]
        var read: Set<HKObjectType> = [HKObjectType.workoutType()]
        if let hr = HKObjectType.quantityType(forIdentifier: .heartRate) { read.insert(hr) }
        store.requestAuthorization(toShare: share, read: read) { ok, _ in
            DispatchQueue.main.async { done(ok) }
        }
    }

    /// "on", "off" or "denied", for the phone's Settings → Apple Watch.
    var status: String {
        guard HKHealthStore.isHealthDataAvailable() else { return "off" }
        if store.authorizationStatus(for: HKObjectType.workoutType()) == .sharingDenied { return "denied" }
        return enabled ? "on" : "off"
    }

    /// The phone's setting, when it sends one: on asks for the permission (once) right away.
    func syncSetting(_ on: Bool?) {
        guard let on = on, on != enabled else { return }
        if on {
            requestAuthorization { ok in
                self.enabled = ok
                if ok && self.wanted { self.start() }
                self.onStatus?()
            }
        } else {
            enabled = false
            end(save: true)
            onStatus?()
        }
    }

    /// Told when the status changes (SessionStore reports it to the phone).
    var onStatus: (() -> Void)?

    /// The workout's id, for Apple Health's sync identifier (the phone writes none of its own then).
    private var workoutId: String?

    /// A workout started here or picked up from the phone: the session starts now.
    func start(workoutId wid: String? = nil) {
        wanted = true
        if let wid = wid { workoutId = wid }
        guard enabled, session == nil, HKHealthStore.isHealthDataAvailable() else { return }
        let config = HKWorkoutConfiguration()
        config.activityType = .traditionalStrengthTraining
        config.locationType = .indoor
        do {
            let s = try HKWorkoutSession(healthStore: store, configuration: config)
            let b = s.associatedWorkoutBuilder()
            b.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: config)
            s.delegate = self
            b.delegate = self
            session = s
            builder = b
            samples = []
            heartRate = nil
            let now = Date()
            s.startActivity(with: now)
            b.beginCollection(withStart: now) { _, _ in }
            // One workout in Apple Health, not two: the phone skips writing one with this sync id.
            if let wid = workoutId {
                b.addMetadata([HKMetadataKeySyncIdentifier: "opengym-w-\(wid)", HKMetadataKeySyncVersion: 1]) { _, _ in }
            }
            startQuery(from: now)
            running = true
        } catch {
            session = nil
            builder = nil
        }
    }

    private func startQuery(from start: Date) {
        guard let type = HKQuantityType.quantityType(forIdentifier: .heartRate) else { return }
        let predicate = HKQuery.predicateForSamples(withStart: start, end: nil, options: .strictStartDate)
        let handler: (HKAnchoredObjectQuery, [HKSample]?, [HKDeletedObject]?, HKQueryAnchor?, Error?) -> Void = { [weak self] _, added, _, _, _ in
            guard let self = self else { return }
            let readings = (added as? [HKQuantitySample] ?? []).map { ($0.endDate, $0.quantity.doubleValue(for: self.bpm)) }
            guard !readings.isEmpty else { return }
            DispatchQueue.main.async { self.add(readings) }
        }
        let q = HKAnchoredObjectQuery(type: type, predicate: predicate, anchor: nil, limit: HKObjectQueryNoLimit, resultsHandler: handler)
        q.updateHandler = handler
        query = q
        store.execute(q)
    }

    private func add(_ readings: [(Date, Double)]) {
        for r in readings where !samples.contains(where: { abs($0.0.timeIntervalSince(r.0)) < 0.5 }) { samples.append(r) }
        samples.sort { $0.0 < $1.0 }
        if let last = samples.last { heartRate = last.1 }
    }

    /// The workout ended: saved to Apple Health, or dropped when `save` is false.
    func end(save: Bool) {
        wanted = false
        workoutId = nil
        if let q = query { store.stop(q); query = nil }
        guard let s = session, let b = builder else { return }
        s.end()
        b.endCollection(withEnd: Date()) { _, _ in
            if save {
                b.finishWorkout { _, _ in }
            } else {
                b.discardWorkout()
            }
        }
        session = nil
        builder = nil
        DispatchQueue.main.async {
            self.running = false
            self.heartRate = nil
        }
    }

    /* ---------- delegates ---------- */

    func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {}

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        DispatchQueue.main.async { self.running = false }
    }

    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        guard let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate),
              collectedTypes.contains(hrType),
              let stats = workoutBuilder.statistics(for: hrType),
              let value = stats.mostRecentQuantity()?.doubleValue(for: bpm) else { return }
        let at = stats.mostRecentQuantityDateInterval()?.end ?? Date()
        DispatchQueue.main.async { self.add([(at, value)]) }
    }
}
