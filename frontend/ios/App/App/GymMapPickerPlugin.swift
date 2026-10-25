import Foundation
import Capacitor
import CoreLocation
import MapKit
import UIKit

/**
 * The gym reminder's place picker on the iPhone (#614, 1.4.4): Apple Maps instead of the web map,
 * because that is the map people on an iPhone already know. A full-screen MKMapView with the
 * app's tint and light/dark look, a search on top (MKLocalSearch, gyms first), "I'm here right
 * now", a pin you can drag or tap into place and the radius as a circle with a slider.
 * No API key: MapKit comes with the system.
 *
 * Nothing is kept here. The place goes back to the page, which saves it with GymReminder.configure
 * like any other gym (GymReminderPlugin.swift); a search goes to Apple, which the picker says
 * under the search field. All words come from the page (`strings`), in the app's language.
 *
 * Usage from JS (lib/gym-places.js pickOnNativeMap):
 *   const P = registerPlugin('GymMapPicker');
 *   await P.pick({ lat?, lng?, name, radius, min, max, step, tint: '#rrggbb', dark, strings });
 *   // { name, address, lat, lng, radius } or { cancelled: true }
 */
@objc(GymMapPickerPlugin)
public class GymMapPickerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GymMapPickerPlugin"
    public let jsName = "GymMapPicker"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise),
    ]

    @objc func pick(_ call: CAPPluginCall) {
        let options = GymMapPickerOptions(call)
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else { call.reject("no view to present on"); return }
            let picker = GymMapPickerController(options: options) { result in
                call.resolve(result ?? ["cancelled": true])
            }
            let nav = UINavigationController(rootViewController: picker)
            nav.modalPresentationStyle = .fullScreen
            nav.view.tintColor = options.tint
            nav.overrideUserInterfaceStyle = options.dark ? .dark : .light
            presenter.present(nav, animated: true)
        }
    }
}

/// What the page asked for, read once from the call.
struct GymMapPickerOptions {
    let start: CLLocationCoordinate2D?
    let name: String
    let radius: Double
    let minRadius: Double
    let maxRadius: Double
    let step: Double
    let tint: UIColor
    let dark: Bool
    private let strings: [String: String]

    init(_ call: CAPPluginCall) {
        if let lat = call.getDouble("lat"), let lng = call.getDouble("lng"), CLLocationCoordinate2DIsValid(CLLocationCoordinate2D(latitude: lat, longitude: lng)) {
            start = CLLocationCoordinate2D(latitude: lat, longitude: lng)
        } else {
            start = nil
        }
        name = call.getString("name") ?? ""
        minRadius = call.getDouble("min") ?? 50
        maxRadius = max(call.getDouble("max") ?? 500, minRadius)
        step = max(call.getDouble("step") ?? 10, 1)
        radius = min(max(call.getDouble("radius") ?? 100, minRadius), maxRadius)
        tint = GymMapPickerOptions.color(hex: call.getString("tint") ?? "") ?? .systemGreen
        dark = call.getBool("dark") ?? true
        var words: [String: String] = [:]
        for (key, value) in call.getObject("strings") ?? [:] {
            if let text = value as? String { words[key] = text }
        }
        strings = words
    }

    /// A word from the page, or the English one when the page sent none.
    func s(_ key: String, _ english: String) -> String {
        let v = strings[key] ?? ""
        return v.isEmpty ? english : v
    }

    /// "#30d158" to a colour; nil for anything else (the system green then).
    static func color(hex: String) -> UIColor? {
        var h = hex.trimmingCharacters(in: .whitespaces)
        if h.hasPrefix("#") { h.removeFirst() }
        guard h.count == 6, let v = UInt32(h, radix: 16) else { return nil }
        return UIColor(red: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255, alpha: 1)
    }
}

/// The picker screen itself.
final class GymMapPickerController: UIViewController, MKMapViewDelegate, UISearchBarDelegate,
    UITableViewDataSource, UITableViewDelegate, CLLocationManagerDelegate {

    private let options: GymMapPickerOptions
    private var finish: (([String: Any]?) -> Void)?

    private let map = MKMapView()
    private let pin = MKPointAnnotation()
    private var circle: MKCircle?
    private var placed = false
    private var radius: Double
    private var name: String
    private var address = ""

    private let searchBar = UISearchBar()
    private let privacyLabel = UILabel()
    private let results = UITableView(frame: .zero, style: .plain)
    private var resultsHeight: NSLayoutConstraint!
    private var items: [MKMapItem] = []
    private var searched = false
    private var search: MKLocalSearch?

    private let panel = UIVisualEffectView(effect: UIBlurEffect(style: .systemThickMaterial))
    private let hintLabel = UILabel()
    private let radiusLabel = UILabel()
    private let slider = UISlider()
    private let hereButton = UIButton(type: .system)

    private let geocoder = CLGeocoder()
    private let locator = CLLocationManager()
    private var wantsHere = false
    private var centredOnUser = false

    init(options: GymMapPickerOptions, finish: @escaping ([String: Any]?) -> Void) {
        self.options = options
        self.finish = finish
        self.radius = options.radius
        self.name = options.name
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("not from a storyboard") }

    // MARK: building the screen

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        title = options.s("title", "Your gym")
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: options.s("cancel", "Cancel"), style: .plain, target: self, action: #selector(cancelTapped))
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: options.s("done", "Use this place"), style: .done, target: self, action: #selector(doneTapped))
        navigationItem.rightBarButtonItem?.isEnabled = false

        // The map fills the screen; the search sits on top of it, the radius panel at the bottom.
        map.delegate = self
        map.pointOfInterestFilter = .includingAll
        map.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(map)
        map.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(mapTapped(_:))))

        searchBar.placeholder = options.s("search", "Find your gym…")
        searchBar.searchBarStyle = .minimal
        searchBar.backgroundColor = .systemBackground
        searchBar.delegate = self
        searchBar.returnKeyType = .search
        searchBar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(searchBar)

        privacyLabel.text = options.s("privacy", "Searches go to Apple Maps. Your gyms stay on this phone.")
        privacyLabel.font = .preferredFont(forTextStyle: .caption2)
        privacyLabel.adjustsFontForContentSizeCategory = true
        privacyLabel.textColor = .secondaryLabel
        privacyLabel.numberOfLines = 0
        privacyLabel.backgroundColor = .systemBackground
        privacyLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(privacyLabel)

        results.dataSource = self
        results.delegate = self
        results.isHidden = true
        results.layer.cornerRadius = 14
        results.clipsToBounds = true
        results.keyboardDismissMode = .onDrag
        results.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(results)

        panel.layer.cornerRadius = 18
        panel.clipsToBounds = true
        panel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(panel)

        hintLabel.text = options.s("hint", "Tap the map or drag the pin onto your gym.")
        hintLabel.font = .preferredFont(forTextStyle: .footnote)
        hintLabel.adjustsFontForContentSizeCategory = true
        hintLabel.textColor = .secondaryLabel
        hintLabel.numberOfLines = 0
        radiusLabel.font = .monospacedDigitSystemFont(ofSize: 15, weight: .semibold)
        slider.minimumValue = Float(options.minRadius)
        slider.maximumValue = Float(options.maxRadius)
        slider.value = Float(radius)
        slider.minimumTrackTintColor = options.tint
        slider.addTarget(self, action: #selector(sliderMoved), for: .valueChanged)

        var here = UIButton.Configuration.filled()
        here.title = options.s("here", "I’m here right now")
        here.image = UIImage(systemName: "location.fill")
        here.imagePadding = 8
        here.cornerStyle = .large
        here.buttonSize = .large
        here.baseBackgroundColor = options.tint
        here.baseForegroundColor = GymMapPickerController.ink(on: options.tint)
        hereButton.configuration = here
        hereButton.addTarget(self, action: #selector(hereTapped), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [hintLabel, radiusLabel, slider, hereButton])
        stack.axis = .vertical
        stack.spacing = 10
        stack.setCustomSpacing(4, after: radiusLabel)
        stack.translatesAutoresizingMaskIntoConstraints = false
        panel.contentView.addSubview(stack)

        let safe = view.safeAreaLayoutGuide
        resultsHeight = results.heightAnchor.constraint(equalToConstant: 0)
        NSLayoutConstraint.activate([
            map.topAnchor.constraint(equalTo: view.topAnchor),
            map.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            map.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            map.trailingAnchor.constraint(equalTo: view.trailingAnchor),

            searchBar.topAnchor.constraint(equalTo: safe.topAnchor),
            searchBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            searchBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            privacyLabel.topAnchor.constraint(equalTo: searchBar.bottomAnchor),
            privacyLabel.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 18),
            privacyLabel.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -18),

            results.topAnchor.constraint(equalTo: privacyLabel.bottomAnchor, constant: 8),
            results.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 12),
            results.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -12),
            resultsHeight,

            panel.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 12),
            panel.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -12),
            panel.bottomAnchor.constraint(equalTo: safe.bottomAnchor, constant: -8),
            stack.topAnchor.constraint(equalTo: panel.contentView.topAnchor, constant: 14),
            stack.bottomAnchor.constraint(equalTo: panel.contentView.bottomAnchor, constant: -14),
            stack.leadingAnchor.constraint(equalTo: panel.contentView.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: panel.contentView.trailingAnchor, constant: -16),
        ])
        // The bottom panel covers the map's lower part: keep the pin and Apple's legal link clear of it.
        map.layoutMargins = UIEdgeInsets(top: 0, left: 0, bottom: 190, right: 0)

        // Where you are, when openGym may know (the page asked for while-using location first).
        locator.delegate = self
        let status = locator.authorizationStatus
        map.showsUserLocation = status == .authorizedWhenInUse || status == .authorizedAlways

        if let start = options.start {
            place(at: start, look: true)
        } else {
            map.region = MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 20, longitude: 0), span: MKCoordinateSpan(latitudeDelta: 100, longitudeDelta: 100))
        }
        showRadius()
    }

    /// Black or white, whichever reads better on the accent (the page's --on-acc, roughly).
    static func ink(on color: UIColor) -> UIColor {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        color.getRed(&r, green: &g, blue: &b, alpha: &a)
        return (0.299 * r + 0.587 * g + 0.114 * b) > 0.6 ? .black : .white
    }

    // MARK: the pin and its circle

    /// Puts the pin (and the circle) at `c`; `look` also moves the map there.
    private func place(at c: CLLocationCoordinate2D, look: Bool) {
        pin.coordinate = c
        if !placed {
            placed = true
            map.addAnnotation(pin)
            navigationItem.rightBarButtonItem?.isEnabled = true
            hintLabel.isHidden = true
        }
        drawCircle()
        if look {
            map.setRegion(MKCoordinateRegion(center: c, latitudinalMeters: max(radius * 5, 400), longitudinalMeters: max(radius * 5, 400)), animated: true)
        }
    }

    private func drawCircle() {
        if let old = circle { map.removeOverlay(old) }
        guard placed else { return }
        let c = MKCircle(center: pin.coordinate, radius: radius)
        circle = c
        map.addOverlay(c)
    }

    private func showRadius() {
        radiusLabel.text = options.s("radius", "{0} m around the pin").replacingOccurrences(of: "{0}", with: String(Int(radius)))
    }

    /// The street address of where the pin now stands, from Apple (what the list shows).
    private func lookUpAddress() {
        geocoder.cancelGeocode()
        let at = pin.coordinate
        geocoder.reverseGeocodeLocation(CLLocation(latitude: at.latitude, longitude: at.longitude)) { [weak self] marks, _ in
            guard let self = self, let mark = marks?.first,
                  self.pin.coordinate.latitude == at.latitude, self.pin.coordinate.longitude == at.longitude else { return }
            self.address = GymMapPickerController.addressOf(mark)
        }
    }

    /// "Gym St 1, 8000 Zürich": the street and number, then the postcode and town.
    static func addressOf(_ p: CLPlacemark) -> String {
        let street = [p.thoroughfare, p.subThoroughfare].compactMap { $0 }.joined(separator: " ")
        let town = [p.postalCode, p.locality].compactMap { $0 }.joined(separator: " ")
        return [street, town].filter { !$0.isEmpty }.joined(separator: ", ")
    }

    @objc private func mapTapped(_ g: UITapGestureRecognizer) {
        guard g.state == .ended else { return }
        searchBar.resignFirstResponder()
        hideResults()
        place(at: map.convert(g.location(in: map), toCoordinateFrom: map), look: false)
        lookUpAddress()
    }

    @objc private func sliderMoved() {
        // The slider moves in the page's steps (10 m), like the web one.
        let snapped = (Double(slider.value) / options.step).rounded() * options.step
        let r = min(max(snapped, options.minRadius), options.maxRadius)
        guard r != radius else { return }
        radius = r
        showRadius()
        drawCircle()
    }

    // MARK: map delegate

    func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
        guard annotation === pin else { return nil }
        let v = (mapView.dequeueReusableAnnotationView(withIdentifier: "gym") as? MKMarkerAnnotationView)
            ?? MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: "gym")
        v.annotation = annotation
        v.markerTintColor = options.tint
        v.glyphImage = UIImage(systemName: "dumbbell.fill") ?? UIImage(systemName: "mappin")
        v.isDraggable = true
        v.canShowCallout = false
        return v
    }

    func mapView(_ mapView: MKMapView, annotationView view: MKAnnotationView, didChange newState: MKAnnotationView.DragState, fromOldState oldState: MKAnnotationView.DragState) {
        // A marker view runs its own drag states; this only follows where it was let go.
        if newState == .ending || newState == .canceling {
            drawCircle()
            lookUpAddress()
        }
    }

    func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
        guard let c = overlay as? MKCircle else { return MKOverlayRenderer(overlay: overlay) }
        let r = MKCircleRenderer(circle: c)
        r.strokeColor = options.tint
        r.fillColor = options.tint.withAlphaComponent(0.18)
        r.lineWidth = 2.5
        return r
    }

    func mapView(_ mapView: MKMapView, didUpdate userLocation: MKUserLocation) {
        guard let loc = userLocation.location else { return }
        if wantsHere {
            wantsHere = false
            useHere(loc.coordinate)
        } else if !placed && !centredOnUser {
            // A new gym: start where you are, without putting the pin there yet.
            centredOnUser = true
            map.setRegion(MKCoordinateRegion(center: loc.coordinate, latitudinalMeters: 1500, longitudinalMeters: 1500), animated: false)
        }
    }

    // MARK: "I'm here right now"

    @objc private func hereTapped() {
        searchBar.resignFirstResponder()
        hideResults()
        switch locator.authorizationStatus {
        case .notDetermined:
            wantsHere = true
            locator.requestWhenInUseAuthorization()
        case .denied, .restricted:
            hintLabel.text = options.s("noLocation", "Location isn’t allowed for openGym. You can change that in the phone’s settings.")
            hintLabel.isHidden = false
        default:
            if let loc = map.userLocation.location, abs(loc.timestamp.timeIntervalSinceNow) < 60 {
                useHere(loc.coordinate)
            } else {
                wantsHere = true
                map.showsUserLocation = true
                locator.requestLocation()
            }
        }
    }

    private func useHere(_ c: CLLocationCoordinate2D) {
        place(at: c, look: true)
        lookUpAddress()
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let s = manager.authorizationStatus
        guard s == .authorizedWhenInUse || s == .authorizedAlways else { return }
        map.showsUserLocation = true
        if wantsHere { manager.requestLocation() }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard wantsHere, let loc = locations.last else { return }
        wantsHere = false
        useHere(loc.coordinate)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard wantsHere else { return }
        wantsHere = false
        hintLabel.text = options.s("notFound", "Couldn’t find where you are. Try the map instead.")
        hintLabel.isHidden = false
    }

    // MARK: search

    func searchBarSearchButtonClicked(_ bar: UISearchBar) {
        bar.resignFirstResponder()
        let q = (bar.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return }
        // Gyms first (Apple's fitness centre category), then anything else that matches.
        run(q, gymsOnly: true) { [weak self] gyms in
            guard let self = self else { return }
            if gyms.count >= 3 { self.show(gyms); return }
            self.run(q, gymsOnly: false) { rest in
                let more = rest.filter { r in !gyms.contains { GymMapPickerController.same($0, r) } }
                self.show(gyms + more)
            }
        }
    }

    func searchBar(_ bar: UISearchBar, textDidChange text: String) {
        if text.isEmpty { hideResults() }
    }

    private func run(_ q: String, gymsOnly: Bool, _ done: @escaping ([MKMapItem]) -> Void) {
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = q
        request.region = map.region
        if gymsOnly {
            request.resultTypes = .pointOfInterest
            request.pointOfInterestFilter = MKPointOfInterestFilter(including: [.fitnessCenter])
        } else {
            request.resultTypes = [.pointOfInterest, .address]
        }
        search?.cancel()
        let s = MKLocalSearch(request: request)
        search = s
        s.start { response, _ in
            DispatchQueue.main.async { done(response?.mapItems ?? []) }
        }
    }

    private static func same(_ a: MKMapItem, _ b: MKMapItem) -> Bool {
        let x = a.placemark.coordinate, y = b.placemark.coordinate
        return abs(x.latitude - y.latitude) < 1e-5 && abs(x.longitude - y.longitude) < 1e-5
    }

    private func show(_ found: [MKMapItem]) {
        items = Array(found.prefix(12))
        searched = true
        results.reloadData()
        results.isHidden = false
        resultsHeight.constant = min(CGFloat(max(items.count, 1)) * 60, 300)
        view.layoutIfNeeded()
    }

    private func hideResults() {
        items = []
        searched = false
        results.isHidden = true
        resultsHeight.constant = 0
    }

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        searched && items.isEmpty ? 1 : items.count
    }

    func tableView(_ tableView: UITableView, heightForRowAt indexPath: IndexPath) -> CGFloat { 60 }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "place") ?? UITableViewCell(style: .subtitle, reuseIdentifier: "place")
        guard !items.isEmpty else {
            cell.textLabel?.text = options.s("none", "Nothing found. Try a street and a town.")
            cell.textLabel?.textColor = .secondaryLabel
            cell.detailTextLabel?.text = nil
            cell.imageView?.image = nil
            cell.selectionStyle = .none
            return cell
        }
        let item = items[indexPath.row]
        let gym = item.pointOfInterestCategory == .fitnessCenter
        cell.textLabel?.text = item.name
        cell.textLabel?.textColor = .label
        cell.detailTextLabel?.text = GymMapPickerController.addressOf(item.placemark)
        cell.detailTextLabel?.textColor = .secondaryLabel
        cell.imageView?.image = UIImage(systemName: gym ? "dumbbell.fill" : "mappin.circle.fill") ?? UIImage(systemName: "mappin.circle.fill")
        cell.imageView?.tintColor = gym ? options.tint : .secondaryLabel
        cell.selectionStyle = .default
        return cell
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard indexPath.row < items.count else { return }
        let item = items[indexPath.row]
        // The place's name names the gym too, unless it already has one.
        if name.trimmingCharacters(in: .whitespaces).isEmpty { name = item.name ?? "" }
        address = GymMapPickerController.addressOf(item.placemark)
        searchBar.text = item.name
        hideResults()
        place(at: item.placemark.coordinate, look: true)
    }

    // MARK: done

    @objc private func cancelTapped() { close(nil) }

    @objc private func doneTapped() {
        guard placed else { return }
        close([
            "name": name, "address": address,
            "lat": pin.coordinate.latitude, "lng": pin.coordinate.longitude, "radius": radius,
        ])
    }

    /// Answers the page once, then goes away.
    private func close(_ result: [String: Any]?) {
        search?.cancel()
        geocoder.cancelGeocode()
        let done = finish
        finish = nil
        dismiss(animated: true) { done?(result) }
    }
}
