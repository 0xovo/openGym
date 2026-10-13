import Capacitor
import Foundation
import WatchConnectivity

/**
 * The phone's end of the Apple Watch link (frontend lib/watch-sync.js, watch app in ios/App/Watch).
 *
 * Phone → watch: the page hands over a snapshot of the running workout (what to lift, what is
 * done, the rest) as a JSON string. It goes out as the application context, which the watch gets
 * whenever it next can, and as a message too when the watch is reachable right now.
 *
 * Watch → phone: the watch sends what happened on it (a set ticked, with its weight and reps) with
 * transferUserInfo, which iOS delivers even when this app is not running. Every event is written to
 * a file first, so one that arrives while the page is asleep (the phone locked in a pocket) is
 * still there when the page wakes: the page drains the file, applies each event once (by its id)
 * and acknowledges it, which removes it here. A live page is told at once ("watchEvent").
 *
 * Without a paired watch nothing happens: status says so and sendSnapshot is a no-op.
 *
 * Usage from JS:
 *   const WatchBridge = registerPlugin('WatchBridge')
 *   await WatchBridge.status()            // { supported, paired, installed, reachable }
 *   await WatchBridge.sendSnapshot({ json })
 *   const { events } = await WatchBridge.drain()
 *   await WatchBridge.ack({ ids })
 *   WatchBridge.addListener('watchEvent', e => ...)
 */
@objc(WatchBridgePlugin)
public class WatchBridgePlugin: CAPPlugin, CAPBridgedPlugin, WCSessionDelegate {
    public let identifier = "WatchBridgePlugin"
    public let jsName = "WatchBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drain", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ack", returnType: CAPPluginReturnPromise),
    ]

    private let queue = DispatchQueue(label: "ch.opengym.watch-events")

    override public func load() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    /* ---------- the page's calls ---------- */

    @objc func status(_ call: CAPPluginCall) {
        guard WCSession.isSupported() else {
            call.resolve(["supported": false, "paired": false, "installed": false, "reachable": false])
            return
        }
        let s = WCSession.default
        call.resolve([
            "supported": true,
            "paired": s.isPaired,
            "installed": s.isWatchAppInstalled,
            "reachable": s.isReachable,
        ])
    }

    @objc func sendSnapshot(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("json is required")
            return
        }
        guard WCSession.isSupported() else { call.resolve(["sent": false]); return }
        let s = WCSession.default
        guard s.activationState == .activated, s.isPaired, s.isWatchAppInstalled else {
            call.resolve(["sent": false])
            return
        }
        let payload: [String: Any] = ["snapshot": json]
        do {
            try s.updateApplicationContext(payload)
        } catch {
            call.resolve(["sent": false, "error": error.localizedDescription])
            return
        }
        if s.isReachable {
            s.sendMessage(payload, replyHandler: nil, errorHandler: nil)
        }
        call.resolve(["sent": true])
    }

    @objc func drain(_ call: CAPPluginCall) {
        queue.async {
            call.resolve(["events": self.readEvents()])
        }
    }

    @objc func ack(_ call: CAPPluginCall) {
        let ids = Set((call.getArray("ids") ?? []).compactMap { $0 as? String })
        queue.async {
            let left = self.readEvents().filter { event in
                guard let id = event["id"] as? String else { return false }
                return !ids.contains(id)
            }
            self.writeEvents(left)
            call.resolve()
        }
    }

    /* ---------- the watch's side ---------- */

    public func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        guard let json = userInfo["event"] as? String,
              let data = json.data(using: .utf8),
              let event = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              event["id"] is String else { return }
        queue.async {
            var events = self.readEvents()
            if !events.contains(where: { ($0["id"] as? String) == (event["id"] as? String) }) {
                events.append(event)
                self.writeEvents(events)
            }
            DispatchQueue.main.async { self.notifyListeners("watchEvent", data: event) }
        }
    }

    public func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}
    public func sessionDidBecomeInactive(_ session: WCSession) {}
    public func sessionDidDeactivate(_ session: WCSession) {
        // A different watch was paired: start a session with that one.
        WCSession.default.activate()
    }

    /* ---------- the queue file ---------- */

    private var fileURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("watch-events.json")
    }

    private func readEvents() -> [[String: Any]] {
        guard let data = try? Data(contentsOf: fileURL),
              let list = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { return [] }
        return list
    }

    private func writeEvents(_ events: [[String: Any]]) {
        // A queue no page drained for a long time is capped, oldest first: a few hundred sets.
        let kept = Array(events.suffix(500))
        if let data = try? JSONSerialization.data(withJSONObject: kept) {
            try? data.write(to: fileURL, options: .atomic)
        }
    }
}
