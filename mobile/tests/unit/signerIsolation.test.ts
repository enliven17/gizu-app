import { requireOptionalNativeModule } from "expo";
import { getSignerCapabilities } from "@/services/wallet/nativeBridge";
import { getNativeSigner } from "@/development/legacySigner/nativeBridge";

jest.mock("expo", () => ({ requireOptionalNativeModule: jest.fn() }));
test("does not look up a legacy signer even when an old client could provide one", () => {
  jest.mocked(requireOptionalNativeModule).mockReturnValue({ openWallet: jest.fn() });
  expect(getNativeSigner()).toBeNull();
  expect(getSignerCapabilities().available).toBe(false);
  expect(requireOptionalNativeModule).not.toHaveBeenCalled();
});
