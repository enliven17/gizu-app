//! Versioned role/index registry. Indices only move forward, so a stale backup cannot reuse a spent wallet.
use crate::{SignerError, address};
use bip32::{DerivationPath, XPrv};
use bip39::{Language, Mnemonic};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

pub const APP_ACCOUNT: u32 = 0;
pub const FUNDING_ACCOUNT: u32 = 1;
pub const CONFIDENTIAL_ACCOUNT: u32 = 2;
pub const FIRST_RECIPIENT: u32 = 3;
pub const RECIPIENTS_PER_SWAP: u32 = 3;
const REGISTRY_VERSION: u32 = 1;
const MAX_INDEX: u32 = 0x7fff_ffff;
const MAX_RANGE: u32 = 64;

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RoleRegistry {
    version: u32,
    next_recipient: u32,
}

impl RoleRegistry {
    fn parse(json: &str) -> Result<Self, SignerError> {
        if json.len() > 1024 {
            return Err(SignerError::InvalidInput);
        }
        let registry: Self = serde_json::from_str(json).map_err(|_| SignerError::InvalidInput)?;
        if registry.version != REGISTRY_VERSION
            || registry.next_recipient < FIRST_RECIPIENT
            || registry.next_recipient > MAX_INDEX
        {
            return Err(SignerError::InvalidInput);
        }
        Ok(registry)
    }
    fn json(self) -> String {
        serde_json::to_string(&self).expect("registry serializes")
    }
}

#[derive(uniffi::Record, Debug, PartialEq, Eq)]
pub struct RecipientAllocation {
    pub registry: String,
    pub indices: Vec<u32>,
}

#[uniffi::export]
pub fn role_registry_initial() -> String {
    RoleRegistry {
        version: REGISTRY_VERSION,
        next_recipient: FIRST_RECIPIENT,
    }
    .json()
}

/// Reserves fresh recipient indices. The caller must persist `registry` before using `indices`.
#[uniffi::export]
pub fn allocate_swap_recipients(registry: String) -> Result<RecipientAllocation, SignerError> {
    let mut parsed = RoleRegistry::parse(&registry)?;
    let start = parsed.next_recipient;
    let end = start
        .checked_add(RECIPIENTS_PER_SWAP)
        .filter(|end| *end <= MAX_INDEX)
        .ok_or(SignerError::InvalidInput)?;
    parsed.next_recipient = end;
    Ok(RecipientAllocation {
        registry: parsed.json(),
        indices: (start..end).collect(),
    })
}

/// Combines a local registry with a restored or scanned one; the higher allocation always wins.
#[uniffi::export]
pub fn merge_role_registries(local: String, other: String) -> Result<String, SignerError> {
    let a = RoleRegistry::parse(&local)?;
    let b = RoleRegistry::parse(&other)?;
    Ok(RoleRegistry {
        version: REGISTRY_VERSION,
        next_recipient: a.next_recipient.max(b.next_recipient),
    }
    .json())
}

/// Registry that covers every recipient index up to and including `highest_used`.
#[uniffi::export]
pub fn role_registry_covering(highest_used: u32) -> Result<String, SignerError> {
    if highest_used < FIRST_RECIPIENT {
        return Ok(role_registry_initial());
    }
    let next = highest_used
        .checked_add(1)
        .filter(|n| *n <= MAX_INDEX)
        .ok_or(SignerError::InvalidInput)?;
    Ok(RoleRegistry {
        version: REGISTRY_VERSION,
        next_recipient: next,
    }
    .json())
}

/// Single-use Earn withdrawal recipient. Persist registry before broadcasting.
#[uniffi::export]
pub fn allocate_earn_recipient(registry: String) -> Result<RecipientAllocation, SignerError> {
    let mut parsed = RoleRegistry::parse(&registry)?;
    let index = parsed.next_recipient;
    parsed.next_recipient = index
        .checked_add(1)
        .filter(|n| *n <= MAX_INDEX)
        .ok_or(SignerError::InvalidInput)?;
    Ok(RecipientAllocation {
        registry: parsed.json(),
        indices: vec![index],
    })
}
pub(crate) fn eligible_public_source(registry: &str, index: u32) -> Result<(), SignerError> {
    let parsed = RoleRegistry::parse(registry)?;
    if index == APP_ACCOUNT
        || index == FUNDING_ACCOUNT
        || (index >= FIRST_RECIPIENT && index < parsed.next_recipient)
    {
        Ok(())
    } else {
        Err(SignerError::InvalidInput)
    }
}
pub(crate) fn validate_public_source_index(index: u32) -> Result<(), SignerError> {
    if index == CONFIDENTIAL_ACCOUNT || index > MAX_INDEX {
        Err(SignerError::InvalidInput)
    } else {
        Ok(())
    }
}

pub(crate) fn seed_from_entropy(entropy: Vec<u8>) -> Result<Zeroizing<[u8; 64]>, SignerError> {
    let entropy = Zeroizing::new(entropy);
    if entropy.len() != 32 {
        return Err(SignerError::InvalidInput);
    }
    let mnemonic = Mnemonic::from_entropy_in(Language::English, &entropy)
        .map_err(|_| SignerError::CryptoFailed)?;
    Ok(Zeroizing::new(mnemonic.to_seed("")))
}

pub(crate) fn derive_key(seed: &[u8; 64], index: u32) -> Result<XPrv, SignerError> {
    if index > MAX_INDEX {
        return Err(SignerError::InvalidInput);
    }
    let path: DerivationPath = format!("m/44'/60'/0'/0/{index}")
        .parse()
        .map_err(|_| SignerError::InvalidInput)?;
    XPrv::derive_from_path(seed, &path).map_err(|_| SignerError::CryptoFailed)
}

/// Public addresses for `count` consecutive indices; used by restore scanning with a gap limit.
#[uniffi::export]
pub fn derive_account_address_range(
    entropy: Vec<u8>,
    start: u32,
    count: u32,
) -> Result<Vec<String>, SignerError> {
    if count == 0
        || count > MAX_RANGE
        || start
            .checked_add(count - 1)
            .is_none_or(|last| last > MAX_INDEX)
    {
        return Err(SignerError::InvalidInput);
    }
    let seed = seed_from_entropy(entropy)?;
    (start..start + count)
        .map(|index| {
            Ok(address(
                derive_key(&seed, index)?.private_key().verifying_key(),
            ))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allocation_moves_forward_and_never_reuses_indices() {
        let first = allocate_swap_recipients(role_registry_initial()).unwrap();
        assert_eq!(first.indices, vec![3, 4, 5]);
        let second = allocate_swap_recipients(first.registry.clone()).unwrap();
        assert_eq!(second.indices, vec![6, 7, 8]);
        let merged = merge_role_registries(second.registry.clone(), first.registry).unwrap();
        assert_eq!(merged, second.registry);
        assert_eq!(
            allocate_swap_recipients(merged).unwrap().indices,
            vec![9, 10, 11]
        );
    }

    #[test]
    fn rejects_registries_that_would_reset_or_overflow() {
        for bad in [
            r#"{"version":1,"nextRecipient":2}"#,
            r#"{"version":2,"nextRecipient":3}"#,
            r#"{"version":1,"nextRecipient":3,"extra":1}"#,
            r#"{"version":1,"nextRecipient":2147483646}"#,
        ] {
            assert!(allocate_swap_recipients(bad.into()).is_err(), "{bad}");
        }
    }

    #[test]
    fn covering_registry_starts_after_the_highest_used_index() {
        assert_eq!(role_registry_covering(0).unwrap(), role_registry_initial());
        assert_eq!(
            allocate_swap_recipients(role_registry_covering(20).unwrap())
                .unwrap()
                .indices,
            vec![21, 22, 23]
        );
    }

    #[test]
    fn range_derivation_matches_the_legacy_sixteen_accounts_and_extends_past_them() {
        let legacy = crate::derive_account_addresses(vec![0; 32]).unwrap();
        let range = derive_account_address_range(vec![0; 32], 0, 20).unwrap();
        assert_eq!(&range[..16], &legacy[..]);
        assert_eq!(range.len(), 20);
        assert_eq!(
            derive_account_address_range(vec![0; 32], 17, 1).unwrap()[0],
            range[17]
        );
        assert!(derive_account_address_range(vec![0; 32], 0, 65).is_err());
        assert!(derive_account_address_range(vec![0; 32], MAX_INDEX, 2).is_err());
    }

    #[test]
    fn earn_allocation_moves_swap_registry_forward_without_reuse() {
        let earn = allocate_earn_recipient(role_registry_initial()).unwrap();
        assert_eq!(earn.indices, vec![3]);
        let swap = allocate_swap_recipients(earn.registry).unwrap();
        assert_eq!(swap.indices, vec![4, 5, 6]);
        assert_eq!(
            allocate_earn_recipient(swap.registry).unwrap().indices,
            vec![7]
        );
    }
}
