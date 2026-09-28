import Foundation
import XCTest

@testable import GizuStoredSignerNative

final class TransferProposalTests: XCTestCase {
  func testBridgeNumbersAcceptExactIntegersAndRejectBooleansFractionsAndOutOfRangeValues() throws {
    XCTAssertEqual(try TransferProposal.exactInteger(0.0, range: 0...15), 0)
    XCTAssertEqual(try TransferProposal.exactInteger(15, range: 0...15), 15)
    for value: Any in [true, -1, 16, 1.5, Double.infinity, Double.nan, "1"] {
      XCTAssertThrowsError(try TransferProposal.exactInteger(value, range: 0...15))
    }
  }

  func testTransferStatesPreserveExistingJournalStrings() throws {
    let statuses: [TransferStepStatus] = [
      .planned, .signed, .pending, .unknown, .finalized, .reverted,
    ]
    let expected = ["planned", "signed", "pending", "unknown", "finalized", "reverted"]
    for (status, text) in zip(statuses, expected) {
      let bytes = Data("\"\(text)\"".utf8)
      XCTAssertEqual(try JSONDecoder().decode(TransferStepStatus.self, from: bytes), status)
      XCTAssertEqual(try JSONEncoder().encode(status), bytes)
    }
  }
}
