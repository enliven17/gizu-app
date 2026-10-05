//! Exact native RPC arithmetic for Earn adapters; no floating-point conversions.
use crate::SignerError;
use alloy_primitives::U256;

fn amount(value: &str) -> Result<U256, SignerError> {
    if value.is_empty()
        || value.len() > 78
        || !value.bytes().all(|b| b.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return Err(SignerError::InvalidInput);
    }
    U256::from_str_radix(value, 10).map_err(|_| SignerError::InvalidInput)
}
#[uniffi::export]
pub fn earn_quantity_value(value: String) -> Result<String, SignerError> {
    let hex = value.strip_prefix("0x").ok_or(SignerError::InvalidInput)?;
    if hex.is_empty()
        || hex.len() > 64
        || (hex.len() > 1 && hex.starts_with('0'))
        || !hex.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(SignerError::InvalidInput);
    }
    Ok(U256::from_str_radix(hex, 16)
        .map_err(|_| SignerError::InvalidInput)?
        .to_string())
}
#[uniffi::export]
pub fn earn_amount_word(value: String) -> Result<String, SignerError> {
    Ok(format!("{:064x}", amount(&value)?))
}
#[uniffi::export]
pub fn earn_amount_sum(values: Vec<String>) -> Result<String, SignerError> {
    if values.len() > 8192 {
        return Err(SignerError::InvalidInput);
    }
    values
        .iter()
        .try_fold(U256::ZERO, |total, value| {
            total
                .checked_add(amount(value)?)
                .ok_or(SignerError::InvalidInput)
        })
        .map(|v| v.to_string())
}
#[uniffi::export]
pub fn earn_amount_product(left: String, right: String) -> Result<String, SignerError> {
    amount(&left)?
        .checked_mul(amount(&right)?)
        .map(|v| v.to_string())
        .ok_or(SignerError::InvalidInput)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_values_reject_noncanonical_and_overflowing_inputs() {
        assert_eq!(
            earn_quantity_value("0x20000000000001".into()).unwrap(),
            "9007199254740993"
        );
        assert_eq!(
            earn_amount_sum(vec!["9007199254740993".into(), "1".into()]).unwrap(),
            "9007199254740994"
        );
        for bad in ["0x", "0x00", "-1", "0xgg"] {
            assert!(earn_quantity_value(bad.into()).is_err());
        }
        for bad in ["", "01", "-1", "1.1"] {
            assert!(earn_amount_word(bad.into()).is_err());
        }
        assert!(earn_amount_sum(vec![U256::MAX.to_string(), "1".into()]).is_err());
        assert!(earn_amount_product(U256::MAX.to_string(), "2".into()).is_err());
    }
}
