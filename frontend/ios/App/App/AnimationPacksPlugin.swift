import Foundation
import Capacitor
import Network
#if canImport(BackgroundAssets)
import BackgroundAssets
#endif

/**
 * The sharper exercise animations, as Apple-hosted asset packs (Background Assets, iOS 26 and
 * later): one pack per quality and figure, `anim-<px>-male` / `anim-<px>-female`, uploaded to App
 * Store Connect and delivered by Apple, never by a server of ours (Gym visual licence: anything
 * above 180 px reaches people only inside the store app). The packs and what is in them come from
 * scripts/media/make-pack-manifests.mjs; inside a pack a drawing sits at `<packId>/<id>.webp`.
 * The page side is frontend/src/lib/anim-packs.js. On an older iOS every call answers
 * "unavailable" and the app shows its built-in animations.
 *
 * The app needs, in Info.plist, BAAppGroupID, BAHasManagedAssetPacks and BAUsesAppleHosting, and
 * the downloader extension (AnimationPacksDownloader), which the system runs to fetch packs.
 */
@objc(AnimationPacksPlugin)
public class AnimationPacksPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AnimationPacksPlugin"
    public let jsName = "AnimationPacks"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "localPath", returnType: CAPPluginReturnPromise),
    ]

    /// Only the ids the app knows: a pack id from the page goes nowhere else.
    private static let packPattern = try! NSRegularExpression(pattern: "^anim-(240|360|480|720|1080)-(male|female)$")
    private static let probePattern = try! NSRegularExpression(pattern: "^[0-9]{4,5}$")

    private static func matches(_ re: NSRegularExpression, _ s: String) -> Bool {
        re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
    }

    private func packArgs(_ call: CAPPluginCall, probe needed: Bool) -> (String, String)? {
        guard let id = call.getString("packId"), AnimationPacksPlugin.matches(AnimationPacksPlugin.packPattern, id) else {
            call.reject("unknown pack", "failed")
            return nil
        }
        let probe = call.getString("probe") ?? ""
        if needed && !AnimationPacksPlugin.matches(AnimationPacksPlugin.probePattern, probe) {
            call.reject("probe is required", "failed")
            return nil
        }
        return (id, probe)
    }

    /// Apple-hosted packs: iOS 26 and an app that declares them.
    private var supported: Bool {
        guard Bundle.main.object(forInfoDictionaryKey: "BAUsesAppleHosting") as? Bool == true else { return false }
        if #available(iOS 26.0, *) { return true }
        return false
    }

    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["available": supported])
    }

    @objc func status(_ call: CAPPluginCall) {
        guard let (id, probe) = packArgs(call, probe: true) else { return }
        guard supported, let folder = localFolder(id, probe) else {
            call.resolve(["state": "none"])
            return
        }
        call.resolve(["state": "ready", "bytes": AnimationPacksPlugin.size(of: folder)])
    }

    @objc func localPath(_ call: CAPPluginCall) {
        guard let (id, probe) = packArgs(call, probe: true) else { return }
        guard supported, let folder = localFolder(id, probe) else {
            call.reject("not downloaded", "unavailable")
            return
        }
        call.resolve(["path": folder.path])
    }

    @objc func download(_ call: CAPPluginCall) {
        guard let (id, _) = packArgs(call, probe: false) else { return }
        guard supported else { call.reject("asset packs need iOS 26", "unavailable"); return }
        let wifiOnly = call.getBool("wifiOnly") ?? true
        #if canImport(BackgroundAssets)
        if #available(iOS 26.0, *) {
            Task {
                if wifiOnly, await !AnimationPacksPlugin.onWifi() {
                    call.reject("waiting for Wi-Fi", "needs-wifi")
                    return
                }
                let manager = AssetPackManager.shared
                let watcher = Task { [weak self] in
                    for await update in manager.statusUpdates(forAssetPackWithID: id) {
                        if case .downloading(_, let progress) = update {
                            self?.notifyListeners("progress", data: ["packId": id, "fraction": progress.fractionCompleted])
                        }
                    }
                }
                defer { watcher.cancel() }
                do {
                    let pack = try await manager.assetPack(withID: id)
                    try await manager.ensureLocalAvailability(of: pack)
                    call.resolve()
                } catch is CancellationError {
                    call.reject("cancelled", "cancelled")
                } catch {
                    call.reject(error.localizedDescription, "failed")
                }
            }
            return
        }
        #endif
        call.reject("asset packs need iOS 26", "unavailable")
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let (id, _) = packArgs(call, probe: false) else { return }
        guard supported else { call.resolve(); return }
        #if canImport(BackgroundAssets)
        if #available(iOS 26.0, *) {
            Task {
                do {
                    try await AssetPackManager.shared.remove(assetPackWithID: id)
                    call.resolve()
                } catch {
                    call.reject(error.localizedDescription, "failed")
                }
            }
            return
        }
        #endif
        call.resolve()
    }

    /// The folder a downloaded pack's files are in, found through one file it holds: Background
    /// Assets reads all downloaded packs as one tree and answers for a path, not for a pack.
    private func localFolder(_ id: String, _ probe: String) -> URL? {
        #if canImport(BackgroundAssets)
        if #available(iOS 26.0, *) {
            guard let file = try? AssetPackManager.shared.url(for: "\(id)/\(probe).webp") else { return nil }
            return file.deletingLastPathComponent()
        }
        #endif
        return nil
    }

    private static func size(of folder: URL) -> Int {
        let keys: [URLResourceKey] = [.totalFileAllocatedSizeKey, .fileAllocatedSizeKey]
        guard let files = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: keys) else { return 0 }
        var total = 0
        for case let f as URL in files {
            let v = try? f.resourceValues(forKeys: Set(keys))
            total += v?.totalFileAllocatedSize ?? v?.fileAllocatedSize ?? 0
        }
        return total
    }

    /// Whether the phone is on a network that costs nothing extra (Wi-Fi or a cable), now.
    private static func onWifi() async -> Bool {
        await withCheckedContinuation { done in
            let monitor = NWPathMonitor()
            var answered = false
            monitor.pathUpdateHandler = { path in
                guard !answered else { return }
                answered = true
                monitor.cancel()
                done.resume(returning: path.status == .satisfied && !path.isExpensive && !path.isConstrained)
            }
            monitor.start(queue: DispatchQueue(label: "ch.opengym.app.anim-packs.path"))
        }
    }
}
