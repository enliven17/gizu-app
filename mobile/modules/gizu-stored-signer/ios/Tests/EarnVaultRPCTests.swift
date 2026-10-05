import XCTest

@testable import GizuStoredSignerNative

private final class VaultStateRPC: StoredTransferRPC {
  var failure = ""
  let hash = "0x" + String(repeating: "11", count: 32)
  var pins: [[String: Any]] = []
  func call(_ method: String, _ params: [Any]) async throws -> Any {
    if method == "eth_getBlockByNumber" {
      return [
        "timestamp": failure == "stale" ? "0x1" : "0x3e8", "number": "0x64",
        "hash": failure == "reorg" && params[0] as? String != "latest"
          ? "0x" + String(repeating: "33", count: 32) : hash,
        "parentHash": "0x" + String(repeating: "22", count: 32), "baseFeePerGas": "0x1",
      ]
    }
    throw WalletFailure.invalid
  }
  func text(_ method: String, _ params: [Any]) async throws -> String {
    if method == "eth_chainId" { return failure == "chain" ? "0x8f" : "0x1" }
    if params.count > 1, let pin = params[1] as? [String: Any] { pins.append(pin) }
    switch method {
    case "eth_getTransactionCount": return "0x4"
    case "eth_getBalance": return failure == "quantity" ? "0x00" : "0x1"
    case "eth_getCode":
      return params[0] as? String == EarnValues.router && failure == "code" ? "0x" : "0x6000"
    case "eth_call":
      let query = params[0] as! [String: String]
      if query["data"] == "0x38d52e0f" {
        return "0x" + (try EarnValues.addressWord(EarnValues.usdc))
      }
      return "0x" + (try earnAmountWord(value: query["data"] == "0x313ce567" ? "6" : "1000000"))
    default: throw WalletFailure.invalid
    }
  }
}
final class EarnVaultRPCTests: XCTestCase {
  func testStateUsesPinnedReadsAndRejectsBadChainStaleBlockMissingCodeAndReorg() async throws {
    let rpc = VaultStateRPC()
    let loader = EarnVaultStateLoader(rpc: rpc, now: { 1000 })
    let state = try await loader.load(
      owner: EarnValues.router, kind: "vaultDeposit", amount: "1000000")
    XCTAssertEqual(state.chainId, 1)
    XCTAssertEqual(state.tokenDecimals, 6)
    XCTAssertEqual(state.usdcBalanceAtoms, "1000000")
    XCTAssertGreaterThan(rpc.pins.count, 10)
    XCTAssertTrue(
      rpc.pins.allSatisfy {
        $0["blockHash"] as? String == rpc.hash && $0["requireCanonical"] as? Bool == true
      })
    for failure in ["chain", "stale", "code", "quantity", "reorg"] {
      rpc.failure = failure
      do {
        _ = try await loader.load(owner: EarnValues.router, kind: "vaultDeposit", amount: "1000000")
        XCTFail(failure)
      } catch {}
    }
  }
  func testNullOnlyAcceptedForMissingTransactionsAndReceipts() async throws {
    let transport = NativeMainnetPortfolioRPC(
      network: .ethereum,
      post: { _ in
        try JSONSerialization.data(withJSONObject: [
          ["jsonrpc": "2.0", "id": 1, "result": NSNull()]
        ])
      })
    for method in ["eth_getTransactionReceipt", "eth_getTransactionByHash"] {
      let result = try await transport.calls([PortfolioRequest(method: method, params: [])])
      XCTAssertTrue(result[0] is NSNull)
    }
    do {
      _ = try await transport.calls([PortfolioRequest(method: "eth_getBalance", params: [])])
      XCTFail()
    } catch {}
  }
}
