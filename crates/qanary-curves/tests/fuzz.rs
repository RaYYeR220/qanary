use proptest::prelude::*;
use qanary_curves::*;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::OnceLock;

const CURVES: [(Curve, &str); 3] = [
    (Curve::Secp160r1, "secp160r1"),
    (Curve::P192, "p192"),
    (Curve::P224, "p224"),
];

/// Drill public keys (valid points) per curve, so random signatures reach the full verification path.
fn drill_keys() -> &'static [([u8; 32], [u8; 32]); 3] {
    static KEYS: OnceLock<[([u8; 32], [u8; 32]); 3]> = OnceLock::new();
    KEYS.get_or_init(|| {
        let path =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../deployments/canary-targets.json");
        let json: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let b32 = |v: &Value| -> [u8; 32] {
            hex::decode(&v.as_str().unwrap()[2..])
                .unwrap()
                .try_into()
                .unwrap()
        };
        CURVES.map(|(_, name)| {
            (
                b32(&json["drill"][name]["x"]),
                b32(&json["drill"][name]["y"]),
            )
        })
    })
}

fn small(v: u64) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[24..].copy_from_slice(&v.to_be_bytes());
    out
}

proptest! {
    #[test]
    fn arbitrary_inputs_never_panic_or_verify(
        id in any::<u8>(),
        qx in any::<[u8; 32]>(),
        qy in any::<[u8; 32]>(),
        digest in any::<[u8; 32]>(),
        r in any::<[u8; 32]>(),
        s in any::<[u8; 32]>(),
    ) {
        if let Some(c) = Curve::from_u8(id) {
            prop_assert!(!ecdsa_verify(c, &qx, &qy, &digest, &r, &s));
        }
    }

    #[test]
    fn random_signatures_on_valid_keys_never_verify(
        idx in 0usize..3,
        digest in any::<[u8; 32]>(),
        r in any::<[u8; 32]>(),
        s in any::<[u8; 32]>(),
        shift in 0usize..13,
    ) {
        // Shift r, s right by whole bytes so that many land inside [1, n-1].
        let shift_down = |v: [u8; 32]| {
            let mut out = [0u8; 32];
            out[shift + 4..].copy_from_slice(&v[..28 - shift]);
            out
        };
        let (c, _) = CURVES[idx];
        let (qx, qy) = drill_keys()[idx];
        prop_assert!(!ecdsa_verify(c, &qx, &qy, &digest, &shift_down(r), &shift_down(s)));
    }

    #[test]
    fn small_scalars_never_panic_or_verify(
        idx in 0usize..3,
        digest in any::<[u8; 32]>(),
        r in 0u64..4,
        s in 0u64..4,
        x in 0u64..4,
        y in 0u64..4,
    ) {
        let (c, _) = CURVES[idx];
        let (qx, qy) = drill_keys()[idx];
        prop_assert!(!ecdsa_verify(c, &qx, &qy, &digest, &small(r), &small(s)));
        prop_assert!(!ecdsa_verify(c, &small(x), &small(y), &digest, &small(r), &small(s)));
    }
}
