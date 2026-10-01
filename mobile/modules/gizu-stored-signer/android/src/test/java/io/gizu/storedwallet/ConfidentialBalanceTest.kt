package io.gizu.storedwallet

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ConfidentialBalanceTest {
  private val address = "0x" + "1".repeat(40)

  private fun balance() =
    JSONObject()
      .put("confidentialAddress", address)
      .put("assetId", "nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx")
      .put("available", "1234567")
      .put("timestampMs", 1000000L)
      .put("authenticated", true)
      .put("operationScoped", false)

  @Test
  fun nativeReadReturnsOnlyValidatedPublicBalance() {
    assertEquals(
      "1234567",
      ConfidentialBalance.publicBalance(balance().toString(), address, 1000000)["available"],
    )
    for ((key, value) in
      listOf(
        "available" to "1e6",
        "available" to "-1",
        "available" to BigIntegerLimit,
        "confidentialAddress" to "0x" + "2".repeat(40),
        "authenticated" to false,
        "operationScoped" to true,
        "timestampMs" to 939999L,
      )) {
      assertThrows(IllegalStateException::class.java) {
        ConfidentialBalance.publicBalance(balance().put(key, value).toString(), address, 1000000)
      }
    }
  }

  @Test
  fun saltRequiresExactResponseAndFourHexBytes() {
    fun response(salt: String) =
      JSONObject()
        .put("jsonrpc", "2.0")
        .put("id", "earn-salt")
        .put("result", JSONObject().put("result", JSONArray(salt.toByteArray().map { it.toInt() })))
        .toString()
    assertArrayEquals(
      byteArrayOf(1, 2, 3, 4),
      ConfidentialBalance.parseSalt(response("\"01020304\"")),
    )
    for (bad in listOf("\"0000\"", "\"zzzzzzzz\"", "[1,2,3,4]")) assertThrows(
      Exception::class.java
    ) {
      ConfidentialBalance.parseSalt(response(bad))
    }
  }

  companion object {
    private val BigIntegerLimit = java.math.BigInteger.ONE.shiftLeft(256).toString()
  }
}
