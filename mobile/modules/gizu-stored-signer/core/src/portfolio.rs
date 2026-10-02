//! Public Monad USDC observations only. No authorization or signing side effects.
use crate::{SignerError, address, roles};
use alloy_primitives::{Address, U256};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioAccount {
    pub account_index: u32,
    pub address: String,
}

#[derive(Clone, Debug, uniffi::Record, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioObservation {
    pub account: PortfolioAccount,
    /// None means unknown, never zero. Used by Android's incremental cache.
    pub balance_atoms: Option<String>,
}

#[derive(Debug, uniffi::Record, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioAccountBalance {
    pub account_index: u32,
    pub address: String,
    pub role: String,
    pub balance_atoms: String,
}

#[derive(Debug, uniffi::Record, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicPortfolioSnapshot {
    pub wallet_id: String,
    pub chain_id: u64,
    pub asset: String,
    pub decimals: u32,
    pub funding_address: String,
    pub funding_atoms: String,
    pub return_atoms: String,
    pub total_atoms: String,
    pub checked_at: u64,
    pub block: String,
    pub balance_complete: bool,
    pub stale: bool,
    pub sync_pending: bool,
    pub accounts: Vec<PortfolioAccountBalance>,
}

#[uniffi::export]
pub fn portfolio_account_indices(registry: String) -> Result<Vec<u32>, SignerError> {
    let end = roles::RoleRegistry::parse(&registry)?.next_recipient;
    if end > 8192 {
        return Err(SignerError::InvalidInput);
    }
    Ok([0, 1].into_iter().chain(3..end).collect())
}

/// Bounded native work permits cancellation between batches and avoids one seed derivation
/// per address. Offset addresses the selected list, not the BIP32 child index.
#[uniffi::export]
pub fn derive_portfolio_accounts(
    entropy: Vec<u8>,
    registry: String,
    offset: u32,
    count: u32,
) -> Result<Vec<PortfolioAccount>, SignerError> {
    let seed = roles::seed_from_entropy(entropy)?;
    let indices = portfolio_account_indices(registry)?;
    let end = offset.checked_add(count).ok_or(SignerError::InvalidInput)?;
    if count == 0 || count > 64 || end as usize > indices.len() {
        return Err(SignerError::InvalidInput);
    }
    indices[offset as usize..end as usize]
        .iter()
        .map(|&index| {
            Ok(PortfolioAccount {
                account_index: index,
                address: address(
                    roles::derive_key(&seed, index)?
                        .private_key()
                        .verifying_key(),
                ),
            })
        })
        .collect()
}

/// ERC-20 ABI uint256 is exactly 32 bytes; JSON-RPC quantities are a different encoding.
#[uniffi::export]
pub fn decode_portfolio_balance(value: String) -> Result<String, SignerError> {
    if value.len() != 66
        || !value.starts_with("0x")
        || !value[2..].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(SignerError::InvalidInput);
    }
    Ok(U256::from_str_radix(&value[2..], 16)
        .map_err(|_| SignerError::InvalidInput)?
        .to_string())
}

fn atoms(value: &str) -> Result<U256, SignerError> {
    if value.is_empty()
        || value.len() > 78
        || !value.bytes().all(|b| b.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return Err(SignerError::InvalidInput);
    }
    U256::from_str_radix(value, 10).map_err(|_| SignerError::InvalidInput)
}

#[derive(Debug, uniffi::Record)]
pub struct PortfolioReadState {
    pub checked_at: u64,
    pub block: String,
    pub complete: bool,
    pub stale: bool,
    pub sync_pending: bool,
}

#[uniffi::export]
pub fn build_public_portfolio(
    wallet_id: String,
    registry: String,
    observations: Vec<PortfolioObservation>,
    state: PortfolioReadState,
) -> Result<PublicPortfolioSnapshot, SignerError> {
    let PortfolioReadState {
        checked_at,
        block,
        complete,
        stale,
        sync_pending,
    } = state;
    let indices = portfolio_account_indices(registry)?;
    if wallet_id.is_empty()
        || wallet_id.len() > 128
        || checked_at > 9_007_199_254_740_991
        || observations.len() != indices.len()
        || !block.starts_with("0x")
        || block.len() < 3
        || block.len() > 66
        || !block[2..].bytes().all(|b| b.is_ascii_hexdigit())
        || (block.len() > 3 && block.as_bytes()[2] == b'0')
        || (!complete && (!stale || !sync_pending))
        || (complete && sync_pending)
    {
        return Err(SignerError::InvalidInput);
    }
    let mut seen = HashSet::new();
    let mut total = U256::ZERO;
    let mut funding = U256::ZERO;
    let mut funding_address = String::new();
    let mut accounts = Vec::new();
    for (index, observation) in indices.into_iter().zip(observations) {
        let account = observation.account;
        if account.address.len() != 42 || !account.address.starts_with("0x") {
            return Err(SignerError::InvalidInput);
        }
        let parsed = account
            .address
            .parse::<Address>()
            .map_err(|_| SignerError::InvalidInput)?;
        if index != account.account_index || !seen.insert(parsed) {
            return Err(SignerError::InvalidInput);
        }
        if index == 1 {
            funding_address = account.address.clone();
        }
        let Some(value) = observation.balance_atoms else {
            if complete {
                return Err(SignerError::InvalidInput);
            }
            continue;
        };
        let balance = atoms(&value)?;
        total = total
            .checked_add(balance)
            .ok_or(SignerError::InvalidInput)?;
        if index == 1 {
            funding = balance;
        }
        if index <= 1 || balance != U256::ZERO {
            accounts.push(PortfolioAccountBalance {
                account_index: index,
                address: account.address,
                // Preserve Android wire semantics: account 0 contributes to returnAtoms,
                // but remains an app/funding account, not a receiving address.
                role: if index <= 1 { "funding" } else { "receiving" }.into(),
                balance_atoms: value,
            });
        }
    }
    Ok(PublicPortfolioSnapshot {
        wallet_id,
        chain_id: 143,
        asset: "USDC".into(),
        decimals: 6,
        funding_address,
        funding_atoms: funding.to_string(),
        return_atoms: (total - funding).to_string(),
        total_atoms: total.to_string(),
        checked_at,
        block,
        balance_complete: complete,
        stale,
        sync_pending,
        accounts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> serde_json::Value {
        serde_json::from_str(include_str!(
            "../../ios/Tests/Fixtures/public-portfolio.json"
        ))
        .unwrap()
    }
    fn observations(f: &serde_json::Value, case: &serde_json::Value) -> Vec<PortfolioObservation> {
        let accounts: Vec<PortfolioAccount> =
            serde_json::from_value(f["accounts"].clone()).unwrap();
        accounts
            .into_iter()
            .zip(case["balances"].as_array().unwrap())
            .map(|(account, amount)| PortfolioObservation {
                account,
                balance_atoms: amount.as_str().map(str::to_owned),
            })
            .collect()
    }
    fn snapshot(
        f: &serde_json::Value,
        rows: Vec<PortfolioObservation>,
        complete: bool,
    ) -> Result<PublicPortfolioSnapshot, SignerError> {
        build_public_portfolio(
            "portfolio-fixture".into(),
            f["registry"].as_str().unwrap().into(),
            rows,
            PortfolioReadState {
                checked_at: 1790000000000,
                block: "0x123".into(),
                complete,
                stale: !complete,
                sync_pending: !complete,
            },
        )
    }
    #[test]
    fn shared_financial_fixtures() {
        let f = fixture();
        let registry = f["registry"].as_str().unwrap().to_owned();
        let accounts = derive_portfolio_accounts(vec![0; 32], registry.clone(), 0, 5).unwrap();
        assert_eq!(serde_json::to_value(accounts).unwrap(), f["accounts"]);
        for case in f["cases"].as_array().unwrap() {
            let result = build_public_portfolio(
                "portfolio-fixture".into(),
                registry.clone(),
                observations(&f, case),
                PortfolioReadState {
                    checked_at: 1790000000000,
                    block: "0x123".into(),
                    complete: case["complete"].as_bool().unwrap(),
                    stale: case["stale"].as_bool().unwrap(),
                    sync_pending: case["syncPending"].as_bool().unwrap(),
                },
            )
            .unwrap();
            assert_eq!(
                serde_json::to_value(result).unwrap(),
                case["expected"],
                "{}",
                case["name"]
            );
        }
    }
    #[test]
    fn rejects_invalid_registry_and_out_of_range_derivation() {
        for registry in [
            "{}",
            r#"{"version":2,"nextRecipient":6}"#,
            r#"{"version":1,"nextRecipient":2}"#,
            r#"{"version":1,"nextRecipient":8193}"#,
        ] {
            assert!(portfolio_account_indices(registry.into()).is_err());
        }
        let registry = r#"{"version":1,"nextRecipient":8192}"#.to_owned();
        let indices = portfolio_account_indices(registry.clone()).unwrap();
        assert_eq!(indices.len(), 8191);
        assert!(!indices.contains(&2));
        assert_eq!(indices.last(), Some(&8191));
        for (offset, count) in [(8191, 1), (0, 65), (0, 0), (u32::MAX, 2)] {
            assert!(
                derive_portfolio_accounts(vec![0; 32], registry.clone(), offset, count).is_err()
            );
        }
    }
    #[test]
    fn rejects_missing_duplicate_and_unallocated_accounts_and_overflow() {
        let f = fixture();
        let rows = observations(&f, &f["cases"][0]);
        let mut invalid = rows.clone();
        invalid[0].balance_atoms = None;
        assert!(snapshot(&f, invalid, true).is_err());
        for address in ["bad".into(), rows[0].account.address[2..].to_owned()] {
            let mut invalid = rows.clone();
            invalid[0].account.address = address;
            assert!(snapshot(&f, invalid, true).is_err());
        }
        for index in [2, 6] {
            let mut invalid = rows.clone();
            invalid[2].account.account_index = index;
            assert!(snapshot(&f, invalid, true).is_err());
        }
        let mut invalid = rows.clone();
        invalid[1].account.address = invalid[0].account.address.clone();
        assert!(snapshot(&f, invalid, true).is_err());
        for amount in ["-1", "01", "1.5", "", "1e6"] {
            let mut invalid = rows.clone();
            invalid[0].balance_atoms = Some(amount.into());
            assert!(snapshot(&f, invalid, true).is_err());
        }
        let mut invalid = rows;
        invalid[0].balance_atoms = Some(U256::MAX.to_string());
        invalid[1].balance_atoms = Some("1".into());
        assert!(snapshot(&f, invalid, true).is_err());
    }
    #[test]
    fn abi_balance_is_exact_uint256() {
        assert_eq!(
            decode_portfolio_balance(format!("0x{:064x}", U256::MAX)).unwrap(),
            U256::MAX.to_string()
        );
        assert_eq!(
            decode_portfolio_balance(format!("0x{:064x}", 9007199254740993u64)).unwrap(),
            "9007199254740993"
        );
        for value in [
            "0x0".into(),
            "0x".into(),
            format!("0x{}", "g".repeat(64)),
            format!("0x1{}", "0".repeat(64)),
        ] {
            assert!(decode_portfolio_balance(value).is_err());
        }
    }
}
