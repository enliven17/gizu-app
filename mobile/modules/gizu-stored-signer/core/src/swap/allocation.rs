//! How many recipient wallets a swap uses, and how the amount is split between them.
//! Ported from a reviewed, standalone algorithm: an amount-tiered random wallet count, and a
//! uniform random composition (Floyd's algorithm) for the split, so neither the count nor the
//! per-wallet share deterministically leaks the swap size. This decides counts and proportions
//! only; wallet derivation is unchanged (`roles::allocate_swap_recipients`).
use super::evm;
use crate::SignerError;
use alloy_primitives::U256;
use rand::Rng;

/// One unit is $10 (10 USDC). At or below one unit (today's entire per-swap cap) there is not
/// enough to tier, so `recipient_count` uses a plain random choice of 1 or 2 instead.
const UNIT_ATOMS: u64 = 10_000_000;
/// Composition resolution for the split: shares are permille (out of 1000), reapplied to
/// whatever the real total turns out to be at estimate time and again at spend time.
const SHARE_TOTAL: u32 = 1000;
/// Headroom above the largest tier's `max_addresses` (20), so a future tier table still fits.
pub const MAX_RECIPIENTS: u32 = 32;

pub struct Tier {
    /// Inclusive upper bound in USDC atoms (6 decimals; 1 USDC is treated as ~$1).
    pub up_to_atoms: u64,
    pub min_addresses: u32,
    pub max_addresses: u32,
}

/// $100 / $1,000 / $10,000 / $30,000 / $60,000 / $100,000. Below the first tier's bound at
/// today's 10 USDC cap, `recipient_count` never reaches this table (see `UNIT_ATOMS`).
pub const DEFAULT_TIERS: [Tier; 6] = [
    Tier { up_to_atoms: 100_000_000, min_addresses: 2, max_addresses: 2 },
    Tier { up_to_atoms: 1_000_000_000, min_addresses: 2, max_addresses: 3 },
    Tier { up_to_atoms: 10_000_000_000, min_addresses: 3, max_addresses: 5 },
    Tier { up_to_atoms: 30_000_000_000, min_addresses: 5, max_addresses: 10 },
    Tier { up_to_atoms: 60_000_000_000, min_addresses: 8, max_addresses: 15 },
    Tier { up_to_atoms: 100_000_000_000, min_addresses: 12, max_addresses: 20 },
];

/// Decides how many recipient wallets a fresh buy or private-balance payout should use, from
/// the requested amount in USDC atoms (pass "0" when it is not yet known, e.g. a payout, which
/// spends whatever the private balance holds — that also falls into the plain 1-or-2 case).
#[uniffi::export]
pub fn plan_recipient_count(amount_atoms: String) -> Result<u32, SignerError> {
    Ok(recipient_count(evm::decimal(&amount_atoms)?))
}

fn tier_for(amount_atoms: U256) -> &'static Tier {
    DEFAULT_TIERS.iter().find(|t| amount_atoms <= U256::from(t.up_to_atoms)).unwrap_or_else(|| DEFAULT_TIERS.last().unwrap())
}

/// How many recipient wallets this swap should use. At or below $10 (every swap today, given
/// the 10 USDC cap) there is nothing to tier, so this is a plain random 1 or 2. Above $10, an
/// amount tier bounds a random count; the bound collapses to a fixed count when `units` cannot
/// fill the tier's range.
pub fn recipient_count(amount_atoms: U256) -> u32 {
    let unit = U256::from(UNIT_ATOMS);
    if amount_atoms <= unit {
        return rand::thread_rng().gen_range(1u32..=2);
    }
    let units = (amount_atoms / unit).min(U256::from(u64::from(u32::MAX))).to::<u32>();
    let tier = tier_for(amount_atoms);
    let max = tier.max_addresses.min(units).clamp(1, MAX_RECIPIENTS);
    let min = tier.min_addresses.min(max).max(1);
    if min >= max { max } else { rand::thread_rng().gen_range(min..=max) }
}

/// Uniformly samples an ordered composition of `total` into `count` positive parts (Floyd's
/// algorithm: distinct random cut points, no floating-point weights or modulo bias). `count`
/// must be at least 1 and at most `total`; both hold by construction wherever this is called.
fn floyd_composition(total: u32, count: u32) -> Vec<u32> {
    if count <= 1 {
        return vec![total];
    }
    let mut rng = rand::thread_rng();
    let mut cuts: Vec<u32> = Vec::with_capacity((count - 1) as usize);
    for j in (total - count + 1)..total {
        let candidate = rng.gen_range(1..=j);
        cuts.push(if cuts.contains(&candidate) { j } else { candidate });
    }
    cuts.sort_unstable();
    debug_assert_eq!(cuts.len(), (count - 1) as usize, "Floyd's algorithm always yields count-1 distinct cuts");
    let mut boundaries = Vec::with_capacity(count as usize + 1);
    boundaries.push(0);
    boundaries.extend(cuts);
    boundaries.push(total);
    boundaries.windows(2).map(|w| w[1] - w[0]).collect()
}

/// Per-wallet share bounds (permille), reviewed rule: with `count` wallets, no single wallet's
/// share strays far from a fair 1/`count` split. Defined for 2..=5 wallets, today's practical
/// range plus near-term headroom; other counts (1, or 6 and up) fall back to an unconstrained
/// uniform composition.
fn share_bounds(count: u32) -> Option<(u32, u32)> {
    match count {
        2 => Some((400, 600)),
        3 => Some((280, 360)),
        4 => Some((220, 280)),
        5 => Some((180, 220)),
        _ => None,
    }
}

/// Number of ways to write `s` as an ordered sum of `k` integers each in `[0, cap]` (bounded
/// stars-and-bars via inclusion-exclusion). A relative weight only — never large enough here to
/// need exact integers — so this returns a float and is safe from overflow at this module's scale.
fn bounded_compositions_count(s: i64, k: u32, cap: i64) -> f64 {
    if k == 0 {
        return if s == 0 { 1.0 } else { 0.0 };
    }
    if s < 0 {
        return 0.0;
    }
    let k = i64::from(k);
    let mut total = 0f64;
    let mut j = 0i64;
    loop {
        let reduced = s - j * (cap + 1);
        if reduced < 0 {
            break;
        }
        let sign = if j % 2 == 0 { 1.0 } else { -1.0 };
        total += sign * binom(k, j) * binom(reduced + k - 1, k - 1);
        j += 1;
    }
    total.max(0.0)
}

fn binom(n: i64, r: i64) -> f64 {
    if r < 0 || r > n {
        return 0.0;
    }
    let r = r.min(n - r);
    let mut result = 1.0f64;
    for i in 0..r {
        result *= (n - i) as f64 / (i + 1) as f64;
    }
    result
}

/// Uniform composition of `SHARE_TOTAL` into `count` parts, each within `[min, max]`. Rejection
/// sampling on an unconstrained draw is uniform over the feasible subset in principle, but its
/// acceptance rate collapses as the per-part window narrows (measured well under 1% for this
/// module's tighter tiers) — so instead this samples each part in turn, weighted by exactly how
/// many ways the remaining parts can still complete a feasible total. That weighting is the
/// standard way to sample uniformly from a combinatorially defined set, and it always succeeds
/// in one pass given a feasible `(min, max)` (this module's tests check every shipped bound is).
fn bounded_composition(count: u32, min: u32, max: u32) -> Vec<u32> {
    let cap = i64::from(max - min);
    let mut remaining_slack = i64::from(SHARE_TOTAL - count * min);
    let mut rng = rand::thread_rng();
    let mut shares = Vec::with_capacity(count as usize);
    for i in 0..count {
        let positions_left = count - i - 1;
        if positions_left == 0 {
            // Last slot takes whatever remains; feasibility guarantees it fits [0, cap].
            shares.push(remaining_slack);
            break;
        }
        let max_here = cap.min(remaining_slack).max(0);
        let weights: Vec<f64> = (0..=max_here).map(|v| bounded_compositions_count(remaining_slack - v, positions_left, cap)).collect();
        let total_weight: f64 = weights.iter().sum();
        let chosen = if total_weight <= 0.0 {
            // Unreachable for a feasible (min, max): every slack value here has a valid tail.
            0
        } else {
            let mut pick = rng.gen_range(0.0..total_weight);
            (0..=max_here).find(|&v| { let w = weights[v as usize]; if pick < w { true } else { pick -= w; false } }).unwrap_or(max_here)
        };
        shares.push(chosen);
        remaining_slack -= chosen;
    }
    shares.into_iter().map(|x| min + x as u32).collect()
}

/// A random permille (out of 1000) share for each of `count` recipients, decided once per
/// operation and reapplied to the real total at both estimate and spend time — the same way a
/// fixed 30/30/40 split was reapplied to two slightly different totals before this.
pub fn split_shares(count: u32) -> Vec<u32> {
    let count = count.clamp(1, SHARE_TOTAL);
    match share_bounds(count) {
        Some((min, max)) => bounded_composition(count, min, max),
        None => floyd_composition(SHARE_TOTAL, count),
    }
}

/// Turns permille shares into atom amounts for a real total. Any integer-division remainder
/// goes to the last recipient, so the parts always sum to exactly `total`.
pub fn apply_shares(total: U256, shares: &[u32]) -> Vec<U256> {
    if shares.is_empty() {
        return vec![total];
    }
    let scale = U256::from(SHARE_TOTAL);
    let mut parts: Vec<U256> = shares.iter().map(|&s| total * U256::from(s) / scale).collect();
    let allocated = parts.iter().fold(U256::ZERO, |sum, v| sum + *v);
    if let Some(last) = parts.last_mut() {
        *last += total - allocated;
    }
    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn at_or_below_ten_usdc_is_always_one_or_two() {
        for atoms in [0u64, 1, 500_000, 9_999_999, 10_000_000] {
            for _ in 0..50 {
                let n = recipient_count(U256::from(atoms));
                assert!(n == 1 || n == 2, "{atoms} atoms produced {n}");
            }
        }
    }

    #[test]
    fn above_ten_usdc_uses_the_tier_table() {
        // $50: one unit above $10 but under the first tier's $100 bound; tier max(2) vs units(5).
        let mut seen = std::collections::HashSet::new();
        for _ in 0..200 {
            seen.insert(recipient_count(U256::from(50_000_000u64)));
        }
        assert!(seen.iter().all(|n| *n == 2), "units=5 >= tier max=2, so count is always 2, got {seen:?}");

        // $100,000 (top tier, min 12 / max 20): count varies within that range.
        let mut top = std::collections::HashSet::new();
        for _ in 0..500 {
            let n = recipient_count(U256::from(100_000_000_000u64));
            assert!((12..=20).contains(&n), "top tier produced {n}");
            top.insert(n);
        }
        assert!(top.len() > 1, "expected some variation across 500 draws, got {top:?}");
    }

    #[test]
    fn shares_always_sum_to_the_real_total_at_any_count() {
        for count in 1..=20u32 {
            let shares = split_shares(count);
            assert_eq!(shares.len() as u32, count);
            assert_eq!(shares.iter().sum::<u32>(), SHARE_TOTAL);
            assert!(shares.iter().all(|&s| s > 0), "a zero share defeats the split");
            for total in [U256::from(1u64), U256::from(996_570u64), U256::from(10_000_000u64)] {
                let parts = apply_shares(total, &shares);
                assert_eq!(parts.len() as u32, count);
                assert_eq!(parts.iter().fold(U256::ZERO, |a, b| a + *b), total);
            }
        }
    }

    #[test]
    fn the_shipped_wallet_bounds_are_feasible() {
        for count in 2..=5u32 {
            let (min, max) = share_bounds(count).unwrap();
            assert!(min * count <= SHARE_TOTAL, "count={count}: {min} * {count} > {SHARE_TOTAL}");
            assert!(max * count >= SHARE_TOTAL, "count={count}: {max} * {count} < {SHARE_TOTAL}");
        }
    }

    #[test]
    fn splits_for_two_to_five_wallets_always_respect_the_per_wallet_bounds() {
        for count in 2..=5u32 {
            let (min, max) = share_bounds(count).unwrap();
            for _ in 0..300 {
                let shares = split_shares(count);
                assert_eq!(shares.len() as u32, count);
                assert_eq!(shares.iter().sum::<u32>(), SHARE_TOTAL);
                assert!(shares.iter().all(|&s| s >= min && s <= max), "{shares:?} outside [{min},{max}] for count={count}");
            }
        }
    }

    #[test]
    fn splits_for_two_to_five_wallets_show_real_variety_not_a_collapsed_equal_split() {
        // Regression: naive rejection sampling on a narrow window (N=4, N=5) collapsed to the
        // exact equal split almost every draw. A correct sampler must not repeat one composition.
        for count in 2..=5u32 {
            let mut distinct = std::collections::HashSet::new();
            for _ in 0..500 {
                distinct.insert(split_shares(count));
            }
            assert!(distinct.len() >= 20, "count={count}: only {} distinct compositions in 500 draws", distinct.len());
        }
    }

    #[test]
    fn counts_without_defined_bounds_still_split_to_the_full_total() {
        for count in [1u32, 6, 20] {
            let shares = split_shares(count);
            assert_eq!(shares.len() as u32, count);
            assert_eq!(shares.iter().sum::<u32>(), SHARE_TOTAL);
        }
    }

    #[test]
    fn a_single_recipient_gets_the_whole_amount() {
        assert_eq!(split_shares(1), vec![SHARE_TOTAL]);
        assert_eq!(apply_shares(U256::from(996_570u64), &[SHARE_TOTAL]), vec![U256::from(996_570u64)]);
    }
}
