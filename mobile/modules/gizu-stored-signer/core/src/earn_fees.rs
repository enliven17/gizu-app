use crate::SignerError;
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Proof {
    version: String,
    route: String,
    total_bps: u32,
    app_fees: Vec<Fee>,
    referral: Option<String>,
    integrator_fee_bps: u32,
    application_fee_atoms: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Fee {
    recipient: String,
    fee: u32,
}
fn identity(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.:-".contains(&b))
}
/// Only platform native TLS constructs this proof. The review includes its full
/// exact fee terms and participates in the core approval hash.
pub(crate) fn review(
    proof: Option<&str>,
    route: &str,
    expected_total: Option<u32>,
) -> Result<String, SignerError> {
    let Some(text) = proof else {
        if expected_total.is_some_and(|n| n != 2) {
            return Err(SignerError::InvalidInput);
        }
        return Ok(
            "Legacy qualified provider fee 2 bps; no referral or Gizu/integrator fee".into(),
        );
    };
    if text.len() > 4096 {
        return Err(SignerError::InvalidInput);
    }
    let p: Proof = serde_json::from_str(text).map_err(|_| SignerError::InvalidInput)?;
    if !identity(&p.version)
        || p.route != route
        || p.total_bps > 100
        || expected_total.is_some_and(|n| n != p.total_bps)
        || p.integrator_fee_bps != 0
        || p.application_fee_atoms != "0"
        || p.app_fees.len() > 8
        || p.referral.as_ref().is_some_and(|s| !identity(s))
    {
        return Err(SignerError::InvalidInput);
    }
    let mut recipients = std::collections::HashSet::new();
    let mut total = 0;
    for f in &p.app_fees {
        if !identity(&f.recipient) || f.fee > 100 || !recipients.insert(&f.recipient) {
            return Err(SignerError::InvalidInput);
        }
        total += f.fee;
    }
    if total != p.total_bps {
        return Err(SignerError::InvalidInput);
    }
    Ok(format!(
        "Fee policy {} · route {} · total {} bps\n{}\nReferral {} · Gizu/integrator fee 0",
        p.version,
        p.route,
        p.total_bps,
        p.app_fees
            .iter()
            .map(|f| format!("{}: {} bps", f.recipient, f.fee))
            .collect::<Vec<_>>()
            .join("\n"),
        p.referral.as_deref().unwrap_or("none")
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    fn proof(total: u32) -> String {
        serde_json::json!({"version":"qualified-2026","route":"source","totalBps":total,"appFees":[{"recipient":"provider.near","fee":total}],"referral":"qualified","integratorFeeBps":0,"applicationFeeAtoms":"0"}).to_string()
    }
    #[test]
    fn review_binds_actual_route_fees_and_policy() {
        let p = proof(4);
        let text = review(Some(&p), "source", Some(4)).unwrap();
        assert!(
            text.contains("qualified-2026")
                && text.contains("provider.near")
                && text.contains("4 bps")
        );
    }
    #[test]
    fn changed_route_rate_and_gizu_charge_are_rejected() {
        let p = proof(4);
        assert!(review(Some(&p), "returnEth", Some(4)).is_err());
        assert!(review(Some(&p), "source", Some(5)).is_err());
        let p = p.replace("\"integratorFeeBps\":0", "\"integratorFeeBps\":1");
        assert!(review(Some(&p), "source", Some(4)).is_err());
        assert!(review(None, "source", Some(4)).is_err());
    }
}
