export type AccountPage =
  | "passkey-wallet"
  | "transaction-signing"
  | "alerts"
  | "currency"
  | "statements"
  | "contact-desk"
  | "terms";
type InformationPage = {
  title: string;
  body: string;
  rows: { label: string; value: string }[];
  actions?: string[];
};
export const informationPages: Partial<Record<AccountPage, InformationPage>> = {
  "passkey-wallet": {
    title: "Passkey wallet",
    body: "Passkey registration is not connected yet. No credential or recovery method has been created by this app.",
    rows: [
      { label: "Access method", value: "Passkey" },
      { label: "Credential", value: "Not connected" },
      { label: "Backup passkey", value: "Unavailable" },
      { label: "Guardian address", value: "Unavailable" },
    ],
    actions: ["Add backup passkey"],
  },
  "transaction-signing": {
    title: "Transaction signing",
    body: "Every order requires an explicit review and confirmation in the app. Device authentication and cryptographic signing are not connected yet. No biometric policy or spending cap is enforced.",
    rows: [
      { label: "Confirmation", value: "Every order" },
      { label: "Biometric verification", value: "Unavailable" },
      { label: "Daily cap", value: "Not configured" },
      { label: "Per order cap", value: "Not configured" },
      { label: "Cooldown", value: "Not configured" },
    ],
    actions: ["Change signing policy"],
  },
  "contact-desk": {
    title: "Contact desk",
    body: "Support channels are not connected yet. Messages and callback requests cannot be sent. Contact details and response hours will appear here once confirmed.",
    rows: [
      { label: "Secure message", value: "Unavailable" },
      { label: "Voice callback", value: "Unavailable" },
      { label: "Email", value: "Not configured" },
    ],
    actions: ["Start secure message", "Book callback"],
  },
  terms: {
    title: "Terms and disclosures",
    body: "Capital is at risk. Past performance does not indicate future results. Vaults may have lockups, fees and restricted redemption windows. Read the applicable documents before investing. Published legal documents are not available in this app yet.",
    rows: [],
    actions: ["Member agreement", "Risk disclosure", "Privacy policy", "Fee schedule"],
  },
};

export const nativeInformationPages: Partial<Record<AccountPage, InformationPage>> = {
  "passkey-wallet": {
    title: "Passkey wallet",
    body: "Your passkey opens your mainnet wallet. Funding and return accounts are shown separately. Wallet keys stay in the native signer. Local wallet access is not backend authentication.",
    rows: [
      { label: "Network", value: "Monad mainnet · 143" },
      { label: "Funding account", value: "1" },
      { label: "Recovery setup", value: "Unavailable" },
    ],
    actions: ["Add backup passkey"],
  },
  "transaction-signing": {
    title: "Transaction signing",
    body: "Signing requires a separate passkey unlock and native review of the approved operation. Swaps use native approval; direct withdrawals are not supported yet. A submitted operation cannot be undone.",
    rows: [
      { label: "Supported network", value: "Monad mainnet" },
      { label: "Direct withdrawals", value: "Not available" },
      { label: "Investment signing", value: "Unavailable" },
    ],
    actions: ["Change signing policy"],
  },
};

export const testnetInformationPages: Partial<Record<AccountPage, InformationPage>> = {
  "passkey-wallet": {
    title: "Passkey wallet",
    body: "Your passkey opens Account 0 on Monad testnet. Wallet keys stay in the native signer. Local wallet access is not backend authentication.",
    rows: [
      { label: "Network", value: "Monad testnet · 10143" },
      { label: "Account", value: "0" },
      { label: "Recovery setup", value: "Unavailable" },
    ],
    actions: ["Add backup passkey"],
  },
  "transaction-signing": {
    title: "Transaction signing",
    body: "Signing requires a separate passkey unlock and native review of the approved operation. Withdrawals send testnet MON; a submitted transfer cannot be undone.",
    rows: [
      { label: "Supported network", value: "Monad testnet" },
      { label: "Native transfer limit", value: "0.1 testnet MON per transfer" },
      { label: "Investment signing", value: "Unavailable" },
    ],
    actions: ["Change signing policy"],
  },
};
