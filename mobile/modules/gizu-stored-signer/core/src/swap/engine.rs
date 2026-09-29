//! Sans-IO swap state machine. The platform only moves HTTP bytes, persists `export_state` before every
//! request, and shows the native review; every provider payload is validated here before any signature.
use super::aurora::{self, Quote, QuoteRequest};
use super::evm;
use super::funding::{self, FundingChain, UnsignedAuthorization, UserOperation};
use super::fusion::{self, ApprovedOrder, LimitOrder, Permit};
use super::pins::*;
use crate::roles::{CONFIDENTIAL_ACCOUNT, FIRST_RECIPIENT, FUNDING_ACCOUNT, derive_key, seed_from_entropy};
use crate::SignerError;
use alloy_primitives::{Address, B256, U256, keccak256};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use zeroize::Zeroizing;

const STATE_VERSION: u32 = 1;
const PRICE_TOLERANCE_BPS: u64 = 300;
const MAX_FUNDING_ATTEMPTS: u8 = 4;
const MAX_FUSION_ATTEMPTS: u8 = 3;
const MAX_TRANSIENT_FAILURES: u32 = 20;
const POLL_MS: u64 = 5_000;
const RESUBMIT_AFTER_POLLS: u32 = 36;
const PROBE_RECIPIENT: Address = alloy_primitives::address!("0x000000000000000000000000000000000000dEaD");

#[derive(uniffi::Enum, Debug, PartialEq, Eq)]
pub enum SwapStep {
    /// Perform exactly this request, then call `on_response` with the same id.
    Request { id: u64, method: String, url: String, body: Option<String> },
    Wait { millis: u64 },
    /// Show this text in the native review; `approve` only after a passkey assertion.
    Review { text: String },
    /// The 15-minute authorization lapsed; a new passkey unlock is required for the same plan.
    Unlock,
    Finished,
    Paused { code: String },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "step", rename_all = "camelCase")]
enum Step {
    Assets,
    SourceChain { execute: bool },
    TargetChain,
    FundingProbe,
    FundingQuote { attempt: u8 },
    FundingPrepare { attempt: u8, execute: bool },
    PayoutEstimate { index: usize },
    FusionEstimate,
    Review,
    FundingSign,
    FundingSubmit,
    FundingReceipt { polls: u32, resubmitted: bool },
    Credit,
    AuthSalt,
    Authenticate { salt: String },
    Balances,
    PayoutQuote { index: usize },
    PayoutIntent { index: usize },
    PayoutSubmit { index: usize },
    PayoutStatus { index: usize, polls: u32, resubmitted: bool },
    PayoutBalance { index: usize },
    FusionBalance { index: usize },
    FusionPreview { index: usize },
    FusionPermit { index: usize },
    FusionOrder { index: usize },
    FusionSign { index: usize },
    FusionSubmit { index: usize },
    FusionStatus { index: usize },
    FusionReceipts { index: usize },
    FusionAfter { index: usize },
    Holdings,
    SellQuote { index: usize },
    Done,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Plan {
    kind: String,
    target: Address,
    #[serde(default)]
    amount_atoms: Option<String>,
    recipient_indices: [u32; 3],
    #[serde(default)]
    holder_indices: Option<[u32; 3]>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct Payout {
    portion: U256,
    request: Option<QuoteRequest>,
    quote: Option<Quote>,
    signed: Option<Value>,
    intent_hash: Option<String>,
    delivered: U256,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct Order {
    attempts: u8,
    before_usdg: U256,
    before_target: U256,
    amount: U256,
    min_out: U256,
    permit_deadline: u64,
    permit: Option<String>,
    order: Option<LimitOrder>,
    extension: Option<String>,
    quote_id: Option<String>,
    order_hash: Option<B256>,
    signature: Option<String>,
    expiration: u64,
    fills: Vec<(String, U256)>,
    swapped: U256,
    received: U256,
    received_total: U256,
    complete: bool,
    #[serde(default)]
    inbound: Option<Quote>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct Data {
    source_asset: String,
    destination_asset: String,
    target_symbol: String,
    target_decimals: u8,
    source_balance: U256,
    budget: U256,
    code: String,
    transaction_count: u64,
    allowance: U256,
    funding_amount: U256,
    funding_fee: U256,
    funding_request: Option<QuoteRequest>,
    funding_quote: Option<Quote>,
    prepared: Option<(UserOperation, Option<UnsignedAuthorization>)>,
    signed_operation: Option<(B256, Value)>,
    estimates: Vec<(U256, U256)>,
    rate_amount: U256,
    rate_end: U256,
    access_token: Option<String>,
    credit_basis: Option<String>,
    available: U256,
    private_token_id: Option<String>,
    payouts: [Payout; 3],
    orders: [Order; 3],
    #[serde(default)]
    leg: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Machine {
    version: u32,
    id: String,
    plan: Plan,
    source: Address,
    confidential: Address,
    recipients: [Address; 3],
    #[serde(default)]
    holders: [Address; 3],
    created_ms: u64,
    approved_ms: Option<u64>,
    session_until_ms: u64,
    step: Step,
    reapproval: Option<String>,
    resubmits: u32,
    paused: Option<String>,
    cancelled: bool,
    next_id: u64,
    pending: Option<u64>,
    failures: u32,
    wait_until_ms: u64,
    data: Data,
}

struct Engine {
    m: Machine,
    gateway: String,
    seed: Option<Zeroizing<[u8; 64]>>,
}

enum Outcome {
    Ok(Value),
    Transient,
    Rejected(u16, Value),
}

fn outcome(status: u16, body: &str) -> Outcome {
    if status == 0 || status == 429 || status >= 500 {
        return Outcome::Transient;
    }
    let value = serde_json::from_str(body).unwrap_or(Value::Null);
    if (200..300).contains(&status) { Outcome::Ok(value) } else { Outcome::Rejected(status, value) }
}

fn gateway_base(url: &str) -> Result<String, SignerError> {
    let trimmed = url.trim_end_matches('/');
    let local = ["http://127.0.0.1:", "http://localhost:", "http://10.0.2.2:"].iter().any(|p| trimmed.starts_with(p));
    if trimmed.len() > 200 || !(trimmed.starts_with("https://") || local) || trimmed.contains('?') || trimmed.contains('#') {
        return Err(SignerError::InvalidInput);
    }
    Ok(trimmed.to_string())
}

fn usdc(v: U256) -> String {
    units(v, 6)
}
fn units(v: U256, decimals: u8) -> String {
    let scale = U256::from(10u64).pow(U256::from(decimals));
    let frac = (v % scale).to_string();
    format!("{}.{}{}", v / scale, "0".repeat(decimals as usize - frac.len().min(decimals as usize)), frac)
}

fn call_data(signature: &str, args: &[Address]) -> String {
    evm::encode_call(signature, &args.iter().map(|a| evm::word_address(*a)).collect::<Vec<_>>())
}

fn rpc_result(batch: &Value, id: u64) -> Result<&Value, SignerError> {
    batch
        .as_array()
        .and_then(|items| items.iter().find(|item| item.get("id").and_then(Value::as_u64) == Some(id)))
        .and_then(|item| item.get("result"))
        .ok_or(SignerError::InvalidInput)
}
fn rpc_uint(batch: &Value, id: u64) -> Result<U256, SignerError> {
    let s = rpc_result(batch, id)?.as_str().ok_or(SignerError::InvalidInput)?;
    if s == "0x" {
        return Ok(U256::ZERO);
    }
    let bytes = evm::hex_bytes(s)?;
    if bytes.len() > 32 {
        return Err(SignerError::InvalidInput);
    }
    Ok(U256::from_be_slice(&bytes))
}
fn rpc_quantity(batch: &Value, id: u64) -> Result<U256, SignerError> {
    evm::quantity(rpc_result(batch, id)?.as_str().ok_or(SignerError::InvalidInput)?)
}
fn abi_string(batch: &Value, id: u64) -> Result<String, SignerError> {
    let bytes = evm::hex_bytes(rpc_result(batch, id)?.as_str().ok_or(SignerError::InvalidInput)?)?;
    let reader = evm::AbiReader::new(&bytes);
    let text = reader.bytes(reader.usize(0)?)?;
    if text.len() > 32 {
        return Err(SignerError::InvalidInput);
    }
    String::from_utf8(text.to_vec()).map_err(|_| SignerError::InvalidInput)
}

fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str, SignerError> {
    v.get(key).and_then(Value::as_str).ok_or(SignerError::InvalidInput)
}

impl Engine {
    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.gateway)
    }
    fn request(&mut self, method: &str, url: String, body: Option<Value>) -> SwapStep {
        self.m.next_id += 1;
        self.m.pending = Some(self.m.next_id);
        SwapStep::Request { id: self.m.next_id, method: method.into(), url, body: body.map(|b| b.to_string()) }
    }
    fn get(&mut self, path: &str) -> SwapStep {
        let url = self.url(path);
        self.request("GET", url, None)
    }
    fn post(&mut self, path: &str, body: Value) -> SwapStep {
        let url = self.url(path);
        self.request("POST", url, Some(body))
    }
    fn rpc(&mut self, chain: &str, calls: Vec<(&str, Value)>) -> SwapStep {
        let batch: Vec<Value> = calls.into_iter().enumerate().map(|(i, (method, params))| json!({"jsonrpc": "2.0", "id": i, "method": method, "params": params})).collect();
        let url = if chain == "monad" { MONAD_RPC } else { ROBINHOOD_RPC };
        self.request("POST", url.into(), Some(Value::Array(batch)))
    }
    fn eth_call(to: Address, data: String) -> Value {
        json!([{"to": to.to_checksum(None), "data": data}, "latest"])
    }

    fn key(&self, index: u32) -> Result<bip32::XPrv, SignerError> {
        derive_key(self.seed.as_ref().ok_or(SignerError::InvalidInput)?, index)
    }
    fn can_sign(&mut self, now: u64) -> bool {
        if now >= self.m.session_until_ms {
            self.seed = None;
        }
        self.seed.is_some() && self.m.approved_ms.is_some() && now < self.m.created_ms + OPERATION_MS
    }
    fn pause(&mut self, code: &str) -> SwapStep {
        self.m.paused = Some(code.into());
        SwapStep::Paused { code: code.into() }
    }
    fn go(&mut self, step: Step) {
        self.m.step = step;
        self.m.failures = 0;
    }
    fn wait(&mut self, now: u64, millis: u64) {
        self.m.wait_until_ms = now + millis;
    }
    fn recipient_index(&self, i: usize) -> u32 {
        self.m.plan.recipient_indices[i]
    }
    fn sell(&self) -> bool {
        self.m.plan.kind == "confidentialSell"
    }
    fn holder(&self, i: usize) -> Address {
        if self.sell() { self.m.holders[i] } else { self.m.recipients[i] }
    }
    fn signer_index(&self, i: usize) -> u32 {
        if self.sell() {
            self.m.plan.holder_indices.map(|h| h[i]).unwrap_or(self.recipient_index(i))
        } else {
            self.recipient_index(i)
        }
    }
    fn next_sell_index(&self, from: usize) -> Option<usize> {
        (from..3).find(|&i| !self.m.data.orders[i].amount.is_zero() && !self.m.data.orders[i].complete)
    }

    fn next(&mut self, now: u64) -> Result<SwapStep, SignerError> {
        if self.m.cancelled {
            return Ok(SwapStep::Paused { code: "CANCELLED".into() });
        }
        if let Some(code) = &self.m.paused {
            return Ok(SwapStep::Paused { code: code.clone() });
        }
        if self.m.pending.take().is_some() {
            // The last response never arrived (crash or lost reply): reads are reissued,
            // submissions go to their status lookup instead of being repeated.
            self.lost_submit();
        }
        if now < self.m.wait_until_ms {
            return Ok(SwapStep::Wait { millis: self.m.wait_until_ms - now });
        }
        if let Some(text) = &self.m.reapproval {
            return Ok(SwapStep::Review { text: text.clone() });
        }
        let d = self.m.data.clone();
        let step = match self.m.step.clone() {
            Step::Assets => self.get("/v1/swap/aurora/tokens"),
            Step::SourceChain { .. } => {
                let (src, pm) = (self.m.source, PIMLICO_ERC20_PAYMASTER);
                self.rpc("monad", vec![
                    ("eth_chainId", json!([])),
                    ("eth_call", Self::eth_call(MONAD_USDC, call_data("balanceOf(address)", &[src]))),
                    ("eth_getCode", json!([src.to_checksum(None), "latest"])),
                    ("eth_getTransactionCount", json!([src.to_checksum(None), "latest"])),
                    ("eth_call", Self::eth_call(MONAD_USDC, call_data("allowance(address,address)", &[src, pm]))),
                ])
            }
            Step::TargetChain => {
                let t = self.m.plan.target;
                self.rpc("robinhood", vec![
                    ("eth_chainId", json!([])),
                    ("eth_call", Self::eth_call(t, evm::encode_call("symbol()", &[]))),
                    ("eth_call", Self::eth_call(t, evm::encode_call("decimals()", &[]))),
                ])
            }
            Step::Holdings => {
                let t = self.m.plan.target;
                let mut calls = Vec::new();
                for i in 0..3 {
                    let h = self.m.holders[i];
                    calls.push(("eth_call", Self::eth_call(t, call_data("balanceOf(address)", &[h]))));
                    calls.push(("eth_getBalance", json!([h.to_checksum(None), "latest"])));
                }
                self.rpc("robinhood", calls)
            }
            Step::FundingProbe => self.post("/v1/swap/monad/prepare-funding", json!({"owner": self.m.source.to_checksum(None), "recipient": PROBE_RECIPIENT.to_checksum(None), "amount": "1"})),
            Step::FundingQuote { .. } => {
                let request = if self.sell() {
                    QuoteRequest::funding(self.m.confidential, self.m.source, &d.source_asset, d.funding_amount)
                } else {
                    QuoteRequest::bridge(self.m.source, self.m.recipients[d.leg], &d.source_asset, &d.destination_asset, d.funding_amount)
                };
                self.m.data.funding_request = Some(request.clone());
                self.post("/v1/swap/aurora/quote", serde_json::to_value(request).map_err(|_| SignerError::InvalidInput)?)
            }
            Step::FundingPrepare { .. } => {
                let quote = d.funding_quote.as_ref().ok_or(SignerError::InvalidInput)?;
                self.post("/v1/swap/monad/prepare-funding", json!({"owner": self.m.source.to_checksum(None), "recipient": quote.deposit_address, "amount": d.funding_amount.to_string()}))
            }
            Step::PayoutEstimate { index } => {
                let portion = aurora::split(d.funding_amount)[index];
                let request = QuoteRequest::bridge(self.m.source, self.m.recipients[index], &d.source_asset, &d.destination_asset, portion);
                self.m.data.payouts[index].portion = portion;
                self.m.data.payouts[index].request = Some(request.clone());
                self.post("/v1/swap/aurora/quote", serde_json::to_value(request).map_err(|_| SignerError::InvalidInput)?)
            }
            Step::FusionEstimate => {
                if self.sell() {
                    let index = self.next_sell_index(0).unwrap_or(0);
                    let amount = d.orders[index].amount;
                    self.m.data.rate_amount = amount;
                    self.post("/v1/swap/fusion/preview", json!({"wallet": self.holder(index).to_checksum(None), "srcToken": self.m.plan.target.to_checksum(None), "dstToken": format!("{ROBINHOOD_USDG:#x}"), "amount": amount.to_string(), "preset": "fast"}))
                } else {
                    let total = d.estimates.iter().fold(U256::ZERO, |sum, (_, min)| sum + *min);
                    self.m.data.rate_amount = total;
                    self.post("/v1/swap/fusion/preview", json!({"wallet": self.m.recipients[0].to_checksum(None), "dstToken": self.m.plan.target.to_checksum(None), "amount": total.to_string(), "preset": "fast"}))
                }
            }
            Step::Review => {
                if self.m.approved_ms.is_some() {
                    self.m.data.prepared = None;
                    if self.sell() {
                        let index = self.next_sell_index(0).ok_or(SignerError::InvalidInput)?;
                        self.go(Step::FusionPreview { index });
                    } else {
                        self.m.data.leg = 0;
                        self.go(Step::SourceChain { execute: true });
                    }
                    return self.next(now);
                }
                return Ok(SwapStep::Review { text: self.review() });
            }
            Step::FundingSign => {
                if d.funding_quote.as_ref().is_none_or(|q| q.deadline_ms <= now + 60_000) {
                    self.go(Step::FundingQuote { attempt: 0 });
                    return self.next(now);
                }
                if d.prepared.is_none() {
                    self.go(Step::SourceChain { execute: true });
                    return self.next(now);
                }
                if !self.can_sign(now) {
                    return Ok(self.unlock_or_expire(now));
                }
                match self.sign_funding(now) {
                    Ok(()) => {}
                    Err(SignerError::Expired) => {
                        // Paymaster validity lapsed while locked: re-read the chain and prepare again.
                        self.m.data.prepared = None;
                        self.go(Step::SourceChain { execute: true });
                        return self.next(now);
                    }
                    Err(_) => return Ok(self.pause("REJECTED_fundingSign")),
                }
                self.go(Step::FundingSubmit);
                return self.next(now);
            }
            Step::FundingSubmit => {
                let (_, rpc) = d.signed_operation.clone().ok_or(SignerError::InvalidInput)?;
                self.post("/v1/swap/monad/submit", json!({"userOperation": rpc}))
            }
            Step::FundingReceipt { .. } => {
                let (hash, _) = d.signed_operation.clone().ok_or(SignerError::InvalidInput)?;
                self.post("/v1/swap/monad/receipt", json!({"userOperationHash": format!("{hash:#x}")}))
            }
            Step::Credit => {
                let quote = d.funding_quote.clone().ok_or(SignerError::InvalidInput)?;
                self.post("/v1/swap/aurora/status", status_body(&quote))
            }
            Step::AuthSalt => self.get("/v1/swap/aurora/auth-salt"),
            Step::Authenticate { salt } => {
                if !self.can_sign(now) {
                    return Ok(self.unlock_or_expire(now));
                }
                let key = self.key(CONFIDENTIAL_ACCOUNT)?;
                let secret = Zeroizing::new(key.private_key().to_bytes().to_vec());
                let payload = aurora::auth_payload(self.m.confidential, &salt, now, aurora::auth_random(&secret, now, self.m.next_id))?;
                let sig = evm::sign(&key, evm::personal_hash(payload.as_bytes()))?;
                self.post("/v1/swap/aurora/authenticate", json!({"payload": payload, "signature": aurora::encode_signature(&sig)}))
            }
            Step::Balances => {
                let token = d.access_token.clone().ok_or(SignerError::InvalidInput)?;
                self.post("/v1/swap/aurora/balances", json!({"accessToken": token}))
            }
            Step::PayoutQuote { index } => {
                if self.sell() {
                    let portion = d.available;
                    let request = QuoteRequest::payout(self.m.confidential, self.m.recipients[index], &d.source_asset, &d.source_asset, portion);
                    self.m.data.payouts[index].portion = portion;
                    self.m.data.payouts[index].request = Some(request.clone());
                    self.post("/v1/swap/aurora/quote", serde_json::to_value(request).map_err(|_| SignerError::InvalidInput)?)
                } else {
                    let portion = aurora::split(d.available)[index];
                    let request = QuoteRequest::payout(self.m.confidential, self.m.recipients[index], &d.source_asset, &d.destination_asset, portion);
                    self.m.data.payouts[index].portion = portion;
                    self.m.data.payouts[index].request = Some(request.clone());
                    self.post("/v1/swap/aurora/quote", serde_json::to_value(request).map_err(|_| SignerError::InvalidInput)?)
                }
            }
            Step::PayoutIntent { index } => {
                if !self.can_sign(now) {
                    return Ok(self.unlock_or_expire(now));
                }
                let quote = d.payouts[index].quote.clone().ok_or(SignerError::InvalidInput)?;
                if quote.deadline_ms <= now + 60_000 {
                    self.go(Step::PayoutQuote { index });
                    return self.next(now);
                }
                self.post("/v1/swap/aurora/generate-intent", json!({"signerId": format!("{:#x}", self.m.confidential), "depositAddress": quote.deposit_address}))
            }
            Step::PayoutSubmit { index } => {
                let signed = d.payouts[index].signed.clone().ok_or(SignerError::InvalidInput)?;
                self.post("/v1/swap/aurora/submit-intent", json!({"signedData": signed}))
            }
            Step::PayoutStatus { index, .. } => {
                let quote = d.payouts[index].quote.clone().ok_or(SignerError::InvalidInput)?;
                self.post("/v1/swap/aurora/status", status_body(&quote))
            }
            Step::PayoutBalance { index } => {
                if self.sell() {
                    let a = self.m.recipients[index];
                    self.rpc("monad", vec![("eth_call", Self::eth_call(MONAD_USDC, call_data("balanceOf(address)", &[a])))])
                } else {
                    let a = self.m.recipients[index];
                    self.rpc("robinhood", vec![
                        ("eth_call", Self::eth_call(ROBINHOOD_USDG, call_data("balanceOf(address)", &[a]))),
                    ])
                }
            }
            Step::FusionBalance { index } | Step::FusionAfter { index } => {
                let a = self.holder(index);
                self.rpc("robinhood", vec![
                    ("eth_call", Self::eth_call(ROBINHOOD_USDG, call_data("balanceOf(address)", &[a]))),
                    ("eth_call", Self::eth_call(self.m.plan.target, call_data("balanceOf(address)", &[a]))),
                    ("eth_getBalance", json!([a.to_checksum(None), "latest"])),
                ])
            }
            Step::FusionPreview { index } => {
                let amount = d.orders[index].amount;
                if self.sell() {
                    self.post("/v1/swap/fusion/preview", json!({"wallet": self.holder(index).to_checksum(None), "srcToken": self.m.plan.target.to_checksum(None), "dstToken": format!("{ROBINHOOD_USDG:#x}"), "amount": amount.to_string(), "preset": "fast"}))
                } else {
                    self.post("/v1/swap/fusion/preview", json!({"wallet": self.m.recipients[index].to_checksum(None), "dstToken": self.m.plan.target.to_checksum(None), "amount": amount.to_string(), "preset": "fast"}))
                }
            }
            Step::SellQuote { index } => {
                let amount = d.orders[index].min_out;
                let request = QuoteRequest::sell_in(self.m.confidential, self.holder(index), &d.destination_asset, &d.source_asset, amount);
                self.m.data.payouts[index].request = Some(request.clone());
                self.post("/v1/swap/aurora/quote", serde_json::to_value(request).map_err(|_| SignerError::InvalidInput)?)
            }
            Step::FusionPermit { index } => {
                if !self.can_sign(now) {
                    return Ok(self.unlock_or_expire(now));
                }
                if self.sell() {
                    self.post("/v1/swap/fusion/permit-context", json!({"owner": self.holder(index).to_checksum(None), "token": self.m.plan.target.to_checksum(None)}))
                } else {
                    self.post("/v1/swap/fusion/permit-context", json!({"owner": self.m.recipients[index].to_checksum(None)}))
                }
            }
            Step::FusionOrder { index } => {
                let o = &d.orders[index];
                if self.sell() {
                    self.post("/v1/swap/fusion/order", json!({"wallet": self.holder(index).to_checksum(None), "srcToken": self.m.plan.target.to_checksum(None), "dstToken": format!("{ROBINHOOD_USDG:#x}"), "amount": o.amount.to_string(), "permit": o.permit.clone().ok_or(SignerError::InvalidInput)?, "preset": "fast"}))
                } else {
                    self.post("/v1/swap/fusion/order", json!({"wallet": self.m.recipients[index].to_checksum(None), "dstToken": self.m.plan.target.to_checksum(None), "amount": o.amount.to_string(), "permit": o.permit.clone().ok_or(SignerError::InvalidInput)?, "preset": "fast"}))
                }
            }
            Step::FusionSign { index } => {
                if !self.can_sign(now) {
                    return Ok(self.unlock_or_expire(now));
                }
                let o = &d.orders[index];
                if now / 1000 + 60 >= o.expiration {
                    self.go(if self.sell() { Step::FusionPreview { index } } else { Step::FusionBalance { index } });
                    return self.next(now);
                }
                let hash = o.order_hash.ok_or(SignerError::InvalidInput)?;
                let sig = evm::sign(&self.key(self.signer_index(index))?, hash)?;
                self.m.data.orders[index].signature = Some(sig.rsv_hex());
                self.go(Step::FusionSubmit { index });
                return self.next(now);
            }
            Step::FusionSubmit { index } => {
                let o = &d.orders[index];
                self.post("/v1/swap/fusion/submit", json!({"order": o.order, "signature": o.signature, "quoteId": o.quote_id, "extension": o.extension}))
            }
            Step::FusionStatus { index } => {
                let hash = d.orders[index].order_hash.ok_or(SignerError::InvalidInput)?;
                self.post("/v1/swap/fusion/status", json!({"orderHash": format!("{hash:#x}")}))
            }
            Step::FusionReceipts { index } => {
                let calls = d.orders[index].fills.iter().map(|(tx, _)| ("eth_getTransactionReceipt", json!([tx]))).collect::<Vec<_>>();
                if calls.is_empty() {
                    self.go(Step::FusionAfter { index });
                    return self.next(now);
                }
                self.rpc("robinhood", calls)
            }
            Step::Done => return Ok(SwapStep::Finished),
        };
        Ok(step)
    }

    fn unlock_or_expire(&mut self, now: u64) -> SwapStep {
        if now >= self.m.created_ms + OPERATION_MS {
            return self.pause("OPERATION_EXPIRED");
        }
        SwapStep::Unlock
    }

    fn sign_funding(&mut self, now: u64) -> Result<(), SignerError> {
        let (op, authorization) = self.m.data.prepared.clone().ok_or(SignerError::InvalidInput)?;
        let quote = self.m.data.funding_quote.clone().ok_or(SignerError::InvalidInput)?;
        let chain = self.chain()?;
        let checked = funding::check_funding(&op, authorization.as_ref(), self.m.source, evm::addr(&quote.deposit_address)?, self.m.data.funding_amount, self.m.data.budget, &chain, now / 1000)?;
        let key = self.key(FUNDING_ACCOUNT)?;
        if evm::key_address(&key) != self.m.source {
            return Err(SignerError::CryptoFailed);
        }
        let signature = evm::sign(&key, checked.hash)?;
        let auth_signature = match &authorization {
            Some(a) => Some(evm::sign(&key, evm::authorization_hash(a.chain_id, a.address, a.nonce))?),
            None => None,
        };
        let rpc = funding::rpc_operation(&op, &signature, authorization.as_ref().zip(auth_signature.as_ref()));
        self.m.data.signed_operation = Some((checked.hash, rpc));
        self.m.data.funding_fee = checked.fee_cap;
        Ok(())
    }

    fn chain(&self) -> Result<FundingChain, SignerError> {
        Ok(FundingChain { code: evm::hex_bytes(&self.m.data.code)?, transaction_count: self.m.data.transaction_count, paymaster_allowance: self.m.data.allowance })
    }

    fn respond(&mut self, id: u64, status: u16, body: &str, now: u64) -> Result<(), SignerError> {
        if self.m.pending != Some(id) {
            return Err(SignerError::InvalidInput);
        }
        self.m.pending = None;
        let result = outcome(status, body);
        if let Outcome::Transient = result {
            let submit = matches!(self.m.step, Step::FundingSubmit | Step::PayoutSubmit { .. } | Step::FusionSubmit { .. });
            if submit {
                // Outcome unknown: look it up, never sign again.
                self.lost_submit();
                self.wait(now, POLL_MS);
                return Ok(());
            }
            self.m.failures += 1;
            if self.m.failures > MAX_TRANSIENT_FAILURES {
                self.m.paused = Some("NETWORK_UNAVAILABLE".into());
            }
            self.wait(now, POLL_MS * u64::from(self.m.failures.min(6)));
            return Ok(());
        }
        match self.handle(result, now) {
            Ok(()) => Ok(()),
            Err(SignerError::Expired) => {
                self.m.paused = Some("QUOTE_EXPIRED".into());
                Ok(())
            }
            Err(error) => {
                self.m.paused = Some(format!("REJECTED_{}", step_name(&self.m.step)));
                Err(error)
            }
        }
    }

    fn handle(&mut self, result: Outcome, now: u64) -> Result<(), SignerError> {
        let step = self.m.step.clone();
        let (value, rejected) = match result {
            Outcome::Ok(v) => (v, None),
            Outcome::Rejected(code, v) => (v, Some(code)),
            Outcome::Transient => unreachable!(),
        };
        match (step, rejected) {
            (Step::Assets, None) => {
                let tokens = value.get("tokens").and_then(Value::as_array).ok_or(SignerError::InvalidInput)?;
                let find = |chain: &str, contract: Address| -> Result<String, SignerError> {
                    let matches: Vec<_> = tokens
                        .iter()
                        .filter(|t| t.get("blockchain").and_then(Value::as_str) == Some(chain) && t.get("contractAddress").and_then(Value::as_str).and_then(|c| evm::addr(c).ok()) == Some(contract))
                        .collect();
                    match matches.as_slice() {
                        [t] if t.get("decimals").and_then(Value::as_u64) == Some(u64::from(USDC_DECIMALS)) => Ok(text(t, "assetId")?.to_string()),
                        _ => Err(SignerError::InvalidInput),
                    }
                };
                self.m.data.source_asset = find("monad", MONAD_USDC)?;
                self.m.data.destination_asset = find("hood", ROBINHOOD_USDG)?;
                self.go(Step::TargetChain);
            }
            (Step::TargetChain, None) => {
                if rpc_quantity(&value, 0)? != U256::from(ROBINHOOD_CHAIN_ID) {
                    return Err(SignerError::InvalidInput);
                }
                let decimals = rpc_uint(&value, 2)?;
                if decimals > U256::from(36) || self.m.plan.target == ROBINHOOD_USDG {
                    return Err(SignerError::InvalidInput);
                }
                self.m.data.target_symbol = abi_string(&value, 1)?;
                self.m.data.target_decimals = decimals.to::<u8>();
                self.go(if self.sell() { Step::Holdings } else { Step::SourceChain { execute: false } });
            }
            (Step::Holdings, None) => {
                let mut any = false;
                for i in 0..3 {
                    let amount = rpc_uint(&value, (i * 2) as u64)?;
                    let eth = rpc_quantity(&value, (i * 2 + 1) as u64)?;
                    if !eth.is_zero() {
                        self.m.paused = Some(format!("HOLDER_{}_HOLDS_ETH", i + 1));
                        return Ok(());
                    }
                    self.m.data.orders[i].amount = amount;
                    self.m.data.orders[i].before_target = amount;
                    any |= !amount.is_zero();
                }
                if !any {
                    self.m.paused = Some("NO_HOLDINGS".into());
                    return Ok(());
                }
                self.go(Step::FusionEstimate);
            }
            (Step::SourceChain { execute }, None) => {
                if rpc_quantity(&value, 0)? != U256::from(MONAD_CHAIN_ID) {
                    return Err(SignerError::InvalidInput);
                }
                let balance = rpc_uint(&value, 1)?;
                self.m.data.code = rpc_result(&value, 2)?.as_str().ok_or(SignerError::InvalidInput)?.to_string();
                self.m.data.transaction_count = rpc_quantity(&value, 3)?.try_into().map_err(|_| SignerError::InvalidInput)?;
                self.m.data.allowance = rpc_uint(&value, 4)?;
                if execute {
                    if balance < self.m.data.budget {
                        self.m.paused = Some("SOURCE_BALANCE_CHANGED".into());
                        return Ok(());
                    }
                    let portion = self.m.data.payouts[self.m.data.leg].portion;
                    if portion.is_zero() {
                        return Err(SignerError::InvalidInput);
                    }
                    self.m.data.funding_amount = portion;
                    self.m.data.prepared = None;
                    self.m.data.signed_operation = None;
                    self.go(Step::FundingQuote { attempt: 0 });
                } else {
                    let requested = match &self.m.plan.amount_atoms {
                        Some(a) => evm::decimal(a)?,
                        None => U256::from(MAX_SOURCE_ATOMS),
                    };
                    self.m.data.source_balance = balance;
                    self.m.data.budget = balance.min(requested).min(U256::from(MAX_SOURCE_ATOMS));
                    if self.m.data.budget.is_zero() {
                        self.m.paused = Some("AWAITING_DEPOSIT".into());
                        return Ok(());
                    }
                    self.go(Step::FundingProbe);
                }
            }
            (Step::FundingProbe, None) => {
                let op: UserOperation = serde_json::from_value(value["userOperation"].clone()).map_err(|_| SignerError::InvalidInput)?;
                let fee = funding::fee_cap(&op, now / 1000)?;
                let reserved = fee.saturating_mul(U256::from(3));
                if reserved >= self.m.data.budget {
                    self.m.paused = Some("FEE_EXCEEDS_BUDGET".into());
                    return Ok(());
                }
                self.m.data.funding_fee = reserved;
                self.m.data.funding_amount = self.m.data.budget - reserved;
                self.go(Step::PayoutEstimate { index: 0 });
            }
            (Step::FundingQuote { attempt }, None) => {
                let request = self.m.data.funding_request.clone().ok_or(SignerError::InvalidInput)?;
                let quote = aurora::check_quote(&request, &value, now)?;
                if quote.amount_in != self.m.data.funding_amount || quote.amount_out > U256::from(MAX_SOURCE_ATOMS) {
                    return Err(SignerError::InvalidInput);
                }
                evm::addr(&quote.deposit_address)?;
                self.m.data.funding_quote = Some(quote.clone());
                self.m.data.prepared = None;
                if !self.sell() && self.m.approved_ms.is_some() {
                    let index = self.m.data.leg;
                    let portion = self.m.data.funding_amount;
                    let (planned_portion, planned_min) = self.m.data.estimates.get(index).copied().ok_or(SignerError::InvalidInput)?;
                    let floor = portion * planned_min * U256::from(10_000 - PRICE_TOLERANCE_BPS) / U256::from(10_000);
                    self.m.data.payouts[index].quote = Some(quote.clone());
                    self.m.data.payouts[index].request = Some(request);
                    if quote.min_amount_out * planned_portion < floor {
                        self.m.reapproval = Some(self.requote_text(&format!(
                            "Bridge {} now guarantees at least {} USDG for {} USDC.",
                            index + 1,
                            usdc(quote.min_amount_out),
                            usdc(portion)
                        )));
                        return Ok(());
                    }
                    self.go(Step::FundingPrepare { attempt, execute: true });
                    return Ok(());
                }
                self.go(Step::FundingPrepare { attempt, execute: self.m.approved_ms.is_some() });
            }
            (Step::FundingPrepare { attempt, execute }, None) => {
                let op: UserOperation = serde_json::from_value(value["userOperation"].clone()).map_err(|_| SignerError::InvalidInput)?;
                let authorization: Option<UnsignedAuthorization> = serde_json::from_value(value["authorization"].clone()).map_err(|_| SignerError::InvalidInput)?;
                let fee = funding::fee_cap(&op, now / 1000)?;
                let room = self.m.data.budget.checked_sub(self.m.data.funding_amount).ok_or(SignerError::InvalidInput)?;
                if fee > room {
                    // Gas price moved up. Reserve headroom and requote inside the same budget.
                    // A lower or equal fee still pays the quoted amount, so it does not requote.
                    if attempt + 1 >= MAX_FUNDING_ATTEMPTS {
                        self.m.paused = Some("FEE_UNSTABLE".into());
                        return Ok(());
                    }
                    let reserved = fee.saturating_add(fee / U256::from(4));
                    let next = self.m.data.budget.checked_sub(reserved).filter(|n| !n.is_zero()).ok_or(SignerError::InvalidInput)?;
                    self.m.data.funding_amount = next;
                    if !self.sell() {
                        self.m.data.payouts[self.m.data.leg].portion = next;
                    }
                    self.go(Step::FundingQuote { attempt: attempt + 1 });
                    return Ok(());
                }
                let deposit = evm::addr(&self.m.data.funding_quote.as_ref().ok_or(SignerError::InvalidInput)?.deposit_address)?;
                let checked = funding::check_funding(&op, authorization.as_ref(), self.m.source, deposit, self.m.data.funding_amount, self.m.data.budget, &self.chain()?, now / 1000)?;
                self.m.data.funding_fee = checked.fee_cap;
                self.m.data.prepared = Some((op, authorization));
                self.go(if execute { Step::FundingSign } else { Step::PayoutEstimate { index: 0 } });
            }
            (Step::PayoutEstimate { index }, None) => {
                let request = self.m.data.payouts[index].request.clone().ok_or(SignerError::InvalidInput)?;
                let quote = aurora::check_quote(&request, &value, now)?;
                let portion = self.m.data.payouts[index].portion;
                if quote.amount_in != portion {
                    return Err(SignerError::InvalidInput);
                }
                self.m.data.payouts[index].quote = Some(quote.clone());
                self.m.data.estimates.truncate(index);
                self.m.data.estimates.push((portion, quote.min_amount_out));
                self.go(if index == 2 { Step::FusionEstimate } else { Step::PayoutEstimate { index: index + 1 } });
            }
            (Step::FusionEstimate, None) => {
                let end = evm::decimal(text(&value, "auctionEndAmount")?)?;
                if value["liquidity"]["passes"] != json!(true) || end.is_zero() {
                    self.m.paused = Some("TARGET_ILLIQUID".into());
                    return Ok(());
                }
                self.m.data.rate_end = end;
                self.go(Step::Review);
            }
            (Step::FundingSubmit, None) => {
                let (hash, _) = self.m.data.signed_operation.clone().ok_or(SignerError::InvalidInput)?;
                if !text(&value, "userOperationHash")?.eq_ignore_ascii_case(&format!("{hash:#x}")) {
                    return Err(SignerError::InvalidInput);
                }
                self.go(Step::FundingReceipt { polls: 0, resubmitted: false });
                self.wait(now, POLL_MS);
            }
            (Step::FundingSubmit, Some(_)) => {
                self.go(Step::FundingReceipt { polls: 0, resubmitted: false });
                self.wait(now, POLL_MS);
            }
            (Step::FundingReceipt { polls, resubmitted }, None) => {
                if value["found"] == json!(true) {
                    if value["success"] != json!(true) {
                        self.m.paused = Some("FUNDING_REVERTED".into());
                        return Ok(());
                    }
                    self.go(Step::Credit);
                } else if polls >= RESUBMIT_AFTER_POLLS && self.m.resubmits < 3 {
                    // Same signed bytes, same userOpHash: a rebroadcast, never a second signature.
                    self.m.resubmits += 1;
                    self.m.step = Step::FundingSubmit;
                } else {
                    self.m.step = Step::FundingReceipt { polls: polls + 1, resubmitted };
                }
                self.wait(now, POLL_MS);
            }
            (Step::Credit, None) => match text(&value, "status")? {
                "SUCCESS" => self.go(if self.sell() { Step::AuthSalt } else { Step::PayoutBalance { index: self.m.data.leg } }),
                "REFUNDED" | "FAILED" => self.m.paused = Some(format!("FUNDING_{}", text(&value, "status")?)),
                _ => self.wait(now, POLL_MS * 2),
            },
            (Step::AuthSalt, None) => {
                let salt = text(&value, "salt")?.to_string();
                self.go(Step::Authenticate { salt });
            }
            (Step::Authenticate { .. }, None) => {
                self.m.data.access_token = Some(text(&value, "accessToken")?.to_string());
                self.go(Step::Balances);
            }
            (Step::Authenticate { .. }, Some(401)) | (Step::Balances, Some(401)) => {
                // Research fallback: a route-confirmed credit uses the quote's guaranteed minimum.
                let minimum = self.m.data.funding_quote.as_ref().ok_or(SignerError::InvalidInput)?.min_amount_out;
                self.credit(minimum, "route_success_minimum")?;
            }
            (Step::Balances, None) => {
                let available = aurora::private_available(&value, &self.m.data.source_asset)?;
                self.credit(available, "authenticated_balance")?;
            }
            (Step::PayoutQuote { index }, None) => {
                let request = self.m.data.payouts[index].request.clone().ok_or(SignerError::InvalidInput)?;
                let quote = aurora::check_quote(&request, &value, now)?;
                let portion = self.m.data.payouts[index].portion;
                if quote.amount_in > portion {
                    return Err(SignerError::InvalidInput);
                }
                self.m.data.payouts[index].quote = Some(quote.clone());
                if self.sell() {
                    self.go(Step::PayoutIntent { index });
                    return Ok(());
                }
                let (planned_portion, planned_min) = self.m.data.estimates.get(index).copied().ok_or(SignerError::InvalidInput)?;
                let floor = portion * planned_min * U256::from(10_000 - PRICE_TOLERANCE_BPS) / U256::from(10_000);
                if quote.min_amount_out * planned_portion < floor {
                    self.m.reapproval = Some(self.requote_text(&format!("Payout {} now guarantees at least {} USDG for {} USDC.", index + 1, usdc(quote.min_amount_out), usdc(portion))));
                    return Ok(());
                }
                self.go(Step::PayoutIntent { index });
            }
            (Step::PayoutIntent { index }, None) => {
                if !self.can_sign(now) {
                    return Ok(());
                }
                let intent = value.get("intent").cloned().ok_or(SignerError::InvalidInput)?;
                let quote = self.m.data.payouts[index].quote.clone().ok_or(SignerError::InvalidInput)?;
                let payload = text(&intent, "payload")?;
                let token = aurora::private_token_id(payload, &self.m.data.source_asset)?;
                if self.m.data.private_token_id.as_ref().is_some_and(|t| *t != token) {
                    return Err(SignerError::InvalidInput);
                }
                let portion = self.m.data.payouts[index].portion;
                let quoted = quote.amount_in;
                if quoted.is_zero() || quoted > portion {
                    return Err(SignerError::InvalidInput);
                }
                let payload = aurora::check_intent(&intent, self.m.confidential, &quote.deposit_address, &token, portion, now)
                    .or_else(|_| aurora::check_intent(&intent, self.m.confidential, &quote.deposit_address, &token, quoted, now))?;
                let key = self.key(CONFIDENTIAL_ACCOUNT)?;
                let sig = evm::sign(&key, evm::personal_hash(payload.as_bytes()))?;
                self.m.data.private_token_id = Some(token);
                self.m.data.payouts[index].signed = Some(json!({"standard": "erc191", "payload": payload, "signature": aurora::encode_signature(&sig)}));
                self.go(Step::PayoutSubmit { index });
            }
            (Step::PayoutSubmit { index }, reject) => {
                if reject.is_none() {
                    self.m.data.payouts[index].intent_hash = Some(text(&value, "intentHash")?.to_string());
                }
                if self.sell() {
                    self.go(Step::PayoutStatus { index, polls: 0, resubmitted: false });
                } else {
                    self.go(if index == 2 { Step::PayoutStatus { index: 0, polls: 0, resubmitted: false } } else { Step::PayoutQuote { index: index + 1 } });
                }
            }
            (Step::PayoutStatus { index, polls, resubmitted }, None) => match text(&value, "status")? {
                "SUCCESS" => self.go(Step::PayoutBalance { index }),
                "REFUNDED" | "FAILED" => self.m.paused = Some(format!("PAYOUT_{}_{}", index + 1, text(&value, "status")?)),
                "PENDING_DEPOSIT" | "INCOMPLETE_DEPOSIT" if polls >= RESUBMIT_AFTER_POLLS && (resubmitted || self.m.data.payouts[index].intent_hash.is_none()) && self.m.resubmits < 3 => {
                    self.m.resubmits += 1;
                    self.m.step = Step::PayoutSubmit { index };
                }
                _ => {
                    self.m.step = Step::PayoutStatus { index, polls: polls + 1, resubmitted };
                    self.wait(now, POLL_MS * 2);
                }
            },
            (Step::PayoutBalance { index }, None) => {
                if self.sell() {
                    let usdc_out = rpc_uint(&value, 0)?;
                    let min = self.m.data.payouts[index].quote.as_ref().ok_or(SignerError::InvalidInput)?.min_amount_out;
                    if usdc_out < min {
                        self.wait(now, POLL_MS);
                        return Ok(());
                    }
                    self.m.data.payouts[index].delivered = usdc_out;
                    self.m.data.orders[index].complete = true;
                    self.m.data.orders[index].received_total = usdc_out;
                    self.after_order(index);
                    return Ok(());
                }
                let usdg = rpc_uint(&value, 0)?;
                let min = self.m.data.payouts[index].quote.as_ref().ok_or(SignerError::InvalidInput)?.min_amount_out;
                if usdg < min {
                    self.wait(now, POLL_MS);
                    return Ok(());
                }
                self.m.data.payouts[index].delivered = usdg;
                if index == 2 {
                    self.go(Step::FusionBalance { index: 0 });
                } else {
                    self.m.data.leg = index + 1;
                    self.go(Step::SourceChain { execute: true });
                }
            }
            (Step::FusionBalance { index }, None) => {
                let (usdg, target, eth) = (rpc_uint(&value, 0)?, rpc_uint(&value, 1)?, rpc_quantity(&value, 2)?);
                if !eth.is_zero() {
                    self.m.paused = Some(format!("RECIPIENT_{}_HOLDS_ETH", index + 1));
                    return Ok(());
                }
                let o = &mut self.m.data.orders[index];
                if usdg.is_zero() {
                    o.complete = true;
                    self.after_order(index);
                    return Ok(());
                }
                o.before_usdg = usdg;
                o.before_target = target;
                o.amount = usdg;
                self.go(Step::FusionPreview { index });
            }
            (Step::FusionPreview { index }, None) => {
                let end = evm::decimal(text(&value, "auctionEndAmount")?)?;
                if value["liquidity"]["passes"] != json!(true) {
                    self.m.paused = Some("TARGET_ILLIQUID".into());
                    return Ok(());
                }
                let min_out = fusion::minimum_out(end);
                let amount = self.m.data.orders[index].amount;
                self.m.data.orders[index].min_out = min_out;
                if self.sell() {
                    if min_out.is_zero() {
                        self.m.paused = Some("TARGET_ILLIQUID".into());
                        return Ok(());
                    }
                    self.m.data.leg = index;
                    self.go(Step::SellQuote { index });
                    return Ok(());
                }
                let floor = amount * self.m.data.rate_end * U256::from(10_000 - PRICE_TOLERANCE_BPS) / U256::from(10_000);
                if min_out * self.m.data.rate_amount < floor {
                    self.m.reapproval = Some(self.requote_text(&format!("Order {} now returns at least {} {} for {} USDG.", index + 1, units(min_out, self.m.data.target_decimals), self.m.data.target_symbol, usdc(amount))));
                    return Ok(());
                }
                self.go(Step::FusionPermit { index });
            }
            (Step::SellQuote { index }, None) => {
                let request = self.m.data.payouts[index].request.clone().ok_or(SignerError::InvalidInput)?;
                let quote = aurora::check_quote(&request, &value, now)?;
                let expected = self.m.data.orders[index].min_out;
                if quote.amount_in > expected {
                    return Err(SignerError::InvalidInput);
                }
                self.m.data.orders[index].inbound = Some(quote.clone());
                self.m.data.funding_quote = Some(quote);
                self.go(Step::FusionPermit { index });
            }
            (Step::FusionPermit { index }, None) => {
                if !self.can_sign(now) {
                    return Ok(());
                }
                let deadline = now / 1000 + PERMIT_LIFETIME_SECS;
                let permit = Permit {
                    name: text(&value, "name")?.to_string(),
                    version: text(&value, "version")?.to_string(),
                    token: if self.sell() { self.m.plan.target } else { ROBINHOOD_USDG },
                    owner: self.holder(index),
                    value: self.m.data.orders[index].amount,
                    nonce: evm::decimal(text(&value, "nonce")?)?,
                    deadline,
                };
                let key = self.key(self.signer_index(index))?;
                let sig = evm::sign(&key, permit.digest()?)?;
                let o = &mut self.m.data.orders[index];
                o.permit = Some(alloy_primitives::hex::encode_prefixed(permit.encode(&sig)));
                o.permit_deadline = deadline;
                self.go(Step::FusionOrder { index });
            }
            (Step::FusionOrder { index }, None) => {
                let order: LimitOrder = serde_json::from_value(value["order"].clone()).map_err(|_| SignerError::InvalidInput)?;
                let extension = text(&value, "extension")?.to_string();
                let o = self.m.data.orders[index].clone();
                let deposit = if self.sell() {
                    evm::addr(&o.inbound.as_ref().ok_or(SignerError::InvalidInput)?.deposit_address)?
                } else {
                    Address::ZERO
                };
                let approved = ApprovedOrder {
                    maker: self.holder(index),
                    target: if self.sell() { ROBINHOOD_USDG } else { self.m.plan.target },
                    amount: o.amount,
                    min_out: o.min_out,
                    permit: evm::hex_bytes(o.permit.as_deref().ok_or(SignerError::InvalidInput)?)?,
                    permit_deadline: o.permit_deadline,
                    maker_asset: if self.sell() { self.m.plan.target } else { ROBINHOOD_USDG },
                    receiver: deposit,
                };
                let checked = fusion::check_order(&order, &extension, &approved, now / 1000)?;
                if !text(&value, "orderHash")?.eq_ignore_ascii_case(&format!("{:#x}", checked.hash)) {
                    return Err(SignerError::InvalidInput);
                }
                let o = &mut self.m.data.orders[index];
                o.order = Some(order);
                o.extension = Some(extension);
                o.quote_id = Some(text(&value, "quoteId")?.to_string());
                o.order_hash = Some(checked.hash);
                o.expiration = checked.expiration;
                o.fills.clear();
                self.go(Step::FusionSign { index });
            }
            (Step::FusionSubmit { index }, _) => {
                self.go(Step::FusionStatus { index });
                self.wait(now, POLL_MS);
            }
            (Step::FusionStatus { index }, None) => {
                let status = text(&value, "status")?.to_string();
                let fills = value.get("fills").and_then(Value::as_array).ok_or(SignerError::InvalidInput)?;
                self.m.data.orders[index].fills = fills
                    .iter()
                    .map(|f| Ok((text(f, "txHash")?.to_string(), evm::decimal(text(f, "filledMakerAmount")?)?)))
                    .collect::<Result<_, SignerError>>()?;
                match status.as_str() {
                    "filled" => self.go(Step::FusionReceipts { index }),
                    "expired" | "cancelled" | "not-accepted" | "not_accepted" => self.go(Step::FusionReceipts { index }),
                    _ if now / 1000 > self.m.data.orders[index].expiration + 60 => self.go(Step::FusionReceipts { index }),
                    _ => self.wait(now, POLL_MS),
                }
            }
            (Step::FusionStatus { index }, Some(404)) => {
                if now / 1000 > self.m.data.orders[index].expiration + 60 {
                    self.go(Step::FusionReceipts { index });
                } else {
                    self.wait(now, POLL_MS);
                }
            }
            (Step::FusionReceipts { index }, None) => {
                let maker = self.holder(index);
                let dest = if self.sell() {
                    evm::addr(&self.m.data.orders[index].inbound.as_ref().ok_or(SignerError::InvalidInput)?.deposit_address)?
                } else {
                    maker
                };
                let from_token = if self.sell() { self.m.plan.target } else { ROBINHOOD_USDG };
                let to_token = if self.sell() { ROBINHOOD_USDG } else { self.m.plan.target };
                let topic = keccak256("Transfer(address,address,uint256)");
                let mut swapped = U256::ZERO;
                let mut received = U256::ZERO;
                for i in 0..self.m.data.orders[index].fills.len() {
                    let receipt = rpc_result(&value, i as u64)?;
                    if receipt.get("status").and_then(Value::as_str) != Some("0x1") {
                        self.m.paused = Some(format!("FUSION_{}_FILL_REVERTED", index + 1));
                        return Ok(());
                    }
                    for log in receipt.get("logs").and_then(Value::as_array).ok_or(SignerError::InvalidInput)? {
                        let topics: Vec<B256> = log.get("topics").and_then(Value::as_array).ok_or(SignerError::InvalidInput)?.iter().filter_map(|t| t.as_str()?.parse().ok()).collect();
                        if topics.len() != 3 || topics[0] != topic {
                            continue;
                        }
                        let emitter = evm::addr(text(log, "address")?)?;
                        let amount = U256::from_be_slice(&evm::hex_bytes(text(log, "data")?)?);
                        let from = Address::from_slice(&topics[1][12..]);
                        let to = Address::from_slice(&topics[2][12..]);
                        if emitter == from_token && from == maker {
                            swapped += amount;
                        }
                        if emitter == to_token && to == dest {
                            received += amount;
                        }
                    }
                }
                let filled = self.m.data.orders[index].fills.iter().fold(U256::ZERO, |sum, (_, v)| sum + *v);
                if swapped != filled {
                    self.m.paused = Some(format!("FUSION_{}_UNRECONCILED", index + 1));
                    return Ok(());
                }
                let o = &mut self.m.data.orders[index];
                o.swapped = swapped;
                o.received = received;
                self.go(Step::FusionAfter { index });
            }
            (Step::FusionAfter { index }, None) => {
                let (usdg, target, eth) = (rpc_uint(&value, 0)?, rpc_uint(&value, 1)?, rpc_quantity(&value, 2)?);
                let o = self.m.data.orders[index].clone();
                if self.sell() {
                    let filled_all = o.swapped == o.amount;
                    if !eth.is_zero() || target.checked_add(o.swapped) != Some(o.before_target) || o.received < o.min_out {
                        self.m.paused = Some(format!("FUSION_{}_UNRECONCILED", index + 1));
                        return Ok(());
                    }
                    if !filled_all {
                        if o.attempts + 1 >= MAX_FUSION_ATTEMPTS {
                            self.m.paused = Some(format!("FUSION_{}_UNFILLED", index + 1));
                        } else {
                            self.m.data.orders[index].attempts += 1;
                            self.m.data.orders[index].amount = target;
                            self.m.data.orders[index].before_target = target;
                            self.go(Step::FusionPreview { index });
                        }
                        return Ok(());
                    }
                    let inbound = o.inbound.clone().ok_or(SignerError::InvalidInput)?;
                    self.m.data.funding_quote = Some(inbound);
                    self.m.data.orders[index].received_total += o.received;
                    self.m.data.leg = index;
                    self.go(Step::Credit);
                    return Ok(());
                }
                let filled_all = o.swapped == o.amount;
                if !eth.is_zero() || o.before_usdg.checked_sub(o.swapped) != Some(usdg) || target < o.before_target || target - o.before_target != o.received || (filled_all && o.received < o.min_out) {
                    self.m.paused = Some(format!("FUSION_{}_UNRECONCILED", index + 1));
                    return Ok(());
                }
                let order = &mut self.m.data.orders[index];
                order.received_total += o.received;
                if usdg.is_zero() {
                    order.complete = true;
                    self.after_order(index);
                } else if order.attempts + 1 >= MAX_FUSION_ATTEMPTS {
                    self.m.paused = Some(format!("FUSION_{}_UNFILLED", index + 1));
                } else {
                    order.attempts += 1;
                    self.go(Step::FusionBalance { index });
                }
            }
            (Step::Assets | Step::TargetChain | Step::SourceChain { .. } | Step::Holdings, Some(_)) => self.m.paused = Some("PLANNING_UNAVAILABLE".into()),
            (Step::FundingProbe | Step::FundingPrepare { .. }, Some(_)) => self.m.paused = Some("FUNDING_UNAVAILABLE".into()),
            (Step::FundingQuote { .. } | Step::PayoutEstimate { .. } | Step::PayoutQuote { .. } | Step::SellQuote { .. }, Some(_)) => self.m.paused = Some("QUOTE_REJECTED".into()),
            (Step::FusionEstimate | Step::FusionPreview { .. } | Step::FusionOrder { .. } | Step::FusionPermit { .. }, Some(_)) => self.m.paused = Some("FUSION_UNAVAILABLE".into()),
            (_, Some(code)) => self.m.paused = Some(format!("PROVIDER_{code}")),
            _ => return Err(SignerError::InvalidInput),
        }
        Ok(())
    }

    fn credit(&mut self, available: U256, basis: &str) -> Result<(), SignerError> {
        if available.is_zero() || available > U256::from(MAX_SOURCE_ATOMS) {
            return Err(SignerError::InvalidInput);
        }
        self.m.data.available = available;
        self.m.data.credit_basis = Some(basis.into());
        self.m.data.access_token = None;
        self.go(Step::PayoutQuote { index: if self.sell() { self.m.data.leg } else { 0 } });
        Ok(())
    }

    fn after_order(&mut self, index: usize) {
        if self.sell() {
            match self.next_sell_index(index + 1) {
                Some(next) => self.go(Step::FusionPreview { index: next }),
                None => self.go(Step::Done),
            }
        } else {
            self.go(if index == 2 { Step::Done } else { Step::FusionBalance { index: index + 1 } });
        }
    }

    fn lost_submit(&mut self) {
        self.m.step = match self.m.step.clone() {
            Step::FundingSubmit => Step::FundingReceipt { polls: 0, resubmitted: true },
            Step::PayoutSubmit { index } => Step::PayoutStatus { index, polls: 0, resubmitted: true },
            Step::FusionSubmit { index } => Step::FusionStatus { index },
            other => other,
        };
    }

    fn requote_text(&self, change: &str) -> String {
        format!("QUOTE CHANGED OUTSIDE THE APPROVED LIMITS\n\n{change}\n\nApprove to continue with this quote, or cancel. Funds already moved stay where they are: see Swap status.")
    }

    fn review(&self) -> String {
        if self.sell() {
            return self.review_sell();
        }
        let d = &self.m.data;
        let mut out = format!(
            "SWAP · MAINNET\nMonad USDC → Aurora → Robinhood USDG → {sym}\n\nTarget {sym} ({dec} decimals)\nContract {target}\n\nFunding wallet F {f}\nF USDC balance {bal}\nUsed now {amount} USDC + gas at most {fee} USDC (paid in USDC)\n",
            sym = d.target_symbol,
            dec = d.target_decimals,
            target = self.m.plan.target.to_checksum(None),
            f = self.m.source.to_checksum(None),
            bal = usdc(d.source_balance),
            amount = usdc(d.funding_amount),
            fee = usdc(d.funding_fee),
        );
        for (i, (portion, min)) in d.estimates.iter().enumerate() {
            out.push_str(&format!("\nBridge {} of 3 (30/30/40) to fresh wallet A{} {}\n  {} USDC → at least {} USDG, then sold for {} via 1inch Fusion\n", i + 1, i + 1, self.m.recipients[i].to_checksum(None), usdc(*portion), usdc(*min), d.target_symbol));
        }
        out.push_str(&format!(
            "\nFusion limit: at least {} {} per {} USDG, 1% slippage, prices may move up to 3% before the app asks again.\n\nPRIVACY: This buy is a public Aurora bridge. F's deposit and the Ai stock balances are public on chain. One app gateway key and the timing of these steps can let the gateway operator link F with A1–A3.\n\nOne approval authorizes up to 12 signatures for 15 minutes, bound to these limits. After 15 minutes you unlock again for this same plan. The operation expires in 24 hours. Steps are sequential and cannot be undone once submitted.",
            units(fusion::minimum_out(d.rate_end), d.target_decimals),
            d.target_symbol,
            usdc(d.rate_amount),
        ));
        out
    }

    fn review_sell(&self) -> String {
        let d = &self.m.data;
        let mut out = format!(
            "CONFIDENTIAL SELL · MAINNET\n{sym} → USDG (Fusion) → confidential balance → three new Monad USDC wallets\n\nSelling {sym} ({dec} decimals)\nContract {target}\nConfidential balance C {c}\n",
            sym = d.target_symbol,
            dec = d.target_decimals,
            target = self.m.plan.target.to_checksum(None),
            c = self.m.confidential.to_checksum(None),
        );
        for i in 0..3 {
            out.push_str(&format!(
                "\nLeg {} of 3\n  Hold {sym} in {holder}\n  {amount} {sym} sells for USDG into Aurora, then pays Monad USDC to new wallet {ret}\n",
                i + 1,
                sym = d.target_symbol,
                holder = self.m.holders[i].to_checksum(None),
                amount = units(d.orders[i].amount, d.target_decimals),
                ret = self.m.recipients[i].to_checksum(None),
            ));
        }
        out.push_str("\nPRIVACY: The old Ai stock wallets stay public. Proceeds go to three fresh indices that are never reused. One app gateway key can still time-link the legs.\n\nOne approval authorizes the Fusion permits, orders and confidential payouts for 15 minutes. After 15 minutes you unlock again for this same plan. The operation expires in 24 hours. Steps cannot be undone once submitted.");
        out
    }

    fn public_status(&self) -> Value {
        let d = &self.m.data;
        let phase = if self.m.cancelled {
            "CANCELLED"
        } else if self.m.paused.is_some() {
            "PAUSED"
        } else if self.m.reapproval.is_some() {
            "REVIEW"
        } else {
            match self.m.step {
                Step::Assets | Step::SourceChain { execute: false } | Step::TargetChain | Step::Holdings | Step::FundingProbe | Step::PayoutEstimate { .. } | Step::FusionEstimate => "PLANNING",
                Step::FundingQuote { .. } | Step::FundingPrepare { .. } if self.m.approved_ms.is_none() => "PLANNING",
                Step::Review if self.m.approved_ms.is_none() => "REVIEW",
                Step::Review | Step::SourceChain { .. } | Step::FundingQuote { .. } | Step::FundingPrepare { .. } | Step::FundingSign | Step::FundingSubmit | Step::FundingReceipt { .. } => "FUNDING",
                Step::Credit | Step::AuthSalt | Step::Authenticate { .. } | Step::Balances => "CREDITED",
                Step::PayoutQuote { .. } | Step::PayoutIntent { .. } | Step::PayoutSubmit { .. } | Step::PayoutStatus { .. } | Step::PayoutBalance { .. } => "PAYOUTS",
                Step::Done => "COMPLETE",
                _ => "FUSION",
            }
        };
        json!({
            "operationId": self.m.id,
            "phase": phase,
            "step": step_name(&self.m.step),
            "pausedCode": self.m.paused,
            "targetSymbol": d.target_symbol,
            "targetDecimals": d.target_decimals,
            "sourceAtoms": d.funding_amount.to_string(),
            "creditedAtoms": d.available.to_string(),
            "payoutsSubmitted": d.payouts.iter().filter(|p| p.signed.is_some()).count(),
            "ordersComplete": d.orders.iter().filter(|o| o.complete).count(),
            "receivedTargetAtoms": d.orders.iter().fold(U256::ZERO, |sum, o| sum + o.received_total).to_string(),
            "direction": if self.sell() { "sell" } else { "buy" },
            "authorizationUntilMs": self.m.session_until_ms,
            "expiresAtMs": self.m.created_ms + OPERATION_MS,
        })
    }
}

fn status_body(quote: &Quote) -> Value {
    match &quote.deposit_memo {
        Some(memo) => json!({"depositAddress": quote.deposit_address, "depositMemo": memo}),
        None => json!({"depositAddress": quote.deposit_address}),
    }
}

fn step_name(step: &Step) -> String {
    serde_json::to_value(step).ok().and_then(|v| v.get("step").and_then(Value::as_str).map(str::to_string)).unwrap_or_default()
}

#[derive(uniffi::Object)]
pub struct SwapOperation {
    inner: Mutex<Engine>,
}

#[uniffi::export]
impl SwapOperation {
    /// `plan` is buy `{"kind":"confidentialSwap",...}` or sell `{"kind":"confidentialSell","holderIndices":[…],…}`.
    #[uniffi::constructor]
    pub fn start(plan: String, entropy: Vec<u8>, gateway: String, now_ms: u64) -> Result<Arc<Self>, SignerError> {
        if plan.len() > 2048 {
            return Err(SignerError::InvalidInput);
        }
        let plan: Plan = serde_json::from_str(&plan).map_err(|_| SignerError::InvalidInput)?;
        let [a, b, c] = plan.recipient_indices;
        let sell = plan.kind == "confidentialSell";
        if (plan.kind != "confidentialSwap" && !sell) || a < FIRST_RECIPIENT || a == b || b == c || a == c || b < FIRST_RECIPIENT || c < FIRST_RECIPIENT {
            return Err(SignerError::InvalidInput);
        }
        let holders = if sell {
            let [h0, h1, h2] = plan.holder_indices.ok_or(SignerError::InvalidInput)?;
            if h0 < FIRST_RECIPIENT || h1 < FIRST_RECIPIENT || h2 < FIRST_RECIPIENT || h0 == h1 || h1 == h2 || h0 == h2 {
                return Err(SignerError::InvalidInput);
            }
            let used = [h0, h1, h2, a, b, c];
            if used.iter().collect::<std::collections::HashSet<_>>().len() != 6 {
                return Err(SignerError::InvalidInput);
            }
            Some([h0, h1, h2])
        } else if plan.holder_indices.is_some() {
            return Err(SignerError::InvalidInput);
        } else {
            None
        };
        if let Some(amount) = &plan.amount_atoms {
            if sell {
                return Err(SignerError::InvalidInput);
            }
            let v = evm::decimal(amount)?;
            if v.is_zero() || v > U256::from(MAX_SOURCE_ATOMS) {
                return Err(SignerError::InvalidInput);
            }
        }
        let seed = seed_from_entropy(entropy)?;
        let at = |i| derive_key(&seed, i).map(|k| evm::key_address(&k));
        let holder_addrs = match holders {
            Some([h0, h1, h2]) => [at(h0)?, at(h1)?, at(h2)?],
            None => [Address::ZERO; 3],
        };
        let machine = Machine {
            version: STATE_VERSION,
            id: format!("{:#x}", keccak256(format!("{}:{}:{:?}:{}", now_ms, at(FUNDING_ACCOUNT)?, plan.recipient_indices, plan.kind))),
            source: at(FUNDING_ACCOUNT)?,
            confidential: at(CONFIDENTIAL_ACCOUNT)?,
            recipients: [at(a)?, at(b)?, at(c)?],
            holders: holder_addrs,
            plan,
            created_ms: now_ms,
            approved_ms: None,
            session_until_ms: now_ms + SESSION_MS,
            step: Step::Assets,
            reapproval: None,
            resubmits: 0,
            paused: None,
            cancelled: false,
            next_id: 0,
            pending: None,
            failures: 0,
            wait_until_ms: 0,
            data: Data::default(),
        };
        Ok(Arc::new(Self { inner: Mutex::new(Engine { m: machine, gateway: gateway_base(&gateway)?, seed: Some(seed) }) }))
    }

    /// Resumes a persisted operation without key material; signing waits for `unlock`.
    #[uniffi::constructor]
    pub fn restore(state: String, gateway: String) -> Result<Arc<Self>, SignerError> {
        let m: Machine = serde_json::from_str(&state).map_err(|_| SignerError::InvalidInput)?;
        if m.version != STATE_VERSION {
            return Err(SignerError::InvalidInput);
        }
        Ok(Arc::new(Self { inner: Mutex::new(Engine { m, gateway: gateway_base(&gateway)?, seed: None }) }))
    }

    pub fn next_step(&self, now_ms: u64) -> Result<SwapStep, SignerError> {
        let mut e = self.inner.lock().map_err(|_| SignerError::CryptoFailed)?;
        e.next(now_ms)
    }

    pub fn on_response(&self, id: u64, status: u16, body: String, now_ms: u64) -> Result<(), SignerError> {
        if body.len() > 1 << 20 {
            return Err(SignerError::InvalidInput);
        }
        let mut e = self.inner.lock().map_err(|_| SignerError::CryptoFailed)?;
        e.respond(id, status, &body, now_ms)
    }

    /// Called only by the native review after a passkey assertion. Opens the 15-minute authorization.
    pub fn approve(&self, now_ms: u64) -> Result<(), SignerError> {
        let mut e = self.inner.lock().map_err(|_| SignerError::CryptoFailed)?;
        if e.m.cancelled || e.seed.is_none() || now_ms >= e.m.session_until_ms || now_ms >= e.m.created_ms + OPERATION_MS {
            e.seed = None;
            return Err(SignerError::Expired);
        }
        if e.m.reapproval.take().is_some() {
            // Continue with exactly the quote that was shown; a later requote is checked again.
            e.m.step = match e.m.step.clone() {
                Step::FundingQuote { attempt } => Step::FundingPrepare { attempt, execute: true },
                Step::PayoutQuote { index } => Step::PayoutIntent { index },
                Step::FusionPreview { index } if e.sell() => Step::SellQuote { index },
                Step::FusionPreview { index } => Step::FusionPermit { index },
                Step::SellQuote { index } => Step::FusionPermit { index },
                other => other,
            };
            e.m.session_until_ms = now_ms + SESSION_MS;
            return Ok(());
        }
        if e.m.step != Step::Review || e.m.approved_ms.is_some() {
            return Err(SignerError::InvalidInput);
        }
        e.m.approved_ms = Some(now_ms);
        e.m.session_until_ms = now_ms + SESSION_MS;
        Ok(())
    }

    /// New passkey unlock for the same approved plan; the entropy must derive the same wallets.
    pub fn unlock(&self, entropy: Vec<u8>, now_ms: u64) -> Result<(), SignerError> {
        let mut e = self.inner.lock().map_err(|_| SignerError::CryptoFailed)?;
        if e.m.cancelled || now_ms >= e.m.created_ms + OPERATION_MS {
            return Err(SignerError::Expired);
        }
        let seed = seed_from_entropy(entropy)?;
        let holders_ok = match e.m.plan.holder_indices {
            Some(indices) => indices.iter().zip(e.m.holders).all(|(i, a)| derive_key(&seed, *i).is_ok_and(|k| evm::key_address(&k) == a)),
            None => e.m.holders.iter().all(|a| a.is_zero()),
        };
        let same = evm::key_address(&derive_key(&seed, FUNDING_ACCOUNT)?) == e.m.source
            && evm::key_address(&derive_key(&seed, CONFIDENTIAL_ACCOUNT)?) == e.m.confidential
            && e.m.plan.recipient_indices.iter().zip(e.m.recipients).all(|(i, a)| derive_key(&seed, *i).is_ok_and(|k| evm::key_address(&k) == a))
            && holders_ok;
        if !same {
            return Err(SignerError::InvalidInput);
        }
        e.seed = Some(seed);
        e.m.session_until_ms = now_ms + SESSION_MS;
        Ok(())
    }

    /// Clears a pause so the current step runs again (it re-validates everything it receives).
    pub fn retry(&self) {
        if let Ok(mut e) = self.inner.lock()
            && !e.m.cancelled
        {
            e.m.paused = None;
            e.m.failures = 0;
            e.m.wait_until_ms = 0;
        }
    }

    /// Stops all future signatures. Submitted steps cannot be undone.
    pub fn cancel(&self) {
        if let Ok(mut e) = self.inner.lock() {
            e.m.cancelled = true;
            e.seed = None;
        }
    }

    /// Serialized state without key material. Contains signed payloads: persist it encrypted only.
    pub fn export_state(&self) -> Result<String, SignerError> {
        let e = self.inner.lock().map_err(|_| SignerError::CryptoFailed)?;
        serde_json::to_string(&e.m).map_err(|_| SignerError::CryptoFailed)
    }

    /// Public phase status for JS: no addresses, hashes or signed data.
    pub fn public_status(&self) -> String {
        self.inner.lock().map(|e| e.public_status().to_string()).unwrap_or_else(|_| "{}".into())
    }

    pub fn operation_id(&self) -> String {
        self.inner.lock().map(|e| e.m.id.clone()).unwrap_or_default()
    }
}

#[cfg(test)]
#[path = "engine_tests.rs"]
mod tests;