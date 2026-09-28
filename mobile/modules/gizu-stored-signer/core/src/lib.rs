//! Native-private entropy derivation and transaction policy. Never export secrets to JS.
use alloy_primitives::{Address, keccak256};
use bip32::{DerivationPath, XPrv};
use bip39::{Language, Mnemonic};
use k256::ecdsa::VerifyingKey;
use zeroize::Zeroizing;
uniffi::setup_scaffolding!();

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum SignerError {
    #[error("Invalid native input")]
    InvalidInput,
    #[error("Native cryptographic check failed")]
    CryptoFailed,
    #[error("Native operation expired")]
    Expired,
}
fn address(key: &VerifyingKey) -> String {
    let point = key.to_sec1_point(false);
    Address::from_slice(&keccak256(&point.as_bytes()[1..])[12..]).to_checksum(None)
}
#[uniffi::export]
pub fn derive_wallet_address(entropy: Vec<u8>) -> Result<String, SignerError> {
    derive_account_addresses(entropy).map(|mut accounts| accounts.remove(0))
}
/// Consumes native-owned random entropy, not passkey PRF. Returns public data only.
#[uniffi::export]
pub fn derive_account_addresses(entropy: Vec<u8>) -> Result<Vec<String>, SignerError> {
    let entropy = Zeroizing::new(entropy);
    if entropy.len() != 32 {
        return Err(SignerError::InvalidInput);
    }
    let mnemonic = Mnemonic::from_entropy_in(Language::English, &entropy)
        .map_err(|_| SignerError::CryptoFailed)?;
    let seed = Zeroizing::new(mnemonic.to_seed(""));
    drop(mnemonic);
    drop(entropy);
    (0..16)
        .map(|i| {
            let path: DerivationPath = format!("m/44'/60'/0'/0/{i}")
                .parse()
                .map_err(|_| SignerError::InvalidInput)?;
            let child = XPrv::derive_from_path(seed.as_ref(), &path)
                .map_err(|_| SignerError::CryptoFailed)?;
            Ok(address(child.private_key().verifying_key()))
        })
        .collect()
}
mod transfers;
pub use transfers::*;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn entropy_is_deterministic_and_accounts_are_distinct() {
        let a = derive_account_addresses(vec![0; 32]).unwrap();
        assert_eq!(a.len(), 16);
        assert_eq!(a[0], "0xF278cF59F82eDcf871d630F28EcC8056f25C1cdb");
        assert_eq!(a, derive_account_addresses(vec![0; 32]).unwrap());
        assert_ne!(a, derive_account_addresses(vec![1; 32]).unwrap());
        assert_eq!(a.iter().collect::<std::collections::HashSet<_>>().len(), 16);
    }
    #[test]
    fn rejects_wrong_entropy_lengths() {
        for n in [0, 16, 31, 33, 64] {
            assert!(derive_account_addresses(vec![0; n]).is_err());
        }
    }
}
