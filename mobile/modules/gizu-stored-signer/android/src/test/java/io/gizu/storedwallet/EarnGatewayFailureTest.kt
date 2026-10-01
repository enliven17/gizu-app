package io.gizu.storedwallet

import org.junit.Assert.*
import org.junit.Test

class EarnGatewayFailureTest {
  @Test
  fun knownGatewayFailureIsSpecificAndDoesNotExposeProviderText() {
    val failure =
      safeEarnGatewayFailure(
        "{\"code\":\"EARN_AURORA_FEE_UNQUALIFIED\",\"message\":\"secret-key-and-provider-url\"}"
      )
    assertNotNull(failure)
    assertEquals("EARN_AURORA_FEE_UNQUALIFIED", failure!!.code)
    assertFalse(failure.message!!.contains("secret"))
  }

  @Test
  fun unknownMalformedAndOversizedErrorsAreNotForwarded() {
    for (body in listOf("{\"code\":\"ATTACKER\"}", "not-json", "x".repeat(4097))) assertNull(
      safeEarnGatewayFailure(body)
    )
  }
}
