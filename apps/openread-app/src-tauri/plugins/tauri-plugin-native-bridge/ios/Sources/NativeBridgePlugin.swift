import AVFoundation
import AuthenticationServices
import CoreText
import MediaPlayer
import ObjectiveC
import StoreKit
import SwiftRs
import Tauri
import UIKit
import WebKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier!, category: "NativeBridge")

func getLocalizedDisplayName(familyName: String) -> String? {
  let fontDescriptor = CTFontDescriptorCreateWithAttributes(
    [
      kCTFontFamilyNameAttribute: familyName
    ] as CFDictionary)

  let font = CTFontCreateWithFontDescriptor(fontDescriptor, 0.0, nil)

  var actualLanguage: Unmanaged<CFString>?
  if let localizedName = CTFontCopyLocalizedName(font, kCTFontFamilyNameKey, &actualLanguage) {
    return localizedName as String
  }
  return nil
}

class SafariAuthRequestArgs: Decodable {
  let authUrl: String
}

class UseBackgroundAudioRequestArgs: Decodable {
  let enabled: Bool
}

class SetSystemUIVisibilityRequestArgs: Decodable {
  let visible: Bool
  let darkMode: Bool
}

class InterceptKeysRequestArgs: Decodable {
  let backKey: Bool?
  let volumeKeys: Bool?
}

class LockScreenOrientationRequestArgs: Decodable {
  let orientation: String?
}

class SetScreenBrightnessRequestArgs: Decodable {
  let brightness: Float?
}

class CopyUriToPathRequestArgs: Decodable {
  let uri: String?
  let dst: String?
}

struct InitializeRequest: Decodable {
  let publicKey: String?
}

struct FetchProductsRequest: Decodable {
  let productIds: [String]
}

struct PurchaseProductRequest: Decodable {
  let productId: String
}

struct ProductData: Codable {
  let id: String
  let title: String
  let description: String
  let price: String
  let priceCurrencyCode: String?
  let priceAmountMicros: Int64
  let productType: String
}

struct PurchaseData: Codable {
  let productId: String
  let transactionId: String
  let originalTransactionId: String
  let purchaseDate: String
  let purchaseState: String
  let platform: String
}

class VolumeKeyHandler: NSObject {
  private var audioSession: AVAudioSession?
  private var originalVolume: Float = 0.0
  private var referenceVolume: Float = 0.5
  private var previousVolume: Float = 0.5
  private var volumeView: MPVolumeView?
  private(set) var isIntercepting = false
  private var webView: WKWebView?
  private var volumeSlider: UISlider?

  func startInterception(webView: WKWebView) {
    if isIntercepting {
      stopInterception()
    }

    logger.log("Starting volume key interception")
    self.webView = webView
    isIntercepting = true

    audioSession = AVAudioSession.sharedInstance()
    do {
      try audioSession?.setCategory(.playback, mode: .default, options: [.mixWithOthers])
      try audioSession?.setActive(true)
    } catch {
      logger.error("Failed to activate audio session: \(error)")
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
      guard let self = self else { return }
      self.originalVolume = self.audioSession?.outputVolume ?? 0.1
      if self.originalVolume > 0.9 {
        self.referenceVolume = 0.9
      } else if self.originalVolume < 0.1 {
        self.referenceVolume = 0.1
      } else {
        self.referenceVolume = self.originalVolume
      }
      logger.log("Reference volume set to \(self.referenceVolume)")
      self.previousVolume = self.referenceVolume
      self.setSessionVolume(self.referenceVolume)
      self.setupHiddenVolumeView()
      self.audioSession?.addObserver(
        self, forKeyPath: "outputVolume", options: [.new], context: nil)
    }

    audioSession?.addObserver(self, forKeyPath: "outputVolume", options: [.new], context: nil)
  }

  func stopInterception() {
    if !isIntercepting {
      return
    }

    logger.log("Stopping volume key interception")
    isIntercepting = false
    audioSession?.removeObserver(self, forKeyPath: "outputVolume")
    DispatchQueue.main.async { [weak self] in
      self?.setSessionVolume(self?.originalVolume ?? 0.1)
      self?.volumeView?.removeFromSuperview()
      self?.volumeView = nil
      self?.volumeSlider = nil
    }
  }

  private func setSessionVolume(_ volume: Float) {
    DispatchQueue.main.async { [weak self] in
      self?.volumeSlider?.value = volume
    }
  }

  private func setupHiddenVolumeView() {
    assert(Thread.isMainThread, "setupHiddenVolumeView must be called on main thread")
    let frame = CGRect(x: -1000, y: -1000, width: 1, height: 1)
    volumeView = MPVolumeView(frame: frame)
    volumeSlider = volumeView?.subviews.first(where: { $0 is UISlider }) as? UISlider
    if let window = UIApplication.shared.windows.first {
      window.addSubview(volumeView!)
    }
  }

  override func observeValue(
    forKeyPath keyPath: String?, of object: Any?, change: [NSKeyValueChangeKey: Any]?,
    context: UnsafeMutableRawPointer?
  ) {
    if keyPath == "outputVolume", let audioSession = self.audioSession, isIntercepting {
      let currentVolume = audioSession.outputVolume
      if currentVolume > self.previousVolume {
        DispatchQueue.main.async { [weak self] in
          self?.webView?.evaluateJavaScript(
            "window.onNativeKeyDown('VolumeUp');", completionHandler: nil)
        }
      } else if currentVolume < self.previousVolume {
        DispatchQueue.main.async { [weak self] in
          self?.webView?.evaluateJavaScript(
            "window.onNativeKeyDown('VolumeDown');", completionHandler: nil)
        }
      }
      self.previousVolume = currentVolume
      self.setSessionVolume(self.referenceVolume)
    }
  }
}

class WebViewLifecycleManager: NSObject {
  private weak var webView: WKWebView?
  private var originalNavigationDelegate: WKNavigationDelegate?
  private var isMonitoring = false
  private var lastBackgroundTime: Date?
  private var backgroundTimeThreshold: TimeInterval = 180.0

  func startMonitoring(webView: WKWebView) {
    self.webView = webView
    originalNavigationDelegate = webView.navigationDelegate
    webView.navigationDelegate = self
    isMonitoring = true
    logger.log("WebViewLifecycleManager: Started monitoring WebView")
  }

  func stopMonitoring() {
    isMonitoring = false
    if let original = originalNavigationDelegate {
      webView?.navigationDelegate = original
    }

    logger.log("WebViewLifecycleManager: Stopped monitoring WebView")
  }

  func handleAppWillEnterForeground() {
    guard isMonitoring, let webView = webView else {
      logger.warning(
        "WebViewLifecycleManager: Cannot handle foreground - not monitoring or webView is nil")
      return
    }

    logger.log("WebViewLifecycleManager: App entering foreground")

    // If lastBackgroundTime is nil, the app never actually went to background —
    // it only lost focus briefly (e.g. system text selection menu, share sheet).
    // Skip the health check to avoid racing with evaluateJavaScript calls
    // from the highlight flow, which can cascade to webView.reload().
    guard let backgroundTime = lastBackgroundTime else {
      logger.log("WebViewLifecycleManager: No background time recorded, skipping health check")
      return
    }

    let timeInBackground = Date().timeIntervalSince(backgroundTime)
    logger.log("WebViewLifecycleManager: Time in background: \(timeInBackground)s")
    lastBackgroundTime = nil

    // Only check WebView health after extended background (>= threshold).
    // Short backgrounds (< threshold) don't need recovery — the web content
    // process stays alive and healthy. The previous quickHealthCheck approach
    // caused false-positive reloads by racing with evaluateJavaScript calls.
    if timeInBackground > backgroundTimeThreshold {
      logger.log(
        "WebViewLifecycleManager: App was backgrounded for \(timeInBackground)s, checking WebView health..."
      )
      checkAndRecoverWebView(webView, reason: "long_background")
    } else {
      logger.log("WebViewLifecycleManager: Short background (\(timeInBackground)s < \(self.backgroundTimeThreshold)s), skipping health check")
    }
  }

  func handleAppWillResignActive() {
    // No-op. Previously called evaluateJavaScript to save the URL here,
    // but willResignActive fires for system menus (text selection, share sheet)
    // and the JS evaluation during text selection disrupts WKWebView state.
    logger.log("WebViewLifecycleManager: App will resign active (no action)")
  }

  func handleAppDidEnterBackground() {
    lastBackgroundTime = Date()
    // Save URL when actually backgrounding (not on resign-active, which fires for system menus)
    guard let webView = webView else { return }
    webView.evaluateJavaScript("window.location.href") { result, error in
      if let error = error {
        logger.error("WebViewLifecycleManager: Failed to capture URL on background: \(error)")
        return
      }
      if let urlString = result as? String {
        if urlString.hasPrefix("http") || urlString.hasPrefix("tauri") {
          UserDefaults.standard.set(urlString, forKey: "tauri_last_valid_url")
          logger.log("WebViewLifecycleManager: Saved valid URL on background")
        }
      }
    }
  }

  private func quickHealthCheck(_ webView: WKWebView) {
    logger.log("WebViewLifecycleManager: Performing quick health check")

    webView.evaluateJavaScript("window.location.href") { [weak self] result, error in
      if let error = error {
        logger.error("WebViewLifecycleManager: Quick health check failed: \(error)")
        self?.checkAndRecoverWebView(webView, reason: "health_check_failed")
      } else if let urlString = result as? String {
        if urlString.contains("about:blank") || urlString.isEmpty {
          logger.warning("WebViewLifecycleManager: WebView showing about:blank!")
          self?.recoverWebView(webView, reason: "about_blank")
        }
      }
    }
  }

  private func checkAndRecoverWebView(_ webView: WKWebView, reason: String) {
    logger.log("WebViewLifecycleManager: Checking WebView health (reason: \(reason))")

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
      webView.evaluateJavaScript("window.location.href") { result, error in
        if let error = error {
          logger.error("WebViewLifecycleManager: Error checking WebView URL: \(error)")
          self?.recoverWebView(webView, reason: "js_error_\(reason)")
        } else if let urlString = result as? String {
          logger.log("WebViewLifecycleManager: Current URL after \(reason): \(urlString)")
          if urlString.contains("about:blank") || urlString.isEmpty {
            logger.warning("WebViewLifecycleManager: Detected blank WebView after \(reason)")
            self?.recoverWebView(webView, reason: reason)
          } else {
            logger.log("WebViewLifecycleManager: WebView appears healthy")
          }
        }
      }
    }
  }

  private func recoverWebView(_ webView: WKWebView, reason: String) {
    logger.log("WebViewLifecycleManager: Recovering WebView (reason: \(reason))")

    if let lastURL = UserDefaults.standard.string(forKey: "tauri_last_valid_url"),
      let url = URL(string: lastURL)
    {
      logger.log("WebViewLifecycleManager: Reloading from saved URL: \(lastURL)")
      webView.load(URLRequest(url: url))
    } else {
      logger.log("WebViewLifecycleManager: No saved URL, performing standard reload")
      webView.reload()
    }
  }
}

extension WebViewLifecycleManager: WKNavigationDelegate {

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    logger.error("WebViewLifecycleManager: WebContent process TERMINATED!️")
    recoverWebView(webView, reason: "process_terminated")

    if let original = originalNavigationDelegate,
      original.responds(to: #selector(webViewWebContentProcessDidTerminate(_:)))
    {
      original.webViewWebContentProcessDidTerminate?(webView)
    }
  }

  // Save successful navigation URLs
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if let url = webView.url {
      let urlString = url.absoluteString

      if urlString.hasPrefix("http") || urlString.hasPrefix("tauri") {
        UserDefaults.standard.set(urlString, forKey: "tauri_last_valid_url")
        logger.log("WebViewLifecycleManager: Saved valid URL")
      }
    }

    if let original = originalNavigationDelegate,
      original.responds(to: #selector(webView(_:didFinish:)))
    {
      original.webView?(webView, didFinish: navigation)
    }
  }

  // Proxy other important navigation delegate methods
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    logger.error("WebViewLifecycleManager: Navigation failed: \(error)")

    if let original = originalNavigationDelegate,
      original.responds(to: #selector(webView(_:didFail:withError:)))
    {
      original.webView?(webView, didFail: navigation, withError: error)
    }
  }

  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    logger.error("WebViewLifecycleManager: Provisional navigation failed: \(error)")

    if let original = originalNavigationDelegate,
      original.responds(to: #selector(webView(_:didFailProvisionalNavigation:withError:)))
    {
      original.webView?(webView, didFailProvisionalNavigation: navigation, withError: error)
    }
  }

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    if let original = originalNavigationDelegate,
      original.responds(to: #selector(webView(_:didStartProvisionalNavigation:)))
    {
      original.webView?(webView, didStartProvisionalNavigation: navigation)
    }
  }

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    if let original = originalNavigationDelegate,
      original.responds(to: #selector(webView(_:didCommit:)))
    {
      original.webView?(webView, didCommit: navigation)
    }
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    if let original = originalNavigationDelegate {
      original.webView?(
        webView, decidePolicyFor: navigationAction, decisionHandler: decisionHandler)
    } else {
      decisionHandler(.allow)
    }
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
    decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
  ) {
    if let original = originalNavigationDelegate {
      original.webView?(
        webView, decidePolicyFor: navigationResponse, decisionHandler: decisionHandler)
    } else {
      decisionHandler(.allow)
    }
  }
}


// MARK: - Native Color Picker
// Matches the iOS native edit menu (Copy/Translate/Share) visual style:
// same corner radius, blur material, shadow, padding, and bar height.
class NativeColorPicker: UIView {
  private let colors: [(id: String, color: UIColor)] = [
    ("yellow", UIColor(red: 240/255, green: 196/255, blue: 58/255, alpha: 1)),
    ("red", UIColor(red: 239/255, green: 107/255, blue: 107/255, alpha: 1)),
    ("blue", UIColor(red: 91/255, green: 168/255, blue: 245/255, alpha: 1)),
    ("green", UIColor(red: 92/255, green: 201/255, blue: 138/255, alpha: 1)),
    ("violet", UIColor(red: 176/255, green: 140/255, blue: 220/255, alpha: 1)),
  ]

  // Matched to iOS native edit menu dimensions
  private let circleSize: CGFloat = 30
  private let padding: CGFloat = 7
  private let gap: CGFloat = 8
  private let cornerRadius: CGFloat = 13
  private let checkmarkTag = 999
  private var selectedColor: String = "yellow"
  private var colorButtons: [UIButton] = []
  private var deleteButton: UIButton?
  private var divider: UIView?
  private weak var webView: WKWebView?
  private var effectView: UIVisualEffectView!
  private var scrollObservation: NSKeyValueObservation?
  private var showContentOffset: CGPoint = .zero
  private let scrollDismissThreshold: CGFloat = 1
  private var autoDismissTimer: Timer?
  private var dismissTapGesture: UITapGestureRecognizer?
  private var dismissPanGesture: UIPanGestureRecognizer?

  init(webView: WKWebView) {
    self.webView = webView
    super.init(frame: .zero)
    setupView()
  }

  required init?(coder: NSCoder) { fatalError() }

  deinit {
    scrollObservation?.invalidate()
    autoDismissTimer?.invalidate()
    removeDismissGestures()
  }

  private func setupView() {
    isHidden = true

    // Glass (iOS 26+) or chrome blur (iOS 18) for the floating pill
    let ev = UIVisualEffectView()
    if #available(iOS 26.0, *) {
      let glass = UIGlassEffect(style: .regular)
      glass.isInteractive = true
      ev.effect = glass
    } else {
      ev.effect = UIBlurEffect(style: .systemChromeMaterial)
    }
    ev.layer.cornerRadius = cornerRadius
    ev.clipsToBounds = true
    ev.translatesAutoresizingMaskIntoConstraints = false
    addSubview(ev)
    NSLayoutConstraint.activate([
      ev.topAnchor.constraint(equalTo: topAnchor),
      ev.bottomAnchor.constraint(equalTo: bottomAnchor),
      ev.leadingAnchor.constraint(equalTo: leadingAnchor),
      ev.trailingAnchor.constraint(equalTo: trailingAnchor),
    ])
    effectView = ev

    layer.cornerRadius = cornerRadius
    // Border + shadow only on pre-iOS 26 — glass provides its own chrome
    if #unavailable(iOS 26) {
      layer.borderWidth = 1.0 / UIScreen.main.scale
      layer.borderColor = UIColor.separator.withAlphaComponent(0.3).cgColor
      layer.shadowColor = UIColor.black.cgColor
      layer.shadowOpacity = 0.08
      layer.shadowRadius = 8
      layer.shadowOffset = CGSize(width: 0, height: 4)
    }

    let stack = UIStackView()
    stack.axis = .horizontal
    stack.spacing = gap
    stack.alignment = .center
    stack.translatesAutoresizingMaskIntoConstraints = false
    effectView.contentView.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.topAnchor.constraint(equalTo: effectView.contentView.topAnchor, constant: padding),
      stack.bottomAnchor.constraint(equalTo: effectView.contentView.bottomAnchor, constant: -padding),
      stack.leadingAnchor.constraint(equalTo: effectView.contentView.leadingAnchor, constant: padding + 3),
      stack.trailingAnchor.constraint(equalTo: effectView.contentView.trailingAnchor, constant: -(padding + 3)),
    ])

    for (i, colorInfo) in colors.enumerated() {
      let btn = UIButton(type: .custom)
      btn.tag = i
      btn.backgroundColor = colorInfo.color
      btn.layer.cornerRadius = circleSize / 2
      btn.layer.shadowColor = UIColor.black.cgColor
      btn.layer.shadowOpacity = 0.1
      btn.layer.shadowRadius = 1
      btn.layer.shadowOffset = CGSize(width: 0, height: 0.5)
      btn.translatesAutoresizingMaskIntoConstraints = false
      NSLayoutConstraint.activate([
        btn.widthAnchor.constraint(equalToConstant: circleSize),
        btn.heightAnchor.constraint(equalToConstant: circleSize),
      ])
      btn.addTarget(self, action: #selector(colorTapped(_:)), for: .touchUpInside)
      stack.addArrangedSubview(btn)
      colorButtons.append(btn)
    }

    let div = UIView()
    div.backgroundColor = UIColor.separator
    div.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      div.widthAnchor.constraint(equalToConstant: 1.0 / UIScreen.main.scale),
      div.heightAnchor.constraint(equalToConstant: circleSize - 6),
    ])
    stack.addArrangedSubview(div)
    stack.setCustomSpacing(gap, after: colorButtons.last!)
    stack.setCustomSpacing(gap, after: div)
    self.divider = div
    div.isHidden = true

    // Delete button
    let del = UIButton(type: .custom)
    del.backgroundColor = UIColor.systemRed.withAlphaComponent(0.1)
    del.layer.cornerRadius = circleSize / 2
    del.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      del.widthAnchor.constraint(equalToConstant: circleSize),
      del.heightAnchor.constraint(equalToConstant: circleSize),
    ])
    let trashImage = UIImage(systemName: "trash")?.withConfiguration(
      UIImage.SymbolConfiguration(pointSize: 14, weight: .medium)
    )
    del.setImage(trashImage, for: .normal)
    del.tintColor = .systemRed
    del.addTarget(self, action: #selector(deleteTapped), for: .touchUpInside)
    stack.addArrangedSubview(del)
    self.deleteButton = del
    del.isHidden = true

  }

  func show(at point: CGPoint, selected: String, withDelete: Bool) {
    selectedColor = selected
    divider?.isHidden = !withDelete
    deleteButton?.isHidden = !withDelete
    updateSelection()

    // Calculate size — extra horizontal padding (padding + 3 each side)
    let hPadding = (padding + 3) * 2
    let colorsWidth = CGFloat(colors.count) * circleSize + CGFloat(colors.count - 1) * gap
    let dividerWidth = withDelete ? (gap + 1.0 / UIScreen.main.scale + gap + circleSize) : 0
    let totalWidth = hPadding + colorsWidth + dividerWidth
    let totalHeight = padding * 2 + circleSize

    // Convert JS viewport coords to screen coords via WKWebView
    // JS getBoundingClientRect() returns coords relative to the visible viewport.
    // WKWebView.convert() translates to the picker's superview (key window).
    let webViewPoint = CGPoint(x: point.x, y: point.y)
    let screenPoint: CGPoint
    if let wv = webView, let window = self.superview {
      screenPoint = wv.convert(webViewPoint, to: window)
    } else {
      screenPoint = webViewPoint
    }

    let screenWidth = UIScreen.main.bounds.width
    let safeTop = webView?.safeAreaInsets.top ?? 0

    // Center horizontally on x, position above the selection point
    let x = max(10, min(screenPoint.x - totalWidth / 2, screenWidth - totalWidth - 10))
    // Place above the tap point
    let y = max(safeTop + 10, screenPoint.y - totalHeight - 12)

    frame = CGRect(x: x, y: y, width: totalWidth, height: totalHeight)
    isHidden = false
    transform = CGAffineTransform(scaleX: 0.85, y: 0.85)
    if #available(iOS 26.0, *) {
      // Glass materialize animation
      effectView.effect = nil
      alpha = 1
      UIView.animate(withDuration: 0.25, delay: 0, usingSpringWithDamping: 0.75, initialSpringVelocity: 0.5) {
        let glass = UIGlassEffect(style: .regular)
        glass.isInteractive = true
        self.effectView.effect = glass
        self.transform = .identity
      }
    } else {
      alpha = 0
      UIView.animate(withDuration: 0.25, delay: 0, usingSpringWithDamping: 0.75, initialSpringVelocity: 0.5) {
        self.alpha = 1
        self.transform = .identity
      }
    }

    // Observe scroll to auto-dismiss after threshold
    startScrollObservation()

    // Transparent overlay catches any tap outside the picker
    installDismissGestures()

    // Auto-dismiss after 3.5 seconds as safety net
    autoDismissTimer?.invalidate()
    autoDismissTimer = Timer.scheduledTimer(withTimeInterval: 3.5, repeats: false) { [weak self] _ in
      self?.hide()
    }
  }

  func hide() {
    guard !isHidden else { return }
    autoDismissTimer?.invalidate()
    autoDismissTimer = nil
    scrollObservation?.invalidate()
    scrollObservation = nil
    removeDismissGestures()
    cleanupJSScrollListeners()
    if #available(iOS 26.0, *) {
      // Glass dematerialize
      UIView.animate(withDuration: 0.15, animations: {
        self.effectView.effect = nil
      }) { _ in
        self.isHidden = true
      }
    } else {
      alpha = 0
      isHidden = true
    }
    transform = .identity
  }

  private func installDismissGestures() {
    removeDismissGestures()
    guard let wv = webView else { return }
    // Tap on book content → dismiss. cancelsTouchesInView=false so normal taps still work
    let tap = UITapGestureRecognizer(target: self, action: #selector(backgroundTapped))
    tap.cancelsTouchesInView = false
    tap.delegate = self
    wv.addGestureRecognizer(tap)
    dismissTapGesture = tap
    // Pan on book content → dismiss on first movement, don't block scrolling
    let pan = UIPanGestureRecognizer(target: self, action: #selector(dismissPanned(_:)))
    pan.cancelsTouchesInView = false
    pan.delegate = self
    wv.addGestureRecognizer(pan)
    dismissPanGesture = pan
  }

  @objc private func dismissPanned(_ gesture: UIPanGestureRecognizer) {
    if gesture.state == .began {
      hide()
    }
  }

  private func removeDismissGestures() {
    if let g = dismissTapGesture { g.view?.removeGestureRecognizer(g); dismissTapGesture = nil }
    if let g = dismissPanGesture { g.view?.removeGestureRecognizer(g); dismissPanGesture = nil }
  }

  private func startScrollObservation() {
    // WKWebView scrollView observation (for top-level scrolls)
    scrollObservation?.invalidate()
    if let scrollView = webView?.scrollView {
      showContentOffset = scrollView.contentOffset
      scrollObservation = scrollView.observe(\.contentOffset, options: [.new]) { [weak self] _, change in
        guard let self = self, !self.isHidden, let newOffset = change.newValue else { return }
        let dx = abs(newOffset.x - self.showContentOffset.x)
        let dy = abs(newOffset.y - self.showContentOffset.y)
        if dx > self.scrollDismissThreshold || dy > self.scrollDismissThreshold {
          self.hide()
        }
      }
    }

    // Inject JS touchmove listener into iframes — fires instantly on finger drag
    // touchmove fires on the first pixel of movement, unlike scroll which waits
    let js = """
    (function() {
      if (window.__openreadPickerScrollCleanup) window.__openreadPickerScrollCleanup();
      var cleanups = [];
      var fired = false;
      function onTouch() {
        if (fired) return;
        fired = true;
        window.webkit.messageHandlers.openreadColorPickerHide.postMessage({});
      }
      document.querySelectorAll('iframe').forEach(function(f) {
        try {
          var doc = f.contentDocument || f.contentWindow.document;
          doc.addEventListener('touchmove', onTouch, {once: true, passive: true});
          doc.addEventListener('scroll', onTouch, {once: true, passive: true});
          cleanups.push(function() {
            doc.removeEventListener('touchmove', onTouch);
            doc.removeEventListener('scroll', onTouch);
          });
        } catch(e) {}
      });
      document.addEventListener('touchmove', onTouch, {once: true, passive: true});
      document.addEventListener('scroll', onTouch, {once: true, passive: true});
      cleanups.push(function() {
        document.removeEventListener('touchmove', onTouch);
        document.removeEventListener('scroll', onTouch);
      });
      window.__openreadPickerScrollCleanup = function() {
        cleanups.forEach(function(c) { c(); });
        cleanups = [];
        window.__openreadPickerScrollCleanup = null;
      };
    })();
    """
    webView?.evaluateJavaScript(js) { _, _ in }
  }

  private func cleanupJSScrollListeners() {
    webView?.evaluateJavaScript("if(window.__openreadPickerScrollCleanup) window.__openreadPickerScrollCleanup();") { _, _ in }
  }

  private func updateSelection() {
    for (i, btn) in colorButtons.enumerated() {
      btn.subviews.filter { $0.tag == checkmarkTag }.forEach { $0.removeFromSuperview() }
      if colors[i].id == selectedColor {
        // Add ring
        btn.layer.borderWidth = 2
        btn.layer.borderColor = UIColor.white.cgColor
        // Add checkmark — scaled for 30pt circle
        let check = UIImageView(image: UIImage(systemName: "checkmark")?.withConfiguration(
          UIImage.SymbolConfiguration(pointSize: 12, weight: .bold)
        ))
        check.tintColor = .white
        check.tag = checkmarkTag
        check.translatesAutoresizingMaskIntoConstraints = false
        btn.addSubview(check)
        NSLayoutConstraint.activate([
          check.centerXAnchor.constraint(equalTo: btn.centerXAnchor),
          check.centerYAnchor.constraint(equalTo: btn.centerYAnchor),
        ])
        check.layer.shadowColor = UIColor.black.cgColor
        check.layer.shadowOpacity = 0.3
        check.layer.shadowRadius = 1
        check.layer.shadowOffset = CGSize(width: 0, height: 1)
      } else {
        btn.layer.borderWidth = 0
      }
    }
  }

  @objc private func colorTapped(_ sender: UIButton) {
    let colorId = colors[sender.tag].id
    selectedColor = colorId
    updateSelection()
    webView?.evaluateJavaScript(
      "window.__nativeTextSelectionAction('highlight', '\(colorId)', 'highlight')"
    ) { _, _ in }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { self.hide() }
  }

  @objc private func deleteTapped() {
    webView?.evaluateJavaScript(
      "window.__nativeTextSelectionAction('remove-highlight')"
    ) { _, _ in }
    hide()
  }

  @objc private func backgroundTapped() {
    hide()
  }
}

extension NativeColorPicker: UIGestureRecognizerDelegate {
  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
    // Only fire for touches outside the picker (don't eat color button taps)
    let location = touch.location(in: self)
    return !bounds.contains(location)
  }

  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
    // Allow our gestures to work alongside WKWebView's own scroll/pan gestures
    return true
  }
}

// MARK: - Native Collection Picker (UIViewController with table view)

class NativeCollectionPicker: UIViewController, UITableViewDataSource, UITableViewDelegate {
  struct CollectionItem {
    let id: String
    let name: String
    var selected: Bool
  }

  private weak var webView: WKWebView?
  private var collections: [CollectionItem] = []
  private var bookHashes: [String] = []
  private let tableView = UITableView(frame: .zero, style: .insetGrouped)
  private var newCollectionName: String?

  init(webView: WKWebView, collections: [[String: Any]], bookHashes: [String]) {
    self.webView = webView
    self.bookHashes = bookHashes
    super.init(nibName: nil, bundle: nil)

    self.collections = collections.map { dict in
      CollectionItem(
        id: dict["id"] as? String ?? "",
        name: dict["name"] as? String ?? "",
        selected: dict["hasBook"] as? Bool ?? false
      )
    }
  }

  required init?(coder: NSCoder) { fatalError() }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = "Add to Collection"
    view.backgroundColor = .systemGroupedBackground

    navigationItem.leftBarButtonItem = UIBarButtonItem(
      barButtonSystemItem: .cancel, target: self, action: #selector(cancelTapped)
    )
    navigationItem.rightBarButtonItem = UIBarButtonItem(
      barButtonSystemItem: .done, target: self, action: #selector(doneTapped)
    )

    tableView.dataSource = self
    tableView.delegate = self
    tableView.translatesAutoresizingMaskIntoConstraints = false
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "cell")
    view.addSubview(tableView)
    NSLayoutConstraint.activate([
      tableView.topAnchor.constraint(equalTo: view.topAnchor),
      tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])
  }

  // MARK: - UITableViewDataSource

  func numberOfSections(in tableView: UITableView) -> Int { 2 }

  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
    section == 0 ? collections.count : 1
  }

  func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
    section == 0 ? (collections.isEmpty ? nil : "Collections") : nil
  }

  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
    cell.selectionStyle = .none

    if indexPath.section == 0 {
      let item = collections[indexPath.row]
      var content = cell.defaultContentConfiguration()
      content.text = item.name
      content.textProperties.font = .systemFont(ofSize: 16)
      cell.contentConfiguration = content
      cell.accessoryType = item.selected ? .checkmark : .none
      cell.tintColor = .systemBlue
    } else {
      var content = cell.defaultContentConfiguration()
      content.text = "New Collection..."
      content.textProperties.color = .systemBlue
      content.image = UIImage(systemName: "plus.circle.fill")
      content.imageProperties.tintColor = .systemBlue
      cell.contentConfiguration = content
      cell.accessoryType = .none
    }
    return cell
  }

  // MARK: - UITableViewDelegate

  func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    UIImpactFeedbackGenerator(style: .light).impactOccurred()

    if indexPath.section == 0 {
      collections[indexPath.row].selected.toggle()
      tableView.reloadRows(at: [indexPath], with: .automatic)
    } else {
      showNewCollectionAlert()
    }
  }

  // MARK: - Actions

  private func showNewCollectionAlert() {
    let alert = UIAlertController(title: "New Collection", message: nil, preferredStyle: .alert)
    alert.addTextField { tf in
      tf.placeholder = "Collection name"
      tf.autocapitalizationType = .words
    }
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.addAction(UIAlertAction(title: "Create", style: .default) { [weak self] _ in
      guard let name = alert.textFields?.first?.text?.trimmingCharacters(in: .whitespacesAndNewlines),
            !name.isEmpty else { return }
      // Add to local list as selected
      self?.collections.append(CollectionItem(id: "__new__\(name)", name: name, selected: true))
      self?.tableView.reloadData()
    })
    present(alert, animated: true)
  }

  @objc private func cancelTapped() {
    dismiss(animated: true)
  }

  @objc private func doneTapped() {
    UIImpactFeedbackGenerator(style: .medium).impactOccurred()

    // Build result: added collections, removed collections, new collections
    var added: [String] = []
    var removed: [String] = []
    var created: [String] = []

    for item in collections {
      if item.id.hasPrefix("__new__") {
        if item.selected {
          created.append(item.name)
        }
      } else {
        // Compare with original state
        let wasSelected = !(item.selected) // toggled means changed
        // Actually we need to track original state. Let me simplify:
        // Just send current state — web side will diff
        if item.selected {
          added.append(item.id)
        }
      }
    }

    // Send all selected IDs + new names to JS
    let addedJSON = added.map { "\"\($0)\"" }.joined(separator: ",")
    let createdJSON = created.map { "\($0.replacingOccurrences(of: "'", with: "\\'"))" }.joined(separator: "','")
    let hashesJSON = bookHashes.map { "\"\($0)\"" }.joined(separator: ",")

    let js = """
    window.__nativeCollectionResult?.({
      selectedIds: [\(addedJSON)],
      newNames: ['\(createdJSON)'],
      bookHashes: [\(hashesJSON)]
    })
    """
    webView?.evaluateJavaScript(js) { _, _ in }
    dismiss(animated: true)
  }
}

// MARK: - Native Selection Toolbar (Glass action bar for multi-select)

// MARK: - Native Selection Bar (System UIToolbar + count pill)
// Uses system UIToolbar for automatic Liquid Glass and 44pt touch targets.
// Count pill sits above the toolbar (no system equivalent, kept custom).
class NativeSelectionBar: UIView {
  private weak var webView: WKWebView?
  private let feedbackGenerator = UIImpactFeedbackGenerator(style: .light)
  private var countLabel: UILabel!
  private var toolbar: UIToolbar!

  private let actionNames = ["selectAll", "addToCollection", "wantToRead", "markFinished", "remove", "cancel"]

  init(webView: WKWebView) {
    self.webView = webView
    super.init(frame: .zero)
    feedbackGenerator.prepare()
    setupView()
  }

  required init?(coder: NSCoder) { fatalError() }

  func updateCount(_ selected: Int, _ total: Int) {
    countLabel.text = "\(selected) of \(total)"
  }

  private func setupView() {
    // Count pill (custom — no system equivalent)
    let countPill = UIVisualEffectView()
    if #available(iOS 26.0, *) {
      countPill.effect = UIGlassEffect(style: .regular)
    } else {
      countPill.effect = UIBlurEffect(style: .systemChromeMaterial)
    }
    countPill.layer.cornerRadius = 14
    countPill.clipsToBounds = true
    countPill.translatesAutoresizingMaskIntoConstraints = false

    let label = UILabel()
    label.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
    label.textColor = .secondaryLabel
    label.text = "0 of 0"
    label.textAlignment = .center
    countLabel = label
    label.translatesAutoresizingMaskIntoConstraints = false
    countPill.contentView.addSubview(label)
    NSLayoutConstraint.activate([
      label.leadingAnchor.constraint(equalTo: countPill.contentView.leadingAnchor, constant: 12),
      label.trailingAnchor.constraint(equalTo: countPill.contentView.trailingAnchor, constant: -12),
      label.centerYAnchor.constraint(equalTo: countPill.contentView.centerYAnchor),
    ])

    // System UIToolbar — automatic Liquid Glass + 44pt touch targets
    toolbar = UIToolbar()
    toolbar.translatesAutoresizingMaskIntoConstraints = false

    let actions: [(icon: String, title: String, destructive: Bool)] = [
      ("checkmark.square", "Select All", false),
      ("folder.badge.plus", "Collection", false),
      ("bookmark", "Want to Read", false),
      ("checkmark.circle", "Finished", false),
      ("trash", "Remove", true),
      ("xmark", "Cancel", false),
    ]

    var barItems: [UIBarButtonItem] = []
    for (index, item) in actions.enumerated() {
      if index > 0 {
        barItems.append(UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil))
      }
      let barButton = UIBarButtonItem(
        image: UIImage(systemName: item.icon)?.withConfiguration(
          UIImage.SymbolConfiguration(pointSize: 16, weight: .medium)
        ),
        style: .plain,
        target: self,
        action: #selector(actionTapped(_:))
      )
      barButton.tag = index
      barButton.tintColor = item.destructive ? .systemRed : nil
      barButton.accessibilityLabel = item.title
      barItems.append(barButton)
    }
    toolbar.setItems(barItems, animated: false)

    addSubview(toolbar)
    addSubview(countPill)

    NSLayoutConstraint.activate([
      toolbar.leadingAnchor.constraint(equalTo: leadingAnchor),
      toolbar.trailingAnchor.constraint(equalTo: trailingAnchor),
      toolbar.bottomAnchor.constraint(equalTo: bottomAnchor),
      toolbar.topAnchor.constraint(equalTo: topAnchor, constant: 20),

      countPill.centerXAnchor.constraint(equalTo: centerXAnchor),
      countPill.bottomAnchor.constraint(equalTo: toolbar.topAnchor, constant: 6),
      countPill.heightAnchor.constraint(equalToConstant: 28),
    ])
  }

  @objc private func actionTapped(_ sender: UIBarButtonItem) {
    feedbackGenerator.impactOccurred()
    let action = actionNames[sender.tag]

    switch action {
    case "remove":
      showRemoveConfirmation()
    case "addToCollection":
      showCollectionAlert()
    default:
      webView?.evaluateJavaScript("window.__nativeSelectionAction?.('\(action)')") { _, _ in }
    }
  }

  private func showRemoveConfirmation() {
    guard let vc = webView?.window?.rootViewController else { return }
    var topVC = vc
    while let presented = topVC.presentedViewController { topVC = presented }

    let alert = UIAlertController(
      title: "Remove Selected Books",
      message: "Are you sure you want to remove the selected books? This cannot be undone.",
      preferredStyle: .alert
    )
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.addAction(UIAlertAction(title: "Remove", style: .destructive) { [weak self] _ in
      self?.webView?.evaluateJavaScript("window.__nativeSelectionAction?.('confirmRemove')") { _, _ in }
    })
    topVC.present(alert, animated: true)
  }

  private func showCollectionAlert() {
    webView?.evaluateJavaScript("window.__nativeSelectionAction?.('openCollectionPicker')") { _, _ in }
  }
}

// MARK: - Native Toolbar (Home Page — Liquid Glass)
// Hamburger button + "OpenRead" badge, positioned at top of screen.

// MARK: - Native Home Navigation Bar (System UINavigationBar)
// Uses system UINavigationBar for automatic Liquid Glass. Switches between home and collections mode.
class NativeHomeNavBar: UINavigationBar {
  private weak var webView: WKWebView?
  private let feedbackGenerator = UIImpactFeedbackGenerator(style: .light)
  private var isCollectionsMode = false
  private var homeItem: UINavigationItem!
  private var collectionsItem: UINavigationItem!

  init(webView: WKWebView) {
    self.webView = webView
    super.init(frame: .zero)
    feedbackGenerator.prepare()
    setupItems()
  }

  required init?(coder: NSCoder) { fatalError() }

  func setCollectionsMode(_ enabled: Bool) {
    guard enabled != isCollectionsMode else { return }
    isCollectionsMode = enabled
    items = [enabled ? collectionsItem : homeItem]
  }

  private func setupItems() {
    prefersLargeTitles = false

    // Title styling — small caps tracking to match the badge aesthetic
    let appearance = UINavigationBarAppearance()
    appearance.configureWithTransparentBackground()
    appearance.titleTextAttributes = [
      .font: UIFont.systemFont(ofSize: 13, weight: .semibold),
      .kern: 1.5 as NSNumber,
    ]
    standardAppearance = appearance
    scrollEdgeAppearance = appearance

    // Home mode: hamburger left, "OPENREAD" center title
    homeItem = UINavigationItem(title: "OPENREAD")
    homeItem.leftBarButtonItem = UIBarButtonItem(
      image: UIImage(systemName: "line.3.horizontal"),
      style: .plain, target: self, action: #selector(menuTapped)
    )

    // Collections mode: hamburger left, "COLLECTIONS" center, search + plus right
    collectionsItem = UINavigationItem(title: "COLLECTIONS")
    collectionsItem.leftBarButtonItem = UIBarButtonItem(
      image: UIImage(systemName: "line.3.horizontal"),
      style: .plain, target: self, action: #selector(menuTapped)
    )
    collectionsItem.rightBarButtonItems = [
      UIBarButtonItem(
        image: UIImage(systemName: "plus"),
        style: .plain, target: self, action: #selector(plusTapped)
      ),
      UIBarButtonItem(
        image: UIImage(systemName: "magnifyingglass"),
        style: .plain, target: self, action: #selector(searchTapped)
      ),
    ]

    pushItem(homeItem, animated: false)
  }

  @objc private func menuTapped() {
    feedbackGenerator.impactOccurred()
    webView?.evaluateJavaScript("window.__nativeMenuAction?.()") { _, _ in }
  }

  @objc private func searchTapped() {
    feedbackGenerator.impactOccurred()
    webView?.evaluateJavaScript("window.__nativeCollectionSearch?.()") { _, _ in }
  }

  @objc private func plusTapped() {
    feedbackGenerator.impactOccurred()
    webView?.evaluateJavaScript("window.__nativeCollectionCreate?.()") { _, _ in }
  }
}

// MARK: - Native Collection Navigation Bar (System UINavigationBar)
// Shows on collection detail: ← Collections | ⋮ kebab with rename/delete
class NativeCollectionNavBar: UINavigationBar {
  private weak var webView: WKWebView?
  private let feedbackGenerator = UIImpactFeedbackGenerator(style: .light)
  private var collectionName: String = ""
  private var collectionId: String = ""

  init(webView: WKWebView) {
    self.webView = webView
    super.init(frame: .zero)
    feedbackGenerator.prepare()
    setupItems()
  }

  required init?(coder: NSCoder) { fatalError() }

  func update(name: String, id: String) {
    collectionName = name
    collectionId = id
  }

  private func setupItems() {
    prefersLargeTitles = false

    let appearance = UINavigationBarAppearance()
    appearance.configureWithTransparentBackground()
    standardAppearance = appearance
    scrollEdgeAppearance = appearance

    let navItem = UINavigationItem(title: "")

    // Back button — ← Collections
    let backBtn = UIBarButtonItem(
      image: UIImage(systemName: "chevron.left"),
      style: .plain,
      target: self,
      action: #selector(backTapped)
    )
    backBtn.title = "Collections"
    navItem.leftBarButtonItem = backBtn

    // Kebab — UIMenu with Rename + Delete
    navItem.rightBarButtonItem = UIBarButtonItem(
      image: UIImage(systemName: "ellipsis"),
      menu: UIMenu(children: [
        UIAction(title: "Rename", image: UIImage(systemName: "pencil")) { [weak self] _ in
          self?.feedbackGenerator.impactOccurred()
          self?.handleRename()
        },
        UIAction(title: "Delete", image: UIImage(systemName: "trash"), attributes: .destructive) { [weak self] _ in
          self?.feedbackGenerator.impactOccurred()
          self?.handleDelete()
        },
      ])
    )

    pushItem(navItem, animated: false)
  }

  @objc private func backTapped() {
    feedbackGenerator.impactOccurred()
    webView?.evaluateJavaScript("window.__nativeCollectionBack?.()") { _, _ in }
  }

  private func handleRename() {
    guard let vc = webView?.window?.rootViewController else { return }
    var topVC = vc
    while let presented = topVC.presentedViewController { topVC = presented }

    let alert = UIAlertController(title: "Rename Collection", message: nil, preferredStyle: .alert)
    alert.addTextField { [weak self] tf in
      tf.text = self?.collectionName ?? ""
      tf.autocapitalizationType = .words
      tf.selectAll(nil)
    }
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.addAction(UIAlertAction(title: "Rename", style: .default) { [weak self] _ in
      let newName = alert.textFields?.first?.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      if !newName.isEmpty {
        self?.collectionName = newName
        let escaped = newName.replacingOccurrences(of: "'", with: "\\'")
        let idEscaped = self?.collectionId.replacingOccurrences(of: "'", with: "\\'") ?? ""
        self?.webView?.evaluateJavaScript("window.__nativeCollectionAction?.('rename', '\(idEscaped)', '\(escaped)')") { _, _ in }
      }
    })
    topVC.present(alert, animated: true)
  }

  private func handleDelete() {
    guard let vc = webView?.window?.rootViewController else { return }
    var topVC = vc
    while let presented = topVC.presentedViewController { topVC = presented }

    let name = collectionName.isEmpty ? "this collection" : collectionName
    let alert = UIAlertController(
      title: "Delete Collection?",
      message: "This will delete \"\(name)\". Your books will not be deleted.",
      preferredStyle: .alert
    )
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.addAction(UIAlertAction(title: "Delete", style: .destructive) { [weak self] _ in
      let idEscaped = self?.collectionId.replacingOccurrences(of: "'", with: "\\'") ?? ""
      self?.webView?.evaluateJavaScript("window.__nativeCollectionAction?.('delete', '\(idEscaped)')") { _, _ in }
    })
    topVC.present(alert, animated: true)
  }
}

// MARK: - Native Footer Tab Bar (System UITabBar)
// Uses system UITabBar for automatic Liquid Glass, selection indicator, and 44pt touch targets.
class NativeFooterTabBar: UITabBar, UITabBarDelegate {
  private weak var webView: WKWebView?
  private let actions = ["toc", "chat", "settings"]
  private var previousTag: Int = -1

  init(webView: WKWebView) {
    self.webView = webView
    super.init(frame: .zero)
    delegate = self
    setupItems()
  }

  required init?(coder: NSCoder) { fatalError() }

  private func setupItems() {
    items = [
      UITabBarItem(title: nil, image: UIImage(systemName: "list.bullet"), tag: 0),
      UITabBarItem(title: nil, image: UIImage(systemName: "bubble.left.and.bubble.right"), tag: 1),
      UITabBarItem(title: nil, image: UIImage(systemName: "gearshape"), tag: 2),
    ]
  }

  func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
    UIImpactFeedbackGenerator(style: .light).impactOccurred()
    let action = actions[item.tag]
    // Toggle: tapping the active tab deselects it
    if item.tag == previousTag {
      selectedItem = nil
      previousTag = -1
    } else {
      previousTag = item.tag
    }
    webView?.evaluateJavaScript("window.__nativeFooterAction?.('\(action)')") { _, _ in }
  }

  func setActiveTab(_ tab: String) {
    if let index = actions.firstIndex(of: tab) {
      selectedItem = items?[index]
      previousTag = index
    }
  }

  func resetSelection() {
    selectedItem = nil
    previousTag = -1
  }
}

// MARK: - Custom Edit Menu Items for WKWebView Text Selection
// Adds Highlight, Add Note, Search in Book to the iOS native edit menu.
// These methods are found via the UIResponder chain when text is selected.
extension WKWebView {
  @objc func openread_highlight() {
    evaluateJavaScript("window.__nativeTextSelectionAction('highlight')") { _, _ in }
  }

  @objc func openread_addNote() {
    evaluateJavaScript("window.__nativeTextSelectionAction('annotate')") { _, _ in }
  }

  @objc func openread_searchInBook() {
    evaluateJavaScript("window.__nativeTextSelectionAction('search')") { _, _ in }
  }

  @objc func openread_wikipedia() {
    evaluateJavaScript("window.__nativeTextSelectionAction('wikipedia')") { _, _ in }
  }
}

class NativeBridgePlugin: Plugin, WKScriptMessageHandler {
  private var webView: WKWebView?
  private var authSession: ASWebAuthenticationSession?
  private var currentOrientationMask: UIInterfaceOrientationMask = .all
  private var originalDelegate: UIApplicationDelegate?
  private var webViewLifecycleManager: WebViewLifecycleManager?
  private var colorPicker: NativeColorPicker?
  private var footerBar: NativeFooterTabBar?
  private var homeToolbar: NativeHomeNavBar?
  private var collectionToolbar: NativeCollectionNavBar?
  private var selectionToolbar: NativeSelectionBar?
  private var sidebarCloseButton: UIButton?
  private var chapterPullBottom: UIView?
  private var chapterPullTop: UIView?
  private var chapterPullBottomWidth: NSLayoutConstraint?
  private var chapterPullTopWidth: NSLayoutConstraint?
  private var urlObservation: NSKeyValueObservation?

  /// Show native rename alert with text field.
  private func showRenameAlert(bookHash: String, currentTitle: String) {
    guard let vc = webView?.window?.rootViewController else { return }
    var topVC = vc
    while let presented = topVC.presentedViewController { topVC = presented }

    let alert = UIAlertController(title: "Rename Book", message: nil, preferredStyle: .alert)
    alert.addTextField { textField in
      textField.text = currentTitle
      textField.autocapitalizationType = .words
      textField.selectAll(nil)
    }
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.addAction(UIAlertAction(title: "Rename", style: .default) { [weak self] _ in
      let newName = alert.textFields?.first?.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      if !newName.isEmpty && newName != currentTitle {
        let escaped = newName.replacingOccurrences(of: "'", with: "\\'")
        let hashEscaped = bookHash.replacingOccurrences(of: "'", with: "\\'")
        self?.webView?.evaluateJavaScript("window.__nativeBookRename?.('\(hashEscaped)', '\(escaped)')") { _, _ in }
      }
    })
    topVC.present(alert, animated: true)
  }

  /// Show footer tab bar with scale-up animation (syncs with question bar shrink).
  private func showFooterBar() {
    footerBar?.transform = CGAffineTransform(scaleX: 0.01, y: 0.01)
    footerBar?.alpha = 1
    UIView.animate(withDuration: 0.3, delay: 0, usingSpringWithDamping: 0.85, initialSpringVelocity: 0.5) {
      self.footerBar?.transform = .identity
    }
  }

  /// Show native glass close button for sidebar overlay.
  private func showSidebarCloseButton() {
    // Create button if first time
    if sidebarCloseButton == nil, let parent = webView?.superview {
      let btn = UIButton(type: .system)
      btn.translatesAutoresizingMaskIntoConstraints = false
      if #available(iOS 26.0, *) {
        var config = UIButton.Configuration.glass()
        config.image = UIImage(systemName: "xmark")?
          .withConfiguration(UIImage.SymbolConfiguration(pointSize: 14, weight: .semibold))
        config.contentInsets = NSDirectionalEdgeInsets(top: 10, leading: 10, bottom: 10, trailing: 10)
        btn.configuration = config
      } else {
        btn.setImage(
          UIImage(systemName: "xmark")?
            .withConfiguration(UIImage.SymbolConfiguration(pointSize: 14, weight: .semibold)),
          for: .normal
        )
        btn.tintColor = .label
        btn.backgroundColor = UIColor.systemGray5
      }
      btn.layer.cornerRadius = 22
      btn.clipsToBounds = true
      btn.addTarget(self, action: #selector(sidebarCloseTapped), for: .touchUpInside)
      parent.addSubview(btn)
      let topPadding: CGFloat = parent.safeAreaInsets.top + 16
      NSLayoutConstraint.activate([
        btn.leadingAnchor.constraint(equalTo: parent.leadingAnchor, constant: 16),
        btn.topAnchor.constraint(equalTo: parent.topAnchor, constant: topPadding),
        btn.widthAnchor.constraint(equalToConstant: 44),
        btn.heightAnchor.constraint(equalToConstant: 44),
      ])
      sidebarCloseButton = btn
    }
    sidebarCloseButton?.alpha = 1
    homeToolbar?.alpha = 0
  }

  /// Hide sidebar close button and restore toolbar.
  private func hideSidebarCloseButton() {
    sidebarCloseButton?.alpha = 0
  }

  @objc private func sidebarCloseTapped() {
    UIImpactFeedbackGenerator(style: .light).impactOccurred()
    hideSidebarCloseButton()
    // Tell web to close the sidebar
    webView?.evaluateJavaScript("window.__nativeSidebarClose?.()") { _, _ in }
  }

  /// Hide footer tab bar with scale-down animation (syncs with question bar expand).
  private func hideFooterBar() {
    UIView.animate(withDuration: 0.25, delay: 0, options: .curveEaseIn, animations: {
      self.footerBar?.transform = CGAffineTransform(scaleX: 0.01, y: 0.01)
    }) { _ in
      self.footerBar?.alpha = 0
      self.footerBar?.transform = .identity
    }
    footerBar?.resetSelection()
  }

  // WKScriptMessageHandler — receives messages from JS (main frame only)
  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    // Reject messages from EPUB content iframes to prevent UI spoofing
    if !message.frameInfo.isMainFrame { return }
    guard let body = message.body as? [String: Any] else { return }

    switch message.name {
    case "openreadColorPicker":
      guard let selected = body["selectedColor"] as? String,
            let showDelete = body["showDelete"] as? Bool else { return }
      // Use JS-provided viewport coordinates directly.
      // The JS side computes these using getBoundingClientRect on the
      // selection range or annotation element, already in viewport space.
      let x = body["x"] as? CGFloat ?? 0
      let y = body["y"] as? CGFloat ?? 0
      colorPicker?.show(at: CGPoint(x: x, y: y), selected: selected, withDelete: showDelete)

    case "openreadColorPickerHide":
      colorPicker?.hide()

    case "openreadToolbarVisible":
      let visible = body["visible"] as? Bool ?? true
      self.homeToolbar?.alpha = visible ? 1 : 0

    case "openreadSelectionToolbar":
      let visible = body["visible"] as? Bool ?? false
      let selected = body["selected"] as? Int ?? 0
      let total = body["total"] as? Int ?? 0
      if visible {
        self.selectionToolbar?.updateCount(selected, total)
        self.selectionToolbar?.alpha = 1
        self.homeToolbar?.alpha = 0
      } else {
        self.selectionToolbar?.alpha = 0
        // Restore home toolbar if on platform page
        let path = self.webView?.url?.path ?? ""
        let isPlatform = path.hasPrefix("/home") || path.hasPrefix("/library") || path.hasPrefix("/collections")
        self.homeToolbar?.alpha = isPlatform ? 1 : 0
      }

    case "openreadCollectionPicker":
      let collections = body["collections"] as? [[String: Any]] ?? []
      let bookHashes = body["bookHashes"] as? [String] ?? []
      UIImpactFeedbackGenerator(style: .light).impactOccurred()
      let picker = NativeCollectionPicker(webView: self.webView!, collections: collections, bookHashes: bookHashes)
      let nav = UINavigationController(rootViewController: picker)
      nav.modalPresentationStyle = .formSheet
      if let sheet = nav.sheetPresentationController {
        sheet.detents = [.medium(), .large()]
        sheet.prefersGrabberVisible = true
      }
      var topVC = self.webView?.window?.rootViewController
      while let presented = topVC?.presentedViewController { topVC = presented }
      topVC?.present(nav, animated: true)

    case "openreadTextInput":
      let title = body["title"] as? String ?? "Input"
      let message = body["message"] as? String
      let placeholder = body["placeholder"] as? String ?? ""
      let defaultValue = body["defaultValue"] as? String ?? ""
      let callbackId = body["callbackId"] as? String ?? ""
      UIImpactFeedbackGenerator(style: .light).impactOccurred()

      guard let vc = self.webView?.window?.rootViewController else { break }
      var topVC = vc
      while let presented = topVC.presentedViewController { topVC = presented }

      let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
      alert.addTextField { tf in
        tf.placeholder = placeholder
        tf.text = defaultValue
        tf.autocapitalizationType = .words
        if !defaultValue.isEmpty { tf.selectAll(nil) }
      }
      alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
      alert.addAction(UIAlertAction(title: "Done", style: .default) { [weak self] _ in
        let value = alert.textFields?.first?.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !value.isEmpty {
          let escaped = value.replacingOccurrences(of: "'", with: "\\'")
          let cbEscaped = callbackId.replacingOccurrences(of: "'", with: "\\'")
          self?.webView?.evaluateJavaScript("window.__nativeTextInputResult?.('\(cbEscaped)', '\(escaped)')") { _, _ in }
        }
      })
      topVC.present(alert, animated: true)

    case "openreadCollectionToolbar":
      let visible = body["visible"] as? Bool ?? false
      if visible {
        let name = body["name"] as? String ?? ""
        let id = body["id"] as? String ?? ""
        self.collectionToolbar?.update(name: name, id: id)
        self.collectionToolbar?.alpha = 1
        self.homeToolbar?.alpha = 0
      } else {
        self.collectionToolbar?.alpha = 0
        let path = self.webView?.url?.path ?? ""
        let isPlatform = path.hasPrefix("/home") || path.hasPrefix("/library") || path.hasPrefix("/collections")
        self.homeToolbar?.alpha = isPlatform ? 1 : 0
      }

    case "openreadRenameBook":
      let bookHash = body["bookHash"] as? String ?? ""
      let currentTitle = body["currentTitle"] as? String ?? ""
      UIImpactFeedbackGenerator(style: .light).impactOccurred()
      showRenameAlert(bookHash: bookHash, currentTitle: currentTitle)

    case "openreadSidebarVisible":
      let visible = body["visible"] as? Bool ?? false
      if visible {
        self.showSidebarCloseButton()
      } else {
        self.hideSidebarCloseButton()
      }

    case "openreadFooterVisible":
      let visible = body["visible"] as? Bool ?? false
      let activeTab = body["activeTab"] as? String
      if visible {
        showFooterBar()
        if let tab = activeTab {
          footerBar?.setActiveTab(tab)
        }
      } else {
        hideFooterBar()
      }

    case "openreadChapterPull":
      let direction = body["direction"] as? String ?? ""
      let progress = CGFloat(body["progress"] as? Double ?? 0)
      let maxWidth = (self.webView?.bounds.width ?? 390) * 0.92
      if direction == "next" {
        chapterPullTop?.alpha = 0
        chapterPullTopWidth?.constant = 0
        chapterPullBottom?.alpha = progress > 0 ? 1 : 0
        chapterPullBottomWidth?.constant = progress * maxWidth
        chapterPullBottom?.superview?.layoutIfNeeded()
      } else if direction == "prev" {
        chapterPullBottom?.alpha = 0
        chapterPullBottomWidth?.constant = 0
        chapterPullTop?.alpha = progress > 0 ? 1 : 0
        chapterPullTopWidth?.constant = progress * maxWidth
        chapterPullTop?.superview?.layoutIfNeeded()
      } else {
        chapterPullBottom?.alpha = 0
        chapterPullBottomWidth?.constant = 0
        chapterPullTop?.alpha = 0
        chapterPullTopWidth?.constant = 0
        chapterPullBottom?.superview?.layoutIfNeeded()
      }

    default:
      break
    }
  }

  @objc public override func load(webview: WKWebView) {
    self.webView = webview
    logger.log("NativeBridgePlugin loaded")

    // Register custom items in the iOS text selection edit menu.
    // UIMenuController.menuItems is deprecated (iOS 16) but remains the only
    // public API to inject items into WKWebView's edit menu without using
    // private classes. The WKWebView extension above provides the action
    // targets — the responder chain finds them when text is selected.
    UIMenuController.shared.menuItems = [
      UIMenuItem(title: "Highlight", action: #selector(WKWebView.openread_highlight)),
      UIMenuItem(title: "Add Note", action: #selector(WKWebView.openread_addNote)),
      UIMenuItem(title: "Search in Book", action: #selector(WKWebView.openread_searchInBook)),
      UIMenuItem(title: "Wikipedia", action: #selector(WKWebView.openread_wikipedia)),
    ]

    // Register JS → Native message handlers for color picker and footer
    let contentController = webview.configuration.userContentController
    contentController.add(self, name: "openreadColorPicker")
    contentController.add(self, name: "openreadColorPickerHide")
    contentController.add(self, name: "openreadFooterVisible")
    contentController.add(self, name: "openreadToolbarVisible")
    contentController.add(self, name: "openreadSidebarVisible")
    contentController.add(self, name: "openreadSelectionToolbar")
    contentController.add(self, name: "openreadRenameBook")
    contentController.add(self, name: "openreadCollectionPicker")
    contentController.add(self, name: "openreadCollectionToolbar")
    contentController.add(self, name: "openreadTextInput")
    contentController.add(self, name: "openreadChapterPull")
    logger.log("NativeBridgePlugin: JS message handlers registered")

    // Native color picker overlay — added to the key window's root view
    // so it floats above everything and uses screen coordinates directly
    let picker = NativeColorPicker(webView: webview)
    // Keep translatesAutoresizingMaskIntoConstraints = true (default)
    // so we can position with frame in show(at:)
    if let keyWindow = UIApplication.shared.connectedScenes
        .compactMap({ $0 as? UIWindowScene })
        .flatMap({ $0.windows })
        .first(where: { $0.isKeyWindow }) {
      keyWindow.addSubview(picker)
    } else {
      webview.superview?.addSubview(picker)
    }
    self.colorPicker = picker
    logger.log("NativeBridgePlugin: Native color picker created")

    // System UINavigationBar — automatic Liquid Glass, handles orientation
    let navBar = NativeHomeNavBar(webView: webview)
    navBar.translatesAutoresizingMaskIntoConstraints = false
    navBar.alpha = 0  // Hidden until a platform page loads
    if let parent = webview.superview {
      parent.addSubview(navBar)
      NSLayoutConstraint.activate([
        navBar.leadingAnchor.constraint(equalTo: parent.leadingAnchor),
        navBar.trailingAnchor.constraint(equalTo: parent.trailingAnchor),
        navBar.topAnchor.constraint(equalTo: parent.safeAreaLayoutGuide.topAnchor),
      ])
    }
    self.homeToolbar = navBar
    logger.log("NativeBridgePlugin: System UINavigationBar home toolbar created")

    // System UINavigationBar for collection detail (← Collections | ⋮ kebab)
    let colNavBar = NativeCollectionNavBar(webView: webview)
    colNavBar.translatesAutoresizingMaskIntoConstraints = false
    colNavBar.alpha = 0  // Hidden until collection detail view
    if let parent = webview.superview {
      parent.addSubview(colNavBar)
      NSLayoutConstraint.activate([
        colNavBar.leadingAnchor.constraint(equalTo: parent.leadingAnchor),
        colNavBar.trailingAnchor.constraint(equalTo: parent.trailingAnchor),
        colNavBar.topAnchor.constraint(equalTo: parent.safeAreaLayoutGuide.topAnchor),
      ])
    }
    self.collectionToolbar = colNavBar
    logger.log("NativeBridgePlugin: System UINavigationBar collection toolbar created")

    // System UIToolbar for multi-select actions + count pill
    let selToolbar = NativeSelectionBar(webView: webview)
    selToolbar.translatesAutoresizingMaskIntoConstraints = false
    selToolbar.alpha = 0  // Hidden until select mode
    if let parent = webview.superview {
      parent.addSubview(selToolbar)
      let bottomPadding: CGFloat = parent.safeAreaInsets.bottom > 0 ? parent.safeAreaInsets.bottom - 10 : 8
      NSLayoutConstraint.activate([
        selToolbar.centerXAnchor.constraint(equalTo: parent.centerXAnchor),
        selToolbar.leadingAnchor.constraint(equalTo: parent.leadingAnchor, constant: 12),
        selToolbar.trailingAnchor.constraint(equalTo: parent.trailingAnchor, constant: -12),
        selToolbar.bottomAnchor.constraint(equalTo: parent.bottomAnchor, constant: -bottomPadding),
        selToolbar.heightAnchor.constraint(equalToConstant: 64),
      ])
    }
    self.selectionToolbar = selToolbar
    logger.log("NativeBridgePlugin: Native selection toolbar created")

    // Centralized route-based visibility for all native UI elements
    let updateVisibility: (WKWebView) -> Void = { [weak self] webView in
      self?.colorPicker?.hide()
      let path = webView.url?.path ?? ""
      let query = webView.url?.query ?? ""
      let isReader = path.hasPrefix("/reader")
      let isPlatformPage = path.hasPrefix("/home") || path.hasPrefix("/library")
        || path.hasPrefix("/collections")
      let isCollectionDetail = path.hasPrefix("/collections") && query.contains("id=")
      let isCollectionList = path.hasPrefix("/collections") && !query.contains("id=")
      // Collection detail: web controls toolbar via message handler
      // Collection list: home toolbar in collections mode (COLLECTIONS + search + plus)
      // Other pages: home toolbar in default mode (OPENREAD)
      if !isCollectionDetail {
        self?.collectionToolbar?.alpha = 0
        self?.homeToolbar?.alpha = isPlatformPage ? 1 : 0
        self?.homeToolbar?.setCollectionsMode(isCollectionList)
      }
      // Sidebar close button: hide on navigation
      self?.hideSidebarCloseButton()
      // Footer bar: only in reader
      if !isReader {
        self?.hideFooterBar()
      }
    }
    // Fire immediately for initial page, then observe future changes
    updateVisibility(webview)
    urlObservation = webview.observe(\.url, options: [.new]) { webView, _ in
      updateVisibility(webView)
    }

    // System UITabBar — full width, automatic Liquid Glass + selection indicator
    let footer = NativeFooterTabBar(webView: webview)
    footer.translatesAutoresizingMaskIntoConstraints = false
    footer.alpha = 0  // Hidden until web tells us to show
    if let parent = webview.superview {
      parent.addSubview(footer)
      NSLayoutConstraint.activate([
        footer.leadingAnchor.constraint(equalTo: parent.leadingAnchor),
        footer.trailingAnchor.constraint(equalTo: parent.trailingAnchor),
        footer.bottomAnchor.constraint(equalTo: parent.bottomAnchor),
      ])
    }
    self.footerBar = footer
    logger.log("NativeBridgePlugin: System UITabBar footer created")

    // Pull-to-load chapter indicator: thin bar that expands from CENTER outward.
    // Uses a plain UIView with centerXAnchor + animated width constraint.
    if let parent = webview.superview {
      let bottomBar = UIView()
      bottomBar.translatesAutoresizingMaskIntoConstraints = false
      bottomBar.backgroundColor = .systemBlue
      bottomBar.layer.cornerRadius = 1.5
      bottomBar.alpha = 0
      parent.addSubview(bottomBar)
      let bottomWidth = bottomBar.widthAnchor.constraint(equalToConstant: 0)
      NSLayoutConstraint.activate([
        bottomBar.centerXAnchor.constraint(equalTo: parent.centerXAnchor),
        bottomWidth,
        bottomBar.bottomAnchor.constraint(equalTo: parent.safeAreaLayoutGuide.bottomAnchor, constant: -2),
        bottomBar.heightAnchor.constraint(equalToConstant: 3),
      ])
      self.chapterPullBottom = bottomBar
      self.chapterPullBottomWidth = bottomWidth

      let topBar = UIView()
      topBar.translatesAutoresizingMaskIntoConstraints = false
      topBar.backgroundColor = .systemBlue
      topBar.layer.cornerRadius = 1.5
      topBar.alpha = 0
      parent.addSubview(topBar)
      let topWidth = topBar.widthAnchor.constraint(equalToConstant: 0)
      NSLayoutConstraint.activate([
        topBar.centerXAnchor.constraint(equalTo: parent.centerXAnchor),
        topWidth,
        topBar.topAnchor.constraint(equalTo: parent.safeAreaLayoutGuide.topAnchor, constant: 2),
        topBar.heightAnchor.constraint(equalToConstant: 3),
      ])
      self.chapterPullTop = topBar
      self.chapterPullTopWidth = topWidth
      logger.log("NativeBridgePlugin: Chapter pull indicator bars created")
    }

    webViewLifecycleManager = WebViewLifecycleManager()
    webViewLifecycleManager?.startMonitoring(webView: webview)
    logger.log("NativeBridgePlugin: WebView lifecycle monitoring activated")

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(appDidBecomeActive),
      name: UIApplication.didBecomeActiveNotification,
      object: nil
    )

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(appDidEnterBackground),
      name: UIApplication.didEnterBackgroundNotification,
      object: nil
    )

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(appWillEnterForeground),
      name: UIApplication.willEnterForegroundNotification,
      object: nil
    )

    if let app = UIApplication.value(forKey: "sharedApplication") as? UIApplication {
      self.originalDelegate = app.delegate
      app.delegate = self
    } else {
      Logger.error("NativeBridgePlugin: Failed to get shared application")
    }
  }

  @objc func appWillEnterForeground() {
    logger.log("NativeBridgePlugin: App will enter foreground")
    webViewLifecycleManager?.handleAppWillEnterForeground()
  }

  @objc func appDidBecomeActive() {
    if volumeKeyHandler != nil {
      activateVolumeKeyInterception()
    }
  }

  @objc func appDidEnterBackground() {
    logger.log("NativeBridgePlugin: App did enter background")
    if let handler = volumeKeyHandler, handler.isIntercepting {
      handler.stopInterception()
    }
    webViewLifecycleManager?.handleAppDidEnterBackground()
  }

  func activateVolumeKeyInterception() {
    if volumeKeyHandler == nil {
      volumeKeyHandler = VolumeKeyHandler()
    }

    if let webView = self.webView {
      volumeKeyHandler?.stopInterception()
      volumeKeyHandler?.startInterception(webView: webView)
    } else {
      logger.warning("Cannot activate volume key interception: webView is nil")
    }
  }

  deinit {
    urlObservation?.invalidate()
    webViewLifecycleManager?.stopMonitoring()
    webViewLifecycleManager = nil

    NotificationCenter.default.removeObserver(self)
  }

  private struct AssociatedKeys {
    static var volumeKeyHandler = "volumeKeyHandler"
    static var interceptingVolumeKeys = "interceptingVolumeKeys"
  }

  private var volumeKeyHandler: VolumeKeyHandler? {
    get {
      return objc_getAssociatedObject(self, &AssociatedKeys.volumeKeyHandler) as? VolumeKeyHandler
    }
    set {
      objc_setAssociatedObject(
        self, &AssociatedKeys.volumeKeyHandler, newValue, .OBJC_ASSOCIATION_RETAIN)
    }
  }

  private var interceptingVolumeKeys: Bool {
    get {
      return objc_getAssociatedObject(self, &AssociatedKeys.interceptingVolumeKeys) as? Bool
        ?? false
    }
    set {
      objc_setAssociatedObject(
        self, &AssociatedKeys.interceptingVolumeKeys, newValue, .OBJC_ASSOCIATION_RETAIN)
    }
  }

  @objc public func use_background_audio(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(UseBackgroundAudioRequestArgs.self)
      let enabled = args.enabled
      let session = AVAudioSession.sharedInstance()
      if enabled {
        try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try session.setActive(true)
        logger.log("AVAudioSession activated")
      } else {
        try session.setActive(false)
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        logger.log("AVAudioSession deactivated")
      }
      invoke.resolve()
    } catch {
      logger.error("Failed to set up audio session: \(error)")
    }
  }

  @objc public func auth_with_safari(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SafariAuthRequestArgs.self)
    let authUrl = URL(string: args.authUrl)!

    authSession = ASWebAuthenticationSession(url: authUrl, callbackURLScheme: "openread") {
      [weak self] callbackURL, error in
      guard let strongSelf = self else { return }

      if let error = error {
        logger.error("Auth session error: \(error.localizedDescription)")
        invoke.reject(error.localizedDescription)
        return
      }

      if let callbackURL = callbackURL {
        strongSelf.authSession?.cancel()
        strongSelf.authSession = nil
        invoke.resolve(["redirectUrl": callbackURL.absoluteString])
      }
    }

    if #available(iOS 13.0, *) {
      authSession?.presentationContextProvider = self
    }

    let started = authSession?.start() ?? false
    logger.log("Auth session start result: \(started)")
  }

  @objc public func set_system_ui_visibility(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SetSystemUIVisibilityRequestArgs.self)
    let visible = args.visible
    let darkMode = args.darkMode

    DispatchQueue.main.async {
      UIApplication.shared.setStatusBarHidden(!visible, with: .none)

      let windows = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap { $0.windows }

      let keyWindow = windows.first(where: { $0.isKeyWindow }) ?? windows.first
      if let keyWindow = keyWindow {
        let targetStyle: UIUserInterfaceStyle = darkMode ? .dark : .light
        // Only set if changed — avoids unnecessary trait propagation through WKWebView
        if keyWindow.overrideUserInterfaceStyle != targetStyle {
          keyWindow.overrideUserInterfaceStyle = targetStyle
        }
        // Removed layoutIfNeeded() — it forced a synchronous layout pass on the
        // entire WKWebView, causing a visible page flash on every toolbar toggle.
        // UIKit applies style changes automatically on the next display cycle.
      } else {
        logger.error("No key window found")
      }
    }
    invoke.resolve(["success": true])
  }

  @objc public func get_sys_fonts_list(_ invoke: Invoke) throws {
    var fontDict: [String: String] = [:]

    for family in UIFont.familyNames.sorted() {
      if let localized = getLocalizedDisplayName(familyName: family) {
        fontDict[family] = localized
      } else {
        let fontNames = UIFont.fontNames(forFamilyName: family)
        if fontNames.isEmpty {
          fontDict[family] = family
        } else {
          for fontName in fontNames {
            fontDict[fontName] = family
          }
        }
      }
    }

    invoke.resolve(["fonts": fontDict])
  }

  @objc public func intercept_keys(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(InterceptKeysRequestArgs.self)

      if let volumeKeys = args.volumeKeys {
        if volumeKeys {
          self.activateVolumeKeyInterception()
        } else {
          self.volumeKeyHandler?.stopInterception()
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            self?.volumeKeyHandler = nil
          }
        }
      }
      invoke.resolve()
    } catch {
      invoke.reject(error.localizedDescription)
    }
  }

  @objc public func lock_screen_orientation(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(LockScreenOrientationRequestArgs.self) else {
      return invoke.reject("Invalid arguments")
    }

    DispatchQueue.main.async {
      UIDevice.current.beginGeneratingDeviceOrientationNotifications()
      let orientation = args.orientation ?? "auto"
      switch orientation.lowercased() {
      case "portrait":
        self.changeOrientation(.portrait)
      case "landscape":
        self.changeOrientation(.landscape)
      case "auto":
        self.changeOrientation(.all)
      default:
        invoke.reject("Invalid orientation mode")
        return
      }

      invoke.resolve()
    }
  }

  private func changeOrientation(_ orientationMask: UIInterfaceOrientationMask) {
    self.currentOrientationMask = orientationMask
    if #available(iOS 16.0, *) {
      if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
        for window in windowScene.windows {
          if let rootVC = window.rootViewController {
            rootVC.setNeedsUpdateOfSupportedInterfaceOrientations()
          }
        }
        if orientationMask == .all {
          windowScene.requestGeometryUpdate(.iOS(interfaceOrientations: .all)) { error in
            logger.error("Orientation update error: \(error.localizedDescription)")
            DispatchQueue.main.async {
              UIViewController.attemptRotationToDeviceOrientation()
            }
          }
        } else {
          windowScene.requestGeometryUpdate(.iOS(interfaceOrientations: orientationMask)) { error in
            logger.error("Orientation update error: \(error.localizedDescription)")
          }
        }
      }
    } else {
      if orientationMask == .all {
        UIViewController.attemptRotationToDeviceOrientation()
      } else {
        let specificOrientation: UIInterfaceOrientation
        if orientationMask.contains(.portrait) {
          specificOrientation = .portrait
        } else if orientationMask.contains(.landscape) {
          let currentOrientation = UIDevice.current.orientation
          if currentOrientation == .landscapeLeft {
            specificOrientation = .landscapeRight
          } else if currentOrientation == .landscapeRight {
            specificOrientation = .landscapeLeft
          } else {
            specificOrientation = .landscapeRight
          }
        } else {
          specificOrientation = .portrait
        }
        UIDevice.current.setValue(specificOrientation.rawValue, forKey: "orientation")
        UIViewController.attemptRotationToDeviceOrientation()
      }
    }
  }

  @objc public func iap_is_available(_ invoke: Invoke) {
    invoke.resolve(["available": true])
  }

  @objc public func iap_initialize(_ invoke: Invoke) {
    StoreKitManager.shared.initialize()
    invoke.resolve(["success": true])
  }

  @objc public func iap_fetch_products(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(FetchProductsRequest.self)

      StoreKitManager.shared.fetchProducts(productIds: args.productIds) { products in
        let productsData: [ProductData] = products.map { product in
          return ProductData(
            id: product.productIdentifier,
            title: product.localizedTitle,
            description: product.localizedDescription,
            price: product.price.stringValue,
            priceCurrencyCode: product.priceLocale.currencyCode,
            priceAmountMicros: Int64(product.price.doubleValue * 1_000_000),
            productType: product.productIdentifier.contains("monthly")
              || product.productIdentifier.contains("yearly") ? "subscription" : "consumable"
          )
        }
        invoke.resolve(["products": productsData])
      }
    } catch {
      invoke.reject("Failed to parse fetch products arguments: \(error.localizedDescription)")
    }
  }

  @objc public func iap_purchase_product(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(PurchaseProductRequest.self)

      StoreKitManager.shared.fetchProducts(productIds: [args.productId]) { products in
        guard let product = products.first else {
          invoke.reject("Product not found")
          return
        }

        StoreKitManager.shared.purchase(product: product) { result in
          switch result {
          case .success(let txn):
            let purchase = PurchaseData(
              productId: txn.payment.productIdentifier,
              transactionId: txn.transactionIdentifier ?? "",
              originalTransactionId: txn.original?.transactionIdentifier ?? txn
                .transactionIdentifier ?? "",
              purchaseDate: ISO8601DateFormatter().string(from: txn.transactionDate ?? Date()),
              purchaseState: "purchased",
              platform: "ios"
            )
            invoke.resolve(["purchase": purchase])
          case .failure(let error):
            invoke.reject("Purchase failed: \(error.localizedDescription)")
          }
        }
      }
    } catch {
      invoke.reject("Failed to parse purchase arguments: \(error.localizedDescription)")
    }
  }

  @objc public func iap_restore_purchases(_ invoke: Invoke) {
    StoreKitManager.shared.restorePurchases { transactions in
      let restored = transactions.map { txn -> PurchaseData in
        return PurchaseData(
          productId: txn.payment.productIdentifier,
          transactionId: txn.transactionIdentifier ?? "",
          originalTransactionId: txn.original?.transactionIdentifier ?? txn.transactionIdentifier
            ?? "",
          purchaseDate: ISO8601DateFormatter().string(from: txn.transactionDate ?? Date()),
          purchaseState: "restored",
          platform: "ios"
        )
      }
      invoke.resolve(["purchases": restored])
    }
  }

  @objc public func get_system_color_scheme(_ invoke: Invoke) {
    let userInterfaceStyle = UITraitCollection.current.userInterfaceStyle
    let colorScheme = (userInterfaceStyle == .dark) ? "dark" : "light"
    invoke.resolve(["colorScheme": colorScheme])
  }

  @objc public func get_screen_brightness(_ invoke: Invoke) {
    let brightness = UIScreen.main.brightness
    invoke.resolve(["brightness": brightness])
  }

  @objc public func set_screen_brightness(_ invoke: Invoke) {
    guard let args = try? invoke.parseArgs(SetScreenBrightnessRequestArgs.self) else {
      return invoke.reject("Failed to parse arguments")
    }

    let brightness = args.brightness ?? 0.5

    if brightness < 0.0 {
      // Revert to system brightness - iOS doesn't have a direct "system brightness" setting
      // We will restore the brightness that was set before the app modified it
      return invoke.resolve(["success": true])
    }

    if brightness > 1.0 {
      return invoke.reject("Brightness must be between 0.0 and 1.0")
    }

    DispatchQueue.main.async {
      UIScreen.main.brightness = CGFloat(brightness)
    }
    invoke.resolve(["success": true])
  }

  @objc public func copy_uri_to_path(_ invoke: Invoke) {
    guard let args = try? invoke.parseArgs(CopyUriToPathRequestArgs.self) else {
      return invoke.reject("Failed to parse arguments")
    }

    guard let uriString = args.uri, let dstPath = args.dst else {
      return invoke.reject("URI and destination path must be provided")
    }

    guard let uri = URL(string: uriString) else {
      return invoke.reject("Invalid URI")
    }

    let fileManager = FileManager.default
    let dstURL = URL(fileURLWithPath: dstPath)

    do {
      let didStartAccessing = uri.startAccessingSecurityScopedResource()
      defer {
        if didStartAccessing {
          uri.stopAccessingSecurityScopedResource()
        }
      }

      var shouldCopy = false

      if fileManager.fileExists(atPath: dstURL.path) {
        let srcAttributes = try fileManager.attributesOfItem(atPath: uri.path)
        let dstAttributes = try fileManager.attributesOfItem(atPath: dstURL.path)

        let srcModDate = srcAttributes[.modificationDate] as? Date ?? Date.distantPast
        let dstModDate = dstAttributes[.modificationDate] as? Date ?? Date.distantPast

        if srcModDate > dstModDate {
          try fileManager.removeItem(at: dstURL)
          shouldCopy = true
        } else {
          shouldCopy = false
        }
      } else {
        shouldCopy = true
      }

      if shouldCopy {
        try fileManager.copyItem(at: uri, to: dstURL)
      }

      invoke.resolve(["success": true])
    } catch {
      invoke.reject("Failed to copy file: \(error.localizedDescription)")
    }
  }

  @objc public func get_safe_area_insets(_ invoke: Invoke) {
    DispatchQueue.main.async { [weak self] in
      guard let webView = self?.webView,
            let window = webView.window else {
        invoke.resolve(["top": 0, "right": 0, "bottom": 0, "left": 0])
        return
      }
      let insets = window.safeAreaInsets
      invoke.resolve([
        "top": insets.top,
        "right": insets.right,
        "bottom": insets.bottom,
        "left": insets.left,
      ])
    }
  }

  @objc public func get_storefront_region_code(_ invoke: Invoke) {
    Task {
      if let storefront = await Storefront.current {
        invoke.resolve(["regionCode": storefront.countryCode])
      } else {
        invoke.reject("Failed to get region code")
      }
    }
  }
}

@_cdecl("init_plugin_native_bridge")
func initPlugin() -> Plugin {
  return NativeBridgePlugin()
}

@available(iOS 13.0, *)
extension NativeBridgePlugin: ASWebAuthenticationPresentationContextProviding {
  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    return UIApplication.shared.windows.first ?? UIWindow()
  }
}

extension NativeBridgePlugin: UIApplicationDelegate {
  public func application(
    _ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?
  ) -> UIInterfaceOrientationMask {
    return self.currentOrientationMask
  }

  /*
    Proxy all application delegate methods to the original delegate:
      sel!(application:didFinishLaunchingWithOptions:),
      sel!(application:openURL:options:),
      sel!(application:continue:restorationHandler:),
      sel!(applicationDidBecomeActive:),
      sel!(applicationWillResignActive:),
      sel!(applicationWillEnterForeground:),
      sel!(applicationDidEnterBackground:),
      sel!(applicationWillTerminate:),
  */

  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    self.originalDelegate?.application?(application, didFinishLaunchingWithOptions: launchOptions)
      ?? false
  }

  public func application(
    _ application: UIApplication, open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    self.originalDelegate?.application?(application, open: url, options: options) ?? false
  }

  public func application(
    _ application: UIApplication, continue continueUserActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    self.originalDelegate?.application?(
      application, continue: continueUserActivity, restorationHandler: restorationHandler) ?? false
  }

  public func applicationDidBecomeActive(_ application: UIApplication) {
    self.originalDelegate?.applicationDidBecomeActive?(application)
  }

  public func applicationWillResignActive(_ application: UIApplication) {
    webViewLifecycleManager?.handleAppWillResignActive()
    self.originalDelegate?.applicationWillResignActive?(application)
  }

  public func applicationWillEnterForeground(_ application: UIApplication) {
    webViewLifecycleManager?.handleAppWillEnterForeground()
    self.originalDelegate?.applicationWillEnterForeground?(application)
  }

  public func applicationDidEnterBackground(_ application: UIApplication) {
    webViewLifecycleManager?.handleAppDidEnterBackground()
    self.originalDelegate?.applicationDidEnterBackground?(application)
  }

  public func applicationWillTerminate(_ application: UIApplication) {
    self.originalDelegate?.applicationWillTerminate?(application)
  }
}
