// Every number and claim the site prints lives here, so it can be checked in
// one place.

/** Basis of the head-to-head comparison with Solidity. */
export const MEASURED = 'execution gas for a cached program, measured on an Arbitrum Nitro node (ArbOS 61)';
/** Basis of the live figures, read from the ApeChain deployment record. */
export const LIVE_BASIS =
  'gas per verification call live on ApeChain, calldata included and uncached, since ApeChain has no cache manager';

/** Stylus on Arbitrum One: new activations paused by the Security Council. */
export const ARBITRUM_ONE_PAUSE = {
  date: '2 October 2026',
  tx: 'https://arbiscan.io/tx/0x9eb3a4be3ba777f9fc82250eddc10f8356731cc97c09a70801d30ce33322c652',
  forum: 'https://forum.arbitrum.foundation/t/security-council-emergency-action-2-10-2026/31530',
  /** The Solidity ML-DSA-44 verifier the account modules use there meanwhile. */
  fallback: 'a Solidity ML-DSA-44 verifier (Fireblocks core, about 1.24M gas per verification)',
};

export interface GasRow {
  scheme: 'Falcon-512' | 'ML-DSA-44' | 'ML-DSA-65';
  standard: string;
  stylus: number;
  solidity: { gas: number; source: string }[];
  ratio: string;
  sig: number;
  pk: number;
}

export const GAS: GasRow[] = [
  {
    scheme: 'Falcon-512',
    standard: 'Round-3 Falcon',
    stylus: 36_000,
    solidity: [{ gas: 641_000, source: 'ZKNox, experimental' }],
    ratio: '18',
    sig: 666,
    pk: 897,
  },
  {
    scheme: 'ML-DSA-44',
    standard: 'FIPS 204',
    stylus: 110_000,
    solidity: [
      { gas: 1_190_000, source: 'ZKNox, experimental' },
      { gas: 1_230_000, source: 'Fireblocks, Sep 2026' },
    ],
    ratio: '11',
    sig: 2_420,
    pk: 1_312,
  },
  {
    scheme: 'ML-DSA-65',
    standard: 'FIPS 204',
    stylus: 166_000,
    solidity: [{ gas: 1_550_000, source: 'ZKNox, experimental' }],
    ratio: '9',
    sig: 3_309,
    pk: 1_952,
  },
];

/** ERC-4337 validation gas budget the verifiers fit inside. */
export const VALIDATION_BUDGET = 500_000;

export interface Rung {
  /** Slider position. */
  at: 0 | 1 | 2 | 3 | 4 | 5;
  /** Short tick label. */
  tick: string;
  /** Narrow-screen tick label. */
  short: string;
  curve: string | null;
  event: string;
  response: string;
  plate: string;
}

export const RUNGS: Rung[] = [
  {
    at: 0, tick: 'none', short: 'none', curve: null,
    event: 'No rung broken.',
    response: 'The hot key spends within its full cap. Anything above the cap needs the post-quantum key.',
    plate: 'Proof, unworn',
  },
  {
    at: 1, tick: '160', short: '160', curve: 'secp160r1',
    event: 'secp160r1 broken.',
    response: 'The hot-key cap halves (×0.5).',
    plate: 'First wear',
  },
  {
    at: 2, tick: '192', short: '192', curve: 'P-192',
    event: 'P-192 broken.',
    response: 'The hot-key cap drops to a tenth (×0.1).',
    plate: 'Worn',
  },
  {
    at: 3, tick: '224', short: '224', curve: 'P-224',
    event: 'P-224 broken.',
    response: 'The hot tier freezes. Only the post-quantum key can move funds.',
    plate: 'Heavily worn',
  },
  {
    at: 4, tick: 'secp256k1', short: 'k1', curve: 'secp256k1',
    event: 'secp256k1 broken.',
    response: 'Ethereum ECDSA keys are disabled for good. The post-quantum key still signs.',
    plate: 'Plate failing',
  },
  {
    at: 5, tick: 'P-256', short: 'r1', curve: 'P-256',
    event: 'P-256 broken.',
    response: 'Passkeys are disabled for good as well. The post-quantum key still signs.',
    plate: 'Worn through',
  },
];

export interface Dated {
  when: string;
  year: number;
  /** Fraction of the year, for placing the entry on the ruler. */
  at: number;
  who: string;
  what: string;
  note?: number;
}

export const TODAY = { year: 2026, at: 0.75, label: 'October 2026' };

export const CHRONOLOGY: Dated[] = [
  { when: 'June 2026', year: 2026, at: 0.42, who: 'United States', what: 'Executive Order 14412 sets post-quantum signatures by 2031.', note: 4 },
  { when: 'July 2026', year: 2026, at: 0.5, who: 'Singapore, CSA', what: 'The Quantum-Safe Handbook names ML-DSA and sets the dates below.', note: 5 },
  { when: 'July 2026', year: 2026, at: 0.55, who: 'Singapore, MAS', what: 'Calls for “quantum resilience before the end of this decade.”', note: 6 },
  { when: '31 March 2027', year: 2027, at: 0.25, who: 'Singapore, CSA', what: 'Migration plans due.', note: 5 },
  { when: '1 January 2028', year: 2028, at: 0, who: 'Singapore, CSA', what: 'New systems quantum-safe from this date.', note: 5 },
  { when: '2031', year: 2031, at: 0.5, who: 'United States', what: 'Post-quantum signatures, under EO 14412.', note: 4 },
  { when: 'After 2035', year: 2035, at: 0.99, who: 'NIST IR 8547, draft', what: 'ECDSA disallowed.', note: 7 },
];

/** Notes, numbered in the order the page first cites them. */
export const SOURCES: { n: number; text: string; href?: string }[] = [
  { n: 1, text: 'Ethereum Yellow Paper, Appendix F: a transaction’s signature lets anyone recover the sender’s public key.' },
  { n: 2, text: 'Deloitte; Project Eleven. Share of ETH held in accounts with exposed public keys.' },
  { n: 3, text: 'Project Eleven, May 2026. Bitcoin held at addresses with exposed public keys.' },
  { n: 4, text: 'United States Executive Order 14412, June 2026.' },
  { n: 5, text: 'Cyber Security Agency of Singapore, Quantum-Safe Handbook, July 2026.' },
  { n: 6, text: 'Monetary Authority of Singapore, July 2026.' },
  { n: 7, text: 'NIST IR 8547, Transition to Post-Quantum Cryptography Standards (initial public draft).' },
  {
    n: 8,
    text: 'Arbitrum Security Council, emergency action of 2 October 2026 pausing new Stylus activations on Arbitrum One and Nova.',
    href: 'https://forum.arbitrum.foundation/t/security-council-emergency-action-2-10-2026/31530',
  },
  { n: 9, text: 'Solidity comparisons: ZKNox experimental verifiers; Fireblocks ML-DSA-44 verifier, September 2026.' },
];

export const PARTNERS: { mark: string; detail: string; role: string }[] = [
  { mark: 'Arbitrum Stylus', detail: 'WASM verifiers', role: 'Runs the three verifiers, each under 18 KB compressed.' },
  { mark: 'ApeChain', detail: 'Arbitrum Orbit chain', role: 'Hosts the live Stylus verifiers and settles to Arbitrum One.' },
  { mark: 'ZeroDev Kernel', detail: 'v3.3', role: 'Qanary installs as an ERC-7579 validator and executor.' },
  { mark: 'Safe', detail: '1.3 and 1.4.1', role: 'Post-quantum ERC-1271 owners, such as a 9-of-12 council of post-quantum keys.' },
  { mark: 'OpenZeppelin', detail: 'Accounts, ERC-7913', role: 'Uses the verifiers directly as ERC-7913 signers.' },
  { mark: 'AWS KMS', detail: 'ML-DSA-44', role: 'Keeps the cold key in an HSM and signs with ML_DSA_SHAKE_256.' },
  { mark: 'Paxos USDG', detail: 'Stablecoin', role: 'Bounties and caps can be denominated in USDG.' },
];
