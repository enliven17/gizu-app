//! Exact USDG return deposits. Signed bytes remain inside the encrypted native journal.
use super::{evm, pins::*};
use crate::SignerError;
use alloy_consensus::{SignableTransaction, TxEip1559};
use alloy_primitives::{Address, B256, Signature, TxKind, U256, keccak256};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const MAX_GAS: u64 = 1_000_000;
const MAX_FEE_WEI: u64 = 1_000_000_000_000_000; // 0.001 ETH per deposit, explicitly reviewed.

pub(super) fn data(to: Address, amount: U256) -> String {
    evm::encode_call(
        "transfer(address,uint256)",
        &[evm::word_address(to), evm::word_u256(amount)],
    )
}

pub(super) fn call(from: Address, to: Address, amount: U256) -> Value {
    json!({"from": from.to_checksum(None), "to": ROBINHOOD_USDG.to_checksum(None), "value": "0x0", "data": data(to, amount)})
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct ReturnTransfer {
    pub from: Address,
    pub to: Address,
    pub amount: U256,
    pub nonce: u64,
    gas: u64,
    gas_price: u128,
    pub raw: Option<String>,
    pub hash: Option<B256>,
    #[serde(default)]
    pub retry_broadcast: bool,
}

impl ReturnTransfer {
    pub fn prepare(
        from: Address,
        to: Address,
        amount: U256,
        nonce: U256,
        price: U256,
        gas: U256,
    ) -> Result<Self, SignerError> {
        let gas: u64 = gas.try_into().map_err(|_| SignerError::InvalidInput)?;
        let gas = gas.checked_mul(12).ok_or(SignerError::InvalidInput)? / 10;
        let price: u128 = price.try_into().map_err(|_| SignerError::InvalidInput)?;
        let price = price.checked_mul(2).ok_or(SignerError::InvalidInput)?;
        let t = Self {
            from,
            to,
            amount,
            nonce: nonce.try_into().map_err(|_| SignerError::InvalidInput)?,
            gas,
            gas_price: price,
            raw: None,
            hash: None,
            retry_broadcast: false,
        };
        if to.is_zero()
            || to == from
            || amount.is_zero()
            || !(21_000..=MAX_GAS).contains(&gas)
            || price == 0
            || t.fee() > U256::from(MAX_FEE_WEI)
        {
            return Err(SignerError::InvalidInput);
        }
        Ok(t)
    }
    pub fn fee(&self) -> U256 {
        U256::from(self.gas) * U256::from(self.gas_price)
    }
    pub fn sign(&mut self, key: &bip32::XPrv) -> Result<(), SignerError> {
        if self.raw.is_some() || self.hash.is_some() || evm::key_address(key) != self.from {
            return Err(SignerError::InvalidInput);
        }
        let tx = TxEip1559 {
            chain_id: ROBINHOOD_CHAIN_ID,
            nonce: self.nonce,
            gas_limit: self.gas,
            max_fee_per_gas: self.gas_price,
            max_priority_fee_per_gas: 0,
            to: TxKind::Call(ROBINHOOD_USDG),
            value: U256::ZERO,
            input: evm::hex_bytes(&data(self.to, self.amount))?.into(),
            access_list: Default::default(),
        };
        let signature = evm::sign(key, tx.signature_hash())?;
        let signature = Signature::from_scalars_and_parity(
            B256::from(signature.r),
            B256::from(signature.s),
            signature.y_parity != 0,
        );
        let mut raw = Vec::new();
        tx.into_signed(signature).eip2718_encode(&mut raw);
        self.hash = Some(keccak256(&raw));
        self.raw = Some(alloy_primitives::hex::encode_prefixed(raw));
        Ok(())
    }
    pub fn check_receipt(&self, receipt: &Value) -> Result<bool, SignerError> {
        let string = |k| {
            receipt
                .get(k)
                .and_then(Value::as_str)
                .ok_or(SignerError::InvalidInput)
        };
        if string("transactionHash")?.parse::<B256>().ok() != self.hash
            || evm::addr(string("from")?)? != self.from
            || evm::addr(string("to")?)? != ROBINHOOD_USDG
            || receipt["blockHash"]
                .as_str()
                .and_then(|s| s.parse::<B256>().ok())
                .is_none()
        {
            return Err(SignerError::InvalidInput);
        }
        if string("status")? == "0x0" {
            return Ok(false);
        }
        if string("status")? != "0x1" {
            return Err(SignerError::InvalidInput);
        }
        let expected = json!([
            format!("{:#x}", keccak256("Transfer(address,address,uint256)")),
            format!("{:#x}", B256::from(evm::word_address(self.from))),
            format!("{:#x}", B256::from(evm::word_address(self.to)))
        ]);
        let mut delivered = U256::ZERO;
        for log in receipt["logs"]
            .as_array()
            .ok_or(SignerError::InvalidInput)?
        {
            if log["address"].as_str().and_then(|s| evm::addr(s).ok()) == Some(ROBINHOOD_USDG)
                && log["topics"] == expected
            {
                let bytes = evm::hex_bytes(log["data"].as_str().ok_or(SignerError::InvalidInput)?)?;
                if bytes.len() != 32 {
                    return Err(SignerError::InvalidInput);
                }
                delivered = delivered
                    .checked_add(U256::from_be_slice(&bytes))
                    .ok_or(SignerError::InvalidInput)?;
            }
        }
        if delivered != self.amount {
            return Err(SignerError::InvalidInput);
        }
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::roles::{derive_key, seed_from_entropy};
    use alloy_consensus::Signed;
    fn key() -> bip32::XPrv {
        derive_key(&seed_from_entropy(vec![7; 32]).unwrap(), 3).unwrap()
    }
    fn draft() -> ReturnTransfer {
        ReturnTransfer::prepare(
            evm::key_address(&key()),
            Address::repeat_byte(7),
            U256::from(123456),
            U256::from(4),
            U256::from(100_000_000),
            U256::from(100_000),
        )
        .unwrap()
    }
    #[test]
    fn exact_signed_transfer_is_chain_token_amount_nonce_and_owner_bound() {
        let mut t = draft();
        t.sign(&key()).unwrap();
        let bytes = evm::hex_bytes(t.raw.as_ref().unwrap()).unwrap();
        let decoded = Signed::<TxEip1559>::eip2718_decode(&mut bytes.as_slice()).unwrap();
        let tx = decoded.tx();
        assert_eq!(tx.chain_id, 4663);
        assert_eq!(tx.to, TxKind::Call(ROBINHOOD_USDG));
        assert_eq!(tx.nonce, 4);
        assert!(tx.value.is_zero());
        assert_eq!(
            tx.input.as_ref(),
            evm::hex_bytes(&data(t.to, t.amount)).unwrap()
        );
        assert_eq!(t.hash, Some(keccak256(bytes)));
        assert_eq!(
            U256::from(tx.gas_limit) * U256::from(tx.max_fee_per_gas),
            t.fee()
        );
        assert!(t.sign(&key()).is_err());
        let other = derive_key(&seed_from_entropy(vec![7; 32]).unwrap(), 4).unwrap();
        assert!(draft().sign(&other).is_err());
    }
    #[test]
    fn rejects_unbounded_gas_fee_and_invalid_deposit() {
        for (to, amount, price, gas) in [
            (Address::ZERO, 1, 1, 100_000),
            (Address::repeat_byte(7), 0, 1, 100_000),
            (Address::repeat_byte(7), 1, 1, 1),
            (Address::repeat_byte(7), 1, 0, 100_000),
            (Address::repeat_byte(7), 1, 1, 2_000_000),
            (Address::repeat_byte(7), 1, 10_000_000_000u64, 100_000),
        ] {
            assert!(
                ReturnTransfer::prepare(
                    evm::key_address(&key()),
                    to,
                    U256::from(amount),
                    U256::ZERO,
                    U256::from(price),
                    U256::from(gas)
                )
                .is_err()
            );
        }
    }
    #[test]
    fn validates_receipt_identity_and_exact_transfer_log_not_just_success() {
        let mut t = draft();
        t.sign(&key()).unwrap();
        let receipt = json!({"transactionHash": t.hash, "from": t.from, "to": ROBINHOOD_USDG,
        "blockHash": B256::repeat_byte(4), "status":"0x1", "logs":[{
            "address":ROBINHOOD_USDG,
            "topics":[keccak256("Transfer(address,address,uint256)"), B256::from(evm::word_address(t.from)), B256::from(evm::word_address(t.to))],
            "data": alloy_primitives::hex::encode_prefixed(evm::word_u256(t.amount))
        }]});
        assert!(t.check_receipt(&receipt).unwrap());
        for field in ["transactionHash", "from", "to", "blockHash", "status"] {
            let mut bad = receipt.clone();
            bad[field] = json!("0x1234");
            assert!(t.check_receipt(&bad).is_err(), "{field}");
        }
        let mut bad = receipt.clone();
        bad["logs"] = json!([]);
        assert!(t.check_receipt(&bad).is_err());
        bad = receipt.clone();
        bad["logs"][0]["data"] = json!("0x01");
        assert!(t.check_receipt(&bad).is_err());
        bad = receipt;
        bad["status"] = json!("0x0");
        assert!(!t.check_receipt(&bad).unwrap());
    }
}
