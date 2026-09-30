//! Typed-data hashing and signing for the exact structures the swap policy approves.
use crate::SignerError;
use alloy_primitives::{Address, B256, U256, keccak256};
use bip32::XPrv;
use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};

pub fn word_address(a: Address) -> [u8; 32] {
    let mut w = [0u8; 32];
    w[12..].copy_from_slice(a.as_slice());
    w
}
pub fn word_u256(v: U256) -> [u8; 32] {
    v.to_be_bytes::<32>()
}

pub fn domain_separator(name: &str, version: &str, chain_id: u64, verifying_contract: Address) -> B256 {
    let type_hash = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    let mut buf = Vec::with_capacity(160);
    buf.extend_from_slice(type_hash.as_slice());
    buf.extend_from_slice(keccak256(name).as_slice());
    buf.extend_from_slice(keccak256(version).as_slice());
    buf.extend_from_slice(&word_u256(U256::from(chain_id)));
    buf.extend_from_slice(&word_address(verifying_contract));
    keccak256(buf)
}

pub fn typed_hash(domain: B256, type_signature: &str, fields: &[[u8; 32]]) -> B256 {
    let mut body = Vec::with_capacity(32 * (fields.len() + 1));
    body.extend_from_slice(keccak256(type_signature).as_slice());
    for f in fields {
        body.extend_from_slice(f);
    }
    let mut digest = Vec::with_capacity(66);
    digest.extend_from_slice(&[0x19, 0x01]);
    digest.extend_from_slice(domain.as_slice());
    digest.extend_from_slice(keccak256(body).as_slice());
    keccak256(digest)
}

pub fn personal_hash(message: &[u8]) -> B256 {
    let mut buf = format!("\x19Ethereum Signed Message:\n{}", message.len()).into_bytes();
    buf.extend_from_slice(message);
    keccak256(buf)
}

fn rlp_uint(v: u64, out: &mut Vec<u8>) {
    if v == 0 {
        out.push(0x80);
    } else if v < 0x80 {
        out.push(v as u8);
    } else {
        let bytes = v.to_be_bytes();
        let start = bytes.iter().position(|b| *b != 0).unwrap_or(7);
        out.push(0x80 + (8 - start) as u8);
        out.extend_from_slice(&bytes[start..]);
    }
}

/// EIP-7702: keccak256(0x05 || rlp([chain_id, address, nonce])).
pub fn authorization_hash(chain_id: u64, delegate: Address, nonce: u64) -> B256 {
    let mut payload = Vec::with_capacity(40);
    rlp_uint(chain_id, &mut payload);
    payload.push(0x94);
    payload.extend_from_slice(delegate.as_slice());
    rlp_uint(nonce, &mut payload);
    let mut buf = vec![0x05, 0xc0 + payload.len() as u8];
    buf.extend_from_slice(&payload);
    keccak256(buf)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RawSignature {
    pub r: [u8; 32],
    pub s: [u8; 32],
    pub y_parity: u8,
}
impl RawSignature {
    pub fn rsv(&self) -> [u8; 65] {
        let mut out = [0u8; 65];
        out[..32].copy_from_slice(&self.r);
        out[32..64].copy_from_slice(&self.s);
        out[64] = 27 + self.y_parity;
        out
    }
    pub fn rsv_hex(&self) -> String {
        alloy_primitives::hex::encode_prefixed(self.rsv())
    }
}

pub fn sign(key: &XPrv, digest: B256) -> Result<RawSignature, SignerError> {
    let (sig, rec) = key.private_key().sign_prehash_recoverable(digest.as_slice());
    if rec.to_byte() > 1 {
        return Err(SignerError::CryptoFailed);
    }
    let bytes = sig.to_bytes();
    let mut r = [0u8; 32];
    let mut s = [0u8; 32];
    r.copy_from_slice(&bytes[..32]);
    s.copy_from_slice(&bytes[32..]);
    Ok(RawSignature { r, s, y_parity: rec.to_byte() })
}

pub fn recover(digest: B256, r: &[u8; 32], s: &[u8; 32], y_parity: u8) -> Result<Address, SignerError> {
    let mut bytes = [0u8; 64];
    bytes[..32].copy_from_slice(r);
    bytes[32..].copy_from_slice(s);
    let sig = Signature::from_slice(&bytes).map_err(|_| SignerError::CryptoFailed)?;
    let rec = RecoveryId::from_byte(y_parity).ok_or(SignerError::CryptoFailed)?;
    let key = VerifyingKey::recover_from_prehash(digest.as_slice(), &sig, rec).map_err(|_| SignerError::CryptoFailed)?;
    let point = key.to_sec1_point(false);
    Ok(Address::from_slice(&keccak256(&point.as_bytes()[1..])[12..]))
}

pub fn key_address(key: &XPrv) -> Address {
    let point = key.private_key().verifying_key().to_sec1_point(false);
    Address::from_slice(&keccak256(&point.as_bytes()[1..])[12..])
}

pub fn hex_bytes(s: &str) -> Result<Vec<u8>, SignerError> {
    let digits = s.strip_prefix("0x").ok_or(SignerError::InvalidInput)?;
    alloy_primitives::hex::decode(digits).map_err(|_| SignerError::InvalidInput)
}

/// Strict 0x quantity: no leading zeros, at most 256 bits.
pub fn quantity(s: &str) -> Result<U256, SignerError> {
    let digits = s.strip_prefix("0x").ok_or(SignerError::InvalidInput)?;
    if digits.is_empty() || digits.len() > 64 || (digits.len() > 1 && digits.starts_with('0')) || !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(SignerError::InvalidInput);
    }
    U256::from_str_radix(digits, 16).map_err(|_| SignerError::InvalidInput)
}

/// Strict decimal integer without sign, exponent or leading zeros.
pub fn decimal(s: &str) -> Result<U256, SignerError> {
    if s.is_empty() || s.len() > 78 || (s.len() > 1 && s.starts_with('0')) || !s.bytes().all(|b| b.is_ascii_digit()) {
        return Err(SignerError::InvalidInput);
    }
    U256::from_str_radix(s, 10).map_err(|_| SignerError::InvalidInput)
}

pub fn addr(s: &str) -> Result<Address, SignerError> {
    if s.len() != 42 || !s.starts_with("0x") {
        return Err(SignerError::InvalidInput);
    }
    s.parse().map_err(|_| SignerError::InvalidInput)
}

pub fn quantity_u64(value: u64) -> String {
    format!("0x{value:x}")
}
pub fn quantity_u256(value: U256) -> String {
    format!("{value:#x}")
}

pub struct AbiReader<'a> {
    data: &'a [u8],
}
impl<'a> AbiReader<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        Self { data }
    }
    pub fn word(&self, offset: usize) -> Result<&'a [u8], SignerError> {
        self.data.get(offset..offset + 32).ok_or(SignerError::InvalidInput)
    }
    pub fn uint(&self, offset: usize) -> Result<U256, SignerError> {
        Ok(U256::from_be_slice(self.word(offset)?))
    }
    pub fn usize(&self, offset: usize) -> Result<usize, SignerError> {
        let v = self.uint(offset)?;
        if v > U256::from(self.data.len()) {
            return Err(SignerError::InvalidInput);
        }
        Ok(v.to::<usize>())
    }
    pub fn address(&self, offset: usize) -> Result<Address, SignerError> {
        let w = self.word(offset)?;
        if w[..12].iter().any(|b| *b != 0) {
            return Err(SignerError::InvalidInput);
        }
        Ok(Address::from_slice(&w[12..]))
    }
    pub fn bytes(&self, offset: usize) -> Result<&'a [u8], SignerError> {
        let len = self.usize(offset)?;
        self.data.get(offset + 32..offset + 32 + len).ok_or(SignerError::InvalidInput)
    }
}

pub fn selector(signature: &str) -> [u8; 4] {
    let h = keccak256(signature);
    [h[0], h[1], h[2], h[3]]
}

pub fn encode_call(signature: &str, words: &[[u8; 32]]) -> String {
    let mut out = selector(signature).to_vec();
    for w in words {
        out.extend_from_slice(w);
    }
    alloy_primitives::hex::encode_prefixed(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authorization_hash_recovers_the_research_source_wallet() {
        let delegate = addr("0xe6Cae83BdE06E4c305530e199D7217f42808555B").unwrap();
        let digest = authorization_hash(143, delegate, 0);
        let mut r = [0u8; 32];
        let mut s = [0u8; 32];
        r.copy_from_slice(&hex_bytes("0x42f807ba995228de788bea7524c1f1efdf9bfe4964fe5fd17018a6e4f17c5180").unwrap());
        s.copy_from_slice(&hex_bytes("0x48128d05aed6d962a931d53158b8db487772e7ad4435e6390b981b534f6d9086").unwrap());
        assert_eq!(recover(digest, &r, &s, 1).unwrap(), addr("0xcd58DBfdDa39dea8cacA8592Eca2b8a637Cf4934").unwrap());
    }

    #[test]
    fn strict_number_parsing_rejects_ambiguous_forms() {
        assert_eq!(quantity("0x8f").unwrap(), U256::from(143));
        for bad in ["8f", "0x", "0x08f", "0xg"] {
            assert!(quantity(bad).is_err(), "{bad}");
        }
        assert_eq!(decimal("206883").unwrap(), U256::from(206_883));
        for bad in ["", "01", "1e3", "-1", " 1"] {
            assert!(decimal(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn rlp_encodes_multi_byte_integers() {
        let mut out = vec![];
        rlp_uint(4663, &mut out);
        assert_eq!(out, vec![0x82, 0x12, 0x37]);
    }
}
