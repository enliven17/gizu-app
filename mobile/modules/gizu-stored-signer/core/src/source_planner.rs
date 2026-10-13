//! Allocation accepts only native-derived observations; platform owns address attestation.
use crate::SignerError;
use alloy_primitives::{Address, U256};
use serde::{Deserialize, Serialize};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Source {
    source_index: u32,
    address: String,
    balance_atoms: String,
    reserved_atoms: String,
    funding_fee_atoms: String,
    execution_reserve_atoms: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Leg {
    source_index: u32,
    address: String,
    budget_atoms: String,
    amount_atoms: String,
    fee_atoms: String,
    reserve_atoms: String,
}
fn atoms(s: &str) -> Result<U256, SignerError> {
    if s.is_empty()
        || s.len() > 78
        || !s.bytes().all(|b| b.is_ascii_digit())
        || (s.len() > 1 && s.starts_with('0'))
    {
        return Err(SignerError::InvalidInput);
    }
    U256::from_str_radix(s, 10).map_err(|_| SignerError::InvalidInput)
}
#[uniffi::export]
pub fn plan_public_source_allocation(
    registry: String,
    requested_budget_atoms: String,
    sources_json: String,
) -> Result<String, SignerError> {
    allocate(registry, requested_budget_atoms, sources_json, U256::ZERO)
}

/// As above, but every leg must deliver at least `minimum_amount_atoms` after its fee and reserve.
/// A swap pays each funding leg out on its own, and Aurora refuses payouts under its bridge
/// minimum, so a leg that is too small would stop the whole swap. Larger sources are used first
/// so a budget needs as few legs as possible.
#[uniffi::export]
pub fn plan_public_source_allocation_with_minimum(
    registry: String,
    requested_budget_atoms: String,
    sources_json: String,
    minimum_amount_atoms: String,
) -> Result<String, SignerError> {
    let minimum = atoms(&minimum_amount_atoms)?;
    allocate(registry, requested_budget_atoms, sources_json, minimum)
}

fn allocate(
    registry: String,
    requested_budget_atoms: String,
    sources_json: String,
    minimum: U256,
) -> Result<String, SignerError> {
    // Every later leg keeps at least this much beyond its own fee and reserve.
    let floor = minimum.max(U256::from(1));
    if sources_json.len() > 131072 {
        return Err(SignerError::InvalidInput);
    }
    let requested = atoms(&requested_budget_atoms)?;
    if requested.is_zero() {
        return Err(SignerError::InvalidInput);
    }
    let sources: Vec<Source> =
        serde_json::from_str(&sources_json).map_err(|_| SignerError::InvalidInput)?;
    if sources.is_empty() || sources.len() > 256 {
        return Err(SignerError::InvalidInput);
    }
    let mut seen = std::collections::HashSet::new();
    let mut addresses = std::collections::HashSet::new();
    let mut available = Vec::new();
    for source in sources {
        crate::roles::eligible_public_source(&registry, source.source_index)?;
        let address = source
            .address
            .parse::<Address>()
            .map_err(|_| SignerError::InvalidInput)?;
        if !seen.insert(source.source_index) || !addresses.insert(address) {
            return Err(SignerError::InvalidInput);
        }
        let capacity = atoms(&source.balance_atoms)?
            .checked_sub(atoms(&source.reserved_atoms)?)
            .ok_or(SignerError::InvalidInput)?;
        let fee = atoms(&source.funding_fee_atoms)?;
        let reserve = atoms(&source.execution_reserve_atoms)?;
        let overhead = fee.checked_add(reserve).ok_or(SignerError::InvalidInput)?;
        if capacity > overhead && capacity - overhead >= minimum {
            available.push((source, capacity, fee, reserve, overhead));
        }
    }
    available.sort_by_key(|s| s.0.source_index);
    if !minimum.is_zero() {
        // Fewest legs: the largest sources first, the account index only breaks ties.
        available.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.source_index.cmp(&b.0.source_index)));
    }
    let chosen = available
        .iter()
        .enumerate()
        .filter(|(_, s)| s.1 >= requested && requested > s.4 && requested - s.4 >= minimum)
        .min_by_key(|(_, s)| (s.2, s.0.source_index))
        .map(|(i, _)| i);
    let selected: Vec<_> = if let Some(i) = chosen {
        vec![&available[i]]
    } else {
        let mut capacity = U256::ZERO;
        let mut overhead = U256::ZERO;
        let mut selected = Vec::new();
        for s in &available {
            capacity = capacity.checked_add(s.1).ok_or(SignerError::InvalidInput)?;
            overhead = overhead
                .checked_add(s.4)
                .and_then(|v| v.checked_add(floor))
                .ok_or(SignerError::InvalidInput)?;
            selected.push(s);
            if capacity >= requested {
                break;
            }
        }
        if capacity < requested || overhead > requested {
            return Err(SignerError::InvalidInput);
        }
        selected
    };
    let mut remaining = requested;
    let mut total_amount = U256::ZERO;
    let mut total_fee = U256::ZERO;
    let mut total_reserve = U256::ZERO;
    let mut legs = Vec::new();
    for (i, s) in selected.iter().enumerate() {
        let tail_min = selected[i + 1..]
            .iter()
            .try_fold(U256::ZERO, |sum, t| {
                sum.checked_add(t.4)?.checked_add(floor)
            })
            .ok_or(SignerError::InvalidInput)?;
        let budget = s.1.min(
            remaining
                .checked_sub(tail_min)
                .ok_or(SignerError::InvalidInput)?,
        );
        let amount = budget
            .checked_sub(s.4)
            .filter(|a| !a.is_zero() && *a >= minimum)
            .ok_or(SignerError::InvalidInput)?;
        remaining = remaining
            .checked_sub(budget)
            .ok_or(SignerError::InvalidInput)?;
        total_amount = total_amount
            .checked_add(amount)
            .ok_or(SignerError::InvalidInput)?;
        total_fee = total_fee
            .checked_add(s.2)
            .ok_or(SignerError::InvalidInput)?;
        total_reserve = total_reserve
            .checked_add(s.3)
            .ok_or(SignerError::InvalidInput)?;
        legs.push(Leg {
            source_index: s.0.source_index,
            address: s.0.address.clone(),
            budget_atoms: budget.to_string(),
            amount_atoms: amount.to_string(),
            fee_atoms: s.2.to_string(),
            reserve_atoms: s.3.to_string(),
        });
    }
    if !remaining.is_zero() {
        return Err(SignerError::InvalidInput);
    }
    Ok(serde_json::json!({"requestedBudgetAtoms":requested.to_string(),"totalAmountAtoms":total_amount.to_string(),"totalFeeAtoms":total_fee.to_string(),"totalReserveAtoms":total_reserve.to_string(),"legs":legs}).to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    fn source(index: u32, balance: &str, fee: &str, reserve: &str) -> Value {
        json!({"sourceIndex":index,"address":format!("0x{index:040x}"),"balanceAtoms":balance,"reservedAtoms":"0","fundingFeeAtoms":fee,"executionReserveAtoms":reserve})
    }
    fn plan(budget: &str, sources: Vec<Value>) -> Result<Value, SignerError> {
        plan_public_source_allocation(
            crate::role_registry_covering(5).unwrap(),
            budget.into(),
            json!(sources).to_string(),
        )
        .map(|s| serde_json::from_str(&s).unwrap())
    }
    #[test]
    fn single_capable_source_avoids_multiple_fees_and_uses_fee_then_index() {
        let p = plan(
            "10",
            vec![
                source(0, "7", "1", "1"),
                source(1, "20", "2", "1"),
                source(3, "20", "1", "1"),
            ],
        )
        .unwrap();
        assert_eq!(p["legs"].as_array().unwrap().len(), 1);
        assert_eq!(p["legs"][0]["sourceIndex"], 3);
        assert_eq!(p["legs"][0]["budgetAtoms"], "10");
        assert_eq!(p["totalAmountAtoms"], "8");
        assert_eq!(p["totalFeeAtoms"], "1");
        assert_eq!(p["totalReserveAtoms"], "1");
    }
    #[test]
    fn multi_source_uses_exact_budget_and_native_reservations() {
        let mut a = source(0, "9", "1", "1");
        a["reservedAtoms"] = json!("2");
        let p = plan("10", vec![source(1, "8", "1", "1"), a]).unwrap();
        assert_eq!(p["legs"][0]["budgetAtoms"], "7");
        assert_eq!(p["legs"][1]["budgetAtoms"], "3");
        assert_eq!(p["requestedBudgetAtoms"], "10");
        assert_eq!(p["totalAmountAtoms"], "6");
        assert_eq!(p["totalFeeAtoms"], "2");
        assert_eq!(p["totalReserveAtoms"], "2");
    }
    #[test]
    fn insufficiency_duplicate_and_ineligible_sources_are_rejected() {
        assert!(
            plan(
                "20",
                vec![source(0, "7", "1", "1"), source(1, "8", "1", "1")]
            )
            .is_err()
        );
        assert!(plan("2", vec![source(0, "7", "1", "1")]).is_err());
        for index in [2, 6, u32::MAX] {
            assert!(plan("4", vec![source(index, "7", "1", "1")]).is_err());
        }
        assert!(
            plan(
                "4",
                vec![source(0, "7", "1", "1"), source(0, "8", "1", "1")]
            )
            .is_err()
        );
        assert!(plan("0", vec![source(0, "7", "1", "1")]).is_err());
    }
    fn plan_min(budget: &str, minimum: &str, sources: Vec<Value>) -> Result<Value, SignerError> {
        plan_public_source_allocation_with_minimum(
            crate::role_registry_covering(9).unwrap(),
            budget.into(),
            json!(sources).to_string(),
            minimum.into(),
        )
        .map(|s| serde_json::from_str(&s).unwrap())
    }
    fn amounts(p: &Value) -> Vec<(u64, u64)> {
        p["legs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|l| {
                (
                    l["sourceIndex"].as_u64().unwrap(),
                    l["amountAtoms"].as_str().unwrap().parse().unwrap(),
                )
            })
            .collect()
    }
    #[test]
    fn a_minimum_never_leaves_a_leg_too_small_to_pay_out() {
        // The mainnet case: a small account first by index used to become a 0.077 USDC leg.
        let p = plan_min(
            "2150000",
            "300000",
            vec![
                source(0, "80000", "3000", "0"),
                source(1, "1700000", "3000", "0"),
                source(3, "500000", "3000", "0"),
            ],
        )
        .unwrap();
        // The 0.08 account is skipped; the two larger ones cover 2.15 with real legs.
        assert_eq!(amounts(&p), vec![(1, 1_697_000), (3, 447_000)]);
        assert!(
            plan_min(
                "2250000",
                "300000",
                vec![
                    source(0, "80000", "3000", "0"),
                    source(1, "1700000", "3000", "0"),
                    source(3, "500000", "3000", "0"),
                ],
            )
            .is_err(),
            "only a too-small account could cover the rest"
        );
        let p = plan_min(
            "2000000",
            "300000",
            vec![
                source(0, "80000", "3000", "0"),
                source(1, "1700000", "3000", "0"),
                source(3, "500000", "3000", "0"),
            ],
        )
        .unwrap();
        // The 0.08 account is skipped and the larger one is used first.
        assert_eq!(amounts(&p)[0].0, 1);
        assert!(
            amounts(&p).iter().all(|(i, a)| *i != 0 && *a >= 300_000),
            "{p}"
        );
        assert_eq!(p["requestedBudgetAtoms"], "2000000");
    }
    #[test]
    fn a_minimum_moves_value_off_the_big_leg_so_the_last_one_is_large_enough() {
        // Greedy filling would leave 0.05 for the second account; the floor reserves 0.3.
        let p = plan_min(
            "2050000",
            "300000",
            vec![
                source(4, "2000000", "3000", "0"),
                source(5, "900000", "3000", "0"),
            ],
        )
        .unwrap();
        let legs = amounts(&p);
        assert_eq!(legs.len(), 2);
        assert!(legs.iter().all(|(_, a)| *a >= 300_000), "{legs:?}");
    }
    #[test]
    fn a_single_source_still_wins_and_must_clear_the_minimum() {
        let p = plan_min(
            "1000000",
            "300000",
            vec![
                source(0, "5000000", "3000", "0"),
                source(1, "2000000", "3000", "0"),
            ],
        )
        .unwrap();
        assert_eq!(amounts(&p).len(), 1);
        assert!(plan_min("200000", "300000", vec![source(0, "5000000", "3000", "0")]).is_err());
    }
    #[test]
    fn without_a_minimum_the_original_allocation_is_unchanged() {
        let sources = vec![source(1, "8", "1", "1"), source(0, "9", "1", "1")];
        assert_eq!(
            plan("10", sources.clone()).unwrap(),
            plan_public_source_allocation_with_minimum(
                crate::role_registry_covering(5).unwrap(),
                "10".into(),
                json!(sources).to_string(),
                "0".into(),
            )
            .map(|s| serde_json::from_str::<Value>(&s).unwrap())
            .unwrap()
        );
    }
    #[test]
    fn allocation_avoids_a_last_leg_that_cannot_pay_its_fee() {
        let p = plan(
            "8",
            vec![source(0, "7", "1", "1"), source(1, "7", "1", "1")],
        )
        .unwrap();
        assert_eq!(p["legs"][0]["budgetAtoms"], "5");
        assert_eq!(p["legs"][1]["budgetAtoms"], "3");
        assert_eq!(p["totalAmountAtoms"], "4");
    }
}
