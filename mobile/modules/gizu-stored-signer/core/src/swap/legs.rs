//! How many wallets a swap spreads over and how big each share is.
//!
//! A buy chooses from its USDC budget. A sell chooses from its estimated proceeds once the sale
//! is priced, from random bytes native code put in the plan. Native code supplies fresh random bytes; this module turns them into a plan. The choice is made
//! once before review, written into the plan and shown to the user, so a restore or retry never
//! rolls it again. The function is deterministic for given bytes, which keeps it testable.
use crate::SignerError;
use alloy_primitives::keccak256;

/// Weights add up to this many basis points, so a share is a whole number of 0.01%.
pub const WEIGHT_TOTAL: u32 = 10_000;
/// Every share stays within 70%..130% of an equal share: two wallets get 35%..65%.
const BAND_LOW_PERCENT: u32 = 70;
const BAND_HIGH_PERCENT: u32 = 130;
const USDC: u64 = 1_000_000;
/// Fewest random bytes a caller must provide.
const MIN_RANDOM: usize = 32;

#[derive(uniffi::Record, Debug, PartialEq, Eq)]
pub struct SwapLegChoice {
    pub count: u32,
    pub weights: Vec<u32>,
}

/// Neighbouring leg counts allowed for a USDC budget (upper bounds are inclusive, except the
/// first: a budget under 5 USDC stays in one wallet, so no share can fall under Aurora's
/// minimum deposit of 0.075 USDG and fail the whole operation).
fn buy_counts(budget_atoms: u64) -> &'static [u32] {
    match budget_atoms {
        b if b < 5 * USDC => &[1],
        b if b <= 20 * USDC => &[2],
        b if b <= 100 * USDC => &[2, 3],
        b if b <= 1_000 * USDC => &[3, 4],
        _ => &[4, 5],
    }
}

/// Deterministic stream of random numbers expanded from native-provided bytes.
struct Stream {
    seed: Vec<u8>,
    counter: u64,
}

impl Stream {
    fn new(random: &[u8]) -> Result<Self, SignerError> {
        if random.len() < MIN_RANDOM || random.len() > 1024 {
            return Err(SignerError::InvalidInput);
        }
        Ok(Self {
            seed: random.to_vec(),
            counter: 0,
        })
    }

    fn word(&mut self) -> u64 {
        let mut input = self.seed.clone();
        input.extend_from_slice(&self.counter.to_be_bytes());
        self.counter += 1;
        u64::from_be_bytes(keccak256(&input)[..8].try_into().expect("eight bytes"))
    }

    /// Uniform in `0..bound`; rejection sampling removes modulo bias.
    fn below(&mut self, bound: u64) -> u64 {
        debug_assert!(bound > 0);
        let limit = u64::MAX - u64::MAX % bound;
        loop {
            let value = self.word();
            if value < limit {
                return value % bound;
            }
        }
    }
}

/// `count` shares in basis points, each within the band around an equal share, summing exactly
/// to `WEIGHT_TOTAL`.
fn random_weights(count: u32, stream: &mut Stream) -> Vec<u32> {
    if count == 1 {
        return vec![WEIGHT_TOTAL];
    }
    let low = (WEIGHT_TOTAL * BAND_LOW_PERCENT).div_ceil(100 * count);
    let high = WEIGHT_TOTAL * BAND_HIGH_PERCENT / (100 * count);
    let mut weights: Vec<u32> = (0..count)
        .map(|_| low + stream.below(u64::from(high - low) + 1) as u32)
        .collect();
    // Independent draws rarely add up to the total: move the difference to shares with room.
    loop {
        let sum: u32 = weights.iter().sum();
        if sum == WEIGHT_TOTAL {
            return weights;
        }
        let grow = sum < WEIGHT_TOTAL;
        let room = |w: u32| if grow { high - w } else { w - low };
        let open: Vec<usize> = (0..weights.len())
            .filter(|i| room(weights[*i]) > 0)
            .collect();
        // Bounds contain the equal share, so a share with room always exists here.
        let pick = open[stream.below(open.len() as u64) as usize];
        let step = room(weights[pick]).min(sum.abs_diff(WEIGHT_TOTAL));
        if grow {
            weights[pick] += step;
        } else {
            weights[pick] -= step;
        }
    }
}

/// The budget (USDC atoms) picks the allowed counts, the random bytes pick one and the shares.
/// `cap` bounds the count to the wallets the caller reserved.
pub(crate) fn choose_for_budget(
    budget: u64,
    random: &[u8],
    cap: u32,
) -> Result<SwapLegChoice, SignerError> {
    if cap == 0 {
        return Err(SignerError::InvalidInput);
    }
    let mut stream = Stream::new(random)?;
    let counts = buy_counts(budget);
    let count = counts[stream.below(counts.len() as u64) as usize].min(cap);
    Ok(SwapLegChoice {
        count,
        weights: random_weights(count, &mut stream),
    })
}

/// A buy: the budget picks the allowed counts, the random bytes pick one and the shares.
#[uniffi::export]
pub fn choose_buy_legs(
    budget_atoms: String,
    random: Vec<u8>,
) -> Result<SwapLegChoice, SignerError> {
    let budget: u64 = budget_atoms
        .parse()
        .map_err(|_| SignerError::InvalidInput)?;
    if budget == 0 {
        return Err(SignerError::InvalidInput);
    }
    choose_for_budget(budget, &random, u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::super::engine::MAX_LEGS;
    use super::*;

    fn random(n: u64) -> Vec<u8> {
        keccak256(n.to_be_bytes()).to_vec()
    }

    #[test]
    fn budgets_pick_from_neighbouring_counts_and_edges_are_inclusive() {
        let counts = |usdc: u64| buy_counts(usdc * USDC);
        assert_eq!(counts(1), &[1]);
        assert_eq!(buy_counts(5 * USDC - 1), &[1]);
        assert_eq!(counts(5), &[2]);
        assert_eq!(counts(20), &[2]);
        assert_eq!(buy_counts(20 * USDC + 1), &[2, 3]);
        assert_eq!(counts(100), &[2, 3]);
        assert_eq!(buy_counts(100 * USDC + 1), &[3, 4]);
        assert_eq!(counts(1_000), &[3, 4]);
        assert_eq!(buy_counts(1_000 * USDC + 1), &[4, 5]);
        assert_eq!(counts(10_000), &[4, 5]);
        assert_eq!(counts(1_000_000), &[4, 5]);
    }

    #[test]
    fn every_choice_stays_in_its_tier_and_in_the_band() {
        for (usdc, allowed) in [
            (2u64, vec![1u32]),
            (4, vec![1]),
            (5, vec![2]),
            (20, vec![2]),
            (21, vec![2, 3]),
            (100, vec![2, 3]),
            (500, vec![3, 4]),
            (5_000, vec![4, 5]),
            (50_000, vec![4, 5]),
        ] {
            let mut seen = std::collections::HashSet::new();
            for n in 0..400 {
                let choice = choose_buy_legs((usdc * USDC).to_string(), random(n)).unwrap();
                assert!(
                    allowed.contains(&choice.count),
                    "{usdc} USDC -> {}",
                    choice.count
                );
                seen.insert(choice.count);
                assert_eq!(choice.weights.len() as u32, choice.count);
                assert_eq!(choice.weights.iter().sum::<u32>(), WEIGHT_TOTAL);
                let equal = f64::from(WEIGHT_TOTAL) / f64::from(choice.count);
                for w in &choice.weights {
                    let share = f64::from(*w);
                    assert!(
                        share >= equal * 0.7 - 1.0 && share <= equal * 1.3 + 1.0,
                        "{:?}",
                        choice.weights
                    );
                }
            }
            // Over many draws every allowed count really occurs.
            assert_eq!(
                seen.len(),
                allowed.len(),
                "{usdc} USDC only ever picked {seen:?}"
            );
        }
    }

    #[test]
    fn two_wallets_split_between_thirty_five_and_sixty_five_percent() {
        for n in 0..500 {
            let choice = choose_buy_legs("10000000".into(), random(n)).unwrap();
            assert_eq!(choice.count, 2);
            assert!(
                choice.weights.iter().all(|w| (3_500..=6_500).contains(w)),
                "{choice:?}"
            );
        }
    }

    #[test]
    fn a_small_budget_stays_in_one_wallet_with_the_whole_share() {
        for n in 0..50 {
            let choice = choose_buy_legs("4999999".into(), random(n)).unwrap();
            assert_eq!(
                choice,
                SwapLegChoice {
                    count: 1,
                    weights: vec![WEIGHT_TOTAL]
                }
            );
        }
    }

    #[test]
    fn shares_differ_between_swaps_and_are_not_round_numbers() {
        let all: std::collections::HashSet<Vec<u32>> = (0..200)
            .map(|n| random_weights(3, &mut Stream::new(&random(n)).unwrap()))
            .collect();
        assert!(all.len() > 150, "only {} distinct share sets", all.len());
        assert!(!all.contains(&vec![3_000, 3_000, 4_000]));
    }

    #[test]
    fn the_same_bytes_always_give_the_same_plan_and_other_bytes_differ() {
        let a = choose_buy_legs("50000000".into(), random(1)).unwrap();
        assert_eq!(a, choose_buy_legs("50000000".into(), random(1)).unwrap());
        assert_ne!(a, choose_buy_legs("50000000".into(), random(2)).unwrap());
    }

    #[test]
    fn one_wallet_takes_everything_and_each_count_adds_up() {
        let mut stream = Stream::new(&random(9)).unwrap();
        assert_eq!(random_weights(1, &mut stream), vec![WEIGHT_TOTAL]);
        for count in 2..=MAX_LEGS as u32 {
            let weights = random_weights(count, &mut stream);
            assert_eq!(weights.len() as u32, count);
            assert_eq!(weights.iter().sum::<u32>(), WEIGHT_TOTAL);
        }
    }

    #[test]
    fn bad_input_is_rejected() {
        assert!(choose_buy_legs("0".into(), random(1)).is_err());
        assert!(choose_buy_legs("-5".into(), random(1)).is_err());
        assert!(choose_buy_legs("abc".into(), random(1)).is_err());
        assert!(
            choose_buy_legs("1000000".into(), vec![1; 31]).is_err(),
            "too little randomness"
        );
        assert!(choose_buy_legs("1000000".into(), vec![0; 2_000]).is_err());
    }

    #[test]
    fn a_chosen_plan_is_accepted_by_the_engine_for_every_count() {
        for count in 2..=MAX_LEGS as u32 {
            let weights =
                random_weights(count, &mut Stream::new(&random(u64::from(count))).unwrap());
            let plan = serde_json::json!({
                "kind": "confidentialSwap",
                "target": "0x12f190a9F9d7D37a250758b26824B97CE941bF54",
                "amountAtoms": "2000000",
                "recipientIndices": (3..3 + count).collect::<Vec<_>>(),
                "weights": weights,
            });
            super::super::SwapOperation::start(
                plan.to_string(),
                vec![7; 32],
                "https://gateway.test".into(),
                1_790_300_000_000,
            )
            .unwrap();
        }
    }
}
