import UIKit

@available(iOS 18.0, *)
@MainActor internal final class WalletCeremony {
  let store: WalletStorage
  let presenter: UIViewController
  var ui: NativeWalletUI?
  private var gate: StoredPasskeyGate?
  private var systemWait = false
  private var lifetime = AuthorizationLifetime()
  var engine: StoredTransferEngine?
  var operationId: String?
  private var observers: [NSObjectProtocol] = []
  var cancelTask: (() -> Void)?
  init(presenter: UIViewController) throws {
    self.presenter = presenter
    store = WalletStorage(files: try ProtectedFiles())
    for event in [
      UIApplication.didEnterBackgroundNotification,
      UIApplication.protectedDataWillBecomeUnavailableNotification,
    ] {
      observers.append(
        NotificationCenter.default.addObserver(forName: event, object: nil, queue: .main) {
          [weak self] note in
          Task { @MainActor in
            guard let self else { return }
            if note.name == UIApplication.protectedDataWillBecomeUnavailableNotification
              || !self.systemWait
            {
              self.cancel()
            }
          }
        })
    }
  }
  func authority() throws {
    try Task.checkCancellation()
    try lifetime.check(
      active: UIApplication.shared.applicationState == .active,
      protected: UIApplication.shared.isProtectedDataAvailable)
  }
  func cancel() {
    lifetime.cancel()
    engine?.close()
    gate?.cancel()
    ui?.stop()
    cancelTask?()
    if let id = operationId { _ = try? engine?.journal.update(id) { $0.cancelled = true } }
  }
  func close() {
    lifetime.cancel()
    engine?.close()
    gate?.cancel()
    ui?.stop()
    ui?.dismiss(animated: false)
    ui = nil
    gate = nil
    cancelTask = nil
    observers.forEach(NotificationCenter.default.removeObserver)
    observers = []
  }
  func interface() async throws -> NativeWalletUI {
    try authority()
    if let ui { return ui }
    let screen = NativeWalletUI()
    screen.onCancel = { [weak self] in self?.cancel() }
    ui = screen
    await withCheckedContinuation { continuation in
      presenter.present(screen, animated: true) { continuation.resume() }
    }
    try authority()
    return screen
  }
  private func system<T>(_ action: () async throws -> T) async throws -> T {
    try authority()
    systemWait = true
    defer { systemWait = false }
    let value = try await action()
    // AuthenticationServices/document pickers can return just before didBecomeActive.
    let until = ProcessInfo.processInfo.systemUptime + 10
    while UIApplication.shared.applicationState != .active
      && ProcessInfo.processInfo.systemUptime < until
    {
      try Task.checkCancellation()
      try await Task.sleep(nanoseconds: 50_000_000)
    }
    try authority()
    return value
  }
  private func provider() async throws -> StoredPasskeyGate {
    let screen = try await interface()
    guard let window = screen.view.window else { throw WalletFailure.unavailable }
    let value = StoredPasskeyGate(window: window)
    gate = value
    return value
  }
  func authorize(
    _ credential: StoredCredential, walletId: String, purpose: String, recovery: Bool = false
  ) async throws -> Data? {
    let provider = try await provider()
    return try await system {
      try await provider.authorize(
        credential, walletId: walletId, purpose: purpose, recovery: recovery)
    }
  }
  func publicState() throws -> [String: Any] {
    let state = store.state()
    if state == "absent" || state == "recoveryRequired" { return ["status": state] }
    let record = try store.load()
    defer { record.close() }
    var result: [String: Any] = ["status": state, "walletId": record.id]
    if record.verified {
      result["accounts"] = try deriveAccountAddresses(entropy: record.entropy).enumerated().map {
        ["accountIndex": $0.offset, "address": $0.element, "chainId": 10143] as [String: Any]
      }
    }
    return result
  }
  func create() async throws -> [String: Any] {
    try require(!store.exists())
    let screen = try await interface()
    try await screen.confirm(
      "Create wallet",
      "Create a passkey and a wallet stored encrypted on this iPhone. Save and verify a backup before using the wallet. Recovery requires that file and this same passkey."
    )
    let provider = try await provider()
    let credential = try await system { try await provider.register() }
    let id = UUID().uuidString
    var proof = try await authorize(
      credential, walletId: id, purpose: "create-recovery-check:v1", recovery: true)
    proof?.wipe()
    try authority()
    var entropy = try randomBytes()
    defer { entropy.wipe() }
    let record = try WalletRecord(id: id, credential: credential, entropy: entropy)
    defer { record.close() }
    try require(try deriveAccountAddresses(entropy: entropy).count == 16)
    try store.create(record)
    return try publicState()
  }
  func open() async throws -> [String: Any] {
    let state = store.state()
    if ["absent", "recoveryRequired"].contains(state) { return ["status": state] }
    let record = try store.load()
    let id = record.id
    let credential = record.credential
    record.close()
    let screen = try await interface()
    try await screen.confirm(
      "Open wallet", "Confirm your passkey to open this wallet. This does not authorize transfers.")
    _ = try await authorize(credential, walletId: id, purpose: "open:v1")
    try authority()
    return try publicState()
  }
  private func readBackup(_ url: URL) throws -> Data {
    let access = url.startAccessingSecurityScopedResource()
    defer { if access { url.stopAccessingSecurityScopedResource() } }
    let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
    try require(size > 0 && size <= 65536)
    let data = try Data(contentsOf: url)
    try require(data.count <= 65536)
    return data
  }
  func backup() async throws -> [String: Any] {
    let record = try store.load()
    let id = record.id
    let credential = record.credential
    record.close()
    let screen = try await interface()
    try await screen.confirm(
      "Back up wallet",
      "Save an encrypted backup, then reopen it to verify recovery. Keep this file and access to the original passkey."
    )
    var prf = try await authorize(credential, walletId: id, purpose: "backup:v1", recovery: true)
    guard prf != nil else { throw WalletFailure.unavailable }
    let current = try store.load()
    let bytes: Data
    do {
      bytes = try StoredBackupCodec.encrypt(current, prf: prf!)
      current.close()
      prf?.wipe()
    } catch {
      current.close()
      prf?.wipe()
      throw error
    }
    let temporary = try store.files.url("backup-\(UUID().uuidString).json")
    defer { try? FileManager.default.removeItem(at: temporary) }
    try store.files.write(temporary.lastPathComponent, bytes: bytes)
    _ = try await system { try await screen.pick(exporting: temporary) }
    try await screen.confirm(
      "Verify saved backup",
      "Reopen the file you just saved. Verification needs the same passkey again.",
      action: "Choose saved file")
    let url = try await system { try await screen.pick() }
    let saved = try readBackup(url)
    var verification = try await authorize(
      credential, walletId: id, purpose: "backup-verify:v1", recovery: true)
    defer { verification?.wipe() }
    guard let verification else { throw WalletFailure.unavailable }
    let restored = try StoredBackupCodec.decrypt(saved, prf: verification)
    defer { restored.close() }
    let original = try store.load()
    defer { original.close() }
    try require(
      restored.id == original.id && restored.credential == original.credential
        && restored.entropy == original.entropy)
    try require(
      try deriveAccountAddresses(entropy: restored.entropy)
        == deriveAccountAddresses(entropy: original.entropy))
    try authority()
    original.verified = true
    try store.save(original)
    return try publicState()
  }
  func restore() async throws -> [String: Any] {
    try require(["absent", "recoveryRequired"].contains(store.state()))
    let screen = try await interface()
    try await screen.confirm(
      "Restore wallet",
      "Choose your encrypted Gizu backup and authorize with its original passkey. Local transaction history is not restored.",
      action: "Choose backup")
    let url = try await system { try await screen.pick() }
    let bytes = try readBackup(url)
    let credential = try StoredBackupCodec.credential(bytes)
    var prf = try await authorize(
      credential, walletId: "restore", purpose: "restore:v1", recovery: true)
    defer { prf?.wipe() }
    guard prf != nil else { throw WalletFailure.unavailable }
    let addresses: [String]
    do {
      let record = try StoredBackupCodec.decrypt(bytes, prf: prf!)
      defer { record.close() }
      addresses = try deriveAccountAddresses(entropy: record.entropy)
      prf?.wipe()
    } catch {
      prf?.wipe()
      throw error
    }
    try await screen.confirm(
      "Confirm recovery",
      "Restore Account 0:\n\(addresses[0])\n\nYour existing healthy wallet will never be overwritten.",
      action: "Restore wallet")
    var commitPrf = try await authorize(
      credential, walletId: "restore", purpose: "restore-commit:v1", recovery: true)
    defer { commitPrf?.wipe() }
    guard commitPrf != nil else { throw WalletFailure.unavailable }
    try authority()
    let recovered = try StoredBackupCodec.decrypt(bytes, prf: commitPrf!)
    defer { recovered.close() }
    try store.restore(recovered)
    return try publicState()
  }
  func journal() throws -> StoredOperationJournal {
    let record = try store.load()
    defer { record.close() }
    return try StoredOperationJournal(store: store, record: record)
  }
  func transfer(_ request: [String: Any]?, id: String? = nil, revision: Int? = nil) async throws
    -> [String: Any]
  {
    let journal = try journal()
    let engine = StoredTransferEngine(store: store, journal: journal)
    self.engine = engine
    let screen = try await interface()
    screen.show(
      "Preparing exact transfers…", "Checking fees and transaction status. Nothing has been signed."
    )
    let operation: StoredOperationRecord
    if let request {
      try await reconcile(journal, rpc: StoredMonadRPC())
      try authority()
      operation = try engine.create(request)
    } else {
      guard let id, let revision else { throw WalletFailure.invalid }
      operation = try journal.get(id)
      try require(operation.revision == revision)
    }
    operationId = operation.operationId
    let review = try await engine.prepare(operation.operationId, revision: operation.revision)
    try authority()
    try await screen.confirm("Review transfer", review.text, action: "Approve and unlock passkey")
    let record = try store.load()
    let credential = record.credential
    let walletId = record.id
    record.close()
    _ = try await authorize(
      credential, walletId: walletId,
      purpose:
        "transfer:v1:\(review.id):\(review.revision):\(digest(Data(review.text.utf8)).base64URL)")
    try authority()
    screen.show(
      "Submitting approved transfers…",
      "Cancellation stops remaining work; already submitted transactions cannot be undone.")
    try await engine.execute(review, authority: authority)
    engine.close()
    return try journal.get(operation.operationId).publicValue
  }
}
