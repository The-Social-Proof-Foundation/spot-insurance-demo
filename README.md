# SPoT × Insurance — interactive demo

A TypeScript web app that demonstrates MySo **Social Proof of Truth (SPoT)** prediction
markets together with the **insurance** module that underwrites them, on a live local
devnet.

It reads every market straight off the chain, enriches it from the social indexer, and
lets you drive the whole lifecycle from the browser — including a **simulated SPoT
oracle** whose signing key comes from an environment variable.

```
┌──────────────┐   reads    ┌───────────────────────┐
│  web (React) │ ─────────► │  api (Node)           │
│  :5273       │            │  :8787                │
└──────────────┘            └───────┬───────────────┘
                                    │ read-only
                       ┌────────────┴────────────┐
                       ▼                         ▼
        chain GraphQL :9125            myso-social-server :9126
        (object enumeration,           (indexed escrow, bets,
         Move JSON, tx events)          payouts, insurance)
                                    │ write (env-var key)
                                    ▼
                              MySo JSON-RPC :9000
                        social_contracts (0x50c1)
```

Nothing in this repo modifies the indexer, the GraphQL server or the social API. Those
are consumed exactly as they ship.

---

## What the demo shows

### The SPoT half

A post asserts a claim. SPoT turns that claim into a **prediction market**:

1. `post::create_public_post` publishes the claim as a normal social post.
2. The oracle reviews it and calls
   `social_proof_of_truth::create_and_finalize_spot_market_for_post`, which
   - registers a `SpotClaim` keyed by the **SHA-256 of a canonical claim identity**,
   - opens a `SpotMarket` with the configured betting options,
   - links the post at claim index 0 in `SpotClaimRegistry`, and
   - flips the post's `spot_analysis_status` to *completed*.
3. Users back an option with `place_spot_bet_for_post`.
4. The oracle resolves with `oracle_resolve`. Confidence below
   `SpotConfig.confidence_threshold_bps` **escalates to the DAO** instead of paying out.

Approving the same claim twice does not open a second market: `market_key_hash` is the
registry's dedup key and the contract aborts with `EMarketExists`, which the UI reports as
a dedup rather than an error.

### The insurance half

Insurance is only reachable once a market exists. The module prices coverage **from SPoT
liquidity**: the covered option's share of escrow is the implied win probability, scaled by
a risk multiplier and clamped by `InsuranceConfig` caps.

- `insurance::set_insurance_enabled` — the module is off by default and everything reverts
  with `EDisabled` until it is enabled.
- `insurance::create_vault` + `deposit_capital` — the underwriter side.
- `insurance::buy_coverage` — capped at the caller's escrow on the covered option
  (`spot::get_user_option_amount`), so **you must hold a position before you can insure it**.
- On settlement, coverage pays out against the same outcome the SPoT market resolved.

### What is faked

Only the off-chain **review**. The real `myso-spot-oracle` polls the indexer, runs an LLM
review over each post, derives the canonical hashes and submits the PTBs. Here the
operator clicks *Approve SPoT* in the UI and the backend reproduces the on-chain half
faithfully:

- same package (`0x50c1`) and same entrypoints,
- same canonicalisation — SHA-256 over compact JSON, `deadline_day` bucketed to `YYYY-MM-DD`,
  betting options sorted + deduped before hashing,
- same ordering constraints (claim index 0, `resolution_policy_hash = market_key_hash`),
- same account (the `SpotOracleAdminCap` holder).

The one deliberate shortcut: the demo's "extraction" is a deterministic stub that slugs the
claim text into the identity's `object` / `entity_ref` fields. That keeps hashes stable and
claim-specific without an LLM in the loop.

---

## Prerequisites

A running MySo devnet with the social stack, e.g.

```bash
cd ../myso-core
./target/debug/myso start \
  --with-faucet --force-regenesis \
  --with-indexer=postgres://postgres@localhost:5432/sui_indexer \
  --with-social-indexer=postgresql://postgres@localhost:5432/social \
  --with-graphql --with-mydata --with-orderbook --with-messaging
```

That brings up the three services this app reads:

| Service | URL | Purpose |
| --- | --- | --- |
| MySo JSON-RPC | `http://127.0.0.1:9000` | transaction submission |
| Chain GraphQL | `http://127.0.0.1:9125/graphql` | object enumeration + parsed events |
| myso-social-server | `http://127.0.0.1:9126` | indexed SPoT + insurance projections |

> There is **no "list all spot markets" route** in the social server — `spot_markets` is
> only read for a single post inside `GET /spot/route/:post_id`. Market enumeration is
> therefore done against the chain GraphQL (`objects(filter: { type: "0x50c1::…::SpotMarket" })`)
> and the social API supplies the indexed enrichment. See
> [`docs/`](./docs) for the full API and oracle blueprints.

## Setup

```bash
pnpm install
cp .env.example .env        # then set SPOT_ORACLE_PRIVATE_KEY
pnpm dev
```

Then open **http://localhost:5273**.

`pnpm dev` runs the API (`:8787`) and the web app (`:5273`) together. Tabs are
deep-linkable: `?tab=markets`, `?tab=insurance`, `?tab=oracle`.

### The oracle key

`SPOT_ORACLE_PRIVATE_KEY` must be an account holding `SpotOracleAdminCap`,
`SpotAdminCap` and `InsuranceAdminCap`. On a fresh devnet that is the deployer address
`0x2458…11d8`, whose key is in `~/.myso/myso_config/myso.keystore`:

```bash
# list the keystore; the entry whose base64 decodes to 00<seed> is the admin key
python3 - <<'EOF'
import json, base64
for i, k in enumerate(json.load(open("/Users/you/.myso/myso_config/myso.keystore"))):
    print(i, k)
EOF
```

Accepted formats: 64-char hex seed, `0x`-prefixed 66-char `flag||seed` hex, base64
(32 or 33 bytes), or bech32 `mysoprivkey…`. Leave it empty to run the UI read-only —
every view still works, only the action buttons disable.

---

## Demo script

Open `?tab=oracle` and walk the numbered steps:

| Step | Action | On-chain effect |
| --- | --- | --- |
| — | **Enable** SPoT truth layer / insurance module | `update_spot_config`, `set_insurance_enabled` |
| — | **Create underwriter vault** | `create_vault` + `deposit_capital` |
| 1 | **Publish post** | `post::create_public_post` |
| 2 | **Approve SPoT** | `create_and_finalize_spot_market_for_post` → claim + market + post link |
| 3 | **Place bet**, then **Buy coverage** | `place_spot_bet_for_post`, `insurance::buy_coverage` |
| 4 | **Resolve** | `oracle_resolve` → payouts / refunds / DAO escalation |

Watch the transaction log for digests, then switch to **Markets** and click the row: the
dialog shows the option breakdown, canonical hashes, lifecycle timings, the insurance
policy ledger, every bet, settlement flows and the raw Move objects.

To see DAO escalation instead of a payout, resolve with a `confidenceBps` below the
threshold shown next to the resolve button.

---

## Auth

Authentication mirrors `orderbook-sandbox-main/sandbox/dashboard`:

- `createMySocialAuth` → popup sign-in → `POST {apiBase}/salt` (bodyless, bearer token) →
  `Ed25519Keypair.fromSecretKey(SHA256(`${sub}_${salt}`)[0..32])`, asserted against
  `session.user.address`.

Fill in the `VITE_MYSOCIAL_*` values in `web/.env` to enable it. When they are unset the
header offers a local **demo session** so the UI is fully explorable without an auth
server.

The browser session never holds a spending key: every transaction is signed server-side by
the oracle key. The MySocial keypair exists to prove the session is a real signing identity.

---

## Layout

```
api/src/
  env.ts        configuration + the SPOT_ORACLE_PRIVATE_KEY contract
  gql.ts        chain GraphQL: objects by type, Move JSON, parsed tx events
  social.ts     myso-social-server REST client (read-only)
  ids.ts        object-id discovery (SpotConfig, caps, registries, platform, treasury…)
  canonical.ts  canonical claim identity + SHA-256 hashes (port of outcome_identity.rs)
  markets.ts    market list/detail aggregation: chain + indexer + insurance
  oracle.ts     the simulated oracle: approve, resolve, config, vault, bet, coverage, post
  chain.ts      client/keypair/execute helpers, retries, event + created-object extraction
  server.ts     tiny router over node:http
web/src/
  components/   header, market table, detail dialog, oracle console, insurance panel
  contexts/     MySocial auth provider
  hooks/        react-query data hooks
  lib/          api client, formatting, keypair derivation
docs/           background blueprints produced while building this
```

## Notes and gotchas

- **Sequential transactions.** The oracle pays gas from a single MYSO coin, and the local
  node's coin index lags a checkpoint or two. `executeAsOracle` uses a short-lived SDK
  client per attempt plus bounded retries, otherwise the second transaction in a row fails
  with `Version 0x… is not available for consumption`.
- **Consistent-store lag.** A freshly created object is not readable from GraphQL for a
  moment, so content reads poll briefly and newly created vaults are re-resolved by field
  lookup rather than trusted from the effects.
- **Shared objects.** `UnderwriterVault` and `MemoryAccount` are `share_object`d, so they
  are found by field value, not by ownership.
- **`enable_spt: true` is rejected** on `create_public_post` (`ESptRequiresDedicatedCreate`);
  the demo posts with `enable_spot: true` and `enable_spt: false`.
- **Decimal amounts.** Every `u64` arrives as a decimal string; they are handled as
  `bigint` and only converted for display.
