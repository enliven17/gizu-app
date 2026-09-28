import UIKit
import UniformTypeIdentifiers

@MainActor internal final class NativeWalletUI: UIViewController, UIDocumentPickerDelegate {
  private let stack = UIStackView()
  private var approval: CheckedContinuation<Void, Error>?
  private var document: CheckedContinuation<URL, Error>?
  var onCancel: (() -> Void)?
  private let ink = UIColor(red: 5 / 255, green: 7 / 255, blue: 6 / 255, alpha: 1)
  private let accent = UIColor(red: 49 / 255, green: 196 / 255, blue: 126 / 255, alpha: 1)
  init() {
    super.init(nibName: nil, bundle: nil)
    modalPresentationStyle = .fullScreen
    isModalInPresentation = true
  }

  required init?(coder: NSCoder) { fatalError("Unavailable") }
  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = ink
    overrideUserInterfaceStyle = .dark
    let scroll = UIScrollView()
    scroll.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(scroll)
    stack.axis = .vertical
    stack.spacing = 20
    stack.translatesAutoresizingMaskIntoConstraints = false
    scroll.addSubview(stack)
    NSLayoutConstraint.activate([
      scroll.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
      scroll.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
      scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
      stack.leadingAnchor.constraint(
        equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 20),
      stack.trailingAnchor.constraint(
        equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -20),
      stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 20),
      stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -20),
      stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -40),
    ])
  }

  func show(_ title: String, _ message: String, action: String? = nil) {
    loadViewIfNeeded()
    stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
    for (text, style) in [
      ("GIZU · MONAD TESTNET", UIFont.TextStyle.caption1), (title, .largeTitle), (message, .body),
    ] {
      let label = UILabel()
      label.text = text
      label.numberOfLines = 0
      label.font = .preferredFont(forTextStyle: style)
      label.adjustsFontForContentSizeCategory = true
      label.textColor = style == .caption1 ? accent : .white
      stack.addArrangedSubview(label)
    }

    if let action { button(action, primary: true, selector: #selector(accept)) }
    button("Cancel", primary: false, selector: #selector(cancel))
  }

  private func button(_ title: String, primary: Bool, selector: Selector) {
    let button = UIButton(type: .system)
    var config = UIButton.Configuration.filled()
    config.title = title
    config.baseBackgroundColor = primary ? accent : UIColor(white: 0.08, alpha: 1)
    config.baseForegroundColor = primary ? ink : .white
    config.background.cornerRadius = 20
    config.contentInsets = .init(top: 18, leading: 20, bottom: 18, trailing: 20)
    button.configuration = config
    button.titleLabel?.numberOfLines = 0
    button.addTarget(self, action: selector, for: .touchUpInside)
    stack.addArrangedSubview(button)
  }

  @objc private func accept() {
    let callback = approval
    approval = nil
    show("Please wait", "Completing the approved operation…")
    callback?.resume()
  }

  @objc private func cancel() { onCancel?() }
  func stop() {
    let pending = approval
    approval = nil
    pending?.resume(throwing: WalletFailure.cancelled)
    let picker = document
    document = nil
    picker?.resume(throwing: WalletFailure.cancelled)
    presentedViewController?.dismiss(animated: false)
  }

  func confirm(_ title: String, _ message: String, action: String = "Continue") async throws {
    try Task.checkCancellation()
    try await withCheckedThrowingContinuation { continuation in
      approval = continuation
      show(title, message, action: action)
    }
  }
  func pick(exporting url: URL? = nil) async throws -> URL {
    try Task.checkCancellation()
    return try await withCheckedThrowingContinuation { continuation in
      document = continuation
      let picker =
        url.map { UIDocumentPickerViewController(forExporting: [$0], asCopy: true) }
        ?? UIDocumentPickerViewController(forOpeningContentTypes: [.json, .data], asCopy: true)
      picker.delegate = self
      picker.allowsMultipleSelection = false
      picker.isModalInPresentation = true
      present(picker, animated: true)
    }
  }
  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    let callback = document
    document = nil
    callback?.resume(throwing: WalletFailure.cancelled)
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL])
  {
    let callback = document
    document = nil
    guard urls.count == 1 else {
      callback?.resume(throwing: WalletFailure.invalid)
      return
    }

    // Wait for picker dismissal before presenting another system prompt.
    controller.dismiss(animated: true) { callback?.resume(returning: urls[0]) }
  }
}
