import XCTest

@testable import GizuStoredSignerNative

final class MainnetPortfolioTests: WalletTestCase {
  func fixture() throws -> [String: Any] {
    let url = Bundle.module.url(
      forResource: "public-portfolio", withExtension: "json", subdirectory: "Fixtures")!
    return try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
  }

  func testBothPlatformBindingsUseIdenticalFinancialFixtures() async throws {
    let fixture = try fixture()
    let registry = fixture["registry"] as! String
    let accounts = try await MainnetPortfolio.accounts(
      entropy: Data(repeating: 0, count: 32), registry: registry)
    let expectedAccounts = fixture["accounts"] as! [[String: Any]]
    XCTAssertEqual(accounts.map(\.accountIndex), [0, 1, 3, 4, 5])
    XCTAssertEqual(accounts.map(\.address), expectedAccounts.map { $0["address"] as! String })
    for item in fixture["cases"] as! [[String: Any]] {
      let amounts = item["balances"] as! [Any]
      let observations = zip(accounts, amounts).map {
        PortfolioObservation(account: $0.0, balanceAtoms: $0.1 as? String)
      }
      let snapshot = try buildPublicPortfolio(
        walletId: "portfolio-fixture", registry: registry, observations: observations,
        state: PortfolioReadState(
          checkedAt: 1_790_000_000_000, block: "0x123", complete: item["complete"] as! Bool,
          stale: item["stale"] as! Bool, syncPending: item["syncPending"] as! Bool))
      var value = snapshot.publicValue
      value.removeValue(forKey: "history")
      XCTAssertEqual(
        value as NSDictionary, item["expected"] as! NSDictionary, item["name"] as! String)
    }
  }

  func testReadUsesOneCanonicalBlockAndNoSigningOrStorageWrites() async throws {
    let store = try storage()
    let record = try record(verified: true)
    defer { record.close() }
    try store.create(record)
    let before = try store.files.read("wallet.enc", limit: WalletLimits.walletRecordBytes)
    let rpc = FakePortfolioRPC()
    let snapshot = try await MainnetPortfolio(rpc: rpc, clock: { 123 }).read(store: store)
    XCTAssertEqual(snapshot["totalAtoms"] as? String, "14")
    XCTAssertEqual(snapshot["fundingAtoms"] as? String, "7")
    XCTAssertEqual(snapshot["returnAtoms"] as? String, "7")
    XCTAssertEqual(snapshot["balanceComplete"] as? Bool, true)
    XCTAssertEqual(
      try store.files.read("wallet.enc", limit: WalletLimits.walletRecordBytes), before)
  }

  func testAbsentUnverifiedAndCorruptWalletsNeverCreateReplacement() async throws {
    for mode in 0..<3 {
      let store = try storage()
      if mode > 0 {
        let record = try record()
        defer { record.close() }
        try store.create(record)
      }
      if mode == 2 { try store.files.write("wallet.enc", bytes: Data([0, 1])) }
      do {
        _ = try await MainnetPortfolio(rpc: FakePortfolioRPC()).read(store: store)
        XCTFail("unusable wallet accepted")
      } catch {}
      XCTAssertEqual(store.state(), ["absent", "backupRequired", "recoveryRequired"][mode])
    }
  }

  func testWrongChainMalformedBalanceReorgAndRPCFailureRejectWholeSnapshot() async throws {
    for failure in ["chain", "balance", "reorg", "rpc"] {
      let store = try storage()
      let record = try record(verified: true)
      defer { record.close() }
      try store.create(record)
      do {
        _ = try await MainnetPortfolio(rpc: FakePortfolioRPC(failure: failure)).read(store: store)
        XCTFail("accepted \(failure)")
      } catch {}
    }
  }

  func testCancellationStopsReads() async throws {
    let store = try storage()
    let record = try record(verified: true)
    defer { record.close() }
    try store.create(record)
    let task = Task {
      try await MainnetPortfolio(rpc: FakePortfolioRPC(failure: "wait")).read(store: store)
    }
    task.cancel()
    do {
      _ = try await task.value
      XCTFail("cancelled result published")
    } catch { XCTAssertTrue(error is CancellationError) }
  }

  func testMaximumRegistryUsesBoundedBatchesWithoutPartialResults() async throws {
    let registry = "{\"version\":1,\"nextRecipient\":8192}"
    let accounts = try await MainnetPortfolio.accounts(
      entropy: Data(repeating: 0, count: 32), registry: registry)
    let rpc = CountingPortfolioRPC()
    let result = try await MainnetPortfolio(rpc: rpc).read(
      walletId: "limit", registry: registry, accounts: accounts)
    XCTAssertEqual(result.accounts.count, 8191)
    XCTAssertEqual(result.totalAtoms, "57337")
    let (maximum, count) = await rpc.counts()
    XCTAssertLessThanOrEqual(maximum, 4)
    XCTAssertEqual(count, 8191)
  }

  func testRPCValidatesBatchIdentityAndRestoresRequestOrder() async throws {
    let requests = [
      PortfolioRequest(method: "eth_chainId", params: []),
      PortfolioRequest(method: "eth_blockNumber", params: []),
    ]
    let good: [[String: Any]] = [
      ["jsonrpc": "2.0", "id": 2, "result": "0x123"],
      ["jsonrpc": "2.0", "id": 1, "result": "0x8f"],
    ]
    let transport = NativeMainnetPortfolioRPC(post: { _ in
      try JSONSerialization.data(withJSONObject: good)
    })
    let result = try await transport.calls(requests)
    XCTAssertEqual(result as? [String], ["0x8f", "0x123"])
    var variants = [[good[0]], [good[0], good[0]]]
    for (key, value) in [
      ("id", true as Any), ("id", "1"), ("id", 1.5), ("id", 3), ("jsonrpc", "1.0"),
      ("error", ["code": -1]), ("result", NSNull()),
    ] {
      var rows = good
      rows[1][key] = value
      variants.append(rows)
    }
    for rows in variants {
      let rpc = NativeMainnetPortfolioRPC(post: { _ in
        try JSONSerialization.data(withJSONObject: rows)
      })
      do {
        _ = try await rpc.calls(requests)
        XCTFail("invalid batch accepted")
      } catch {}
    }
    let timedOut = NativeMainnetPortfolioRPC(post: { _ in throw URLError(.timedOut) })
    do {
      _ = try await timedOut.calls(requests)
      XCTFail("timeout accepted")
    } catch { XCTAssertEqual((error as? URLError)?.code, .timedOut) }
  }
}

private actor CountingPortfolioRPC: MainnetPortfolioRPC {
  var active = 0
  var maximum = 0
  var count = 0
  func counts() -> (Int, Int) { (maximum, count) }
  func calls(_ requests: [PortfolioRequest]) async throws -> [Any] {
    XCTAssertLessThanOrEqual(requests.count, 40)
    active += 1
    maximum = max(maximum, active)
    count += requests.filter { $0.method == "eth_call" }.count
    defer { active -= 1 }
    await Task.yield()
    return try await FakePortfolioRPC().calls(requests)
  }
}

private struct FakePortfolioRPC: MainnetPortfolioRPC {
  var failure = ""
  func calls(_ requests: [PortfolioRequest]) async throws -> [Any] {
    if failure == "wait" { try await Task.sleep(nanoseconds: 60_000_000_000) }
    if failure == "rpc" { throw URLError(.notConnectedToInternet) }
    return try requests.map { request in
      switch request.method {
      case "eth_chainId": return failure == "chain" ? "0x1" : "0x8f"
      case "eth_getBlockByNumber":
        let reorg = failure == "reorg" && request.params[0] as? String != "finalized"
        return ["number": "0x123", "hash": "0x" + String(repeating: reorg ? "b" : "a", count: 64)]
      case "eth_call":
        let selector = request.params[1] as! [String: Any]
        XCTAssertEqual(selector["blockHash"] as? String, "0x" + String(repeating: "a", count: 64))
        XCTAssertEqual(selector["requireCanonical"] as? Bool, true)
        XCTAssertEqual((request.params[0] as! [String: String])["to"], MainnetPortfolio.usdc)
        return failure == "balance" ? "0x7" : "0x" + String(repeating: "0", count: 63) + "7"
      default:
        XCTFail("Unexpected method \(request.method)")
        throw WalletFailure.invalid
      }
    }
  }
}
