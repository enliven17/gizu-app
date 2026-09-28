//! Native-private operation object. Never expose this FFI object through Expo.
use crate::{SignerError, address};
use alloy_consensus::{SignableTransaction, TxEip1559};
use alloy_primitives::{Address, Signature, TxKind, U256, keccak256};
use bip32::{DerivationPath, XPrv};
use bip39::{Language, Mnemonic};
use serde::Deserialize;
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

const PER_TRANSFER: u128 = 100_000_000_000_000_000;
const TOTAL_VALUE: u128 = 1_000_000_000_000_000_000;
const TOTAL_FEE: u128 = 100_000_000_000_000_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Proposal {
    kind: String,
    chain_id: u64,
    transfers: Vec<Transfer>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Transfer {
    account_index: u32,
    to: String,
    value_wei: String,
    expected_from: Option<String>,
}

fn parse(proposal: &str) -> Result<Proposal, SignerError> {
    if proposal.len() > 65536 {
        return Err(SignerError::InvalidInput);
    }
    let p: Proposal = serde_json::from_str(proposal).map_err(|_| SignerError::InvalidInput)?;
    if p.kind != "nativeTransfers"
        || p.chain_id != 10143
        || p.transfers.is_empty()
        || p.transfers.len() > 32
    {
        return Err(SignerError::InvalidInput);
    }
    let mut total = 0u128;
    for t in &p.transfers {
        if let Some(expected) = &t.expected_from
            && (expected.len() != 42
                || !expected.starts_with("0x")
                || expected.parse::<Address>().is_err())
        {
            return Err(SignerError::InvalidInput);
        }
        let value = decimal(&t.value_wei)?;
        if t.account_index > 15 || value == 0 || value > PER_TRANSFER {
            return Err(SignerError::InvalidInput);
        }
        total = total.checked_add(value).ok_or(SignerError::InvalidInput)?;
        if total > TOTAL_VALUE {
            return Err(SignerError::InvalidInput);
        }
        if t.to.len() != 42 || !t.to.starts_with("0x") {
            return Err(SignerError::InvalidInput);
        }
        let to: Address = t.to.parse().map_err(|_| SignerError::InvalidInput)?;
        // Exclude zero, protocol precompiles and reserved low addresses, even if code is empty.
        if to.as_slice()[..18].iter().all(|b| *b == 0) {
            return Err(SignerError::InvalidInput);
        }
    }
    Ok(p)
}
fn decimal(s: &str) -> Result<u128, SignerError> {
    if s.is_empty()
        || s.len() > 39
        || (s.len() > 1 && s.starts_with('0'))
        || !s.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(SignerError::InvalidInput);
    }
    s.parse().map_err(|_| SignerError::InvalidInput)
}
fn hex(s: &str) -> Result<u128, SignerError> {
    let digits = s.strip_prefix("0x").ok_or(SignerError::InvalidInput)?;
    if digits.is_empty()
        || digits.len() > 32
        || (digits.len() > 1 && digits.starts_with('0'))
        || !digits.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(SignerError::InvalidInput);
    }
    u128::from_str_radix(digits, 16).map_err(|_| SignerError::InvalidInput)
}
fn mon(value: u128) -> String {
    format!("{}.{:018} MON", value / TOTAL_VALUE, value % TOTAL_VALUE)
}

#[uniffi::export]
pub fn validate_transfer_proposal(proposal: String) -> Result<(), SignerError> {
    parse(&proposal).map(|_| ())
}

#[derive(Clone, uniffi::Record)]
pub struct TransferIntent {
    pub account_index: u32,
    pub from: String,
    pub to: String,
    pub value_hex: String,
}
#[derive(uniffi::Record)]
pub struct TransferQuote {
    pub chain_id: String,
    pub nonce: String,
    pub gas: String,
    pub max_fee: String,
    pub priority_fee: String,
    pub balance: String,
    pub recipient_code: String,
    pub sender_code: String,
}
#[derive(uniffi::Record)]
pub struct NativeSignedTransfer {
    // Private native-to-native ONLY. Never resolve this record to Expo/JS.
    pub raw_transaction: String,
    pub transaction_hash: String,
    pub intent_hash: String,
    pub from: String,
    pub nonce: String,
}
struct Prepared {
    tx: TxEip1559,
    index: u32,
    from: String,
}
struct State {
    seed: Option<Zeroizing<[u8; 64]>>,
    intents: Vec<TransferIntent>,
    prepared: Vec<Prepared>,
    started: Instant,
    approved: bool,
    next: usize,
    review: Option<String>,
}
impl State {
    fn live(&mut self) -> Result<(), SignerError> {
        if self.started.elapsed() >= Duration::from_secs(120) {
            self.seed = None;
            return Err(SignerError::Expired);
        }
        if self.seed.is_none() {
            return Err(SignerError::InvalidInput);
        }
        Ok(())
    }
}
#[derive(uniffi::Object)]
pub struct TransferOperation {
    state: Mutex<State>,
}

#[uniffi::export]
impl TransferOperation {
    #[uniffi::constructor]
    pub fn new(proposal: String, entropy: Vec<u8>) -> Result<Arc<Self>, SignerError> {
        let entropy = Zeroizing::new(entropy);
        let p = parse(&proposal)?;
        if entropy.len() != 32 {
            return Err(SignerError::InvalidInput);
        }
        let mnemonic = Mnemonic::from_entropy_in(Language::English, &entropy)
            .map_err(|_| SignerError::CryptoFailed)?;
        let seed = Zeroizing::new(mnemonic.to_seed(""));
        drop(mnemonic);
        drop(entropy);
        let mut intents = Vec::new();
        for t in p.transfers {
            let key = derive(&seed, t.account_index)?;
            let from = address(key.private_key().verifying_key());
            if t.expected_from
                .as_ref()
                .is_some_and(|expected| !expected.eq_ignore_ascii_case(&from))
            {
                return Err(SignerError::InvalidInput);
            }
            intents.push(TransferIntent {
                account_index: t.account_index,
                from,
                to: t
                    .to
                    .parse::<Address>()
                    .map_err(|_| SignerError::InvalidInput)?
                    .to_checksum(None),
                value_hex: format!("0x{:x}", decimal(&t.value_wei)?),
            });
        }
        Ok(Arc::new(Self {
            state: Mutex::new(State {
                seed: Some(seed),
                intents,
                prepared: vec![],
                started: Instant::now(),
                approved: false,
                next: 0,
                review: None,
            }),
        }))
    }
    pub fn intents(&self) -> Result<Vec<TransferIntent>, SignerError> {
        let mut s = self.state.lock().map_err(|_| SignerError::CryptoFailed)?;
        s.live()?;
        Ok(s.intents.clone())
    }
    pub fn prepare(&self, quotes: Vec<TransferQuote>) -> Result<String, SignerError> {
        let mut s = self.state.lock().map_err(|_| SignerError::CryptoFailed)?;
        s.live()?;
        if s.review.is_some() || quotes.len() != s.intents.len() {
            return Err(SignerError::InvalidInput);
        }
        let mut next_nonce = BTreeMap::<u32, (u64, u64)>::new();
        let mut costs = BTreeMap::<u32, u128>::new();
        let mut balances = BTreeMap::<u32, u128>::new();
        let mut total_fee = 0u128;
        let mut total_value = 0u128;
        let mut prepared = Vec::new();
        let mut review = String::from(
            "MONAD TESTNET · chain 10143\nNative MON transfers only. No mainnet funds.\n",
        );
        for (i, (intent, q)) in s.intents.iter().zip(quotes.iter()).enumerate() {
            if hex(&q.chain_id)? != 10143 || q.recipient_code != "0x" || q.sender_code != "0x" {
                return Err(SignerError::InvalidInput);
            }
            let pending = u64::try_from(hex(&q.nonce)?).map_err(|_| SignerError::InvalidInput)?;
            let entry = next_nonce
                .entry(intent.account_index)
                .or_insert((pending, pending));
            if entry.0 != pending {
                return Err(SignerError::InvalidInput);
            }
            let nonce = entry.1;
            entry.1 = nonce.checked_add(1).ok_or(SignerError::InvalidInput)?;
            let gas = u64::try_from(hex(&q.gas)?).map_err(|_| SignerError::InvalidInput)?;
            // Narrow this slice to plain EOA transfers; no hidden executable code or inflated estimates.
            if gas != 21000 {
                return Err(SignerError::InvalidInput);
            }
            let fee = hex(&q.max_fee)?;
            let priority = hex(&q.priority_fee)?;
            if fee == 0 || priority > fee {
                return Err(SignerError::InvalidInput);
            }
            let max_cost = fee
                .checked_mul(u128::from(gas))
                .ok_or(SignerError::InvalidInput)?;
            total_fee = total_fee
                .checked_add(max_cost)
                .ok_or(SignerError::InvalidInput)?;
            if total_fee > TOTAL_FEE {
                return Err(SignerError::InvalidInput);
            }
            let value = hex(&intent.value_hex)?;
            total_value = total_value
                .checked_add(value)
                .ok_or(SignerError::InvalidInput)?;
            let cost = costs.entry(intent.account_index).or_default();
            *cost = cost
                .checked_add(value)
                .and_then(|v| v.checked_add(max_cost))
                .ok_or(SignerError::InvalidInput)?;
            let balance = hex(&q.balance)?;
            let saved = balances.entry(intent.account_index).or_insert(balance);
            if *saved != balance {
                return Err(SignerError::InvalidInput);
            }
            review.push_str(&format!("\nTransfer {} / {}\nAccount {}\nFrom {}\nTo {}\nAmount {}\nNonce {} · gas {}\nMax fee/gas {} wei · priority {} wei\nMaximum fee {}\n",i+1,s.intents.len(),intent.account_index,intent.from,intent.to,mon(value),nonce,gas,fee,priority,mon(max_cost)));
            prepared.push(Prepared {
                index: intent.account_index,
                from: intent.from.clone(),
                tx: TxEip1559 {
                    chain_id: 10143,
                    nonce,
                    gas_limit: gas,
                    max_fee_per_gas: fee,
                    max_priority_fee_per_gas: priority,
                    to: TxKind::Call(intent.to.parse().map_err(|_| SignerError::InvalidInput)?),
                    value: U256::from(value),
                    access_list: Default::default(),
                    input: Default::default(),
                },
            });
        }
        if costs
            .iter()
            .any(|(index, cost)| balances.get(index).is_none_or(|balance| balance < cost))
        {
            return Err(SignerError::InvalidInput);
        }
        review.push_str(&format!("\nTOTAL VALUE {}\nMAXIMUM TOTAL FEES {}\nMAXIMUM TOTAL DEBIT {}\n\nApproval applies only to these exact transfers. Transfers are sequential, not atomic. Cancellation cannot undo a submitted transfer.",mon(total_value),mon(total_fee),mon(total_value.checked_add(total_fee).ok_or(SignerError::InvalidInput)?)));
        s.prepared = prepared;
        s.review = Some(review.clone());
        Ok(review)
    }
    /// Called only by a full-screen native confirmation action; never an Expo method.
    pub fn approve(&self) -> Result<(), SignerError> {
        let mut s = self.state.lock().map_err(|_| SignerError::CryptoFailed)?;
        s.live()?;
        if s.review.is_none() || s.approved {
            return Err(SignerError::InvalidInput);
        }
        s.approved = true;
        Ok(())
    }
    pub fn sign_next(
        &self,
        pending_nonce: String,
        chain_id: String,
        recipient_code: String,
        sender_code: String,
    ) -> Result<NativeSignedTransfer, SignerError> {
        let mut s = self.state.lock().map_err(|_| SignerError::CryptoFailed)?;
        s.live()?;
        if !s.approved || s.next >= s.prepared.len() {
            return Err(SignerError::InvalidInput);
        }
        let p = &s.prepared[s.next];
        if hex(&chain_id)? != 10143
            || hex(&pending_nonce)? != u128::from(p.tx.nonce)
            || recipient_code != "0x"
            || sender_code != "0x"
        {
            s.seed = None;
            return Err(SignerError::InvalidInput);
        }
        let child = derive(s.seed.as_ref().ok_or(SignerError::InvalidInput)?, p.index)?;
        let digest = p.tx.signature_hash();
        let (sig, rec) = child
            .private_key()
            .sign_prehash_recoverable(digest.as_ref());
        if rec.to_byte() > 1 {
            s.seed = None;
            return Err(SignerError::CryptoFailed);
        }
        let bytes = sig.to_bytes();
        let signature = Signature::from_scalars_and_parity(
            bytes[..32]
                .try_into()
                .map_err(|_| SignerError::CryptoFailed)?,
            bytes[32..]
                .try_into()
                .map_err(|_| SignerError::CryptoFailed)?,
            rec.is_y_odd(),
        );
        let signed = p.tx.clone().into_signed(signature);
        let mut raw = Vec::new();
        signed.eip2718_encode(&mut raw);
        let result = NativeSignedTransfer {
            raw_transaction: alloy_primitives::hex::encode_prefixed(&raw),
            transaction_hash: format!("{:#x}", keccak256(&raw)),
            intent_hash: format!("{digest:#x}"),
            from: p.from.clone(),
            nonce: p.tx.nonce.to_string(),
        };
        s.next += 1;
        if s.next == s.prepared.len() {
            s.seed = None;
        }
        Ok(result)
    }
    pub fn invalidate(&self) {
        if let Ok(mut s) = self.state.lock() {
            s.seed = None;
            s.approved = false;
        }
    }
}
fn derive(seed: &[u8; 64], index: u32) -> Result<XPrv, SignerError> {
    let path: DerivationPath = format!("m/44'/60'/0'/0/{index}")
        .parse()
        .map_err(|_| SignerError::InvalidInput)?;
    XPrv::derive_from_path(seed, &path).map_err(|_| SignerError::CryptoFailed)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn proposal(count: usize) -> String {
        let steps=(0..count).map(|i|format!(r#"{{"accountIndex":{},"to":"0x1111111111111111111111111111111111111111","valueWei":"1"}}"#,i%16)).collect::<Vec<_>>().join(",");
        format!(r#"{{"kind":"nativeTransfers","chainId":10143,"transfers":[{steps}]}}"#)
    }
    fn quote() -> TransferQuote {
        TransferQuote {
            chain_id: "0x279f".into(),
            nonce: "0x0".into(),
            gas: "0x5208".into(),
            max_fee: "0x174876e800".into(),
            priority_fee: "0x0".into(),
            balance: "0xde0b6b3a7640000".into(),
            recipient_code: "0x".into(),
            sender_code: "0x".into(),
        }
    }
    fn sign(op: &TransferOperation, nonce: &str) -> Result<NativeSignedTransfer, SignerError> {
        op.sign_next(nonce.into(), "0x279f".into(), "0x".into(), "0x".into())
    }
    #[test]
    fn rejects_hostile_and_ambiguous_proposals() {
        let good = proposal(1);
        for bad in [
            good.replace("10143", "1"),
            good.replace("\"valueWei\":\"1\"", "\"valueWei\":1"),
            good.replace("\"valueWei\":\"1\"", "\"valueWei\":\"01\""),
            good.replace("\"valueWei\":\"1\"", "\"valueWei\":\"1e2\""),
            good.replace("\"accountIndex\":0", "\"accountIndex\":16"),
            good.replace("\"accountIndex\":0", "\"accountIndex\":0,\"data\":\"0x\""),
            good.replace("\"chainId\":10143", "\"chainId\":10143,\"chainId\":10143"),
            proposal(33),
            proposal(0),
            good.replace("\"valueWei\":\"1\"", "\"valueWei\":\"100000000000000001\""),
            good.replace(
                "1111111111111111111111111111111111111111",
                "0000000000000000000000000000000000000001",
            ),
            " ".repeat(65537),
        ] {
            assert!(validate_transfer_proposal(bad).is_err());
        }
    }
    #[test]
    fn approval_is_required_and_immutable_and_one_shot() {
        let op = TransferOperation::new(proposal(1), vec![0; 32]).unwrap();
        assert!(op.approve().is_err());
        assert!(sign(&op, "0x0").is_err());
        let review = op.prepare(vec![quote()]).unwrap();
        assert!(review.contains("MONAD TESTNET"));
        assert!(review.contains("0.000000000000000001 MON"));
        assert!(op.prepare(vec![quote()]).is_err());
        assert!(sign(&op, "0x0").is_err());
        op.approve().unwrap();
        assert!(op.approve().is_err());
        let signed = sign(&op, "0x0").unwrap();
        assert!(signed.raw_transaction.starts_with("0x02"));
        assert_eq!(
            signed.transaction_hash,
            format!(
                "{:#x}",
                keccak256(alloy_primitives::hex::decode(&signed.raw_transaction).unwrap())
            )
        );
        assert!(sign(&op, "0x0").is_err());
    }
    #[test]
    fn twelve_plus_steps_use_exact_nonces_and_no_extra_signature() {
        let op = TransferOperation::new(proposal(17), vec![0; 32]).unwrap();
        op.prepare((0..17).map(|_| quote()).collect()).unwrap();
        op.approve().unwrap();
        for i in 0..17 {
            let tx = sign(&op, if i == 16 { "0x1" } else { "0x0" }).unwrap();
            assert_eq!(tx.nonce, if i == 16 { "1" } else { "0" });
        }
        assert!(sign(&op, "0x2").is_err());
    }
    #[test]
    fn same_account_batch_cancellation_revokes_remaining_signatures() {
        let proposal = proposal(13);
        let mut parsed: serde_json::Value = serde_json::from_str(&proposal).unwrap();
        for transfer in parsed["transfers"].as_array_mut().unwrap() {
            transfer["accountIndex"] = serde_json::json!(0);
        }
        let op = TransferOperation::new(parsed.to_string(), vec![0; 32]).unwrap();
        let review = op.prepare((0..13).map(|_| quote()).collect()).unwrap();
        assert!(review.contains("Transfer 13 / 13"));
        op.approve().unwrap();
        assert_eq!(sign(&op, "0x0").unwrap().nonce, "0");
        op.invalidate();
        assert!(sign(&op, "0x1").is_err());
        assert!(op.approve().is_err());
        // A fresh operation must prepare and obtain approval again.
        let reopened = TransferOperation::new(parsed.to_string(), vec![0; 32]).unwrap();
        assert!(sign(&reopened, "0x1").is_err());
    }

    #[test]
    fn thirteen_same_account_transfers_use_consecutive_nonces_after_one_approval() {
        let mut parsed: serde_json::Value = serde_json::from_str(&proposal(13)).unwrap();
        for transfer in parsed["transfers"].as_array_mut().unwrap() {
            transfer["accountIndex"] = serde_json::json!(0);
        }
        let op = TransferOperation::new(parsed.to_string(), vec![0; 32]).unwrap();
        op.prepare((0..13).map(|_| quote()).collect()).unwrap();
        op.approve().unwrap();
        for nonce in 0..13 {
            assert_eq!(
                sign(&op, &format!("0x{nonce:x}")).unwrap().nonce,
                nonce.to_string()
            );
        }
        assert!(sign(&op, "0xd").is_err());
    }

    #[test]
    fn expected_sender_binds_wallet_proposal_before_preparation() {
        let mut p: serde_json::Value = serde_json::from_str(&proposal(1)).unwrap();
        let address = crate::derive_wallet_address(vec![0; 32]).unwrap();
        p["transfers"][0]["expectedFrom"] = serde_json::json!(address.to_lowercase());
        assert!(TransferOperation::new(p.to_string(), vec![0; 32]).is_ok());
        assert!(TransferOperation::new(p.to_string(), vec![1; 32]).is_err());
        p["transfers"][0]["expectedFrom"] = serde_json::json!("invalid");
        assert!(validate_transfer_proposal(p.to_string()).is_err());
    }

    #[test]
    fn rejects_bad_quotes_and_aggregate_fees_or_balance() {
        for field in 0..8 {
            let op = TransferOperation::new(proposal(1), vec![0; 32]).unwrap();
            let mut q = quote();
            match field {
                0 => q.chain_id = "0x1".into(),
                1 => q.recipient_code = "0x1234".into(),
                2 => q.sender_code = "0xef0100".into(),
                3 => q.gas = "0x5209".into(),
                4 => q.balance = "0x0".into(),
                5 => q.priority_fee = "0xffffffffffff".into(),
                6 => q.max_fee = "0xffffffffffffffffffffffffffffffff".into(),
                _ => q.nonce = "0xffffffffffffffffffff".into(),
            }
            assert!(op.prepare(vec![q]).is_err());
        }
        let op = TransferOperation::new(proposal(32), vec![0; 32]).unwrap();
        assert!(
            op.prepare(
                (0..32)
                    .map(|_| {
                        let mut q = quote();
                        q.max_fee = "0x2e90edd000".into();
                        q
                    })
                    .collect()
            )
            .is_err()
        );
    }
    #[test]
    fn cancellation_expiry_and_nonce_changes_remove_authority() {
        for mode in 0..4 {
            let op = TransferOperation::new(proposal(1), vec![0; 32]).unwrap();
            op.prepare(vec![quote()]).unwrap();
            op.approve().unwrap();
            match mode {
                0 => op.invalidate(),
                1 => op.state.lock().unwrap().started = Instant::now() - Duration::from_secs(121),
                2 => {
                    assert!(sign(&op, "0x1").is_err());
                }
                _ => {
                    assert!(
                        op.sign_next("0x0".into(), "0x1".into(), "0x".into(), "0x".into())
                            .is_err()
                    );
                }
            }
            assert!(sign(&op, "0x0").is_err());
        }
    }
    #[test]
    fn concurrent_calls_cannot_reuse_a_signature_and_balance_is_aggregate() {
        let op = TransferOperation::new(proposal(1), vec![0; 32]).unwrap();
        op.prepare(vec![quote()]).unwrap();
        op.approve().unwrap();
        let one = op.clone();
        let two = op.clone();
        let a = std::thread::spawn(move || sign(&one, "0x0").is_ok());
        let b = std::thread::spawn(move || sign(&two, "0x0").is_ok());
        assert_ne!(a.join().unwrap(), b.join().unwrap());
        let op = TransferOperation::new(proposal(17), vec![0; 32]).unwrap();
        // Enough for one account-0 transfer, insufficient for its second step.
        let quotes = (0..17)
            .map(|_| {
                let mut q = quote();
                q.balance = "0x775f05a074001".into();
                q
            })
            .collect();
        assert!(op.prepare(quotes).is_err());
    }
}
