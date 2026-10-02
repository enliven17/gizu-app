package io.gizu.storedwallet

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WalletBuildPolicyTest {
  @Test
  fun supportedDevicesCanUseTheWalletInThisBuildVariant() {
    for (sdk in listOf(28, 35, 36)) {
      assertTrue(WalletBuildPolicy.isAvailable(sdk, true))
    }
  }

  @Test
  fun unsupportedDevicesAndMissingScreensRemainUnavailable() {
    assertFalse(WalletBuildPolicy.isAvailable(27, true))
    assertFalse(WalletBuildPolicy.isAvailable(35, false))
  }
}
