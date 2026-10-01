import ExpoModulesCore
import UIKit

public final class GizuStoredSignerModule: Module {
  @MainActor private static var occupied = false
  @MainActor private var ceremony: WalletCeremony?
  @MainActor private var task: Task<Void, Never>?
  private static var supported: Bool { WalletBuildPolicy.isAvailable() }

  private func run(
    _ promise: Promise, operation: StaticString, timeout: UInt64 = 120_000_000_000,
    action: @escaping @MainActor (WalletCeremony) async throws -> Any
  ) {
    Task { @MainActor in
      let diagnostics = WalletDiagnostics(operation: operation)
      diagnostics.mark("presenter-check")
      guard Self.supported, #available(iOS 18.0, *),
        let presenter = self.appContext?.utilities?.currentViewController(),
        presenter.view.window != nil
      else {
        diagnostics.failed(WalletFailure.unavailable)
        promise.reject("UNAVAILABLE", "iOS wallet unavailable in this build.")
        return
      }

      diagnostics.mark("occupancy-check")
      guard !Self.occupied else {
        diagnostics.failed(WalletFailure.busy)
        promise.reject("BUSY", "A native wallet operation is already in progress.")
        return
      }

      Self.occupied = true
      self.task = Task { @MainActor in
        var timeoutTask: Task<Void, Never>?
        var timedOut = false
        defer {
          diagnostics.mark("cleanup")
          timeoutTask?.cancel()
          self.ceremony?.close()
          self.ceremony = nil
          self.task = nil
          Self.occupied = false
          diagnostics.event("released")
        }

        do {
          diagnostics.mark("storage-initialization")
          let scope = try WalletCeremony(presenter: presenter, diagnostics: diagnostics)
          self.ceremony = scope
          scope.cancelTask = { [weak self] in self?.task?.cancel() }
          timeoutTask = Task { @MainActor [weak scope] in
            do {
              try await Task.sleep(nanoseconds: timeout)
              timedOut = true
              diagnostics.event("timeout")
              scope?.cancel()
            } catch {}
          }

          try scope.checkAuthorization()
          let result = try await action(scope)
          try scope.checkAuthorization()
          diagnostics.mark("resolve")
          promise.resolve(result)
        } catch WalletFailure.insufficientBalance {
          diagnostics.failed(WalletFailure.insufficientBalance)
          promise.reject(
            "INSUFFICIENT_BALANCE",
            "Not enough testnet MON for the transfer amount and maximum network fees.")
        } catch {
          diagnostics.failed(error)
          promise.reject(
            timedOut ? "WALLET_TIMEOUT" : WalletDiagnostics.bridgeCode(error),
            "Wallet operation stopped, expired or failed. Check wallet state and refresh transfer status before retrying. No existing wallet is replaced automatically."
          )
        }
      }
    }
  }
  public func definition() -> ModuleDefinition {
    Name("GizuStoredSigner")
    AsyncFunction("getCapabilities") { () -> [String: Any] in
      [
        "contractVersion": 1, "available": Self.supported, "walletStorage": Self.supported,
        "backup": Self.supported, "transfers": Self.supported, "swaps": Self.supported,
      ]
    }

    AsyncFunction("getWalletState") { (promise: Promise) in
      self.run(promise, operation: "getWalletState") { try $0.publicState() }
    }

    AsyncFunction("createWallet") { (promise: Promise) in
      self.run(promise, operation: "createWallet") { try await $0.create() }
    }

    AsyncFunction("openWallet") { (promise: Promise) in
      self.run(promise, operation: "openWallet") { try await $0.open() }
    }
    AsyncFunction("backupWallet") { (promise: Promise) in
      self.run(promise, operation: "backupWallet") { try await $0.backup() }
    }

    AsyncFunction("restoreWallet") { (promise: Promise) in
      self.run(promise, operation: "restoreWallet") { try await $0.restore() }
    }

    AsyncFunction("executeOperation") { (proposal: [String: Any], promise: Promise) in
      self.run(promise, operation: "executeOperation") { try await $0.transfer(proposal) }
    }

    AsyncFunction("listOperations") { (promise: Promise) in
      self.run(promise, operation: "listOperations") { scope in
        let journal = try scope.journal()
        try await reconcile(journal, rpc: StoredMonadRPC())
        return try journal.all().map(\.publicValue)
      }
    }

    AsyncFunction("getOperationStatus") { (id: String, promise: Promise) in
      self.run(promise, operation: "getOperationStatus") { scope in
        let journal = try scope.journal()
        try await reconcile(journal, rpc: StoredMonadRPC())
        return try journal.get(id).publicValue
      }
    }

    AsyncFunction("resumeOperation") { (id: String, revision: Int, promise: Promise) in
      self.run(promise, operation: "resumeOperation") {
        try await $0.transfer(nil, id: id, revision: revision)
      }
    }

    AsyncFunction("cancelOperation") { (id: String, promise: Promise) in
      Task { @MainActor in
        if self.ceremony?.operationId == id {
          self.ceremony?.cancel()
          await self.task?.value
        }

        self.run(promise, operation: "cancelOperation") { scope in
          try scope.journal().update(id) { $0.cancelled = true }.publicValue
        }
      }
    }

    AsyncFunction("getSwapDeposit") { (promise: Promise) in
      self.run(promise, operation: "getSwapDeposit") { try $0.swapDeposit() }
    }
    AsyncFunction("startSwap") {
      (target: String, amountAtoms: String, gateway: String, promise: Promise) in
      self.run(promise, operation: "startSwap", timeout: 900_000_000_000) {
        try await $0.startSwap(
          target: target, amountAtoms: amountAtoms.isEmpty ? nil : amountAtoms, gateway: gateway)
      }
    }
    AsyncFunction("startSell") { (gateway: String, promise: Promise) in
      self.run(promise, operation: "startSell", timeout: 900_000_000_000) {
        try await $0.startSell(gateway: gateway)
      }
    }
    AsyncFunction("resumeSwap") { (gateway: String, promise: Promise) in
      self.run(promise, operation: "resumeSwap", timeout: 900_000_000_000) {
        try await $0.resumeSwap(gateway: gateway)
      }
    }
    AsyncFunction("getSwapStatus") { (gateway: String, promise: Promise) in
      self.run(promise, operation: "getSwapStatus") { try $0.swapStatus(gateway: gateway) }
    }
    AsyncFunction("cancelSwap") { (gateway: String, promise: Promise) in
      self.run(promise, operation: "cancelSwap") { try $0.cancelSwap(gateway: gateway) }
    }
    Function("lock") {
      Task { @MainActor in
        self.task?.cancel()
        self.ceremony?.cancel()
      }
    }

    OnDestroy {
      Task { @MainActor in
        self.task?.cancel()
        self.ceremony?.cancel()
      }
    }
  }
}
