//! Drives `SwapOperation` against a scripted gateway and chains. The fake builds provider payloads the
//! validators accept and verifies every signature it receives against the wallet that must have made it.
use super::*;
use crate::swap::aurora::iso_string;
use alloy_primitives::{address, hex};
use base64::Engine as _;
use std::collections::{HashMap, HashSet};

const T0: u64 = 1_790_300_000_000;
const ENTROPY: [u8; 32] = [7; 32];
const GATEWAY: &str = "https://gateway.test";
const SRC: &str = "nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx";
const DST: &str = "nep141:hood-0x5fc5360d0400a0fd4f2af552add042d716f1d168.omft.near";
const AMZN: Address = address!("0x12f190a9F9d7D37a250758b26824B97CE941bF54");
const FEE: u64 = 3_000;
const WEI_PER_ATOM: u64 = 4_000_000_000;

#[derive(Clone, Copy, PartialEq)]
enum Tamper {
    None,
    FundingRecipient,
    QuoteRefund,
    OrderReceiver,
}

struct Wallets {
    f: Address,
    c: Address,
    a: [Address; 3],
}

fn wallets() -> Wallets {
    let seed = seed_from_entropy(ENTROPY.to_vec()).unwrap();
    let at = |i| evm::key_address(&derive_key(&seed, i).unwrap());
    Wallets {
        f: at(FUNDING_ACCOUNT),
        c: at(CONFIDENTIAL_ACCOUNT),
        a: [at(3), at(4), at(5)],
    }
}

struct World {
    w: Wallets,
    tamper: Tamper,
    /// Pimlico's approve amount relative to the signed fee cap.
    approve_delta: i64,
    /// Order drafts still to return 3% under the previewed auction end.
    short_orders: u8,
    f_balance: U256,
    payout_rate_bps: u64,
    credit: U256,
    credit_delay_ms: u64,
    credit_ready_ms: Option<u64>,
    transient_submit_once: bool,
    usdg: HashMap<Address, U256>,
    target: HashMap<Address, U256>,
    monad_usdc: HashMap<Address, U256>,
    origin_deposit: HashMap<Address, String>,
    deposits: HashMap<String, (Address, U256, U256, bool)>,
    credited: HashSet<String>,
    last_deposit: Option<String>,
    funded_at: HashMap<String, u64>,
    permits: HashMap<B256, Vec<u8>>,
    fills: HashMap<B256, (String, Address, U256, U256, Address, bool)>,
    user_ops: usize,
    intents: usize,
    orders: usize,
    paths: Vec<String>,
    return_receipts: HashMap<String, Value>,
    return_submits: usize,
    return_gas: bool,
}

impl World {
    fn new() -> Self {
        Self {
            w: wallets(),
            tamper: Tamper::None,
            approve_delta: 0,
            short_orders: 0,
            f_balance: U256::from(2_000_000u64),
            payout_rate_bps: 9_900,
            credit: U256::ZERO,
            credit_delay_ms: 0,
            credit_ready_ms: None,
            transient_submit_once: false,
            usdg: HashMap::new(),
            target: HashMap::new(),
            monad_usdc: HashMap::new(),
            origin_deposit: HashMap::new(),
            deposits: HashMap::new(),
            credited: HashSet::new(),
            last_deposit: None,
            funded_at: HashMap::new(),
            permits: HashMap::new(),
            fills: HashMap::new(),
            user_ops: 0,
            intents: 0,
            orders: 0,
            paths: vec![],
            return_receipts: HashMap::new(),
            return_submits: 0,
            return_gas: false,
        }
    }

    fn handle(&mut self, url: &str, body: Option<&str>, now: u64) -> (u16, String) {
        let body: Value = body
            .map(|b| serde_json::from_str(b).unwrap())
            .unwrap_or(Value::Null);
        if url == MONAD_RPC {
            return (200, rpc_reply(&body, |m, p| self.monad(m, p)).to_string());
        }
        if url == ROBINHOOD_RPC {
            return (
                200,
                rpc_reply(&body, |m, p| self.robinhood(m, p)).to_string(),
            );
        }
        let path = url
            .strip_prefix(GATEWAY)
            .expect("only the configured gateway is called")
            .to_string();
        self.paths.push(path.clone());
        let s = |v: &Value, k: &str| v[k].as_str().unwrap().to_string();
        let ok = |v: Value| (200, v.to_string());
        match path.as_str() {
            "/v1/swap/aurora/tokens" => ok(json!({"tokens": [
                {"assetId": SRC, "blockchain": "monad", "symbol": "USDC", "decimals": 6, "contractAddress": format!("{MONAD_USDC:#x}")},
                {"assetId": "nep141:eth-usdc", "blockchain": "eth", "symbol": "USDC", "decimals": 6, "contractAddress": format!("{MONAD_USDC:#x}")},
                {"assetId": DST, "blockchain": "hood", "symbol": "USDG", "decimals": 6, "contractAddress": format!("{ROBINHOOD_USDG:#x}")},
            ]})),
            "/v1/swap/monad/prepare-funding" => ok(self.prepare(
                evm::addr(&s(&body, "owner")).unwrap(),
                evm::addr(&s(&body, "recipient")).unwrap(),
                evm::decimal(&s(&body, "amount")).unwrap(),
                now,
            )),
            "/v1/swap/aurora/quote" => ok(self.quote(body, now)),
            "/v1/swap/monad/submit" => {
                let hash = self.submit_operation(&body["userOperation"], now);
                if std::mem::take(&mut self.transient_submit_once) {
                    return (503, String::new());
                }
                ok(json!({"userOperationHash": format!("{hash:#x}")}))
            }
            "/v1/swap/monad/receipt" => ok(if self.credit_ready_ms.is_some() {
                json!({"found": true, "success": true, "transactionHash": "0x01"})
            } else {
                json!({"found": false})
            }),
            "/v1/swap/aurora/status" => {
                let deposit = s(&body, "depositAddress");
                let done = if let Some(t) = self.funded_at.get(&deposit) {
                    now >= *t
                } else if self.deposits.contains_key(&deposit) {
                    self.credited.contains(&deposit)
                } else {
                    self.credit_ready_ms.is_some_and(|t| now >= t)
                };
                if done
                    && self.credited.insert(deposit.clone())
                    && let Some((recipient, _, out, true)) = self.deposits.get(&deposit).cloned()
                {
                    *self.usdg.entry(recipient).or_default() += out;
                }
                ok(json!({"status": if done { "SUCCESS" } else { "PENDING_DEPOSIT" }}))
            }
            "/v1/swap/aurora/auth-salt" => ok(json!({"salt": "252812b3"})),
            "/v1/swap/aurora/authenticate" => {
                assert_eq!(
                    recover_aurora(&s(&body, "payload"), &s(&body, "signature")),
                    self.w.c
                );
                ok(json!({"accessToken": "token"}))
            }
            "/v1/swap/aurora/balances" => ok(json!({"balances": [
                {"tokenId": SRC, "available": self.credit.to_string(), "source": "private"},
                {"tokenId": SRC, "available": "999", "source": "public"},
            ]})),
            "/v1/swap/aurora/generate-intent" => {
                let deposit = s(&body, "depositAddress");
                let (_, amount, _, _) = self.deposits[&deposit];
                let nonce =
                    base64::engine::general_purpose::STANDARD.encode(keccak256(deposit.as_bytes()));
                let payload = json!({
                    "signer_id": s(&body, "signerId"),
                    "verifying_contract": "intents.far",
                    "deadline": iso_string(now + 300_000),
                    "nonce": nonce,
                    "intents": [{"intent": "transfer", "receiver_id": deposit, "tokens": {format!("imt:{}:{SRC}", "ab".repeat(32)): amount.to_string()}}],
                });
                ok(json!({"intent": {"standard": "erc191", "payload": payload.to_string()}}))
            }
            "/v1/swap/aurora/submit-intent" => {
                let signed = &body["signedData"];
                let payload = s(signed, "payload");
                assert_eq!(recover_aurora(&payload, &s(signed, "signature")), self.w.c);
                let message: Value = serde_json::from_str(&payload).unwrap();
                let deposit = s(&message["intents"][0], "receiver_id");
                if self.credited.insert(deposit.clone()) {
                    self.intents += 1;
                    let (recipient, _, out, dest_usdg) = self.deposits[&deposit];
                    if dest_usdg {
                        *self.usdg.entry(recipient).or_default() += out;
                    } else {
                        *self.monad_usdc.entry(recipient).or_default() += out;
                    }
                }
                ok(json!({"intentHash": format!("intent-{deposit}")}))
            }
            "/v1/swap/fusion/preview" => {
                let amount = evm::decimal(&s(&body, "amount")).unwrap();
                let src = body
                    .get("srcToken")
                    .and_then(Value::as_str)
                    .and_then(|t| evm::addr(t).ok())
                    .unwrap_or(ROBINHOOD_USDG);
                let end = if src == ROBINHOOD_USDG {
                    amount * U256::from(WEI_PER_ATOM)
                } else {
                    amount / U256::from(WEI_PER_ATOM)
                };
                ok(
                    json!({"preset": "fast", "auctionStartAmount": "1", "auctionEndAmount": end.to_string(), "liquidity": {"impactBps": "12", "passes": true}}),
                )
            }
            "/v1/swap/fusion/permit-context" => {
                ok(json!({"name": "Global Dollar", "version": "1", "nonce": "0"}))
            }
            "/v1/swap/fusion/order" => ok(self.order(&body, now)),
            "/v1/swap/fusion/submit" => {
                self.fill(&body);
                (202, json!({"accepted": true}).to_string())
            }
            "/v1/swap/fusion/status" => {
                let hash: B256 = s(&body, "orderHash").parse().unwrap();
                match self.fills.get(&hash) {
                    Some((tx, _, making, _, _, _)) => ok(
                        json!({"status": "filled", "fills": [{"txHash": tx, "filledMakerAmount": making.to_string()}]}),
                    ),
                    None => (404, json!({"code": "FUSION_NOT_FOUND"}).to_string()),
                }
            }
            other => panic!("unexpected gateway path {other}"),
        }
    }

    fn monad(&self, method: &str, params: &Value) -> Value {
        match method {
            "eth_chainId" => json!("0x8f"),
            "eth_getCode" => json!("0x"),
            "eth_getTransactionCount" => json!("0x0"),
            "eth_call" => {
                let data = params[0]["data"].as_str().unwrap();
                if data.starts_with(&evm::encode_call("balanceOf(address)", &[])) {
                    let holder = Address::from_slice(&evm::hex_bytes(data).unwrap()[16..36]);
                    let value = if holder == self.w.f {
                        self.f_balance
                    } else {
                        self.monad_usdc.get(&holder).copied().unwrap_or_default()
                    };
                    json!(word(value))
                } else {
                    json!(word(U256::ZERO))
                }
            }
            _ => panic!("unexpected monad call {method}"),
        }
    }

    fn robinhood(&mut self, method: &str, params: &Value) -> Value {
        match method {
            "eth_chainId" => json!("0x1237"),
            "eth_getBalance" => json!(if self.return_gas {
                "0x38d7ea4c68000"
            } else {
                "0x0"
            }),
            "eth_getCode" => json!("0x"),
            "eth_getTransactionCount" => json!("0x0"),
            "eth_gasPrice" => json!("0x5f5e100"),
            "eth_estimateGas" => json!("0x186a0"),
            "eth_sendRawTransaction" => {
                use alloy_consensus::{SignableTransaction, Signed, TxEip1559};
                let raw = evm::hex_bytes(params[0].as_str().unwrap()).unwrap();
                let tx = Signed::<TxEip1559>::eip2718_decode(&mut raw.as_slice()).unwrap();
                assert_eq!(tx.tx().chain_id, ROBINHOOD_CHAIN_ID);
                assert_eq!(tx.tx().to, alloy_primitives::TxKind::Call(ROBINHOOD_USDG));
                assert!(tx.tx().value.is_zero());
                let sig = tx.signature();
                let from = evm::recover(
                    tx.tx().signature_hash(),
                    &sig.r().to_be_bytes(),
                    &sig.s().to_be_bytes(),
                    sig.v() as u8,
                )
                .unwrap();
                let bytes = tx.tx().input.as_ref();
                assert_eq!(&bytes[..4], &evm::selector("transfer(address,uint256)"));
                let to = Address::from_slice(&bytes[16..36]);
                let amount = U256::from_be_slice(&bytes[36..68]);
                assert_eq!(self.origin_deposit[&from], to.to_checksum(None));
                assert_eq!(self.usdg[&from], amount);
                let hash = format!("{:#x}", keccak256(&raw));
                if !self.return_receipts.contains_key(&hash) {
                    self.return_submits += 1;
                    self.usdg.insert(from, U256::ZERO);
                    self.funded_at.insert(to.to_checksum(None), T0);
                    self.return_receipts.insert(hash.clone(), json!({
                        "transactionHash": hash, "from": from.to_checksum(None), "to": ROBINHOOD_USDG.to_checksum(None),
                        "blockHash": format!("{:#x}", B256::repeat_byte(3)), "status": "0x1", "logs": [{
                            "address": ROBINHOOD_USDG.to_checksum(None),
                            "topics": [format!("{:#x}", keccak256("Transfer(address,address,uint256)")), format!("{:#x}", B256::from(evm::word_address(from))), format!("{:#x}", B256::from(evm::word_address(to)))],
                            "data": word(amount),
                        }]
                    }));
                }
                json!(hash)
            }
            "eth_call" => {
                let data = params[0]["data"].as_str().unwrap();
                let to = evm::addr(params[0]["to"].as_str().unwrap()).unwrap();
                if data == evm::encode_call("symbol()", &[]) {
                    let mut out = vec![];
                    out.extend_from_slice(&evm::word_u256(U256::from(32)));
                    out.extend_from_slice(&evm::word_u256(U256::from(4)));
                    let mut text = [0u8; 32];
                    text[..4].copy_from_slice(if to == ROBINHOOD_USDG {
                        b"USDG"
                    } else {
                        b"AMZN"
                    });
                    out.extend_from_slice(&text);
                    return json!(hex::encode_prefixed(out));
                }
                if data == evm::encode_call("decimals()", &[]) {
                    return json!(word(U256::from(if to == ROBINHOOD_USDG { 6 } else { 18 })));
                }
                let holder = Address::from_slice(&evm::hex_bytes(data).unwrap()[16..36]);
                let book = if to == ROBINHOOD_USDG {
                    &self.usdg
                } else {
                    &self.target
                };
                json!(word(book.get(&holder).copied().unwrap_or_default()))
            }
            "eth_getTransactionReceipt" => {
                let tx = params[0].as_str().unwrap();
                if let Some(receipt) = self.return_receipts.get(tx) {
                    return receipt.clone();
                }
                let (_, maker, making, taking, dest, sell) =
                    self.fills.values().find(|(t, ..)| t == tx).unwrap().clone();
                let topic = keccak256("Transfer(address,address,uint256)");
                let pad = |a: Address| format!("{:#x}", B256::from(evm::word_address(a)));
                if sell {
                    json!({"status": "0x1", "logs": [
                        {"address": format!("{AMZN:#x}"), "topics": [format!("{topic:#x}"), pad(maker), pad(FUSION_SETTLEMENT)], "data": word(making)},
                        {"address": format!("{ROBINHOOD_USDG:#x}"), "topics": [format!("{topic:#x}"), pad(FUSION_SETTLEMENT), pad(dest)], "data": word(taking)},
                    ]})
                } else {
                    json!({"status": "0x1", "logs": [
                        {"address": format!("{ROBINHOOD_USDG:#x}"), "topics": [format!("{topic:#x}"), pad(maker), pad(FUSION_SETTLEMENT)], "data": word(making)},
                        {"address": format!("{AMZN:#x}"), "topics": [format!("{topic:#x}"), pad(FUSION_SETTLEMENT), pad(maker)], "data": word(taking)},
                    ]})
                }
            }
            _ => panic!("unexpected robinhood call {method}"),
        }
    }

    fn prepare(&mut self, owner: Address, recipient: Address, amount: U256, now: u64) -> Value {
        self.last_deposit = Some(recipient.to_checksum(None));
        let recipient = if self.tamper == Tamper::FundingRecipient {
            address!("0x00000000000000000000000000000000000BAd00")
        } else {
            recipient
        };
        let mut data = vec![0u8; 182];
        data[0] = 0x02;
        data[2..8].copy_from_slice(&(now / 1000 + 600).to_be_bytes()[2..]);
        data[14..34].copy_from_slice(MONAD_USDC.as_slice());
        data[50..82].copy_from_slice(&U256::from(100_000u64).to_be_bytes::<32>());
        let approve = evm::hex_bytes(&evm::encode_call(
            "approve(address,uint256)",
            &[
                evm::word_address(PIMLICO_ERC20_PAYMASTER),
                evm::word_u256(U256::from(FEE.saturating_add_signed(self.approve_delta))),
            ],
        ))
        .unwrap();
        let transfer = evm::hex_bytes(&evm::encode_call(
            "transfer(address,uint256)",
            &[evm::word_address(recipient), evm::word_u256(amount)],
        ))
        .unwrap();
        json!({
            "userOperation": {
                "sender": owner.to_checksum(None),
                "nonce": "0x0",
                "factory": "0x7702",
                "factoryData": "0x",
                "callData": hex::encode_prefixed(execute_batch(&[approve, transfer])),
                "callGasLimit": "0x186a0",
                "verificationGasLimit": "0xc350",
                "preVerificationGas": "0x186a0",
                "maxFeePerGas": "0x174876e800",
                "maxPriorityFeePerGas": "0x3b9aca00",
                "paymaster": PIMLICO_ERC20_PAYMASTER.to_checksum(None),
                "paymasterVerificationGasLimit": "0x61a8",
                "paymasterPostOpGasLimit": "0x61a8",
                "paymasterData": hex::encode_prefixed(data),
            },
            "authorization": {"chainId": 143, "address": SIMPLE_7702.to_checksum(None), "nonce": 0},
            "feeCapAtoms": FEE.to_string(),
        })
    }

    fn quote(&mut self, request: Value, now: u64) -> Value {
        let amount = evm::decimal(request["amount"].as_str().unwrap()).unwrap();
        let dest_usdg = request["destinationAsset"] == DST;
        let destination = request["recipientType"] == "DESTINATION_CHAIN";
        let (deposit, out) = if request["depositType"] == "ORIGIN_CHAIN" {
            let out = if destination {
                amount * U256::from(self.payout_rate_bps) / U256::from(10_000)
            } else {
                amount - U256::from(20)
            };
            self.credit = out;
            let recipient = request["recipient"].as_str().unwrap_or_default();
            let refund = request["refundTo"].as_str().unwrap_or_default();
            let mut seed = amount.to_be_bytes::<32>().to_vec();
            seed.extend_from_slice(recipient.as_bytes());
            seed.extend_from_slice(refund.as_bytes());
            let deposit = Address::from_slice(&keccak256(&seed)[12..]).to_checksum(None);
            if let Ok(holder) = evm::addr(refund) {
                self.origin_deposit.insert(holder, deposit.clone());
            }
            if destination && let Ok(to) = evm::addr(recipient) {
                self.deposits
                    .insert(deposit.clone(), (to, amount, out, dest_usdg));
            }
            (deposit, out)
        } else {
            let deposit = format!("payout-{}", self.deposits.len());
            let out = amount * U256::from(self.payout_rate_bps) / U256::from(10_000);
            self.deposits.insert(
                deposit.clone(),
                (
                    evm::addr(request["recipient"].as_str().unwrap()).unwrap(),
                    amount,
                    out,
                    dest_usdg,
                ),
            );
            (deposit, out)
        };
        let mut echoed = request.clone();
        if self.tamper == Tamper::QuoteRefund {
            echoed["refundTo"] = json!("0x00000000000000000000000000000000000BAd00");
        }
        // Mainnet shape: refunds start 15 minutes after the quote; the address stays open for 3 days.
        echoed["deadline"] = json!(iso_string(now + 15 * 60_000));
        json!({
            "quoteRequest": echoed,
            "signature": "ed25519:quote",
            "quote": {"depositAddress": deposit, "amountIn": amount.to_string(), "amountOut": out.to_string(), "minAmountOut": (out * U256::from(99) / U256::from(100)).to_string(), "deadline": iso_string(now + 3 * 86_400_000)},
        })
    }

    fn submit_operation(&mut self, rpc: &Value, now: u64) -> B256 {
        let mut fields = rpc.clone();
        let object = fields.as_object_mut().unwrap();
        let signature =
            evm::hex_bytes(object.remove("signature").unwrap().as_str().unwrap()).unwrap();
        let auth = object
            .remove("eip7702Auth")
            .expect("a fresh F needs its 7702 authorization");
        let op: UserOperation = serde_json::from_value(fields).unwrap();
        let unsigned = UnsignedAuthorization {
            chain_id: 143,
            address: SIMPLE_7702,
            nonce: 0,
        };
        let hash = funding::user_operation_hash(&op, Some(&unsigned)).unwrap();
        assert_eq!(
            recover_raw(hash, &signature[..64], signature[64] - 27),
            self.w.f
        );
        let word = |k: &str| evm::hex_bytes(auth[k].as_str().unwrap()).unwrap();
        let parity = word("yParity")[0];
        assert_eq!(
            recover_raw(
                evm::authorization_hash(143, SIMPLE_7702, 0),
                &[word("r"), word("s")].concat(),
                parity
            ),
            self.w.f
        );
        self.user_ops += 1;
        self.credit_ready_ms
            .get_or_insert(now + self.credit_delay_ms);
        if let Some(deposit) = self.last_deposit.clone() {
            self.funded_at
                .entry(deposit)
                .or_insert(now + self.credit_delay_ms);
        }
        hash
    }

    fn order(&mut self, body: &Value, now: u64) -> Value {
        let wallet = evm::addr(body["wallet"].as_str().unwrap()).unwrap();
        let amount = evm::decimal(body["amount"].as_str().unwrap()).unwrap();
        let permit = evm::hex_bytes(body["permit"].as_str().unwrap()).unwrap();
        let src = body
            .get("srcToken")
            .and_then(Value::as_str)
            .and_then(|t| evm::addr(t).ok())
            .unwrap_or(ROBINHOOD_USDG);
        let dst = evm::addr(body["dstToken"].as_str().unwrap()).unwrap();
        let sell = src != ROBINHOOD_USDG;
        let taking = if sell {
            amount / U256::from(WEI_PER_ATOM)
        } else {
            amount * U256::from(WEI_PER_ATOM)
        };
        let taking = if self.short_orders > 0 {
            self.short_orders -= 1;
            taking * U256::from(97) / U256::from(100)
        } else {
            taking
        };
        let receiver = if sell {
            // The provider only knows the request, not the engine's private quote state.
            let receiver = body
                .get("receiver")
                .and_then(Value::as_str)
                .expect("sell must send its bridge receiver");
            assert_eq!(
                evm::addr(receiver).unwrap(),
                evm::addr(self.origin_deposit.get(&wallet).unwrap()).unwrap()
            );
            receiver.to_string()
        } else {
            format!("{FUSION_SETTLEMENT:#x}")
        };
        let mut amount_data = FUSION_SETTLEMENT.as_slice().to_vec();
        amount_data.extend_from_slice(&[0x11; 8]);
        let mut permit_field = src.as_slice().to_vec();
        permit_field.extend_from_slice(&permit);
        let mut post = FUSION_SETTLEMENT.as_slice().to_vec();
        if self.tamper == Tamper::OrderReceiver {
            post.push(1);
            post.extend_from_slice(&[0; 40]);
            post.extend_from_slice(
                address!("0x00000000000000000000000000000000000BAd00").as_slice(),
            );
        } else {
            post.push(0);
            post.extend_from_slice(&[0; 40]);
        }
        post.extend_from_slice(&[0; 6 + 5 + 33]);
        let fields: [&[u8]; 8] = [
            &[],
            &[],
            &amount_data,
            &amount_data,
            &[],
            &permit_field,
            &[],
            &post,
        ];
        let (mut offsets, mut end, mut ext) = (U256::ZERO, 0u64, vec![]);
        for (i, f) in fields.iter().enumerate() {
            end += f.len() as u64;
            offsets |= U256::from(end) << (32 * i);
        }
        ext.extend_from_slice(&offsets.to_be_bytes::<32>());
        fields.iter().for_each(|f| ext.extend_from_slice(f));
        let mask = (U256::from(1) << 160) - U256::from(1);
        let salt: U256 =
            (U256::from(0x1234u64) << 160usize) | (U256::from_be_bytes(keccak256(&ext).0) & mask);
        let traits: U256 = (U256::from(1) << 249usize) | (U256::from(now / 1000 + 180) << 80usize);
        let order = LimitOrder {
            salt: salt.to_string(),
            maker: format!("{wallet:#x}"),
            receiver,
            maker_asset: format!("{src:#x}"),
            taker_asset: format!("{dst:#x}"),
            making_amount: amount.to_string(),
            taking_amount: taking.to_string(),
            maker_traits: traits.to_string(),
        };
        let hash = fusion::order_hash(&order).unwrap();
        self.permits.insert(hash, permit);
        json!({"orderHash": format!("{hash:#x}"), "quoteId": "quote-1", "order": order, "extension": hex::encode_prefixed(ext)})
    }

    fn fill(&mut self, body: &Value) {
        let order: LimitOrder = serde_json::from_value(body["order"].clone()).unwrap();
        let hash = fusion::order_hash(&order).unwrap();
        let maker = evm::addr(&order.maker).unwrap();
        let signature = evm::hex_bytes(body["signature"].as_str().unwrap()).unwrap();
        assert_eq!(
            recover_raw(hash, &signature[..64], signature[64] - 27),
            maker
        );
        let permit = &self.permits[&hash];
        let words = |i: usize| U256::from_be_slice(&permit[i * 32..i * 32 + 32]);
        let token = evm::addr(&order.maker_asset).unwrap();
        let digest = Permit {
            name: "Global Dollar".into(),
            version: "1".into(),
            token,
            owner: maker,
            value: words(2),
            nonce: U256::ZERO,
            deadline: words(3).to(),
        }
        .digest()
        .unwrap();
        assert_eq!(
            recover_raw(digest, &permit[160..224], words(4).to::<u8>() - 27),
            maker
        );
        let (making, taking) = (
            evm::decimal(&order.making_amount).unwrap(),
            evm::decimal(&order.taking_amount).unwrap(),
        );
        let dest = evm::addr(&order.receiver).unwrap();
        let sell = token != ROBINHOOD_USDG;
        if !self.fills.contains_key(&hash) {
            self.orders += 1;
            if sell {
                *self.target.get_mut(&maker).unwrap() -= making;
            } else {
                *self.usdg.get_mut(&maker).unwrap() -= making;
                *self.target.entry(maker).or_default() += taking;
            }
            self.fills.insert(
                hash,
                (
                    format!("{:#x}", keccak256(hash)),
                    maker,
                    making,
                    taking,
                    dest,
                    sell,
                ),
            );
        }
    }
}

fn word(v: U256) -> String {
    hex::encode_prefixed(v.to_be_bytes::<32>())
}

fn rpc_reply(batch: &Value, mut f: impl FnMut(&str, &Value) -> Value) -> Value {
    Value::Array(batch.as_array().unwrap().iter().map(|call| json!({"jsonrpc": "2.0", "id": call["id"], "result": f(call["method"].as_str().unwrap(), &call["params"])})).collect())
}

fn execute_batch(calls: &[Vec<u8>]) -> Vec<u8> {
    let mut out = evm::selector("executeBatch((address,uint256,bytes)[])").to_vec();
    out.extend_from_slice(&evm::word_u256(U256::from(32)));
    out.extend_from_slice(&evm::word_u256(U256::from(calls.len())));
    let tuples: Vec<Vec<u8>> = calls
        .iter()
        .map(|data| {
            let mut t = evm::word_address(MONAD_USDC).to_vec();
            t.extend_from_slice(&[0; 32]);
            t.extend_from_slice(&evm::word_u256(U256::from(96)));
            t.extend_from_slice(&evm::word_u256(U256::from(data.len())));
            t.extend_from_slice(data);
            t.resize(t.len().div_ceil(32) * 32, 0);
            t
        })
        .collect();
    let mut offset = 32 * calls.len();
    for t in &tuples {
        out.extend_from_slice(&evm::word_u256(U256::from(offset)));
        offset += t.len();
    }
    tuples.iter().for_each(|t| out.extend_from_slice(t));
    out
}

fn recover_raw(digest: B256, rs: &[u8], parity: u8) -> Address {
    evm::recover(
        digest,
        rs[..32].try_into().unwrap(),
        rs[32..64].try_into().unwrap(),
        parity,
    )
    .unwrap()
}

fn recover_aurora(payload: &str, signature: &str) -> Address {
    let raw = bs58::decode(signature.strip_prefix("secp256k1:").unwrap())
        .into_vec()
        .unwrap();
    recover_raw(evm::personal_hash(payload.as_bytes()), &raw[..64], raw[64])
}

fn plan(amount: Option<&str>) -> String {
    let mut p = json!({"kind": "confidentialSwap", "target": AMZN.to_checksum(None), "recipientIndices": [3, 4, 5]});
    if let Some(a) = amount {
        p["amountAtoms"] = json!(a);
    }
    p.to_string()
}

fn start(amount: Option<&str>) -> Arc<SwapOperation> {
    SwapOperation::start(plan(amount), ENTROPY.to_vec(), GATEWAY.into(), T0).unwrap()
}

#[test]
fn restored_review_requires_native_unlock_before_approval() {
    let op = start(None);
    let mut world = World::new();
    let mut now = T0;
    let original_review = review(&op, &mut world, &mut now);
    let restored = SwapOperation::restore(op.export_state().unwrap(), GATEWAY.into()).unwrap();
    assert_eq!(
        restored.next_step(now).unwrap(),
        SwapStep::Review {
            text: original_review
        }
    );
    assert!(
        restored.approve(now).is_err(),
        "restoring must not restore signing authority"
    );
    restored.unlock(ENTROPY.to_vec(), now).unwrap();
    restored.approve(now).unwrap();
    assert!(matches!(
        restored.next_step(now).unwrap(),
        SwapStep::Request { .. }
    ));
}

/// Runs requests and waits until the machine needs the user, finishes or pauses.
fn drive(op: &SwapOperation, world: &mut World, now: &mut u64) -> SwapStep {
    drive_until(op, world, now, |_| false)
}

fn drive_until(
    op: &SwapOperation,
    world: &mut World,
    now: &mut u64,
    stop: impl Fn(&str) -> bool,
) -> SwapStep {
    for _ in 0..20_000 {
        match op.next_step(*now).unwrap() {
            SwapStep::Request {
                id,
                method,
                url,
                body,
            } => {
                if stop(&url) {
                    return SwapStep::Request {
                        id,
                        method,
                        url,
                        body,
                    };
                }
                let (status, reply) = world.handle(&url, body.as_deref(), *now);
                *now += 250;
                let _ = op.on_response(id, status, reply, *now);
            }
            SwapStep::Wait { millis } => *now += millis,
            other => return other,
        }
    }
    panic!("the operation never settled");
}

fn review(op: &SwapOperation, world: &mut World, now: &mut u64) -> String {
    match drive(op, world, now) {
        SwapStep::Review { text } => text,
        other => panic!("expected the review, got {other:?}"),
    }
}

fn status(op: &SwapOperation) -> Value {
    serde_json::from_str(&op.public_status()).unwrap()
}

#[test]
fn plans_reviews_and_completes_the_whole_swap_with_the_expected_signers() {
    let (mut world, mut now) = (World::new(), T0);
    let op = start(Some("2000000"));
    let text = review(&op, &mut world, &mut now);
    assert!(text.contains("CONFIDENTIAL SWAP · MAINNET"));
    assert!(text.contains("PRIVACY"));
    assert!(text.contains("AMZN (18 decimals)"));
    assert!(text.contains(&world.w.f.to_checksum(None)));
    assert!(text.contains("Used now 1.997000 USDC + gas at most 0.003000 USDC"));
    assert_eq!(
        world.user_ops + world.intents + world.orders,
        0,
        "nothing is signed before approval"
    );
    assert_eq!(status(&op)["phase"], "REVIEW");

    op.approve(now).unwrap();
    assert_eq!(drive(&op, &mut world, &mut now), SwapStep::Finished);
    assert_eq!((world.user_ops, world.intents, world.orders), (1, 3, 3));
    for a in world.w.a {
        assert!(world.usdg[&a].is_zero());
        assert!(!world.target[&a].is_zero());
    }
    // A buy funds C once; every USDG payout leaves from C, never through a public bridge.
    assert!(
        world.deposits.keys().all(|d| d.starts_with("payout-")),
        "a buy never quotes a public bridge"
    );

    let s = status(&op);
    assert_eq!(s["phase"], "COMPLETE");
    assert_eq!(s["ordersComplete"], 3);
    assert_eq!(s["targetSymbol"], "AMZN");
    let total: U256 = world
        .w
        .a
        .iter()
        .map(|a| world.target[a])
        .fold(U256::ZERO, |x, y| x + y);
    assert_eq!(s["receivedTargetAtoms"], total.to_string());
    let public = op.public_status().to_lowercase();
    for a in [
        world.w.f,
        world.w.c,
        world.w.a[0],
        world.w.a[1],
        world.w.a[2],
    ] {
        assert!(
            !public.contains(&format!("{a:#x}")[2..]),
            "public status leaks a wallet"
        );
    }
}

#[test]
fn rejects_invalid_plans_and_preserves_an_explicit_production_budget() {
    assert!(
        SwapOperation::start(
            plan(Some("18446744073709551616")),
            ENTROPY.to_vec(),
            GATEWAY.into(),
            T0
        )
        .is_err()
    );
    assert!(SwapOperation::start(plan(Some("0")), ENTROPY.to_vec(), GATEWAY.into(), T0).is_err());
    let reused = plan(None).replace("[3,4,5]", "[3,3,5]");
    assert!(SwapOperation::start(reused, ENTROPY.to_vec(), GATEWAY.into(), T0).is_err());
    let app_account = plan(None).replace("[3,4,5]", "[0,4,5]");
    assert!(SwapOperation::start(app_account, ENTROPY.to_vec(), GATEWAY.into(), T0).is_err());
    assert!(
        SwapOperation::start(
            plan(None),
            ENTROPY.to_vec(),
            "http://gateway.test".into(),
            T0
        )
        .is_err()
    );

    let (mut world, mut now) = (World::new(), T0);
    world.f_balance = U256::from(50_000_000u64);
    let text = review(&start(Some("50000000")), &mut world, &mut now);
    assert!(text.contains("Used now 49.997000 USDC + gas at most 0.003000 USDC"));
}

#[test]
fn an_expired_authorization_asks_for_the_same_wallets_again() {
    let (mut world, mut now) = (World::new(), T0);
    world.credit_delay_ms = 20 * 60_000;
    let op = start(Some("2000000"));
    review(&op, &mut world, &mut now);
    op.approve(now).unwrap();
    assert_eq!(drive(&op, &mut world, &mut now), SwapStep::Unlock);
    assert_eq!(status(&op)["phase"], "CREDITED");
    assert_eq!(world.user_ops, 1);
    assert!(
        op.unlock(vec![8; 32], now).is_err(),
        "another seed must not continue this plan"
    );
    op.unlock(ENTROPY.to_vec(), now).unwrap();
    assert_eq!(drive(&op, &mut world, &mut now), SwapStep::Finished);
    assert_eq!((world.user_ops, world.intents, world.orders), (1, 3, 3));
}

#[test]
fn restores_without_a_seed_and_needs_an_unlock_before_approval() {
    let (mut world, mut now) = (World::new(), T0);
    let op = start(Some("2000000"));
    review(&op, &mut world, &mut now);
    let state = op.export_state().unwrap();
    assert!(!state.contains("seed") && !state.contains("entropy"));

    let restored = SwapOperation::restore(state, GATEWAY.into()).unwrap();
    assert_eq!(restored.operation_id(), op.operation_id());
    assert!(matches!(
        restored.next_step(now).unwrap(),
        SwapStep::Review { .. }
    ));
    assert!(matches!(restored.approve(now), Err(SignerError::Expired)));
    restored.unlock(ENTROPY.to_vec(), now).unwrap();
    restored.approve(now).unwrap();
    assert!(restored.approve(now).is_err(), "approval is one-shot");
    assert_eq!(drive(&restored, &mut world, &mut now), SwapStep::Finished);
}

#[test]
fn a_lost_submission_is_looked_up_and_never_signed_again() {
    let (mut world, mut now) = (World::new(), T0);
    world.transient_submit_once = true;
    let op = start(Some("2000000"));
    review(&op, &mut world, &mut now);
    op.approve(now).unwrap();
    assert_eq!(drive(&op, &mut world, &mut now), SwapStep::Finished);
    assert_eq!(world.user_ops, 1);
    assert_eq!(
        world
            .paths
            .iter()
            .filter(|p| *p == "/v1/swap/monad/submit")
            .count(),
        1
    );
}

#[test]
fn a_crash_after_sending_resumes_at_the_status_lookup() {
    let (mut world, mut now) = (World::new(), T0);
    let op = start(Some("2000000"));
    review(&op, &mut world, &mut now);
    op.approve(now).unwrap();
    let SwapStep::Request { url, body, .. } = drive_until(&op, &mut world, &mut now, |u| {
        u.ends_with("/v1/swap/monad/submit")
    }) else {
        panic!()
    };
    world.handle(&url, body.as_deref(), now);
    let state = op.export_state().unwrap();

    let restored = SwapOperation::restore(state, GATEWAY.into()).unwrap();
    let SwapStep::Request { url, .. } = restored.next_step(now).unwrap() else {
        panic!()
    };
    assert!(url.ends_with("/v1/swap/monad/receipt"));
    restored.cancel();
    assert_eq!(
        restored.next_step(now).unwrap(),
        SwapStep::Paused {
            code: "CANCELLED".into()
        }
    );
    assert!(restored.unlock(ENTROPY.to_vec(), now).is_err());
}

#[test]
fn a_worse_payout_quote_needs_a_new_approval_and_uses_the_shown_quote() {
    let (mut world, mut now) = (World::new(), T0);
    let op = start(Some("2000000"));
    review(&op, &mut world, &mut now);
    op.approve(now).unwrap();
    world.payout_rate_bps = 9_000;
    let SwapStep::Review { text } = drive(&op, &mut world, &mut now) else {
        panic!("expected a re-approval")
    };
    assert!(text.starts_with("QUOTE CHANGED OUTSIDE THE APPROVED LIMITS"));
    assert_eq!(status(&op)["phase"], "REVIEW");
    assert_eq!(world.intents, 0);
    let quotes = world.deposits.len();
    op.approve(now).unwrap();
    let SwapStep::Request { url, .. } = op.next_step(now).unwrap() else {
        panic!()
    };
    assert!(url.ends_with("/v1/swap/aurora/generate-intent"));
    assert_eq!(
        world.deposits.len(),
        quotes,
        "the approved quote is used, not a new one"
    );
}

#[test]
fn reapproved_quotes_carry_the_operation_to_completion() {
    let (mut world, mut now) = (World::new(), T0);
    let op = start(Some("2000000"));
    review(&op, &mut world, &mut now);
    op.approve(now).unwrap();
    world.payout_rate_bps = 9_000;
    let mut reapprovals = 0;
    let last = loop {
        match drive(&op, &mut world, &mut now) {
            SwapStep::Review { .. } if reapprovals < 3 => {
                op.approve(now).unwrap();
                reapprovals += 1;
            }
            other => break other,
        }
    };
    assert_eq!(last, SwapStep::Finished);
    assert_eq!(reapprovals, 3);
    assert_eq!((world.intents, world.orders), (3, 3));
}

#[test]
fn a_funding_operation_that_pays_someone_else_is_never_signed() {
    let (mut world, mut now) = (World::new(), T0);
    world.tamper = Tamper::FundingRecipient;
    let op = start(Some("2000000"));
    let SwapStep::Paused { code } = drive(&op, &mut world, &mut now) else {
        panic!()
    };
    assert_eq!(code, "REJECTED_fundingPrepare");
    assert!(op.approve(now).is_err());
    assert_eq!(world.user_ops, 0);
}

#[test]
fn a_quote_with_a_foreign_refund_address_pauses_planning() {
    let (mut world, mut now) = (World::new(), T0);
    world.tamper = Tamper::QuoteRefund;
    let op = start(Some("2000000"));
    assert_eq!(
        drive(&op, &mut world, &mut now),
        SwapStep::Paused {
            code: "REJECTED_fundingQuote".into()
        }
    );
    assert_eq!(status(&op)["phase"], "PAUSED");
}

#[test]
fn a_fusion_order_paying_another_receiver_is_never_signed() {
    let (mut world, mut now) = (World::new(), T0);
    let op = start(Some("2000000"));
    review(&op, &mut world, &mut now);
    op.approve(now).unwrap();
    world.tamper = Tamper::OrderReceiver;
    assert_eq!(
        drive(&op, &mut world, &mut now),
        SwapStep::Paused {
            code: "FUSION_1_ORDER_RECEIVER".into()
        }
    );
    assert_eq!((world.user_ops, world.intents, world.orders), (1, 3, 0));
    assert!(!world.paths.iter().any(|p| p == "/v1/swap/fusion/submit"));
}

#[test]
fn an_empty_funding_wallet_waits_for_a_deposit() {
    let (mut world, mut now) = (World::new(), T0);
    world.f_balance = U256::ZERO;
    let op = start(None);
    assert_eq!(
        drive(&op, &mut world, &mut now),
        SwapStep::Paused {
            code: "AWAITING_DEPOSIT".into()
        }
    );
    world.f_balance = U256::from(1_500_000u64);
    op.retry();
    let text = review(&op, &mut world, &mut now);
    assert!(text.contains("Used now 1.497000 USDC"));
}

fn sell_plan(holders: [u32; 3], recipients: [u32; 3]) -> String {
    json!({"kind": "confidentialSell", "target": AMZN.to_checksum(None), "holderIndices": holders, "recipientIndices": recipients}).to_string()
}

#[test]
fn sell_rejects_reused_or_overlapping_indices() {
    assert!(
        SwapOperation::start(
            sell_plan([3, 4, 5], [3, 6, 7]),
            ENTROPY.to_vec(),
            GATEWAY.into(),
            T0
        )
        .is_err()
    );
    assert!(
        SwapOperation::start(
            sell_plan([3, 4, 5], [6, 7, 8]).replace("confidentialSell", "confidentialSwap"),
            ENTROPY.to_vec(),
            GATEWAY.into(),
            T0
        )
        .is_err()
    );
    assert!(
        SwapOperation::start(
            plan(Some("2000000")).replace("}", r#","holderIndices":[6,7,8]}"#),
            ENTROPY.to_vec(),
            GATEWAY.into(),
            T0
        )
        .is_err()
    );
    let op = SwapOperation::start(
        sell_plan([3, 4, 5], [6, 7, 8]),
        ENTROPY.to_vec(),
        GATEWAY.into(),
        T0,
    )
    .unwrap();
    assert_eq!(status(&op)["direction"], "sell");
}

#[test]
fn sells_stock_into_three_fresh_monad_wallets() {
    let (mut world, mut now) = (World::new(), T0);
    let buy = start(Some("2000000"));
    review(&buy, &mut world, &mut now);
    buy.approve(now).unwrap();
    assert_eq!(drive(&buy, &mut world, &mut now), SwapStep::Finished);
    assert!(world.w.a.iter().all(|a| !world.target[a].is_zero()));

    let op = SwapOperation::start(
        sell_plan([3, 4, 5], [6, 7, 8]),
        ENTROPY.to_vec(),
        GATEWAY.into(),
        T0,
    )
    .unwrap();
    let text = review(&op, &mut world, &mut now);
    assert!(text.contains("CONFIDENTIAL SELL · MAINNET"));
    assert!(text.contains("three new Monad USDC wallets"));
    let seed = seed_from_entropy(ENTROPY.to_vec()).unwrap();
    let ret = |i| evm::key_address(&derive_key(&seed, i).unwrap());
    for i in [6u32, 7, 8] {
        assert!(text.contains(&ret(i).to_checksum(None)));
    }
    op.approve(now).unwrap();
    assert_eq!(drive(&op, &mut world, &mut now), SwapStep::Finished);
    assert_eq!(status(&op)["phase"], "COMPLETE");
    assert_eq!(status(&op)["direction"], "sell");
    assert_eq!(status(&op)["ordersComplete"], 3);
    for a in world.w.a {
        assert!(world.target[&a].is_zero());
    }
    for i in [6u32, 7, 8] {
        assert!(
            !world.monad_usdc[&ret(i)].is_zero(),
            "return wallet {i} stays empty"
        );
    }
}

#[test]
fn pimlico_rounding_either_side_of_the_fee_is_accepted() {
    for delta in [-4i64, 4] {
        let (mut world, mut now) = (World::new(), T0);
        world.approve_delta = delta;
        let op = start(Some("2000000"));
        review(&op, &mut world, &mut now);
        op.approve(now).unwrap();
        assert_eq!(
            drive(&op, &mut world, &mut now),
            SwapStep::Finished,
            "approve off by {delta}"
        );
        assert_eq!(world.user_ops, 1);
    }
}

#[test]
fn an_approval_far_from_the_fee_is_never_signed() {
    for delta in [-(FEE as i64) / 10, FEE as i64 / 10] {
        let (mut world, mut now) = (World::new(), T0);
        world.approve_delta = delta;
        let op = start(Some("2000000"));
        assert_eq!(
            drive(&op, &mut world, &mut now),
            SwapStep::Paused {
                code: "REJECTED_fundingPrepare".into()
            },
            "approve off by {delta}"
        );
        assert_eq!(world.user_ops, 0);
    }
}

#[test]
fn a_funding_quote_near_its_refund_deadline_is_requoted_before_the_deposit() {
    let quotes = |world: &World| {
        world
            .paths
            .iter()
            .filter(|p| *p == "/v1/swap/aurora/quote")
            .count()
    };
    let (mut fresh, mut now) = (World::new(), T0);
    let op = start(Some("2000000"));
    review(&op, &mut fresh, &mut now);
    op.approve(now).unwrap();
    assert_eq!(drive(&op, &mut fresh, &mut now), SwapStep::Finished);

    // The user takes six minutes to approve: the planning quote has nine of its fifteen left.
    let (mut slow, mut now) = (World::new(), T0);
    let op = start(Some("2000000"));
    review(&op, &mut slow, &mut now);
    now += 6 * 60_000;
    op.approve(now).unwrap();
    assert_eq!(drive(&op, &mut slow, &mut now), SwapStep::Finished);
    assert_eq!(
        quotes(&slow),
        quotes(&fresh) + 1,
        "the funding quote is renewed once"
    );
    assert_eq!(slow.user_ops, 1);
}

fn payout_plan() -> String {
    json!({"kind": "confidentialPayout", "target": AMZN.to_checksum(None), "recipientIndices": [3, 4, 5]}).to_string()
}

#[test]
fn buys_from_an_existing_private_balance_without_touching_monad() {
    let (mut world, mut now) = (World::new(), T0);
    world.credit = U256::from(3_945_530u64);
    let op = SwapOperation::start(payout_plan(), ENTROPY.to_vec(), GATEWAY.into(), T0).unwrap();
    let text = review(&op, &mut world, &mut now);
    assert!(text.contains("CONFIDENTIAL BUY FROM PRIVATE BALANCE"));
    assert!(text.contains("Nothing is sent from Monad"));
    assert!(text.contains("Used now 3.945530 USDC"));
    assert!(text.contains(&world.w.c.to_checksum(None)));
    assert_eq!(status(&op)["phase"], "REVIEW");
    assert_eq!(
        world.user_ops + world.intents + world.orders,
        0,
        "only the ownership proof is signed before approval"
    );
    assert!(
        !world.paths.iter().any(|p| p.starts_with("/v1/swap/monad/")),
        "a payout never prepares Monad funding"
    );

    op.approve(now).unwrap();
    assert_eq!(drive(&op, &mut world, &mut now), SwapStep::Finished);
    assert_eq!((world.user_ops, world.intents, world.orders), (0, 3, 3));
    assert!(!world.paths.iter().any(|p| p.starts_with("/v1/swap/monad/")));
    let sent: U256 = world
        .deposits
        .iter()
        .filter(|(d, _)| world.credited.contains(*d))
        .map(|(_, (_, amount, _, _))| *amount)
        .fold(U256::ZERO, |a, b| a + b);
    assert_eq!(
        sent,
        U256::from(3_945_530u64),
        "the three payouts split exactly the private balance"
    );
    for a in world.w.a {
        assert!(!world.target[&a].is_zero());
    }
    assert_eq!(status(&op)["phase"], "COMPLETE");
}

#[test]
fn a_payout_with_an_empty_private_balance_pauses_before_review() {
    let (mut world, mut now) = (World::new(), T0);
    let op = SwapOperation::start(payout_plan(), ENTROPY.to_vec(), GATEWAY.into(), T0).unwrap();
    assert_eq!(
        drive(&op, &mut world, &mut now),
        SwapStep::Paused {
            code: "NO_PRIVATE_BALANCE".into()
        }
    );
    assert_eq!(world.intents, 0);
}

#[test]
fn a_payout_plan_takes_no_amount_or_holders() {
    let with_amount = payout_plan().replace("}", r#","amountAtoms":"1000000"}"#);
    assert!(SwapOperation::start(with_amount, ENTROPY.to_vec(), GATEWAY.into(), T0).is_err());
    let with_holders = payout_plan().replace("}", r#","holderIndices":[6,7,8]}"#);
    assert!(SwapOperation::start(with_holders, ENTROPY.to_vec(), GATEWAY.into(), T0).is_err());
}

#[test]
fn an_order_under_the_minimum_is_previewed_again_and_never_signed_short() {
    let (mut world, mut now) = (World::new(), T0);
    world.short_orders = 2;
    let op = start(Some("2000000"));
    review(&op, &mut world, &mut now);
    op.approve(now).unwrap();
    assert_eq!(drive(&op, &mut world, &mut now), SwapStep::Finished);
    assert_eq!(world.orders, 3, "every leg still fills once");
    let previews = world
        .paths
        .iter()
        .filter(|p| *p == "/v1/swap/fusion/preview")
        .count();
    assert_eq!(
        previews,
        1 + 3 + 2,
        "planning, one per leg, one per short draft"
    );
}

#[test]
fn an_order_that_stays_under_the_minimum_pauses_with_its_reason() {
    let (mut world, mut now) = (World::new(), T0);
    world.short_orders = u8::MAX;
    let op = start(Some("2000000"));
    review(&op, &mut world, &mut now);
    op.approve(now).unwrap();
    assert_eq!(
        drive(&op, &mut world, &mut now),
        SwapStep::Paused {
            code: "FUSION_1_ORDER_BELOW_MINIMUM".into()
        }
    );
    assert_eq!(world.orders, 0);
    assert!(!world.paths.iter().any(|p| p == "/v1/swap/fusion/submit"));
}

fn recovery_plan(scan_to: u32) -> String {
    json!({"kind": "confidentialRecovery", "target": AMZN.to_checksum(None), "recipientIndices": [3, 4, 5], "scanTo": scan_to}).to_string()
}

#[test]
fn recovery_finishes_buys_for_wallets_an_earlier_operation_left_holding_usdg() {
    let (mut world, mut now) = (World::new(), T0);
    let seed = seed_from_entropy(ENTROPY.to_vec()).unwrap();
    let at = |i| evm::key_address(&derive_key(&seed, i).unwrap());
    // Indices 9-11 were one earlier operation: leg 1 filled, legs 2 and 3 still hold USDG.
    world.usdg.insert(at(10), U256::from(1_027_014u64));
    world.usdg.insert(at(11), U256::from(1_419_357u64));
    let op = SwapOperation::start(recovery_plan(15), ENTROPY.to_vec(), GATEWAY.into(), T0).unwrap();
    let text = review(&op, &mut world, &mut now);
    assert!(text.contains("FINISH UNFINISHED BUYS"));
    assert!(text.contains("Nothing is sent from Monad or from the confidential balance"));
    assert!(text.contains(&format!(
        "Wallet {}\n  1.027014 USDG → AMZN",
        at(10).to_checksum(None)
    )));
    assert!(text.contains(&format!(
        "Wallet {}\n  1.419357 USDG → AMZN",
        at(11).to_checksum(None)
    )));
    assert_eq!(world.orders, 0, "nothing is signed before approval");

    op.approve(now).unwrap();
    assert_eq!(drive(&op, &mut world, &mut now), SwapStep::Finished);
    assert_eq!((world.user_ops, world.intents, world.orders), (0, 0, 2));
    for i in [10, 11] {
        assert!(world.usdg[&at(i)].is_zero());
        assert!(!world.target[&at(i)].is_zero());
    }
    assert!(!world.paths.iter().any(|p| p.starts_with("/v1/swap/monad/")
        || p.contains("aurora/quote")
        || p.contains("intent")));
    assert_eq!(status(&op)["phase"], "COMPLETE");
}

#[test]
fn recovery_with_nothing_left_pauses_before_review() {
    let (mut world, mut now) = (World::new(), T0);
    let op = SwapOperation::start(recovery_plan(15), ENTROPY.to_vec(), GATEWAY.into(), T0).unwrap();
    assert_eq!(
        drive(&op, &mut world, &mut now),
        SwapStep::Paused {
            code: "NOTHING_TO_RECOVER".into()
        }
    );
}

#[test]
fn only_recovery_scans_and_only_allocated_indices() {
    assert!(SwapOperation::start(recovery_plan(5), ENTROPY.to_vec(), GATEWAY.into(), T0).is_err());
    assert!(
        SwapOperation::start(
            plan(None).replace("}", r#","scanTo":15}"#),
            ENTROPY.to_vec(),
            GATEWAY.into(),
            T0
        )
        .is_err()
    );
    let without = json!({"kind": "confidentialRecovery", "target": AMZN.to_checksum(None), "recipientIndices": [3, 4, 5]}).to_string();
    assert!(SwapOperation::start(without, ENTROPY.to_vec(), GATEWAY.into(), T0).is_err());
}

#[test]
fn a_paused_sell_receiver_mismatch_can_resume_without_repeating_the_buy() {
    let (mut world, mut now) = (World::new(), T0);
    let buy = start(Some("2000000"));
    review(&buy, &mut world, &mut now);
    buy.approve(now).unwrap();
    assert_eq!(drive(&buy, &mut world, &mut now), SwapStep::Finished);
    let sell = SwapOperation::start(
        sell_plan([3, 4, 5], [6, 7, 8]),
        ENTROPY.to_vec(),
        GATEWAY.into(),
        now,
    )
    .unwrap();
    review(&sell, &mut world, &mut now);
    sell.approve(now).unwrap();
    let SwapStep::Request { id, url, body, .. } = drive_until(&sell, &mut world, &mut now, |url| {
        url.ends_with("/fusion/order")
    }) else {
        panic!()
    };
    let (_, reply) = world.handle(&url, body.as_deref(), now);
    let mut bad: Value = serde_json::from_str(&reply).unwrap();
    bad["order"]["receiver"] = json!(format!("{:#x}", world.w.a[0]));
    sell.on_response(id, 200, bad.to_string(), now).unwrap();
    assert_eq!(status(&sell)["pausedCode"], "FUSION_1_ORDER_RECEIVER");
    assert_eq!(world.orders, 3, "only the earlier buy was submitted");
    let restored = SwapOperation::restore(sell.export_state().unwrap(), GATEWAY.into()).unwrap();
    restored.retry();
    restored.unlock(ENTROPY.to_vec(), now).unwrap();
    assert_eq!(drive(&restored, &mut world, &mut now), SwapStep::Finished);
    assert_eq!(world.orders, 6);
    assert_eq!(world.user_ops, 1, "resume must not fund another buy");
}

#[test]
fn funding_binds_selected_source_across_restore_unlock() {
    let mut p: Value = serde_json::from_str(&plan(Some("1000000"))).unwrap();
    p["sourceIndex"] = json!(0);
    let operation =
        SwapOperation::start(p.to_string(), ENTROPY.to_vec(), GATEWAY.into(), T0).unwrap();
    let seed = seed_from_entropy(ENTROPY.to_vec()).unwrap();
    let expected = evm::key_address(&derive_key(&seed, 0).unwrap());
    {
        let e = operation.inner.lock().unwrap();
        assert_eq!(e.m.source, expected);
    }
    let restored =
        SwapOperation::restore(operation.export_state().unwrap(), GATEWAY.into()).unwrap();
    restored.unlock(ENTROPY.to_vec(), T0).unwrap();
    {
        let e = restored.inner.lock().unwrap();
        assert_eq!(e.m.source, expected);
    }
    p["sourceIndex"] = json!(2);
    assert!(SwapOperation::start(p.to_string(), ENTROPY.to_vec(), GATEWAY.into(), T0).is_err());
    p["sourceIndex"] = json!(3);
    assert!(SwapOperation::start(p.to_string(), ENTROPY.to_vec(), GATEWAY.into(), T0).is_err());
}
#[test]
fn requested_budget_above_source_balance_stops_instead_of_shrinking() {
    let op = start(Some("3000000"));
    let mut world = World::new();
    let mut now = T0;
    let result = drive(&op, &mut world, &mut now);
    assert!(!matches!(result, SwapStep::Review { .. }));
    assert_eq!(world.user_ops, 0);
    assert!(op.inner.lock().unwrap().m.data.funding_amount.is_zero());
}

#[test]
fn selected_account_zero_funds_the_entire_swap_with_its_own_signature() {
    let mut p: Value = serde_json::from_str(&plan(Some("2000000"))).unwrap();
    p["sourceIndex"] = json!(0);
    let op = SwapOperation::start(p.to_string(), ENTROPY.to_vec(), GATEWAY.into(), T0).unwrap();
    let seed = seed_from_entropy(ENTROPY.to_vec()).unwrap();
    let mut world = World::new();
    world.w.f = evm::key_address(&derive_key(&seed, 0).unwrap());
    let mut now = T0;
    assert!(review(&op, &mut world, &mut now).contains(&world.w.f.to_checksum(None)));
    op.approve(now).unwrap();
    assert_eq!(drive(&op, &mut world, &mut now), SwapStep::Finished);
    assert_eq!(world.user_ops, 1);
}

#[test]
fn explicit_fifteen_usdc_budget_is_supported_without_a_test_cap() {
    let op = start(Some("15000000"));
    let mut world = World::new();
    world.f_balance = U256::from(15000000u64);
    let mut now = T0;
    assert!(review(&op, &mut world, &mut now).contains("Used now 14.997000 USDC"));
}

fn usdg_start(kind: &str) -> Arc<SwapOperation> {
    let p = if kind == "confidentialSell" {
        json!({"kind":kind,"target":ROBINHOOD_USDG.to_checksum(None),"recipientIndices":[6,7,8],"holderIndices":[3,4,5]})
    } else {
        json!({"kind":kind,"target":ROBINHOOD_USDG.to_checksum(None),"recipientIndices":[3,4,5],"amountAtoms":"2000000"})
    };
    SwapOperation::start(p.to_string(), ENTROPY.to_vec(), GATEWAY.into(), T0).unwrap()
}

#[test]
fn usdg_bridge_completes_only_after_deliveries_without_fusion() {
    let (mut world, mut now) = (World::new(), T0);
    let op = usdg_start("confidentialSwap");
    let text = review(&op, &mut world, &mut now);
    assert!(text.contains("No 1inch purchase"));
    assert!(text.contains("requires ETH"));
    assert_eq!((world.user_ops, world.intents, world.orders), (0, 0, 0));
    op.approve(now).unwrap();
    assert_eq!(drive(&op, &mut world, &mut now), SwapStep::Finished);
    assert_eq!(status(&op)["bridgeOnly"], true);
    assert_eq!(status(&op)["ordersComplete"], 0);
    assert_eq!(status(&op)["deliveriesComplete"], 3);
    let total = world
        .w
        .a
        .iter()
        .fold(U256::ZERO, |sum, a| sum + world.usdg[a]);
    assert_eq!(status(&op)["receivedTargetAtoms"], total.to_string());
    assert!(!world.paths.iter().any(|p| p.contains("fusion")));
    assert_eq!((world.user_ops, world.intents), (1, 3));
}

#[test]
fn usdg_bridge_resume_after_delivery_does_not_repeat_payouts() {
    let (mut world, mut now) = (World::new(), T0);
    let op = usdg_start("confidentialSwap");
    review(&op, &mut world, &mut now);
    op.approve(now).unwrap();
    loop {
        if status(&op)["deliveriesComplete"] == 1 {
            break;
        }
        match op.next_step(now).unwrap() {
            SwapStep::Request { id, url, body, .. } => {
                let (code, result) = world.handle(&url, body.as_deref(), now);
                op.on_response(id, code, result, now).unwrap();
            }
            SwapStep::Wait { millis } => now += millis,
            step => panic!("unexpected {step:?}"),
        }
    }
    let restored = SwapOperation::restore(op.export_state().unwrap(), GATEWAY.into()).unwrap();
    assert_eq!(drive(&restored, &mut world, &mut now), SwapStep::Finished);
    assert_eq!((world.user_ops, world.intents, world.orders), (1, 3, 0));
    assert_eq!(status(&restored)["deliveriesComplete"], 3);
}

#[test]
fn usdg_return_requires_gas_then_reviews_exact_transfers_and_each_payout() {
    let (mut world, mut now) = (World::new(), T0);
    for a in world.w.a {
        world.usdg.insert(a, U256::from(1_000_000));
    }
    let op = usdg_start("confidentialSell");
    assert_eq!(
        drive(&op, &mut world, &mut now),
        SwapStep::Paused {
            code: "USDG_RETURN_GAS_REQUIRED_1".into()
        }
    );
    assert_eq!(world.return_submits, 0);
    assert_eq!(status(&op)["approved"], false);
    world.return_gas = true;
    op.retry();
    assert!(review(&op, &mut world, &mut now).contains("RETURN USDG"));
    op.approve(now).unwrap();
    let mut reviews = 0;
    loop {
        match drive(&op, &mut world, &mut now) {
            SwapStep::Review { text } => {
                assert!(text.contains("Maximum transaction fee") || text.contains("Return leg"));
                reviews += 1;
                op.approve(now).unwrap();
            }
            SwapStep::Finished => break,
            step => panic!("unexpected {step:?}"),
        }
    }
    assert_eq!(reviews, 6);
    assert_eq!(world.return_submits, 3);
    assert_eq!(world.intents, 3);
    assert!(!world.paths.iter().any(|p| p.contains("fusion")));
    assert!(world.usdg.values().all(|a| a.is_zero()));
    assert_eq!(status(&op)["deliveriesComplete"], 3);
}

#[test]
fn usdg_unknown_submit_reconciles_saved_hash_after_restart_without_resending() {
    let (mut world, mut now) = (World::new(), T0);
    world.return_gas = true;
    world.usdg.insert(world.w.a[0], U256::from(1_000_000));
    let op = usdg_start("confidentialSell");
    review(&op, &mut world, &mut now);
    op.approve(now).unwrap();
    review(&op, &mut world, &mut now);
    op.approve(now).unwrap();
    let SwapStep::Request { url, body, .. } = op.next_step(now).unwrap() else {
        panic!()
    };
    assert!(body.as_ref().unwrap().contains("eth_sendRawTransaction"));
    let saved = op.export_state().unwrap();
    // The chain accepts it, but the app closes before receiving the acknowledgement.
    world.handle(&url, body.as_deref(), now);
    let restored = SwapOperation::restore(saved, GATEWAY.into()).unwrap();
    assert_eq!(drive(&restored, &mut world, &mut now), SwapStep::Unlock);
    assert_eq!(world.return_submits, 1);
    restored.unlock(ENTROPY.to_vec(), now).unwrap();
    assert!(review(&restored, &mut world, &mut now).contains("Return leg"));
    restored.approve(now).unwrap();
    assert_eq!(drive(&restored, &mut world, &mut now), SwapStep::Finished);
    assert_eq!(world.return_submits, 1);
    assert_eq!(world.intents, 1);
    assert!(world.paths.iter().all(|p| !p.contains("fusion")));
}

#[test]
fn usdg_missing_receipt_requires_explicit_retry_and_reuses_exact_signed_bytes() {
    let (mut world, mut now) = (World::new(), T0);
    world.return_gas = true;
    world.usdg.insert(world.w.a[0], U256::from(1_000_000));
    let op = usdg_start("confidentialSell");
    review(&op, &mut world, &mut now);
    op.approve(now).unwrap();
    review(&op, &mut world, &mut now);
    op.approve(now).unwrap();
    let SwapStep::Request {
        id, body: original, ..
    } = op.next_step(now).unwrap()
    else {
        panic!()
    };
    op.on_response(id, 0, "".into(), now).unwrap();
    loop {
        match op.next_step(now).unwrap() {
            SwapStep::Request { id, body, .. } => {
                assert!(body.unwrap().contains("eth_getTransactionReceipt"));
                op.on_response(id, 200, json!([{"id":0,"result":null}]).to_string(), now)
                    .unwrap();
            }
            SwapStep::Wait { millis } => now += millis,
            SwapStep::Paused { code } => {
                assert_eq!(code, "USDG_RETURN_PENDING");
                break;
            }
            other => panic!("unexpected {other:?}"),
        }
    }
    op.retry();
    let SwapStep::Request { id, body, .. } = op.next_step(now).unwrap() else {
        panic!()
    };
    assert!(body.unwrap().contains("eth_getTransactionReceipt"));
    op.on_response(id, 200, json!([{"id":0,"result":null}]).to_string(), now)
        .unwrap();
    let SwapStep::Request { body, .. } = op.next_step(now).unwrap() else {
        panic!()
    };
    assert_eq!(body, original);
    assert_eq!(world.return_submits, 0);
}

#[test]
fn usdg_changed_payout_quote_still_requires_fresh_approval() {
    let (mut world, mut now) = (World::new(), T0);
    let op = usdg_start("confidentialSwap");
    review(&op, &mut world, &mut now);
    op.approve(now).unwrap();
    world.payout_rate_bps = 8000;
    let text = review(&op, &mut world, &mut now);
    assert!(text.contains("QUOTE CHANGED"));
    assert_eq!(world.intents, 0);
    op.cancel();
    assert!(matches!(
        op.next_step(now).unwrap(),
        SwapStep::Paused { .. } | SwapStep::Finished
    ));
    assert_eq!(world.intents, 0);
}

#[test]
fn usdg_discovery_records_existing_balances_without_orders_or_transfers() {
    let (mut world, mut now) = (World::new(), T0);
    world.usdg.insert(world.w.a[0], U256::from(12345));
    let p = json!({"kind":"confidentialRecovery","target":ROBINHOOD_USDG.to_checksum(None),"recipientIndices":[3,4,5],"scanTo":6});
    let op = SwapOperation::start(p.to_string(), ENTROPY.to_vec(), GATEWAY.into(), T0).unwrap();
    assert_eq!(drive(&op, &mut world, &mut now), SwapStep::Finished);
    assert_eq!(status(&op)["receivedTargetAtoms"], "12345");
    assert_eq!(
        (
            world.user_ops,
            world.intents,
            world.orders,
            world.return_submits
        ),
        (0, 0, 0, 0)
    );
}

#[test]
fn usdg_bridge_counts_only_new_delivery_when_a_previous_source_already_paid_wallets() {
    let (mut world, mut now) = (World::new(), T0);
    for a in world.w.a {
        world.usdg.insert(a, U256::from(900_000));
    }
    let op = usdg_start("confidentialSwap");
    review(&op, &mut world, &mut now);
    op.approve(now).unwrap();
    assert_eq!(drive(&op, &mut world, &mut now), SwapStep::Finished);
    let total = world
        .w
        .a
        .iter()
        .fold(U256::ZERO, |sum, a| sum + world.usdg[a]);
    assert_eq!(
        status(&op)["receivedTargetAtoms"],
        (total - U256::from(2_700_000)).to_string()
    );
    assert_eq!(world.orders, 0);
}
