//! Native-only read authentication. No arbitrary messages or spending intents.
use crate::{SignerError, address};
use alloy_primitives::keccak256;
use base64::{Engine, engine::general_purpose::STANDARD};
use bip32::XPrv;
use bip39::{Language, Mnemonic};
use chrono::{DateTime, SecondsFormat};
use zeroize::Zeroizing;

#[derive(uniffi::Record)]
pub struct EarnReadAuthentication {
    pub payload: String,
    pub signature: String,
}
fn child(entropy: Vec<u8>, chain_id: u64, cycle_index: u32) -> Result<XPrv, SignerError> {
    let entropy = Zeroizing::new(entropy);
    if entropy.len() != 32 || ![1, 4663].contains(&chain_id) {
        return Err(SignerError::InvalidInput);
    }
    let mnemonic = Mnemonic::from_entropy_in(Language::English, &entropy)
        .map_err(|_| SignerError::CryptoFailed)?;
    let seed = Zeroizing::new(mnemonic.to_seed(""));
    drop(mnemonic);
    crate::earn_cycle_key(&seed, chain_id, cycle_index, 2)
}
#[uniffi::export]
pub fn derive_earn_confidential_address(
    entropy: Vec<u8>,
    chain_id: u64,
) -> Result<String, SignerError> {
    let key = child(entropy, chain_id, 0)?;
    Ok(address(key.private_key().verifying_key()))
}
/// FFI is private to native platform code. Expo exposes only the resulting balance.
/// This function constructs the payload itself and cannot sign a spending intent.
#[uniffi::export]
pub fn authenticate_earn_cycle_read(
    entropy: Vec<u8>,
    chain_id: u64,
    cycle_index: u32,
    salt: Vec<u8>,
    random: Vec<u8>,
    started_ms: u64,
    now_ms: u64,
) -> Result<EarnReadAuthentication, SignerError> {
    let key = child(entropy, chain_id, cycle_index)?;
    authenticate_read_key(key, salt, random, started_ms, now_ms)
}
/// Swap read authentication is permanently constrained to public account 2 (C).
/// No FFI parameter can change its signer, payload or empty intent list.
#[uniffi::export]
pub fn authenticate_swap_read(
    entropy: Vec<u8>,
    salt: Vec<u8>,
    random: Vec<u8>,
    started_ms: u64,
    now_ms: u64,
) -> Result<EarnReadAuthentication, SignerError> {
    let entropy = Zeroizing::new(entropy);
    if entropy.len() != 32 {
        return Err(SignerError::InvalidInput);
    }
    let mnemonic = Mnemonic::from_entropy_in(Language::English, &entropy)
        .map_err(|_| SignerError::CryptoFailed)?;
    let seed = Zeroizing::new(mnemonic.to_seed(""));
    drop(mnemonic);
    drop(entropy);
    let key = crate::roles::derive_key(&seed, 2)?;
    drop(seed);
    authenticate_read_key(key, salt, random, started_ms, now_ms)
}
fn authenticate_read_key(
    key: XPrv,
    salt: Vec<u8>,
    random: Vec<u8>,
    started_ms: u64,
    now_ms: u64,
) -> Result<EarnReadAuthentication, SignerError> {
    if salt.len() != 4 || random.len() != 7 || now_ms < started_ms || now_ms - started_ms > 60_000 {
        return Err(SignerError::InvalidInput);
    }
    let deadline_ms = started_ms
        .checked_add(300_000)
        .ok_or(SignerError::InvalidInput)?;
    let deadline_ns = deadline_ms
        .checked_mul(1_000_000)
        .ok_or(SignerError::InvalidInput)?;
    let started_ns = started_ms
        .checked_mul(1_000_000)
        .ok_or(SignerError::InvalidInput)?;
    let deadline = DateTime::from_timestamp_millis(
        i64::try_from(deadline_ms).map_err(|_| SignerError::InvalidInput)?,
    )
    .ok_or(SignerError::InvalidInput)?
    .to_rfc3339_opts(SecondsFormat::Millis, true);
    let signer = address(key.private_key().verifying_key()).to_lowercase();
    let mut nonce = [0u8; 32];
    nonce[..5].copy_from_slice(&[0x56, 0x28, 0xf6, 0xc6, 0]);
    nonce[5..9].copy_from_slice(&salt);
    nonce[9..17].copy_from_slice(&deadline_ns.to_le_bytes());
    nonce[17..25].copy_from_slice(&started_ns.to_le_bytes());
    nonce[25..].copy_from_slice(&random);
    let payload=serde_json::json!({"signer_id":signer,"verifying_contract":"intents.near","deadline":deadline,"nonce":STANDARD.encode(nonce),"intents":[]}).to_string();
    let digest = keccak256(format!(
        "\x19Ethereum Signed Message:\n{}{}",
        payload.len(),
        payload
    ));
    let (sig, recovery) = key.private_key().sign_prehash_recoverable(digest.as_ref());
    let mut bytes = sig.to_bytes().to_vec();
    bytes.push(recovery.to_byte());
    Ok(EarnReadAuthentication {
        payload,
        signature: format!("secp256k1:{}", bs58::encode(bytes).into_string()),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn auth_is_recoverable_distinct_and_only_authorizes_empty_read_intents() {
        let identity = derive_earn_confidential_address(vec![0; 32], 1).unwrap();
        assert!(
            !crate::derive_earn_addresses(vec![0; 32], 1)
                .unwrap()
                .contains(&identity)
        );
        assert!(
            !crate::derive_account_addresses(vec![0; 32])
                .unwrap()
                .contains(&identity)
        );
        assert_ne!(
            identity,
            derive_earn_confidential_address(vec![0; 32], 4663).unwrap()
        );
        assert_eq!(
            identity,
            derive_earn_confidential_address(vec![0; 32], 1).unwrap()
        );
        let result = authenticate_earn_read(
            vec![0; 32],
            1,
            vec![1, 2, 3, 4],
            vec![9; 7],
            1_000_000,
            1_000_001,
        )
        .unwrap();
        let message: serde_json::Value = serde_json::from_str(&result.payload).unwrap();
        assert_eq!(message["signer_id"], identity.to_lowercase());
        assert_eq!(message["verifying_contract"], "intents.near");
        assert_eq!(message["intents"], serde_json::json!([]));
        assert_eq!(message["deadline"], "1970-01-01T00:21:40.000Z");
        let nonce = STANDARD.decode(message["nonce"].as_str().unwrap()).unwrap();
        assert_eq!(nonce.len(), 32);
        assert_eq!(&nonce[..9], &[0x56, 0x28, 0xf6, 0xc6, 0, 1, 2, 3, 4]);
        assert_eq!(&nonce[9..17], &1_300_000_000_000u64.to_le_bytes());
        assert_eq!(&nonce[17..25], &1_000_000_000_000u64.to_le_bytes());
        let signature = bs58::decode(result.signature.strip_prefix("secp256k1:").unwrap())
            .into_vec()
            .unwrap();
        assert_eq!(signature.len(), 65);
        let digest = keccak256(format!(
            "\x19Ethereum Signed Message:\n{}{}",
            result.payload.len(),
            result.payload
        ));
        let sig = k256::ecdsa::Signature::try_from(&signature[..64]).unwrap();
        let recovery = k256::ecdsa::RecoveryId::try_from(signature[64]).unwrap();
        let key = k256::ecdsa::VerifyingKey::recover_from_prehash(digest.as_ref(), &sig, recovery)
            .unwrap();
        assert_eq!(address(&key), identity);
    }
    #[test]
    fn rejects_invalid_profiles_nonce_lengths_expired_and_future_auth() {
        for chain in [0, 143, 10143] {
            assert!(
                authenticate_earn_read(
                    vec![0; 32],
                    chain,
                    vec![0; 4],
                    vec![0; 7],
                    1_000_000,
                    1_000_000
                )
                .is_err()
            );
        }
        for len in [0, 3, 5] {
            assert!(
                authenticate_earn_read(
                    vec![0; 32],
                    1,
                    vec![0; len],
                    vec![0; 7],
                    1_000_000,
                    1_000_000
                )
                .is_err()
            );
        }
        assert!(
            authenticate_earn_read(vec![0; 32], 1, vec![0; 4], vec![0; 8], 1_000_000, 1_000_000)
                .is_err()
        );
        assert!(
            authenticate_earn_read(vec![0; 31], 1, vec![0; 4], vec![0; 7], 1_000_000, 1_000_000)
                .is_err()
        );
        for now in [999_999, 1_060_001, u64::MAX] {
            assert!(
                authenticate_earn_read(vec![0; 32], 1, vec![0; 4], vec![0; 7], 1_000_000, now)
                    .is_err()
            );
        }
    }
}

#[uniffi::export]
pub fn authenticate_earn_read(
    entropy: Vec<u8>,
    chain_id: u64,
    salt: Vec<u8>,
    random: Vec<u8>,
    started_ms: u64,
    now_ms: u64,
) -> Result<EarnReadAuthentication, SignerError> {
    authenticate_earn_cycle_read(entropy, chain_id, 0, salt, random, started_ms, now_ms)
}
#[cfg(test)]
mod cycle_read_tests {
    use super::*;
    #[test]
    fn read_authentication_uses_cycle_confidential_key_and_empty_intents() {
        let result = authenticate_earn_cycle_read(
            vec![0; 32],
            1,
            2,
            vec![1; 4],
            vec![2; 7],
            1000000,
            1000001,
        )
        .unwrap();
        let payload: serde_json::Value = serde_json::from_str(&result.payload).unwrap();
        let expected = crate::derive_earn_cycle_confidential_address(vec![0; 32], 1, 2).unwrap();
        assert_eq!(payload["signer_id"], expected.to_lowercase());
        assert_eq!(payload["intents"], serde_json::json!([]));
        let bytes = bs58::decode(result.signature.strip_prefix("secp256k1:").unwrap())
            .into_vec()
            .unwrap();
        let digest = keccak256(format!(
            "\x19Ethereum Signed Message:\n{}{}",
            result.payload.len(),
            result.payload
        ));
        let key = k256::ecdsa::VerifyingKey::recover_from_prehash(
            digest.as_ref(),
            &k256::ecdsa::Signature::from_slice(&bytes[..64]).unwrap(),
            k256::ecdsa::RecoveryId::from_byte(bytes[64]).unwrap(),
        )
        .unwrap();
        assert_eq!(address(&key), expected);
    }
}

#[cfg(test)]
mod swap_read_tests {
    use super::*;
    #[test]
    fn swap_auth_recovers_only_the_fixed_confidential_account_and_empty_intents() {
        let auth =
            authenticate_swap_read(vec![0; 32], vec![1; 4], vec![2; 7], 1_000_000, 1_000_001)
                .unwrap();
        let message: serde_json::Value = serde_json::from_str(&auth.payload).unwrap();
        let identity = crate::derive_account_addresses(vec![0; 32]).unwrap()[2].clone();
        assert_eq!(message["signer_id"], identity.to_lowercase());
        assert_eq!(message["intents"], serde_json::json!([]));
        assert_eq!(message["verifying_contract"], "intents.near");
        assert_eq!(message.as_object().unwrap().len(), 5);
        let bytes = bs58::decode(auth.signature.strip_prefix("secp256k1:").unwrap())
            .into_vec()
            .unwrap();
        let digest = keccak256(format!(
            "\x19Ethereum Signed Message:\n{}{}",
            auth.payload.len(),
            auth.payload
        ));
        let key = k256::ecdsa::VerifyingKey::recover_from_prehash(
            digest.as_ref(),
            &k256::ecdsa::Signature::from_slice(&bytes[..64]).unwrap(),
            k256::ecdsa::RecoveryId::from_byte(bytes[64]).unwrap(),
        )
        .unwrap();
        assert_eq!(address(&key), identity);
        let mut tampered = message.clone();
        tampered["signer_id"] = serde_json::Value::String(
            crate::derive_account_addresses(vec![0; 32]).unwrap()[0].to_lowercase(),
        );
        let text = tampered.to_string();
        let digest = keccak256(format!(
            "\x19Ethereum Signed Message:\n{}{}",
            text.len(),
            text
        ));
        let key = k256::ecdsa::VerifyingKey::recover_from_prehash(
            digest.as_ref(),
            &k256::ecdsa::Signature::from_slice(&bytes[..64]).unwrap(),
            k256::ecdsa::RecoveryId::from_byte(bytes[64]).unwrap(),
        )
        .unwrap();
        assert_ne!(address(&key), identity);
    }
    #[test]
    fn swap_auth_rejects_bad_entropy_nonce_bounds_and_arithmetic_overflow() {
        for entropy in [0, 16, 31, 33] {
            assert!(
                authenticate_swap_read(vec![0; entropy], vec![0; 4], vec![0; 7], 100, 100).is_err()
            );
        }
        for salt in [0, 3, 5] {
            assert!(
                authenticate_swap_read(vec![0; 32], vec![0; salt], vec![0; 7], 100, 100).is_err()
            );
        }
        for random in [0, 6, 8] {
            assert!(
                authenticate_swap_read(vec![0; 32], vec![0; 4], vec![0; random], 100, 100).is_err()
            );
        }
        for now in [99, 60_101, u64::MAX] {
            assert!(authenticate_swap_read(vec![0; 32], vec![0; 4], vec![0; 7], 100, now).is_err());
        }
        for started in [u64::MAX, (u64::MAX / 1_000_000) - 299_999] {
            assert!(
                authenticate_swap_read(vec![0; 32], vec![0; 4], vec![0; 7], started, started)
                    .is_err()
            );
        }
        assert!(authenticate_swap_read(vec![0; 32], vec![0; 4], vec![0; 7], 100, 60_100).is_ok());
    }
}
