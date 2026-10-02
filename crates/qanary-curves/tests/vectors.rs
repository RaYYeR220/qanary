use qanary_curves::*;
use serde_json::Value;
use std::path::PathBuf;

fn repo_file(rel: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(rel);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap()
}

fn load(curve: &str) -> Vec<Value> {
    repo_file(&format!("vectors/ladder/{curve}.json"))["vectors"]
        .as_array()
        .unwrap()
        .clone()
}

fn b32(v: &Value) -> [u8; 32] {
    let s = v.as_str().unwrap();
    hex::decode(s.strip_prefix("0x").unwrap_or(s))
        .unwrap()
        .try_into()
        .unwrap()
}

fn verify_case(c: Curve, v: &Value) -> bool {
    ecdsa_verify(
        c,
        &b32(&v["qx"]),
        &b32(&v["qy"]),
        &b32(&v["digest"]),
        &b32(&v["r"]),
        &b32(&v["s"]),
    )
}

const REQUIRED_KINDS: &[&str] = &[
    "valid",
    "truncated_bits_changed",
    "malleated_s",
    "tampered_digest",
    "tampered_r",
    "tampered_s",
    "r_zero",
    "s_zero",
    "r_eq_n",
    "s_eq_n",
    "off_curve",
    "infinity",
    "qx_plus_p",
    "claim_a",
    "claim_a_for_b",
];

fn run(c: Curve, name: &str) {
    let vectors = load(name);
    let (mut n, mut valid) = (0, 0);
    for v in &vectors {
        let expected = v["valid"].as_bool().unwrap();
        assert_eq!(
            verify_case(c, v),
            expected,
            "{name} case {n} ({})",
            v["kind"]
        );
        valid += expected as usize;
        n += 1;
    }
    assert!(n >= 70, "{name}: only {n} vectors");
    assert!(valid >= 64, "{name}: only {valid} valid vectors");
    for kind in REQUIRED_KINDS {
        assert!(
            vectors.iter().any(|v| v["kind"] == *kind),
            "{name}: no {kind} vector"
        );
    }
}

#[test]
fn secp160r1_vectors() {
    run(Curve::Secp160r1, "secp160r1");
}

#[test]
fn p192_vectors() {
    run(Curve::P192, "p192");
}

#[test]
fn p224_vectors() {
    run(Curve::P224, "p224");
}

#[test]
fn x_coordinate_reduced_mod_n() {
    // R.x in [n, p): only possible where p > n.
    for (c, name) in [(Curve::P192, "p192"), (Curve::P224, "p224")] {
        let v: Vec<_> = load(name)
            .into_iter()
            .filter(|v| v["kind"] == "x_ge_n")
            .collect();
        assert_eq!(v.len(), 1, "{name}");
        assert!(verify_case(c, &v[0]), "{name}");
    }
}

/// The drill public keys published in deployments/canary-targets.json verify the
/// claimant-bound drill signatures, and only for the claimant they were made for.
#[test]
fn drill_keys_match_nums_script() {
    let targets = repo_file("deployments/canary-targets.json");
    for (c, name) in [
        (Curve::Secp160r1, "secp160r1"),
        (Curve::P192, "p192"),
        (Curve::P224, "p224"),
    ] {
        let drill = &targets["drill"][name];
        let claims: Vec<_> = load(name)
            .into_iter()
            .filter(|v| v["kind"].as_str().unwrap().starts_with("claim_"))
            .collect();
        assert_eq!(claims.len(), 4, "{name}");
        for v in &claims {
            assert_eq!(b32(&v["qx"]), b32(&drill["x"]), "{name} {}", v["kind"]);
            assert_eq!(b32(&v["qy"]), b32(&drill["y"]), "{name} {}", v["kind"]);
            let expected = v["kind"] == "claim_a" || v["kind"] == "claim_b";
            assert_eq!(
                v["valid"].as_bool().unwrap(),
                expected,
                "{name} {}",
                v["kind"]
            );
            assert_eq!(verify_case(c, v), expected, "{name} {}", v["kind"]);
        }
    }
}

/// Output of `python scripts/ladder_sign.py <curve> <drill privateKey> <claim_a digest>`,
/// captured once: the FFI signer used by the Solidity tests agrees with `ecdsa_verify`.
#[test]
fn ladder_sign_script_output_verifies() {
    let cases = [
        (
            Curve::Secp160r1,
            "secp160r1",
            "0x5e2fe99bd1097d8ca85ea0676afa5c8b1cc3f020258b52ebab252c6677f20321",
            "0x000000000000000000000000a6b154b3a3f748d6710b2c48876069f62eb4cf50000000000000000000000000fa546fb6d29fec15db7513f3d38403d9e82bfd35",
        ),
        (
            Curve::P192,
            "p192",
            "0xbadc4dce851d7736abd7e88c852707b5cb78bb7345880aa534d293ee39184234",
            "0x00000000000000004c9996900bfacff18bc83a8e429ed68ad1a006f98c83852200000000000000000b267a5c2405e9d4e9a40f1a8ad10066476c4e2b15b6c4e3",
        ),
        (
            Curve::P224,
            "p224",
            "0xab9c6a90cabbdbfc3aa5215c4dcad85c90955ae739415dc94988385878670b05",
            "0x000000009ebbb4c37324996622eb4057bc218a0e75b8680e149155dcf63bdb83000000007c8c068f6d06ab6e524d789af6b359334c1b53117379893e18c97c30",
        ),
    ];
    let targets = repo_file("deployments/canary-targets.json");
    for (c, name, digest, sig) in cases {
        let drill = &targets["drill"][name];
        let (qx, qy) = (b32(&drill["x"]), b32(&drill["y"]));
        let digest = b32(&Value::from(digest));
        let sig = hex::decode(&sig[2..]).unwrap();
        let r: [u8; 32] = sig[..32].try_into().unwrap();
        let mut s: [u8; 32] = sig[32..].try_into().unwrap();
        assert!(ecdsa_verify(c, &qx, &qy, &digest, &r, &s), "{name}");
        s[31] ^= 1;
        assert!(
            !ecdsa_verify(c, &qx, &qy, &digest, &r, &s),
            "{name} tampered s"
        );
    }
}

#[test]
fn curve_ids() {
    assert_eq!(Curve::from_u8(1), Some(Curve::Secp160r1));
    assert_eq!(Curve::from_u8(2), Some(Curve::P192));
    assert_eq!(Curve::from_u8(3), Some(Curve::P224));
    for v in [0u8, 4, 9, 255] {
        assert_eq!(Curve::from_u8(v), None);
    }
    assert_eq!(Curve::P224 as u8, 3);
}
