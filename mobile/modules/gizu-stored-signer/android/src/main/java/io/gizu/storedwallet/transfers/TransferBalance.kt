package io.gizu.storedwallet

import java.math.BigInteger

/**
 * Early funding guidance only; the Rust core still validates the complete quote before approval.
 */
internal fun requireTransferBalance(balance: String, values: List<String>, maxFee: String) {
  fun quantity(value: String): BigInteger {
    require(Regex("0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})").matches(value))
    return value.drop(2).toBigInteger(16)
  }
  val fee = quantity(maxFee).multiply(BigInteger.valueOf(21000))
  require(fee.signum() > 0 && values.isNotEmpty())
  val required = values.fold(BigInteger.ZERO) { total, value -> total + quantity(value) + fee }
  if (quantity(balance) < required) throw RpcFailure(RpcFailureCode.INSUFFICIENT_FUNDS)
}
