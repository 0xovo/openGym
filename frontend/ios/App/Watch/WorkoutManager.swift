import Foundation
import HealthKit

/*
 * Apple Health on the watch, behind the "Apple Health" switch (off until the lifter turns it on):
 * a strength-training workout session while the phone's workout runs, which shows the live heart
 * rate here and keeps the watch app running with the wrist down (so the rest still taps the wrist
 * on time), and the workout saved to Apple Health when it ends. Off, nothing of this runs and
 * nothing is asked.
 */
final class WorkoutManager: NSObject, ObservableObject, HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate {
    static let enabledKey = "healthEnabled"

    @Published var enabled: Bool = UserDefaults.standard.bool(forKey: WorkoutManager.enabledKey) {
        didSet { UserDefaults.standard.set(enabled, forKey: WorkoutManager.enabledKey) }
    }
    @Published private(set) var heartRate: Double?
    @Published private(set) var running = false

    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    /// Every reading of the session, for the heart rate of each set and rest (SessionStore).
    private var samples: [(Date, Double)] = []

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

    /// A workout started on the phone: a session here, when the switch is on.
    func start() {
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
            let now = Date()
            s.startActivity(with: now)
            b.beginCollection(withStart: now) { _, _ in }
            running = true
        } catch {
            session = nil
            builder = nil
        }
    }

    /// The workout ended on the phone: saved to Apple Health, or dropped when `save` is false.
    func end(save: Bool) {
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
              let value = stats.mostRecentQuantity()?.doubleValue(for: HKUnit.count().unitDivided(by: .minute())) else { return }
        DispatchQueue.main.async {
            self.heartRate = value
            self.samples.append((Date(), value))
        }
    }
}
