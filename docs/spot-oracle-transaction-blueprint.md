# MySo SPoT Oracle → Move Transaction Blueprint (TypeScript reimplementation reference)

Sources read (all under `/Users/brandonshaw/Offline-Projects/ProjectYZ/myso-core/`):

- `crates/myso-spot-oracle/src/config.rs`, `src/blockchain/{mod,create_market,finalize,settle,refund,chain_lookup,worker}.rs`, `src/types.rs`
- `crates/myso-spot-oracle/config/default.toml`, `config/knowledge_domains.localnet.yaml`, `docs/ARCHITECTURE.md`, `docs/RESOLVER_COMPILER.md`
- `crates/myso-framework/packages/myso-social/sources/social_proof_of_truth.move`
- Supporting (needed for exact derivation of inputs): `src/review/canonicalize.rs`, `src/review/outcome_identity.rs`, `src/review/worker.rs`, `src/review/compiler/mod.rs`, `src/review/deadline.rs`, `src/store/{claims,markets,jobs,reviews}.rs`, `src/ingest/{checkpoints,post_created}.rs`, `src/resolver/{mod,engine}.rs`, `src/claim/lifecycle.rs`, `src/social_client.rs`, `network.config/spot-oracle/spot-oracle-session.env`, `crates/myso-types/src/crypto.rs`

No `README` exists in the oracle crate.

---

## 0. TL;DR for the TS port

| Thing | Value |
|---|---|
| Package ID | **hardcoded const `0x50c1`** (normalized `0x0000…50c1`) — `src/config.rs:13` |
| Module | `social_proof_of_truth` |
| Clock object | `0x0000000000000000000000000000000000000000000000000000000000000006` — `src/blockchain/mod.rs:16` |
| Functions actually called | `create_spot_claim`, `create_spot_market_for_claim`, `link_post_to_spot_claim`, `finalize_spot_claims_for_post`, `oracle_resolve`, `refund_unresolved` |
| Function **never** called by the oracle | `create_and_finalize_spot_market_for_post` (only referenced at `social_proof_of_truth.move:2131`, inside `#[test_only]`) |
| Signer key format | **hex**, `flag ‖ 32-byte-privkey` (e.g. `00<64 hex>` = Ed25519). NOT bech32, NOT base64 |
| RPC | `myso_sdk` JSON-RPC over HTTP (`SPOT_ORACLE_MYSO_RPC`). **No GraphQL** in the oracle process |
| Gas | first coin from `get_coins(sender, None, None, None)`; fixed budgets 30M / 50M MIST; RGP from `get_reference_gas_price` |
| Wait | `ExecuteTransactionRequestType::WaitForLocalExecution` |
| Hash algo | **SHA-256 over `serde_json::to_vec` of a serde struct** (canonical JSON) — `src/review/outcome_identity.rs:125-130` |
| Hash wire format | 32 raw bytes on-chain; lowercase hex **without** `0x` in Postgres |

---

## 1. Move call targets — fully-qualified identifiers and exact ordered argument types

### 1.1 Package + module resolution

```rust
// crates/myso-spot-oracle/src/config.rs:11-13
/// On-chain `myso-social` package ID (localnet / framework default). Used by the
/// blockchain module to resolve `social_proof_of_truth` entrypoints.
pub const SOCIAL_PACKAGE_ID: &str = "0x50c1";
```

Every chain module does:

```rust
// src/blockchain/create_market.rs:484 (and :611, :728; finalize.rs:172; settle.rs:222; refund.rs:128)
let package = ObjectID::from_hex_literal(SOCIAL_PACKAGE_ID)?;
```

`ObjectID::from_hex_literal("0x50c1")` left-pads to 32 bytes → `0x00000000000000000000000000000000000000000000000000000000000050c1` (matches `PKG_SOCIAL` in `network.config/spot-oracle/spot-oracle-session.env`).

**⚠️ TS-port trap:** `crate::config::SOCIAL_PACKAGE_ID` is a compile-time constant. The CLI arg `--social-package-id` / env `SPOT_ORACLE_SOCIAL_PACKAGE_ID` (`src/config.rs:232-234`, default `0x50c1`) is **only** used by the checkpoint ingest event filter (`src/ingest/checkpoints.rs:118-119`), **not** by the PTB builders. If you configure `SPOT_ORACLE_SOCIAL_PACKAGE_ID` to a non-`0x50c1` value, ingest filters on the new package but transactions still target `0x50c1`.

Module string is always `"social_proof_of_truth"`.

### 1.2 Clock object

```rust
// src/blockchain/mod.rs:16-17
pub const CLOCK_OBJECT_ID: &str =
    "0x0000000000000000000000000000000000000000000000000000000000000006";
```

Confirmed: `CLOCK_ID=0x0000000000000000000000000000000000000000000000000000000000000006` in the localnet session env. Used identically everywhere: `ObjectID::from_hex_literal(CLOCK_OBJECT_ID)` then `shared_object_arg(..., SharedObjectMutability::Immutable)`.

### 1.3 How shared object args are built (needed for the TS port)

```rust
// src/blockchain/mod.rs:30-51
pub async fn shared_object_arg(
    client: &myso_sdk::MySoClient,
    object_id: ObjectID,
    mutability: SharedObjectMutability,
) -> anyhow::Result<ObjectArg> {
    let object = client
        .read_api()
        .get_object_with_options(object_id, MySoObjectDataOptions::new().with_owner())
        .await?;
    let data = object.data.as_ref().context("object missing data")?;
    let initial_shared_version = match data.owner.as_ref() {
        Some(myso_types::object::Owner::Shared {
            initial_shared_version,
        }) => *initial_shared_version,
        other => anyhow::bail!("object {:?} is not shared: {:?}", object_id, other),
    };
    Ok(ObjectArg::SharedObject {
        id: object_id,
        initial_shared_version,
        mutability,
    })
}
```

So **every** shared argument is passed as `ObjectArg::SharedObject { id, initial_shared_version, mutability }`. In TS with the Sui-style SDK this is exactly `tx.object(id)` (which auto-resolves `initial_shared_version`); if you hand-build the PTB kind you must fetch `Owner.Shared.initial_shared_version` yourself.

The **cap** is the one non-shared object arg:

```rust
// src/blockchain/create_market.rs:492-497 (identical in finalize.rs:178-183, settle.rs:233-238, refund.rs:140-145)
let admin_obj = client
    .read_api()
    .get_object_with_options(admin_cap, MySoObjectDataOptions::default())
    .await?
    .into_object()?;
let admin_arg = ObjectArg::ImmOrOwnedObject(admin_obj.object_ref());
```

`object_ref()` = `(object_id, version, digest)` — it must be **freshly fetched** on every submission (version bumps after each tx). In TS: `tx.object(capId)`.

`ptb.obj(arg)` / `ptb.pure(value)` produce `Argument` indices; `ptb.command(Command::MoveCall(Box::new(ProgrammableMoveCall { package, module, function, type_arguments: vec![], arguments: vec![...] })))`.

Pure values are BCS-serialized: `u64` → 8 LE bytes; `u8` → 1 byte; `String`/`vector<u8>` → ULEB128 length prefix + bytes; `vector<String>` → ULEB128 count + each; `Option<T>` → `0x00` for None, `0x01 ‖ T` for Some; `address` / `vector<address>` → 32-byte(s).

---

### 1.4 `create_spot_claim`

Move signature (`social_proof_of_truth.move:676-683`):

```move
public entry fun create_spot_claim(
    _: &SpotOracleAdminCap,
    config: &SpotConfig,
    registry: &mut SpotClaimRegistry,
    semantic_claim_hash: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext
)
```

Oracle call site (`src/blockchain/create_market.rs:632-650`):

```rust
let mut ptb = ProgrammableTransactionBuilder::new();
let admin_input = ptb.obj(admin_arg)?;
let config_input = ptb.obj(config_arg)?;
let registry_input = ptb.obj(registry_arg)?;
let clock_input = ptb.obj(clock_arg)?;
let hash_input = ptb.pure(semantic_claim_hash.to_vec())?;
ptb.command(Command::MoveCall(Box::new(ProgrammableMoveCall {
    package,
    module: "social_proof_of_truth".to_string(),
    function: "create_spot_claim".to_string(),
    type_arguments: vec![],
    arguments: vec![
        admin_input,
        config_input,
        registry_input,
        hash_input,
        clock_input,
    ],
})));
```

| # | Arg | Move type | Rust construction | TS equivalent |
|---|---|---|---|---|
| 1 | `_: &SpotOracleAdminCap` | owned cap | `ObjectArg::ImmOrOwnedObject(fresh object_ref)` | `tx.object(adminCapId)` |
| 2 | `config: &SpotConfig` | shared, immutable | `shared_object_arg(client, spot_config, Immutable)` | `tx.object(spotConfigId)` |
| 3 | `registry: &mut SpotClaimRegistry` | shared, mutable | `shared_object_arg(client, registry_id, Mutable)` | `tx.object(registryId)` |
| 4 | `semantic_claim_hash: vector<u8>` | pure bytes | `ptb.pure(semantic_claim_hash.to_vec())` | `tx.pure(bcs.vector(bcs.u8()).serialize(bytes))` |
| 5 | `clock: &Clock` | shared, immutable | `0x…006` | `tx.object('0x6')` |

Gas budget **30_000_000** (`create_market.rs:658`).

Emits `SpotClaimCreatedEvent { claim_id, semantic_claim_hash, created_at_ms }` (`social_proof_of_truth.move:341-345`). Aborts: `EDisabled=1` if `!config.truth_enabled`; `EInvalidHash=33` if `len < 8` (`MIN_HASH_LEN`); `EClaimExists=25` if hash already registered.

### 1.5 `create_spot_market_for_claim`

Move signature (`social_proof_of_truth.move:723-737`):

```move
public entry fun create_spot_market_for_claim(
    _: &SpotOracleAdminCap,
    config: &SpotConfig,
    registry: &mut SpotClaimRegistry,
    claim: &mut SpotClaim,
    primary_post: &mut Post,
    claim_index: u64,
    market_key_hash: vector<u8>,
    resolution_policy_hash: vector<u8>,
    betting_options: vector<String>,
    resolution_at_ms: u64,
    max_resolution_window_ms: Option<u64>,
    clock: &Clock,
    ctx: &mut TxContext
)
```

Oracle call site (`src/blockchain/create_market.rs:507-541`):

```rust
let mut ptb = ProgrammableTransactionBuilder::new();
let admin_input = ptb.obj(admin_arg)?;
let config_input = ptb.obj(config_arg)?;
let registry_input = ptb.obj(registry_arg)?;
let claim_input = ptb.obj(claim_arg)?;
let post_input = ptb.obj(post_arg)?;
// Single-claim baseline: primary post links this market at claim_index 0. The market key
// hash doubles as the resolution policy binding (both derived from the resolver spec).
let claim_index_input = ptb.pure(0u64)?;
let key_input = ptb.pure(market_key_hash.to_vec())?;
let policy_input = ptb.pure(market_key_hash.to_vec())?;
let options_input = ptb.pure(betting_options.to_vec())?;
let resolution_at_input = ptb.pure(resolution_at_ms)?;
let max_rw_input = ptb.pure(Some(max_resolution_buffer_ms))?;
let clock_input = ptb.obj(clock_arg)?;
ptb.command(Command::MoveCall(Box::new(ProgrammableMoveCall {
    package,
    module: "social_proof_of_truth".to_string(),
    function: "create_spot_market_for_claim".to_string(),
    type_arguments: vec![],
    arguments: vec![
        admin_input, config_input, registry_input, claim_input, post_input,
        claim_index_input, key_input, policy_input, options_input,
        resolution_at_input, max_rw_input, clock_input,
    ],
})));
```

| # | Arg | Move type | Mutability / kind | Value |
|---|---|---|---|---|
| 1 | `_: &SpotOracleAdminCap` | owned cap | `ImmOrOwnedObject` | `SPOT_ORACLE_ADMIN_CAP_OBJECT_ID` |
| 2 | `config: &SpotConfig` | shared | **Immutable** | `SPOT_ORACLE_SPOT_CONFIG_OBJECT_ID` |
| 3 | `registry: &mut SpotClaimRegistry` | shared | **Mutable** | `SPOT_ORACLE_REGISTRY_OBJECT_ID` |
| 4 | `claim: &mut SpotClaim` | shared | **Mutable** | `spot_claims.spot_claim_object_id` (or event scan) |
| 5 | `primary_post: &mut Post` | shared | **Mutable** | `markets.post_id` (Post object ID) |
| 6 | `claim_index: u64` | pure | — | always `0u64` (single-claim baseline) |
| 7 | `market_key_hash: vector<u8>` | pure | — | 32-byte SHA-256 (§4.2) |
| 8 | `resolution_policy_hash: vector<u8>` | pure | — | **identical to `market_key_hash`** here |
| 9 | `betting_options: vector<String>` | pure | — | `["Yes","No"]` typically (§4.4) |
| 10 | `resolution_at_ms: u64` | pure | — | `spot_markets.deadline.timestamp_millis()` |
| 11 | `max_resolution_window_ms: Option<u64>` | pure | — | `Some(markets.max_resolution_window_ms)` = `SPOT_ORACLE_MAX_RESOLUTION_BUFFER_MS` |
| 12 | `clock: &Clock` | shared | **Immutable** | `0x…006` |

Gas budget **50_000_000** (`create_market.rs:546`).

Move-side checks (`social_proof_of_truth.move:738-761`): `truth_enabled`; `assert_valid_hash(market_key_hash)` (≥8 bytes); `!markets_by_key_hash.contains(hash)` else `EMarketExists=27`; `resolution_at_ms >= clock::timestamp_ms` else `ETooEarly=4`; `min_betting_options <= len <= max_betting_options` else `EInvalidAmount=2`; no duplicate options else `EDuplicateOption=15`.

Emits `SpotMarketCreatedEvent { market_id, claim_id, market_key_hash, primary_post_id, claim_index, resolution_policy_hash, created_at_ms, betting_options, resolution_at_ms, max_resolution_window_ms }` (`:347-358`).

### 1.6 `link_post_to_spot_claim`

Move signature (`social_proof_of_truth.move:837-847`):

```move
public entry fun link_post_to_spot_claim(
    _: &SpotOracleAdminCap,
    config: &SpotConfig,
    registry: &mut SpotClaimRegistry,
    claim: &mut SpotClaim,
    post: &mut Post,
    claim_index: u64,
    resolution_policy_hash: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext
)
```

Oracle call site (`src/blockchain/create_market.rs:750-777`):

```rust
let mut ptb = ProgrammableTransactionBuilder::new();
let admin_input = ptb.obj(admin_arg)?;
let config_input = ptb.obj(config_arg)?;
let registry_input = ptb.obj(registry_arg)?;
let claim_input = ptb.obj(claim_arg)?;
let post_input = ptb.obj(post_arg)?;
// Single-claim baseline: hybrid referrers link at claim_index 0; the claim id bytes stand
// in as the resolution policy binding until per-claim policy threading lands.
let claim_index_input = ptb.pure(0u64)?;
let policy_input = ptb.pure(claim_obj.into_bytes().to_vec())?;
let clock_input = ptb.obj(clock_arg)?;

ptb.command(Command::MoveCall(Box::new(ProgrammableMoveCall {
    package,
    module: "social_proof_of_truth".to_string(),
    function: "link_post_to_spot_claim".to_string(),
    type_arguments: vec![],
    arguments: vec![
        admin_input, config_input, registry_input, claim_input, post_input,
        claim_index_input, policy_input, clock_input,
    ],
})));
```

| # | Arg | Move type | Mutability | Value |
|---|---|---|---|---|
| 1 | `_: &SpotOracleAdminCap` | owned cap | `ImmOrOwnedObject` | `SPOT_ORACLE_ADMIN_CAP_OBJECT_ID` |
| 2 | `config: &SpotConfig` | shared | Immutable | `SPOT_ORACLE_SPOT_CONFIG_OBJECT_ID` |
| 3 | `registry: &mut SpotClaimRegistry` | shared | Mutable | `SPOT_ORACLE_REGISTRY_OBJECT_ID` |
| 4 | `claim: &mut SpotClaim` | shared | Mutable | claim object ID |
| 5 | `post: &mut Post` | shared | Mutable | Post object ID |
| 6 | `claim_index: u64` | pure | — | `0u64` |
| 7 | `resolution_policy_hash: vector<u8>` | pure | — | **32 raw bytes of the claim object address** (`ObjectID::into_bytes()`), *not* a hash |
| 8 | `clock: &Clock` | shared | Immutable | `0x…006` |

Gas budget **30_000_000** (`create_market.rs:782`). Effects requested: only `.with_effects()` (`:788`) — no events/object changes.

Move-side: requires an open market for the claim (`registry.open_market_by_claim`) else `ENoOpenMarket=36`; `post_claim_index_to_market[(post,0)]` must not exist else `EClaimExists=25`. Emits `SpotPostLinkedEvent` (`:360-368`).

### 1.7 `finalize_spot_claims_for_post`

Move signature (`social_proof_of_truth.move:878-894`):

```move
public entry fun finalize_spot_claims_for_post(
    _: &SpotOracleAdminCap,
    config: &SpotConfig,
    post: &mut Post,
    detected_claim_count: u64,
    rejected_claim_count: u64,
    truncated_claim_count: u64,
    past_verified_count: u64,
    claim_manifest_hash: Option<vector<u8>>,
    veracity_manifest_hash: Option<vector<u8>>,
    past_claim_indexes: vector<u64>,
    past_verdicts: vector<u8>,
    past_related_market_ids: vector<address>,
    past_evidence_hashes: vector<vector<u8>>,
    clock: &Clock,
    ctx: &mut TxContext
)
```

Oracle call site (`src/blockchain/finalize.rs:189-227`):

```rust
let mut ptb = ProgrammableTransactionBuilder::new();
let admin_input = ptb.obj(admin_arg)?;
let config_input = ptb.obj(config_arg)?;
let post_input = ptb.obj(post_arg)?;
let detected_input = ptb.pure(counts.detected)?;
let rejected_input = ptb.pure(counts.rejected)?;
let truncated_input = ptb.pure(counts.truncated)?;
let past_verified_input = ptb.pure(counts.past_verified)?;
// Future claim manifest is not carried on-chain (links already have it); past verdicts are.
let claim_manifest_input = ptb.pure(Option::<Vec<u8>>::None)?;
let veracity_manifest_input = ptb.pure(past.veracity_manifest_hash.clone())?;
let past_indexes_input = ptb.pure(past.claim_indexes.clone())?;
let past_verdicts_input = ptb.pure(past.verdicts.clone())?;
let past_related_markets_input = ptb.pure(past.related_markets.clone())?;
let past_evidence_hashes_input = ptb.pure(past.evidence_hashes.clone())?;
let clock_input = ptb.obj(clock_arg)?;

ptb.command(Command::MoveCall(Box::new(ProgrammableMoveCall {
    package,
    module: "social_proof_of_truth".to_string(),
    function: "finalize_spot_claims_for_post".to_string(),
    type_arguments: vec![],
    arguments: vec![
        admin_input, config_input, post_input,
        detected_input, rejected_input, truncated_input, past_verified_input,
        claim_manifest_input, veracity_manifest_input,
        past_indexes_input, past_verdicts_input,
        past_related_markets_input, past_evidence_hashes_input,
        clock_input,
    ],
})));
```

| # | Arg | Move type | Kind | Value in the oracle |
|---|---|---|---|---|
| 1 | `_: &SpotOracleAdminCap` | owned cap | `ImmOrOwnedObject` | admin cap ID |
| 2 | `config: &SpotConfig` | shared | Immutable | `SPOT_ORACLE_SPOT_CONFIG_OBJECT_ID` |
| 3 | `post: &mut Post` | shared | Mutable | Post object ID |
| 4 | `detected_claim_count: u64` | pure | — | `1` (create/reject paths) |
| 5 | `rejected_claim_count: u64` | pure | — | `0` normally, `1` on unsupported-claim reject |
| 6 | `truncated_claim_count: u64` | pure | — | `0` |
| 7 | `past_verified_count: u64` | pure | — | `0` future path, `1` past path |
| 8 | `claim_manifest_hash: Option<vector<u8>>` | pure | — | **always `None`** |
| 9 | `veracity_manifest_hash: Option<vector<u8>>` | pure | — | past path: SHA-256 of evidence URLs (`0x`-hex decoded) |
| 10 | `past_claim_indexes: vector<u64>` | pure | — | `[]` or `[0]` |
| 11 | `past_verdicts: vector<u8>` | pure | — | `[]` or `[1|2|3]` |
| 12 | `past_related_market_ids: vector<address>` | pure | — | `[]` or `[<market obj id \| 0x0>]` |
| 13 | `past_evidence_hashes: vector<vector<u8>>` | pure | — | `[]` or `[32-byte hash]` |
| 14 | `clock: &Clock` | shared | Immutable | `0x…006` |

Gas budget **30_000_000** (`finalize.rs:232`). Effects: `.with_effects()` only (`:238`).

Move-side invariant (`social_proof_of_truth.move:898-908`): all four past vectors must have the **same length** as `past_verified_count`, else `EPastVerdictMismatch=35`; verdict bytes must be `1|2|3`. Status is set to `spot_status_completed()` if `future_accepted > 0 || past_verified_count > 0`, else `spot_status_completed_no_actionable` (`:910-915`). Emits `SpotClaimsFinalizedForPost` (`:370-390`).

Job-payload → struct mapping (`src/blockchain/finalize.rs:100-145`):

```rust
fn decode_hex(s: &str) -> Vec<u8> {
    hex::decode(s.trim_start_matches("0x")).unwrap_or_default()
}

fn parse_past_verdicts(job: &SpotJob) -> anyhow::Result<PastVerdicts> {
    let arr = |k: &str| -> Vec<serde_json::Value> {
        job.payload.get(k).and_then(|v| v.as_array()).cloned().unwrap_or_default()
    };
    let related_markets = arr("past_related_market_ids")
        .iter()
        .filter_map(|v| v.as_str())
        .map(|s| MySoAddress::from_str(s).map_err(|e| anyhow::anyhow!("bad related_market_id {s}: {e:?}")))
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(PastVerdicts {
        veracity_manifest_hash: job.payload.get("veracity_manifest_hash")
            .and_then(|v| v.as_str()).map(decode_hex),
        claim_indexes: arr("past_claim_indexes").iter().filter_map(|v| v.as_u64()).collect(),
        verdicts: arr("past_verdicts").iter().filter_map(|v| v.as_u64().map(|n| n as u8)).collect(),
        related_markets,
        evidence_hashes: arr("past_evidence_hashes")
            .iter().filter_map(|v| v.as_str().map(decode_hex)).collect(),
    })
}
```

### 1.8 `oracle_resolve`

Move signature (`social_proof_of_truth.move:1246-1261`):

```move
public entry fun oracle_resolve(
    _: &SpotOracleAdminCap,
    spot_config: &SpotConfig,
    registry: &mut SpotClaimRegistry,
    claim: &SpotClaim,
    market: &mut SpotMarket,
    post: &Post,
    platform: &mut Platform,
    treasury: &EcosystemTreasury,
    outcome_option_id: u8,
    confidence_bps: u64,
    reasoning: String,
    evidence_urls: vector<String>,
    clock: &Clock,
    ctx: &mut TxContext
)
```

Oracle call site (`src/blockchain/settle.rs:255-289`):

```rust
let mut ptb = ProgrammableTransactionBuilder::new();
let admin_input = ptb.obj(admin_arg)?;
let config_input = ptb.obj(config_arg)?;
let registry_input = ptb.obj(registry_arg)?;
let claim_input = ptb.obj(claim_arg)?;
let market_input = ptb.obj(market_arg)?;
let post_input = ptb.obj(post_arg)?;
let platform_input = ptb.obj(platform_arg)?;
let treasury_input = ptb.obj(treasury_arg)?;
let outcome_input = ptb.pure(outcome_option_id)?;
let confidence_input = ptb.pure(confidence_bps)?;
let reasoning_input = ptb.pure(reasoning.to_string())?;
let evidence_input = ptb.pure(evidence_urls.to_vec())?;
let clock_input = ptb.obj(clock_arg)?;
ptb.command(Command::MoveCall(Box::new(ProgrammableMoveCall {
    package,
    module: "social_proof_of_truth".to_string(),
    function: "oracle_resolve".to_string(),
    type_arguments: vec![],
    arguments: vec![
        admin_input, config_input, registry_input, claim_input, market_input,
        post_input, platform_input, treasury_input, outcome_input,
        confidence_input, reasoning_input, evidence_input, clock_input,
    ],
})));
```

| # | Arg | Move type | Mutability | Object source |
|---|---|---|---|---|
| 1 | `_: &SpotOracleAdminCap` | owned cap | `ImmOrOwnedObject` | `SPOT_ORACLE_ADMIN_CAP_OBJECT_ID` |
| 2 | `spot_config: &SpotConfig` | shared | **Immutable** | `SPOT_ORACLE_SPOT_CONFIG_OBJECT_ID` |
| 3 | `registry: &mut SpotClaimRegistry` | shared | **Mutable** | `SPOT_ORACLE_REGISTRY_OBJECT_ID` |
| 4 | `claim: &SpotClaim` | shared | **Immutable** | `post_claim_links` ⋈ `spot_claims.spot_claim_object_id` |
| 5 | `market: &mut SpotMarket` | shared | **Mutable** | `markets.spot_market_object_id` |
| 6 | `post: &Post` | shared | **Immutable** | `markets.post_id` |
| 7 | `platform: &mut Platform` | shared | **Mutable** | `SPOT_ORACLE_PLATFORM_OBJECT_ID` |
| 8 | `treasury: &EcosystemTreasury` | shared | **Immutable** | `SPOT_ORACLE_ECOSYSTEM_TREASURY_OBJECT_ID` |
| 9 | `outcome_option_id: u8` | pure | — | index of `outcome_label` in `betting_options` |
| 10 | `confidence_bps: u64` | pure | — | `confidence_bps` from job (default 9500 if absent) |
| 11 | `reasoning: String` | pure | — | `reasoning` (default `"deterministic resolver outcome"`) |
| 12 | `evidence_urls: vector<String>` | pure | — | must be non-empty |
| 13 | `clock: &Clock` | shared | Immutable | `0x…006` |

Gas budget **50_000_000** (`settle.rs:294`).

**⚠️ Divergence worth noting:** `oracle_resolve` requests *no* effects/events (`MySoTransactionBlockResponseOptions::new()`, `settle.rs:300`) and **never checks transaction status** — it returns `Ok(response.digest.to_string())` unconditionally (`settle.rs:296-304`). A failed tx would still be recorded as `confirmed` in `spot_transactions` and would still drive the market to `resolved`. Contrast with `create_market.rs:806-818`:

```rust
fn ensure_tx_succeeded(response: &MySoTransactionBlockResponse, label: &str) -> anyhow::Result<()> {
    match response.status_ok() {
        Some(true) => Ok(()),
        Some(false) => {
            let status = response.effects.as_ref().map(|e| format!("{:?}", e.status()));
            anyhow::bail!("{label} transaction failed: {status:?}");
        }
        None => anyhow::bail!("{label} transaction response missing effects"),
    }
}
```

`finalize.rs:242-247` uses a weaker check (`if response.status_ok() == Some(false)`); `refund.rs` does not check at all.

Move-side (`:1262-1293`): `market.status == STATUS_OPEN` else `EWrongStatus=6`; `market.outcome` is none else `EAlreadyResolved=3`; `now_ms >= market.resolution_at_ms` else `ETooEarly=4`; valid option id else `EInvalidOptionId=11`; `reasoning.len` in `[min_reasoning_length, max_reasoning_length]` else `EInvalidReasoning=10`; `1 <= evidence_urls.len <= max_evidence_urls` else `EInvalidAmount=2`. If `confidence_bps < spot_config.confidence_threshold_bps`, the market goes to `STATUS_DAO_REQUIRED` and emits `SpotDaoRequiredEvent` (no payout); otherwise `finalize_resolution_and_payout`.

### 1.9 `refund_unresolved` (also driven by the oracle)

Move: `social_proof_of_truth.move:1539`. Oracle (`refund.rs:155-175`):

| # | Arg | Move type | Mutability |
|---|---|---|---|
| 1 | `_: &SpotOracleAdminCap` | owned cap | `ImmOrOwnedObject` |
| 2 | `config: &SpotConfig` | shared | Immutable |
| 3 | `registry: &mut SpotClaimRegistry` | shared | Mutable |
| 4 | `market: &mut SpotMarket` | shared | Mutable |
| 5 | `post: &Post` | shared | Immutable |
| 6 | `clock: &Clock` | shared | Immutable |

Gas budget **50_000_000** (`refund.rs:180`).

### 1.10 `create_and_finalize_spot_market_for_post` — signature for reference only

Not called by the oracle. Move signature (`social_proof_of_truth.move:954-967`):

```move
public entry fun create_and_finalize_spot_market_for_post(
    oracle_cap: &SpotOracleAdminCap,
    config: &SpotConfig,
    registry: &mut SpotClaimRegistry,
    post: &mut Post,
    semantic_claim_hash: vector<u8>,
    market_key_hash: vector<u8>,
    resolution_policy_hash: vector<u8>,
    betting_options: vector<String>,
    resolution_at_ms: u64,
    max_resolution_window_ms: Option<u64>,
    clock: &Clock,
    ctx: &mut TxContext
)
```

(12 args, no `claim`/`claim_index` — it registers the claim itself, links at index `0`, then finalizes as `spot_status_completed()` with counts `1,0,0,0` and `None` manifests.)

---

## 2. Package / object ID configuration

### 2.1 Exact config key names, env vars, defaults

All from `src/config.rs` (clap `#[arg(long, env = "...")]`). CLI long flag and env var are listed; the TOML key would be the snake_case field name under `[spot_oracle]`.

| Field (`OracleArgs`) | CLI `--flag` | Env var | Default | Chain role |
|---|---|---|---|---|
| `listen_addr` | `--listen-addr` | `SPOT_ORACLE_LISTEN` | `0.0.0.0:8097` | API |
| `metrics_addr` | `--metrics-addr` | `SPOT_ORACLE_METRICS_ADDRESS` | `0.0.0.0:9187` | metrics |
| `database_url` | `--database-url` | `SPOT_ORACLE_DATABASE_URL` | `postgresql://spot:spot@127.0.0.1:5435/spot_oracle` | Postgres |
| `db_max_connections` | `--db-max-connections` | `SPOT_ORACLE_DB_MAX_CONNECTIONS` | `10` | |
| `sources_config` | `--sources-config` | `SPOT_ORACLE_SOURCES_CONFIG` | `crates/myso-spot-oracle/config/sources.localnet.yaml` | |
| `event_providers_config` | `--event-providers-config` | `SPOT_ORACLE_EVENT_PROVIDERS_CONFIG` | `crates/myso-spot-oracle/config/event_providers.localnet.yaml` | |
| `event_sync_interval_secs` | `--event-sync-interval-secs` | `SPOT_ORACLE_EVENT_SYNC_INTERVAL_SECS` | `300` | |
| **`myso_rpc`** | `--myso-rpc` | **`SPOT_ORACLE_MYSO_RPC`** | **`http://127.0.0.1:9000`** | Fullnode JSON-RPC endpoint |
| **`private_key_hex`** | `--private-key-hex` | **`SPOT_ORACLE_PRIVATE_KEY_HEX`** | *(none — `Option<String>`)* | signer |
| **`spot_config_object_id`** | `--spot-config-object-id` | **`SPOT_ORACLE_SPOT_CONFIG_OBJECT_ID`** | *(none)* | `SpotConfig` shared |
| **`admin_cap_object_id`** | `--admin-cap-object-id` | **`SPOT_ORACLE_ADMIN_CAP_OBJECT_ID`** | *(none)* | `SpotOracleAdminCap` owned |
| **`spot_registry_object_id`** | `--spot-registry-object-id` | **`SPOT_ORACLE_REGISTRY_OBJECT_ID`** | *(none)* | `SpotClaimRegistry` shared |
| **`platform_object_id`** | `--platform-object-id` | **`SPOT_ORACLE_PLATFORM_OBJECT_ID`** | *(none)* | `Platform` (oracle_resolve only) |
| **`ecosystem_treasury_object_id`** | `--ecosystem-treasury-object-id` | **`SPOT_ORACLE_ECOSYSTEM_TREASURY_OBJECT_ID`** | *(none)* | `EcosystemTreasury` (oracle_resolve only) |
| `social_server_url` | `--social-server-url` | `SPOT_ORACLE_SOCIAL_SERVER_URL` | `http://127.0.0.1:9126` | legacy HTTP ingest |
| `social_sync_secret` | `--social-sync-secret` | `SPOT_ORACLE_SOCIAL_SYNC_SECRET` | *(none)* | `x-spot-oracle-sync-secret` header |
| `admin_secret` | `--admin-secret` | `SPOT_ORACLE_ADMIN_SECRET` | *(none)* | `x-spot-oracle-admin-secret` |
| `openrouter_api_url` | `--openrouter-api-url` | `SPOT_ORACLE_OPENROUTER_API_URL` | `https://openrouter.ai/api/v1/chat/completions` | |
| `openrouter_api_key` | `--openrouter-api-key` | `SPOT_ORACLE_OPENROUTER_API_KEY` | *(none)* | |
| `llm_model` | `--llm-model` | `SPOT_ORACLE_LLM_MODEL` | `openai/gpt-4o-mini` | |
| `review_poll_interval_secs` | | `SPOT_ORACLE_REVIEW_POLL_INTERVAL_SECS` | `15` | |
| `scheduler_poll_interval_secs` | | `SPOT_ORACLE_SCHEDULER_POLL_INTERVAL_SECS` | `10` | |
| `resolver_concurrency` | | `SPOT_ORACLE_RESOLVER_CONCURRENCY` | `4` | |
| `rss_poll_interval_secs` | | `SPOT_ORACLE_RSS_POLL_INTERVAL_SECS` | `60` | |
| `chain_submit_interval_secs` | | `SPOT_ORACLE_CHAIN_SUBMIT_INTERVAL_SECS` | `10` | chain worker cadence |
| `reconcile_interval_secs` | | `SPOT_ORACLE_RECONCILE_INTERVAL_SECS` | `120` | |
| **`confidence_threshold_bps`** | | **`SPOT_ORACLE_CONFIDENCE_THRESHOLD_BPS`** | **`7000`** | mirrors on-chain `SpotConfig.confidence_threshold_bps` |
| `min_deadline_lead_secs` | | `SPOT_ORACLE_MIN_DEADLINE_LEAD_SECS` | `300` | |
| `max_deadline_horizon_secs` | | `SPOT_ORACLE_MAX_DEADLINE_HORIZON_SECS` | `63072000` (730d) | |
| `max_election_horizon_secs` | | `SPOT_ORACLE_MAX_ELECTION_HORIZON_SECS` | `126144000` (1460d) | |
| `max_sports_horizon_secs` | | `SPOT_ORACLE_MAX_SPORTS_HORIZON_SECS` | `94608000` (1095d) | |
| **`max_resolution_buffer_ms`** | | **`SPOT_ORACLE_MAX_RESOLUTION_BUFFER_MS`** | **`259200000`** (72h) | → on-chain `max_resolution_window_ms` |
| `price_market_spacing_secs` | | `SPOT_ORACLE_PRICE_MARKET_SPACING_SECS` | `1800` | |
| `store_raw_evidence` | | `SPOT_ORACLE_STORE_RAW_EVIDENCE` | `true` | |
| `live_sources` | | `SPOT_ORACLE_LIVE_SOURCES` | `false` | |
| `enabled` | | `SPOT_ORACLE_ENABLED` | `true` | |
| `streaming_url` | | `SPOT_ORACLE_STREAMING_URL` | *(none)* | gRPC `SubscribeCheckpoints` |
| `ingest_mode` | | `SPOT_ORACLE_INGEST_MODE` | `checkpoint` (`checkpoint`\|`http`\|`both`) | |
| **`social_package_id`** | | **`SPOT_ORACLE_SOCIAL_PACKAGE_ID`** | **`0x50c1`** | ingest filter only |

Sources verbatim:

```rust
// src/config.rs:62-92
/// MySo RPC URL for PTB submission (create / resolve / refund).
#[arg(long, env = "SPOT_ORACLE_MYSO_RPC", default_value = "http://127.0.0.1:9000")]
pub myso_rpc: String,

/// Oracle signer private key (hex). Required to submit `oracle_resolve` / create PTBs.
#[arg(long, env = "SPOT_ORACLE_PRIVATE_KEY_HEX")]
pub private_key_hex: Option<String>,

/// `SpotConfig` shared object ID (required for claim/market PTBs).
#[arg(long, env = "SPOT_ORACLE_SPOT_CONFIG_OBJECT_ID")]
pub spot_config_object_id: Option<String>,

/// `SpotOracleAdminCap` object ID (required for oracle-only entrypoints).
#[arg(long, env = "SPOT_ORACLE_ADMIN_CAP_OBJECT_ID")]
pub admin_cap_object_id: Option<String>,

/// Shared `SpotClaimRegistry` object ID (required for claim/market PTBs).
#[arg(long, env = "SPOT_ORACLE_REGISTRY_OBJECT_ID")]
pub spot_registry_object_id: Option<String>,

/// Shared `Platform` object ID (required for on-chain `oracle_resolve`).
#[arg(long, env = "SPOT_ORACLE_PLATFORM_OBJECT_ID")]
pub platform_object_id: Option<String>,

/// Shared `EcosystemTreasury` object ID (required for on-chain `oracle_resolve`).
#[arg(long, env = "SPOT_ORACLE_ECOSYSTEM_TREASURY_OBJECT_ID")]
pub ecosystem_treasury_object_id: Option<String>,
```

### 2.2 `config/default.toml` — exact contents

```toml
[spot_oracle]
listen_addr = "0.0.0.0:8097"
metrics_address = "0.0.0.0:9187"
database_url = "postgresql://spot:spot@127.0.0.1:5435/spot_oracle"
db_max_connections = 10
sources_config = "crates/myso-spot-oracle/config/sources.localnet.yaml"
event_providers_config = "crates/myso-spot-oracle/config/event_providers.localnet.yaml"
myso_rpc = "http://127.0.0.1:9000"
social_server_url = "http://127.0.0.1:9126"
openrouter_api_url = "https://openrouter.ai/api/v1/chat/completions"
llm_model = "openai/gpt-4o-mini"
review_poll_interval_secs = 15
scheduler_poll_interval_secs = 10
resolver_concurrency = 4
rss_poll_interval_secs = 60
chain_submit_interval_secs = 10
reconcile_interval_secs = 120
store_raw_evidence = true
live_sources = false
enabled = true
```

**No package ID, registry ID, config object ID, cap ID, or private key appears in `default.toml`.** All chain identity comes from env vars / CLI flags.

Figment layering exists but is unused for chain config:

```rust
// src/config.rs:243-250
impl OracleArgs {
    /// Figment layering: `config/default.toml` < `config/local.toml` < `SPOT_ORACLE_*` env.
    pub fn load_figment(&self) -> Figment {
        Figment::new()
            .merge(Toml::file("config/default.toml").nested())
            .merge(Toml::file("config/local.toml").nested())
            .merge(Env::prefixed("SPOT_ORACLE_").split("_"))
    }
}
```

`OracleArgs` is parsed by clap (`Parser`), not by Figment; `load_figment()` is not on the chain path.

### 2.3 Chain-configured gate

```rust
// src/blockchain/mod.rs:23-28
pub fn chain_configured(args: &crate::config::OracleArgs) -> bool {
    args.private_key_hex.is_some()
        && args.spot_config_object_id.is_some()
        && args.admin_cap_object_id.is_some()
        && args.spot_registry_object_id.is_some()
}
```

If false, every chain entry point **logs a warning and applies the off-chain lifecycle transition anyway** (e.g. `create_market.rs:64-80`, `settle.rs:83-94`, `refund.rs:44-54`, `finalize.rs:60-63`). `platform_object_id` and `ecosystem_treasury_object_id` are *not* in the gate but are hard-required by `submit_oracle_resolve` (`settle.rs:100-110`).

### 2.4 Real localnet values (from `network.config/spot-oracle/spot-oracle-session.env`)

```
PKG_SOCIAL=0x00000000000000000000000000000000000000000000000000000000000050c1
CLOCK_ID=0x0000000000000000000000000000000000000000000000000000000000000006
SPOT_CONFIG_ID=0xfd5390f98cdc92b56265960ed695622f8c8648a5bb9ef333f06a635e604f0773
SPOT_REGISTRY_ID=0x70e1cde567f3c37bce2e8f0b92cbb3029799528e549058df9b25e8376438cefb
SPOT_ORACLE_ADMIN_CAP_ID=0x111efd2b66b784de508cc8c3c702a64698434eaa4464b56dc73eac74f92bdb3d
PLATFORM_OBJECT_ID=0x2f761b0a138e2abf98aba48c8df70ceb3dce12fe1ec17afda49190a577a61d65
ECOSYSTEM_TREASURY_ID=0xbe20e48713c3898e5182d666b5f564308a9254fdfb2f8b9f53ac49af2ee4d89b
ORACLE_ADDRESS=0x2458950181e415250823d6ce1d55f2b3427826a111939e0d6d38e9a1397411d8
SPOT_ORACLE_DATABASE_URL=postgresql://spot:spot@127.0.0.1:5435/spot_oracle
SPOT_ORACLE_MYSO_RPC=http://127.0.0.1:9000
SPOT_ORACLE_SPOT_CONFIG_OBJECT_ID=0xfd5390f98cdc92b56265960ed695622f8c8648a5bb9ef333f06a635e604f0773
SPOT_ORACLE_REGISTRY_OBJECT_ID=0x70e1cde567f3c37bce2e8f0b92cbb3029799528e549058df9b25e8376438cefb
SPOT_ORACLE_ADMIN_CAP_OBJECT_ID=0x111efd2b66b784de508cc8c3c702a64698434eaa4464b56dc73eac74f92bdb3d
SPOT_ORACLE_PRIVATE_KEY_HEX=00736c869f584b6fdf1d961541e515304cdbeaf8e3d7789ae79fd05e2d9da34578
SPOT_ORACLE_PLATFORM_OBJECT_ID=0x2f761b0a138e2abf98aba48c8df70ceb3dce12fe1ec17afda49190a577a61d65
SPOT_ORACLE_ECOSYSTEM_TREASURY_OBJECT_ID=0xbe20e48713c3898e5182d666b5f564308a9254fdfb2f8b9f53ac49af2ee4d89b
SPOT_ORACLE_SOCIAL_SYNC_SECRET=local-spot-oracle-sync
SPOT_ORACLE_SYNC_SECRET=local-spot-oracle-sync
SPOT_ORACLE_STREAMING_URL=http://127.0.0.1:9000
SPOT_ORACLE_INGEST_MODE=checkpoint
SPOT_ORACLE_LIVE_SOURCES=true
```

Note `SPOT_ORACLE_PRIVATE_KEY_HEX` begins with `00` → Ed25519 flag byte, followed by the 32-byte seed.

---

## 3. Signing & submission

### 3.1 Private key format — hex, `flag ‖ privkey`

```rust
// src/blockchain/create_market.rs:465-472 (byte-identical in finalize.rs:153-160, settle.rs:203-210, refund.rs:109-116, create_market.rs:592-599, :709-716)
let key_hex = args
    .private_key_hex
    .as_ref()
    .context("missing private key")?;
let key_bytes = hex::decode(key_hex.trim())?;
let key_pair =
    MySoKeyPair::from_bytes(&key_bytes).map_err(|e| anyhow::anyhow!("invalid key: {:?}", e))?;
let sender = MySoAddress::from(&key_pair.public());
```

`MySoKeyPair::from_bytes` (`crates/myso-types/src/crypto.rs:200-221`) interprets byte 0 as a **signature-scheme flag** and the remainder as the raw private key:

```rust
pub fn from_bytes(bytes: &[u8]) -> Result<Self, eyre::Report> {
    match SignatureScheme::from_flag_byte(bytes.first().ok_or_else(|| eyre!("Invalid length"))?) {
        Ok(x) => match x {
            SignatureScheme::ED25519 => Ok(MySoKeyPair::Ed25519(Ed25519KeyPair::from_bytes(
                bytes.get(1..).ok_or_else(|| eyre!("Invalid length"))?,
            )?)),
            SignatureScheme::Secp256k1 => { /* bytes[1..] as secp256k1 secret */ }
            SignatureScheme::Secp256r1 => { /* bytes[1..] as secp256r1 secret */ }
            _ => Err(eyre!("Invalid flag byte")),
        },
        _ => Err(eyre!("Invalid bytes")),
    }
}
```

- **Ed25519** → flag `0x00`, then 32-byte seed → 33 bytes total (`00` + 64 hex chars).
- **Secp256k1** → flag `0x01`, then 32-byte scalar.
- **Secp256r1** → flag `0x02`, then 32-byte scalar.

**Not** bech32. The bech32 path exists but is *unused* by the oracle:

```rust
// crates/myso-types/src/crypto.rs:85, 231-240
pub const MYSO_PRIV_KEY_PREFIX: &str = "mysoprivkey";
...
/// Encode a MySoKeyPair as `flag || privkey` in Bech32 starting with "mysoprivkey" ...
pub fn encode(&self) -> Result<String, eyre::Report> {
    Bech32::encode(self.to_bytes(), MYSO_PRIV_KEY_PREFIX).map_err(|e| eyre!(e))
}
pub fn decode(value: &str) -> Result<Self, eyre::Report> {
    let bytes = Bech32::decode(value, MYSO_PRIV_KEY_PREFIX)?;
    Self::from_bytes(&bytes)
}
```

**Not** base64. `hex::decode` is applied raw to the trimmed string; there is no `0x` strip, so `SPOT_ORACLE_PRIVATE_KEY_HEX` must be bare hex (a leading `0x` would fail `hex::decode`).

### 3.2 RPC / GraphQL client

**No GraphQL client exists in the oracle.** (`grep -rn "graphql\|GraphQL" src/` → zero hits.) The only chain client is the `myso_sdk` JSON-RPC client:

```rust
// src/blockchain/settle.rs:212-214 (pattern repeated in every chain module)
let client = MySoClientBuilder::default()
    .build(args.myso_rpc.clone())
    .await?;
```

`myso_sdk::MySoClient` (`crates/myso-sdk/src/lib.rs:492-506`) wraps an HTTP JSON-RPC `RpcClient` plus typed APIs:

```rust
pub struct MySoClient {
    api: Arc<RpcClient>,
    transaction_builder: TransactionBuilder,
    read_api: Arc<ReadApi>,
    coin_read_api: CoinReadApi,
    event_api: EventApi,
    quorum_driver_api: QuorumDriverApi,
    governance_api: GovernanceApi,
}
```

A **new client is constructed per transaction** (once per `build_and_submit_*` call); there is no pooling. Default request timeout 60 s (`MySoClientBuilder::default`).

### 3.3 Gas coin selection

```rust
// src/blockchain/settle.rs:216-220 (identical everywhere)
let gas_coins = client
    .coin_read_api()
    .get_coins(sender, None, None, None)
    .await?;
let gas_obj = gas_coins.data.first().context("sender has no gas coins")?;
```

Signature is `get_coins(owner, coin_type: Option<String>, cursor: Option<String>, limit: Option<usize>)`. All `None` → default coin type (MYSO) and default page size. **The first returned coin is used unconditionally** — no coin merging, no balance-aware splitting, no gas-coin reservation across concurrent submissions.

### 3.4 Build, sign, submit

Fully generic pattern (e.g. `src/blockchain/settle.rs:291-304`):

```rust
let pt = ptb.finish();
let rgp = client.read_api().get_reference_gas_price().await?;
let tx_data =
    TransactionData::new_programmable(sender, vec![gas_obj.object_ref()], pt, 50_000_000, rgp);
let signed = Transaction::from_data_and_signer(tx_data, vec![&key_pair]);
let response = client
    .quorum_driver_api()
    .execute_transaction_block(
        signed,
        MySoTransactionBlockResponseOptions::new(),
        Some(ExecuteTransactionRequestType::WaitForLocalExecution),
    )
    .await?;
Ok(response.digest.to_string())
```

- **PTB builder:** `myso_types::programmable_transaction_builder::ProgrammableTransactionBuilder` → `ptb.obj(ObjectArg)`, `ptb.pure(value)`, `ptb.command(Command::MoveCall(...))`, `ptb.finish()`.
- **`TransactionData::new_programmable(sender, gas_payment: Vec<ObjectRef>, pt, gas_budget, gas_price)`.** Gas price = live reference gas price; `gas_payment` = a single coin ref.
- **Fixed gas budgets** (MIST): `create_spot_claim` 30_000_000; `create_spot_market_for_claim` 50_000_000; `link_post_to_spot_claim` 30_000_000; `finalize_spot_claims_for_post` 30_000_000; `oracle_resolve` 50_000_000; `refund_unresolved` 50_000_000.
- **Signing:** `Transaction::from_data_and_signer(tx_data, vec![&key_pair])`.
- **Waiting:** `Some(ExecuteTransactionRequestType::WaitForLocalExecution)` always.

Response option differences per call:

| Call | Requested options | Status checked? |
|---|---|---|
| `create_spot_claim` | `.with_effects().with_events().with_object_changes()` | yes (`ensure_tx_succeeded`) |
| `create_spot_market_for_claim` | `.with_effects().with_events().with_object_changes()` | yes (`ensure_tx_succeeded`) |
| `link_post_to_spot_claim` | `.with_effects()` | yes (`ensure_tx_succeeded`) |
| `finalize_spot_claims_for_post` | `.with_effects()` | partial (`== Some(false)`) |
| `oracle_resolve` | *(none)* | **no** |
| `refund_unresolved` | *(none)* | **no** |

### 3.5 Post-submit object-ID resolution

`create_spot_market_for_claim` (`create_market.rs:559-574`):

```rust
ensure_tx_succeeded(&response, "create_spot_market_for_claim")?;
let digest = response.digest.to_string();
let market_object_id =
    find_market_id_in_tx_events(response.events.as_ref(), Some(market_key_hash))
        .or_else(|| find_created_type(&response.object_changes, "SpotMarket"))
        .or_else(|| None);
let market_object_id = match market_object_id {
    Some(id) => id,
    None => lookup_market_by_key_hash(args, market_key_hash).await?
        .map(|m| m.market_object_id)
        .context("create_spot_market_for_claim did not create SpotMarket and no existing market found on-chain")?,
};
```

`create_spot_claim` (`create_market.rs:673-685`): `find_claim_id_in_tx_events(...)` → `find_created_type(&response.object_changes, "SpotClaim")` → `lookup_claim_object_id_by_semantic_hash`.

`find_created_type` (`create_market.rs:820-835`) matches `ObjectChange::Created { object_type.name.as_str() == type_name }` and returns `object_id.to_canonical_string(true)` (0x-prefixed full hex).

Event extraction (`chain_lookup.rs:13-60`) matches `event.type_.name` against `"SpotClaimCreatedEvent"` / `"SpotMarketCreatedEvent"` and verifies the hash field, accepting either a `0x`-hex string or a JSON byte-array:

```rust
fn hash_from_json_value(value: &serde_json::Value) -> Option<Vec<u8>> {
    match value {
        serde_json::Value::String(s) => {
            let trimmed = s.trim().trim_start_matches("0x");
            hex::decode(trimmed).ok()
        }
        serde_json::Value::Array(arr) => {
            let mut bytes = Vec::with_capacity(arr.len());
            for v in arr {
                let n = v.as_u64()?;
                if n > 255 { return None; }
                bytes.push(n as u8);
            }
            Some(bytes)
        }
        _ => None,
    }
}
```

### 3.6 Idempotency / duplicate handling

Nonce + `spot_transactions` row per chain job:

```rust
// src/blockchain/create_market.rs:120-124
let nonce = format!("create-claim-market-{oracle_market_id}");
let tx_id = state.store.insert_transaction(Some(oracle_market_id), "create_claim_market", &nonce).await?;
```

Nonce formats: `create-claim-market-{oracle_market_id}`, `link-post-{oracle_market_id}`, `link-existing-market-{oracle_market_id}`, `finalize-post-{post_id}`, `resolve-{market_id}-{outcome_option_id}`, `refund-{market_id}`.

On-chain-exists recovery (`create_market.rs:796-804`):

```rust
fn is_on_chain_exists_error(err: &anyhow::Error) -> bool {
    let msg = err.to_string().to_lowercase();
    msg.contains("emarketexists")
        || msg.contains("eclaimexists")
        || msg.contains("error code 27")
        || msg.contains("error code 25")
        || msg.contains("abort code: 27")
        || msg.contains("abort code: 25")
}
```

Abort codes are lowercase-matched, so the TS port should stringify the full RPC error and search for `emarketexists` / `eclaimexists` / error code 25 / 27.

---

## 4. Deriving the claim / market inputs

### 4.1 `semantic_claim_hash` and `market_key_hash` — SHA-256 over canonical JSON

Definitions (`src/review/outcome_identity.rs:109-130`):

```rust
pub fn outcome_identity_hash(identity: &OutcomeIdentityFields) -> [u8; 32] {
    hash_json(identity)
}

pub fn outcome_market_hash(market_key: &OutcomeMarketKey) -> [u8; 32] {
    hash_json(market_key)
}

fn hash_json<T: Serialize>(value: &T) -> [u8; 32] {
    let json = serde_json::to_vec(value).expect("outcome identity serializes");
    let mut hasher = Sha256::new();
    hasher.update(&json);
    hasher.finalize().into()
}
```

So: **SHA-256 of the UTF-8 bytes of `serde_json::to_vec` output** — i.e. compact JSON, **no whitespace**, **field order = struct declaration order**. Not blake2b, not BLAKE3, not a hash of a UTF-8 string.

Stored as lowercase hex, **no `0x` prefix** (`canonicalize.rs:301-311`):

```rust
pub fn claim_hash_hex(claim: &CanonicalClaim) -> String { hex::encode(claim.market_key_hash) }
pub fn semantic_claim_hash_hex(claim: &CanonicalClaim) -> String { hex::encode(claim.semantic_claim_hash) }
pub fn market_key_hash_hex(claim: &CanonicalClaim) -> String { hex::encode(claim.market_key_hash) }
```

On the wire to Move, the hex is decoded back to **32 raw bytes**:

```rust
// src/blockchain/create_market.rs:447-454
fn decode_hash_hex(hex_str: &str) -> anyhow::Result<Vec<u8>> {
    let trimmed = hex_str.trim().trim_start_matches("0x");
    let bytes = hex::decode(trimmed).context("invalid claim/market hash hex")?;
    if bytes.len() < 8 {
        anyhow::bail!("hash too short (need >= 8 bytes)");
    }
    Ok(bytes)
}
```

#### Struct 1 — `OutcomeIdentityFields` → `semantic_claim_hash`

```rust
// src/review/outcome_identity.rs:14-37
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OutcomeIdentityFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub competition_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metric_ref: Option<String>,
    pub predicate: String,
    pub object: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metric: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comparison: Option<ComparisonOp>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub threshold: Option<String>,
    pub outcome_type: OutcomeType,
    pub claim_category: ClaimCategory,
    #[serde(default)]
    pub suggested_sources: Vec<String>,
}
```

JSON key order (serde emits in declaration order; `None` fields are **omitted entirely**):

```
entity_ref?, competition_ref?, event_ref?, metric_ref?,
predicate, object, metric?, comparison?, threshold?,
outcome_type, claim_category, suggested_sources
```

Note `suggested_sources` has **no** `skip_serializing_if`, so it is always present (`[]` when empty).

Example (from the unit test at `outcome_identity.rs:141-154`), for `entity_ref=Some("jd_vance")`, `event_ref=Some("us_presidential_election_2028")`, `predicate="win"`, `object="election"`, `outcome_type=Binary`, `claim_category=EventOccurrence`, `suggested_sources=["wikipedia"]`:

```json
{"entity_ref":"jd_vance","event_ref":"us_presidential_election_2028","predicate":"win","object":"election","outcome_type":"binary","claim_category":"event_occurrence","suggested_sources":["wikipedia"]}
```

SHA-256 of exactly those bytes.

Enum encodings (`#[serde(rename_all = "snake_case")]`):

| Enum | Wire values |
|---|---|
| `OutcomeType` (`canonicalize.rs:17-23`) | `binary`, `multi_choice`, `scalar` |
| `ClaimCategory` (`types.rs:35-44`) | `unsupported`, `price_threshold`, `release_published`, `event_occurrence`, `custom_http` |
| `ComparisonOp` (`types.rs:12-21`) | `lt`, `lte`, `gt`, `gte`, `eq`, `neq` |

#### Struct 2 — `OutcomeMarketKey` → `market_key_hash`

```rust
// src/review/outcome_identity.rs:39-46
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OutcomeMarketKey {
    pub identity: OutcomeIdentityFields,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deadline_day: Option<String>,
    pub betting_options: Vec<String>,
}
```

JSON key order: `identity` (nested as above), `deadline_day?` (omitted when `None`), `betting_options` (always present).

Construction (`outcome_identity.rs:85-107`):

```rust
pub fn build_outcome_market_key(
    identity: OutcomeIdentityFields,
    deadline: Option<DateTime<Utc>>,
    betting_options: Vec<String>,
    claim_category: ClaimCategory,
    price_market_spacing: chrono::Duration,
) -> OutcomeMarketKey {
    let market_deadline = match claim_category {
        ClaimCategory::PriceThreshold => {
            deadline.map(|d| bucket_deadline_for_market_key(d, price_market_spacing))
        }
        _ => deadline,
    };
    let deadline_day = market_deadline.map(deadline_day_bucket);
    let mut options = betting_options;
    options.sort();
    options.dedup();
    OutcomeMarketKey { identity, deadline_day, betting_options: options }
}
```

`deadline_day_bucket` (`outcome_identity.rs:48-50`):

```rust
pub fn deadline_day_bucket(deadline: DateTime<Utc>) -> String {
    deadline.date_naive().format("%Y-%m-%d").to_string()
}
```

**Only `price_threshold` claims floor the deadline into the 30-minute bucket**; all other categories use the exact deadline's day. Bucketing (`review/deadline.rs:154-191`, `DEFAULT_PRICE_MARKET_SPACING = 30 minutes`):

```rust
pub fn bucket_deadline_for_market_key(deadline: DateTime<Utc>, spacing: Duration) -> DateTime<Utc> {
    floor_to_spacing(deadline, spacing)
}

fn floor_to_spacing(dt: DateTime<Utc>, spacing: Duration) -> DateTime<Utc> {
    let spacing_minutes = spacing.num_minutes().max(1);
    let date = dt.date_naive();
    let total_minutes = date.num_days_from_ce() as i64 * 24 * 60
        + i64::from(dt.hour()) * 60
        + i64::from(dt.minute());
    let floored = total_minutes - (total_minutes % spacing_minutes);
    minutes_since_epoch_to_utc(floored)
}

fn minutes_since_epoch_to_utc(total_minutes: i64) -> DateTime<Utc> {
    let days = total_minutes.div_euclid(24 * 60);
    let minutes = total_minutes.rem_euclid(24 * 60);
    let hours = minutes / 60;
    let mins = minutes % 60;
    NaiveDate::from_num_days_from_ce_opt(days as i32)
        .and_then(|d| d.and_hms_opt(hours as u32, mins as u32, 0))
        .map(|t| Utc.from_utc_datetime(&t))
        .unwrap_or_else(Utc::now)
}
```

`num_days_from_ce()` is the proleptic-Gregorian day number (0001-01-01 = day 1); in TS the equivalent is `Math.floor(Date.UTC(y,m,d)/86400000) + 719163` minutes-based flooring:

```ts
const daysFromCe = Math.floor(Date.UTC(y, m, d) / 86_400_000) + 719_163;
const totalMinutes = daysFromCe * 1440 + hours * 60 + minutes;
const floored = totalMinutes - (totalMinutes % spacingMinutes);
const bucketMs = (floored * 60_000) - 719_163 * 86_400_000; // back to unix epoch
```

`spacing` comes from `SPOT_ORACLE_PRICE_MARKET_SPACING_SECS` (default 1800) — `review/worker.rs:199-203`.

#### Full canonicalization entry point

```rust
// src/review/canonicalize.rs:133-240 (abridged to the hash-relevant parts)
pub fn canonicalize_with_identity(
    extraction_id: Uuid,
    extracted: &ExtractedClaim,
    graph_refs: Option<crate::review::claim_matcher::ClaimMatch>,
    opts: &CanonicalizeOptions,
) -> CanonicalClaim {
    let subject = normalize_asset(&extracted.subject);
    let object = normalize_repo_or_asset(&extracted.object);
    let threshold = extracted.threshold.as_ref().map(|t| normalize_number(t));
    let comparison = extracted.comparison.or_else(|| infer_comparison(&extracted.predicate));
    let mut suggested_sources = extracted.suggested_sources.clone();
    suggested_sources.sort();
    suggested_sources.dedup();
    let mut suggested_options = extracted.suggested_options.clone();
    suggested_options.sort();
    suggested_options.dedup();
    ...
    let claim_category = derive_category(extracted, &subject, &comparison);
    let predicate = extracted.predicate.trim().to_lowercase();
    let metric = extracted.metric.as_ref().map(|s| s.trim().to_lowercase());

    let refs = graph_refs.as_ref();
    let entity_ref = refs.and_then(|r| r.entity_ref.clone()).or_else(|| {
        extracted.resolver_hints.matched_event_id.as_ref().map(|_| slugify_entity(&subject))
    });
    let event_ref = refs.and_then(|r| r.event_ref.clone())
        .or_else(|| extracted.resolver_hints.matched_event_id.clone());
    let competition_ref = refs.and_then(|r| r.competition_ref.clone());
    let metric_ref = refs.and_then(|r| r.metric_ref.clone());

    let outcome_identity = build_outcome_identity(
        entity_ref.clone(), competition_ref.clone(), event_ref.clone(), metric_ref.clone(),
        predicate.clone(), object.clone(), metric.clone(), comparison, threshold.clone(),
        extracted.outcome_type, claim_category, suggested_sources.clone(),
    );
    let semantic_claim_hash = outcome_identity_hash(&outcome_identity);
    ...
    let outcome_market_key = build_outcome_market_key(
        outcome_identity.clone(), extracted.deadline, suggested_options,
        claim_category, opts.price_market_spacing,
    );
    let market_key_hash = outcome_market_hash(&outcome_market_key);
    ...
}
```

Normalization helpers that affect the hash (`canonicalize.rs:313-369`):

- `normalize_asset`: lowercase + aliases `btc→bitcoin`, `eth→ethereum`, `sol→solana` (`lower == alias || lower.contains(alias)`).
- `normalize_repo_or_asset`: if the string contains `/`, normalize both sides with `normalize_repo_slug` (just `trim().to_lowercase()`) and rejoin as `owner/repo`; else `normalize_asset`.
- `normalize_number`: keep only `[0-9.]`, parse as f64; if integral → `format!("{}", v as i64)`, else `format!("{v}")`; on parse failure return the cleaned string.
- `infer_comparison`: `above|exceed|greater → gt`; `below|under|less → lt`; else `None`.
- `slugify_entity`: lowercase, non-alphanumerics → `_`, collapse/split on `_`, drop empties, rejoin with `_`.

### 4.2 `resolution_policy_hash`

There is **no separate off-chain derivation**. `CanonicalClaim` (`canonicalize.rs:86-98`) has only `semantic_claim_hash`, `market_key_hash`, and `claim_hash` (a legacy alias equal to `market_key_hash`). The value passed to Move is chosen at the call site:

| Call | `resolution_policy_hash` value | Reference |
|---|---|---|
| `create_spot_market_for_claim` | **`market_key_hash` bytes** (comment: "The market key hash doubles as the resolution policy binding") | `create_market.rs:513-517` |
| `link_post_to_spot_claim` | **raw 32 bytes of the claim object address** (`ObjectID::into_bytes()`), comment: "the claim id bytes stand in as the resolution policy binding until per-claim policy threading lands" | `create_market.rs:756-759` |

### 4.3 `betting_options`

Produced by the Resolver Compiler and persisted, then read back at chain-submit time.

Default rule (`review/compiler/mod.rs:75-82`):

```rust
pub(crate) fn default_betting_options(canonical: &CanonicalClaim) -> Vec<String> {
    let f = &canonical.normalized_fields;
    if f.suggested_options.is_empty() {
        vec!["Yes".to_string(), "No".to_string()]
    } else {
        f.suggested_options.clone()
    }
}
```

Called identically by all four compilers (`compiler/price.rs:17`, `release.rs:50`, `event.rs:32`, `custom_http.rs:39`). `normalized_fields.suggested_options` is already **sorted + deduped** by `canonicalize_with_identity` (`canonicalize.rs:148-150`).

Validation (`review/compiler/validate.rs:13, :37`): `2 <= len <= 10`.

Persisted by the review worker (`review/worker.rs:284-347`):

```rust
let compiled = ResolverCompiler::compile(&canonical, &state.sources, &source_rows)?;
let def_id = crate::store::reviews::insert_resolver_definition(...).await?;
let betting_options = serde_json::to_value(&compiled.betting_options)?;

let claim_id = crate::store::claims::insert_spot_claim(state.store.pool(), &semantic_hex, canonical_id).await?;
let spot_market_id = crate::store::claims::insert_spot_market(
    state.store.pool(), claim_id, &market_hex, canonical.normalized_fields.deadline,
    &betting_options, Some(def_id), /* entity/competition/event/metric refs */
    Some(&crate::review::outcome_identity::outcome_identity_hash_hex(&canonical.outcome_identity)),
    canonical.outcome_market_key.deadline_day.as_deref(),
).await?;
...
state.store.transition_with_metadata(
    market_id, LifecycleEvent::ReviewAccepted, Some(review_id), Some(def_id),
    Some(&betting_options), ctx,
).await?;

let resolution_window_ms = (deadline - market.created_at).num_milliseconds().max(0);
let max_buffer_ms = state.args.max_resolution_buffer_ms as i64;
state.store.set_market_resolution_timing(market_id, resolution_window_ms, max_buffer_ms).await?;
```

At chain-submit time the options come from the `markets` row, not from `spot_markets`:

```rust
// src/blockchain/create_market.rs:82
let options: Vec<String> = serde_json::from_value(market.betting_options.clone())?;
```

Same read in `settle.rs:54`. `markets.betting_options` is JSONB (`migrations/20260708000001_initial_spot_oracle_schema.up.sql`) written by `transition_with_metadata`.

Move-side re-validation: `min_betting_options`/`max_betting_options` from `SpotConfig`, duplicates rejected. `outcome_option_id` is a **`u8` index into the options vector**.

### 4.4 `resolution_at_ms`

```rust
// src/blockchain/create_market.rs:587-591
let resolution_at_ms = deadline
    .context("spot market missing deadline for on-chain resolution_at_ms")?
    .timestamp_millis()
    .try_into()
    .context("resolution_at_ms overflow")?;
```

`deadline` is `spot_markets.deadline` (`create_market.rs:130`), which is `canonical.normalized_fields.deadline` — the **exact extracted UTC deadline**, *not* the floored bucket used in `market_key_hash`. Both the `resolution_at_ms` and the `deadline_day` inside `market_key_hash` therefore come from the same `DateTime<Utc>`, but through different transformations.

Move asserts `resolution_at_ms >= clock::timestamp_ms(clock)` (`ETooEarly=4`). Also:

```rust
// src/blockchain/settle.rs:67-81 — submit is deferred until the definition deadline
if let Some(def_id) = market.resolver_definition_id {
    if let Some(def) = state.store.get_resolver_definition(def_id).await? {
        if chrono::Utc::now() < def.maturity_schedule.deadline {
            state.store.requeue_job(job.id, def.maturity_schedule.deadline, "before resolution_at for chain submit").await?;
            return Ok(());
        }
    }
}
```

### 4.5 `max_resolution_window_ms`

```rust
// src/blockchain/create_market.rs:129-134
&state.args, &market.post_id, &options,
spot_market.deadline,
market.max_resolution_window_ms as u64,
&semantic_hash, &market_key_hash,
claim_object_id.as_deref(),
```

- `market.max_resolution_window_ms` is an `i64` column on `markets` (`store/markets.rs:28`), default `604800000` in the initial schema, **overwritten** at review-accept time with `state.args.max_resolution_buffer_ms` (`review/worker.rs:342-347`), whose default is `SPOT_ORACLE_MAX_RESOLUTION_BUFFER_MS=259200000` (72 h).
- Column write (`store/markets.rs:253-274`):

```rust
pub async fn set_market_resolution_timing(
    pool: &PgPool, market_id: Uuid, resolution_window_ms: i64, max_resolution_window_ms: i64,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"UPDATE markets SET resolution_window_ms = $2, max_resolution_window_ms = $3, updated_at = NOW() WHERE id = $1"#,
    ).bind(market_id).bind(resolution_window_ms).bind(max_resolution_window_ms).execute(pool).await?;
    Ok(())
}
```

- It is passed on-chain as `ptb.pure(Some(max_resolution_buffer_ms))` → BCS `Option<u64>` = `01 ‖ u64le`.

**Naming caveat:** the Rust parameter is named `max_resolution_buffer_ms` but the Move parameter is `max_resolution_window_ms`; the `markets` column is `max_resolution_window_ms`. The refund job is scheduled at `deadline + max_buffer_ms` (`review/worker.rs:376-386`).

### 4.6 `outcome_option_id`

```rust
// src/blockchain/settle.rs:54-59
let options: Vec<String> = serde_json::from_value(market.betting_options.clone())?;
let outcome_label = outcome_label.context("missing outcome_label")?;
let outcome_option_id = options
    .iter()
    .position(|o| o == &outcome_label)
    .unwrap_or(0) as u8;
```

Exact string match; **falls back to option `0`** if the resolver label is not in the list. `evidence_urls` must be non-empty or the job bails (`settle.rs:61-63`). `confidence_bps` defaults to `9500` and `reasoning` to `"deterministic resolver outcome"` when absent from the payload.

### 4.7 Past-verdict manifest hashes

```rust
// src/review/verify.rs:99-106
fn hash_evidence(urls: &[String]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    for url in urls {
        hasher.update(url.as_bytes());
        hasher.update(b"\n");
        }
    hasher.finalize().to_vec()
}
```

= SHA-256 over each URL's UTF-8 bytes followed by `0x0A`, concatenated. Verdict encoding (`verify.rs:18-21, 91-97`): `VERDICT_TRUE=1`, `VERDICT_FALSE=2`, `VERDICT_UNVERIFIABLE=3`; label→verdict is lowercase-matched on `yes|true` / `no|false`.

Related market address uses a zero address sentinel when none exists (`review/worker.rs:537-538, 587-591`):

```rust
/// All-zero on-chain address encoding "no related market" in the finalize past-verdict vectors.
const ZERO_ADDR: &str = "0x0000000000000000000000000000000000000000000000000000000000000000";
...
let evidence_hex = format!("0x{}", hex::encode(&verdict.evidence_hash));
```

---

## 5. Post → market linking

### 5.1 Which posts the oracle picks up

**Primary path — checkpoint gRPC ingest** (`src/ingest/checkpoints.rs`), always enabled when `SPOT_ORACLE_STREAMING_URL` is set:

```rust
// src/ingest/checkpoints.rs:60-71
let endpoint =
    Endpoint::from_shared(streaming_url.to_string())?.connect_timeout(Duration::from_secs(10));
let mut client = SubscriptionServiceClient::connect(endpoint)
    .await?
    .max_decoding_message_size(MAX_GRPC_MESSAGE_SIZE_BYTES); // 128 MiB

let mut request = SubscribeCheckpointsRequest::default();
request.read_mask = Some(Checkpoint::proto_field_mask());

let mut stream = client.subscribe_checkpoints(request).await?.into_inner();
let ingest_store = CheckpointIngestStore::new(state.store.pool().clone());
let mut watermark = ingest_store.get_watermark().await.unwrap_or(0);
```

Filter is **package + module + event name**, and is **always-on** (no `enable_spot` opt-in filter):

```rust
// src/ingest/checkpoints.rs:118-166
let social_package = ObjectID::from_hex_literal(&state.args.social_package_id)
    .unwrap_or_else(|_| ObjectID::ZERO);

for tx in &checkpoint.transactions {
    let Some(events) = &tx.events else { continue; };
    for ev in &events.data {
        if ev.package_id != social_package { continue; }
        if ev.type_.module.as_str() != "post" { continue; }
        if ev.type_.name.as_str() != "PostCreatedEvent" { continue; }

        let parsed = match parse_post_created(&ev.contents) { ... };

        // Always-on multi-claim SPoT: analyze every post regardless of opt-in. Dedupe on
        // the per-post analysis row so an already-ingested post is not re-enqueued.
        if state.store.market_exists(&parsed.post_id).await? { ... continue; }

        let market_id = crate::store::markets::insert_market(
            state.store.pool(), &parsed.post_id, &parsed.owner, &parsed.content,
        ).await?;
        crate::store::jobs::enqueue_job(
            state.store.pool(), "ReviewPost", Some(market_id), None,
            parsed.created_at_ms, Utc::now(),
            serde_json::json!({
                "post_id": parsed.post_id,
                "owner": parsed.owner,
                "content": parsed.content,
                "created_at_ms": parsed.created_at_ms,
                "post_type": parsed.post_type,
            }),
        ).await?;
        ...
    }
}
```

Note: `parsed.created_at_ms` is `chrono::Utc::now().timestamp_millis()` — the ingest wall clock, **not** an on-chain timestamp (`ingest/post_created.rs:79`). It is used only as the job's `priority_score`.

`PostCreatedEvent` BCS layout (`src/ingest/post_created.rs:19-81`):

```rust
#[derive(Debug, Deserialize)]
struct BcsPostCreatedEvent {
    post_id: AccountAddress,
    owner: AccountAddress,
    profile_id: AccountAddress,
    platform_id: AccountAddress,
    permissions: u8,
    content: String,
    post_type: String,
    parent_post_id: Option<AccountAddress>,
    mentions: Option<Vec<AccountAddress>>,
    media_urls: Option<Vec<String>>,
    metadata_json: Option<String>,
    mydata_id: Option<AccountAddress>,
    promotion_id: Option<AccountAddress>,
    revenue_redirect_to: Option<AccountAddress>,
    revenue_redirect_percentage: Option<u64>,
    enable_spt: bool,
    spt_id: Option<AccountAddress>,
    poc_redirection_kind: u8,
    actor_address: AccountAddress,
    sub_agent_id: Option<AccountAddress>,
    organization_id: Option<AccountAddress>,
    action_identity_class: u8,
}

fn to_parsed(post_id: AccountAddress, owner: AccountAddress, content: String, post_type: String) -> ParsedPostCreated {
    ParsedPostCreated {
        post_id: format!("0x{post_id}"),
        owner: format!("0x{owner}"),
        content,
        post_type,
        created_at_ms: chrono::Utc::now().timestamp_millis(),
    }
}
```

`post_id` here **is the on-chain `Post` shared object address** — later fed straight into `parse_object_id(post_id)` as the `Post` argument (`create_market.rs:489, :733`; `finalize.rs:175`; `settle.rs:228`).

**Legacy path — HTTP polling** (`src/review/ingest.rs`, only when `SPOT_ORACLE_INGEST_MODE` is `http` or `both`; `docs/ARCHITECTURE.md:13-14` marks it deprecated). `GET {social_server_url}/spot/pending-posts?limit=50&cursor={ms}` with header `x-spot-oracle-sync-secret` (`social_client.rs:40-58`); cursor is `MAX(markets.created_at_ms)`; the JSON item shape is `{ post_id, owner, content, created_at, post_type? }`.

### 5.2 DB tables involved

| Table | Purpose | Key columns |
|---|---|---|
| `markets` | One row per ingested post (the oracle's "oracle market") | `id`, `post_id` (on-chain Post object ID), `creator`, `claim_text`, `betting_options` JSONB, `status`, `status_reason`, `on_chain_status`, `review_id`, `resolver_definition_id`, `resolution_window_ms`, `max_resolution_window_ms`, `spot_market_object_id` |
| `market_transitions` | Audit of every status change | `market_id`, `from_status`, `to_status`, `trigger`, `job_id`, `tx_digest`, `status_reason` |
| `llm_extractions` | Raw LLM output + parsed | `post_id`, `raw_response`, `parsed` JSONB, `model` |
| `canonical_claims` | Normalized claim + hashes | `llm_extraction_id`, `normalized_fields` JSONB, `claim_hash`, `semantic_claim_hash`, `market_key_hash` |
| `oracle_reviews` | Decision per post | `post_id`, `canonical_claim_id`, `decision`, `reject_reason`, `reviewer` |
| `resolver_definitions` | Immutable execution spec | `canonical_claim_id`, `resolver_kind`, `spec` JSONB, `source_ids` JSONB, `betting_options` JSONB, `maturity_schedule` JSONB, `compile_fingerprint` |
| `spot_claims` | Claim → on-chain object | `id`, `semantic_claim_hash` UNIQUE, `spot_claim_object_id`, `canonical_claim_id` |
| `spot_markets` | Claim-scoped market + on-chain object | `id`, `claim_id` FK, `market_key_hash` UNIQUE, `spot_market_object_id`, `deadline`, `betting_options` JSONB, `status`, `resolver_definition_id`, `entity_ref`, `competition_ref`, `event_ref`, `metric_ref`, `outcome_identity_hash`, `deadline_day` |
| `post_claim_links` | Post → claim/market link | `post_id` UNIQUE, `claim_id`, `market_id`, `oracle_market_id`, `review_id`, `link_kind` (`primary` \| `linked`) |
| `spot_jobs` | Job queue | `id`, `job_type`, `market_id`, `resolver_definition_id`, `priority_score`, `status`, `attempts`, `max_attempts`, `run_after`, `payload` JSONB |
| `spot_transactions` | Chain-tx idempotency | populated via `insert_transaction(market_id, kind, nonce)` |
| `resolver_state`, `evidence`, `evidence_bundles`, `spot_trusted_sources`, `spot_scheduled_events`, `knowledge_*` | supporting | — |

DDL anchors: `crates/myso-spot-oracle-schema/migrations/20260708000001_initial_spot_oracle_schema.up.sql` (markets, spot_jobs, canonical_claims, resolver_definitions, evidence…), `20260709000000_claim_market_redesign.up.sql` (spot_claims, spot_markets, post_claim_links), `20260717000000_knowledge_graph_and_dedup.up.sql:95-100` (`entity_ref`, `competition_ref`, `event_ref`, `metric_ref`, `outcome_identity_hash`, `deadline_day` on `spot_markets`).

### 5.3 State machine

Off-chain `markets.status` (`src/types.rs:104-157`):

```rust
pub enum MarketStatus {
    PostCreated, PendingReview, Rejected, PendingCreate, Waiting,
    Resolving, DaoRequired, Resolved, Refunded, Failed,
}
```

String values (`as_str`): `post_created`, `pending_review`, `rejected`, `pending_create`, `waiting`, `resolving`, `dao_required`, `resolved`, `refunded`, `failed`. `from_str` additionally accepts `"active"` as an alias for `Waiting`. Terminal: `rejected | resolved | refunded | failed`.

Transitions (`src/claim/lifecycle.rs:34-77`):

| From | Event | To |
|---|---|---|
| `post_created` | `ReviewEnqueued` | `pending_review` |
| `pending_review` | `ReviewRejected` | `rejected` |
| `pending_review` | `ReviewAccepted` | `pending_create` |
| `pending_create` | `CreateTxConfirmed` | `waiting` |
| `waiting` \| `resolving` | `ResolveAttemptStarted` | `resolving` |
| `resolving` | `ResolveTxConfirmed{high_confidence:true}` | `resolved` |
| `resolving` | `ResolveTxConfirmed{high_confidence:false}` | `dao_required` |
| `waiting` \| `resolving` \| `dao_required` | `RefundTxConfirmed` | `refunded` |
| any non-terminal | `Failed{reason}` | `failed` |

Any other combination bails (`illegal transition from … via …`); terminal states bail on any event. `insert_spot_market` writes `spot_markets.status = 'pending_create'`; `set_spot_market_object_id` flips it to `'waiting'` (`store/claims.rs:270-283`).

On-chain `SpotRecord`/`SpotMarket.status` mirror (`src/types.rs:159-178`):

```rust
pub enum OnChainSpotStatus { Open = 1, DaoRequired = 2, Resolved = 3, Refundable = 4 }
```

`on_chain_status_for_resolve` (`resolver/engine.rs:526-536`):

```rust
pub fn is_high_confidence(confidence_bps: u64, threshold_bps: u64) -> bool {
    confidence_bps >= threshold_bps
}

pub fn on_chain_status_for_resolve(high_confidence: bool) -> i16 {
    if high_confidence { OnChainSpotStatus::Resolved as i16 } else { OnChainSpotStatus::DaoRequired as i16 }
}
```

### 5.4 Job queue and dispatch

`src/blockchain/worker.rs:10-39`:

```rust
pub async fn process_chain_job(state: Arc<AppState>, job: SpotJob) -> anyhow::Result<()> {
    let job_id = job.id;
    let tx_kind = job.payload.get("tx_kind").and_then(|v| v.as_str()).unwrap_or("unknown");
    let result = match tx_kind {
        "create_market" | "create_claim_market" => create_market::submit_create_claim_market(state.clone(), &job).await,
        "link_post" => create_market::submit_link_post(state.clone(), &job).await,
        "finalize_post" => finalize::submit_finalize_post(state.clone(), &job).await,
        "oracle_resolve" => settle::submit_oracle_resolve(state.clone(), &job).await,
        "refund_unresolved" => refund::submit_refund_unresolved(state.clone(), &job).await,
        other => Err(anyhow::anyhow!("unknown tx_kind: {other}")),
    };
    match result {
        Ok(()) => { state.store.complete_job(job_id, "completed", None).await?; }
        Err(err) => {
            state.store.complete_job(job_id, "failed", Some(&err.to_string())).await?;
            return Err(err);
        }
    }
    Ok(())
}
```

Job types: `ReviewPost`, `ResolveMarket`, `SubmitChainTx` (`src/scheduler/mod.rs:36-46`). `SubmitChainTx` is dispatched by payload `tx_kind` ∈ {`create_market`|`create_claim_market`, `link_post`, `finalize_post`, `oracle_resolve`, `refund_unresolved`}.

Enqueued payloads:

| Emitted by | Line | Payload |
|---|---|---|
| Review accept | `review/worker.rs:349-364` | `{"tx_kind":"create_claim_market","spot_claim_id":…,"spot_market_id":…,"semantic_claim_hash":…,"market_key_hash":…}`, priority `100` |
| Review linked | `review/worker.rs:427-440` | `{"tx_kind":"link_post","spot_claim_id":…,"spot_market_id":…}`, priority `90` |
| Create/link confirm | `create_market.rs:351-375` | `{"tx_kind":"finalize_post","post_id":…,"detected_claim_count":1,"rejected_claim_count":0,"truncated_claim_count":0,"past_verified_count":0}`, priority `80` |
| Unsupported claim | `review/worker.rs:171-187` | `{"tx_kind":"finalize_post",…,"rejected_claim_count":1}` |
| Past claim verdict | `review/worker.rs:592-615` | `{"tx_kind":"finalize_post",…,"past_verified_count":1,"past_claim_indexes":[0],"past_verdicts":[v],"past_related_market_ids":[addr],"past_evidence_hashes":[hex],"veracity_manifest_hash":hex,…}` |
| Resolver engine | `resolver/engine.rs:141-158` | `{"tx_kind":"oracle_resolve","outcome_label":…,"confidence_bps":…,"reasoning":…,"evidence_urls":[…],"bundle_hash":…}`, priority `200` |
| Resolver engine (fallback) | `resolver/engine.rs:168-185` | `{"tx_kind":"refund_unresolved"}`, priority `150` |
| Review accept (scheduled) | `review/worker.rs:365-386` | `ResolveMarket` at `compiled.maturity_schedule.maturity_at`, priority `50`; `refund_unresolved` at `deadline + max_buffer_ms`, priority `10` |

Queue mechanics (`store/jobs.rs:50-73`): `WHERE status='pending' AND run_after <= NOW() ORDER BY priority_score DESC, created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1`, then `status='processing', attempts = attempts + 1`.

### 5.5 Object-ID resolution at submit time

| Needed | Resolution order |
|---|---|
| `claim_object_id` | `spot_claims.spot_claim_object_id` → `lookup_claim_object_id_by_semantic_hash` (on-chain event scan) — `create_market.rs:86-90, :254-262` |
| `market_object_id` | `spot_markets.spot_market_object_id` → `lookup_market_by_key_hash` → parse create-tx events → `ObjectChange::Created{name=="SpotMarket"}` — `create_market.rs:92-101, :103-118, :561-573` |
| `claim_object_id` for resolve | SQL join (`settle.rs:175-189`): |

```sql
SELECT c.spot_claim_object_id
FROM post_claim_links l
JOIN spot_claims c ON c.id = l.claim_id
WHERE l.post_id = $1
```

| Needed | Source |
|---|---|
| `spot_market_object_id` for resolve | `markets.spot_market_object_id` (`settle.rs:96-99`) |
| `post_id` | `markets.post_id` |

Event-scan fallback (`chain_lookup.rs:103-140`): `EventFilter::MoveEventModule { package: 0x…50c1, module: "social_proof_of_truth" }`, `query_events(filter, cursor, Some(200), true)` (descending), up to `MAX_EVENT_PAGES = 20` pages.

---

## 6. Porting checklist / gotchas for TypeScript

1. **Package is a constant.** `0x50c1` is baked into the PTB builders; `SPOT_ORACLE_SOCIAL_PACKAGE_ID` only affects ingest. Decide deliberately which one your TS uses.
2. **Clock `0x6`** — always shared-immutable.
3. **Key is bare hex `flag ‖ 32B`**, no `0x`, no bech32 (`mysoprivkey`), no base64. `0x00`=Ed25519, `0x01`=Secp256k1, `0x02`=Secp256r1.
4. **Hashes are SHA-256 over compact serde JSON**, struct-declaration key order, `None` fields omitted, `suggested_sources`/`betting_options` always emitted. A single extra key or reordered key changes the hash and breaks dedup against the Rust oracle.
5. **`deadline_day` is `%Y-%m-%d`** of the deadline, floored to 30-minute buckets **only for `price_threshold`**.
6. **`betting_options` inside `market_key_hash` are sorted+deduped**, but the options written to the chain and to `outcome_option_id` indexing come from the compiler output (`normalized_fields.suggested_options`, also sorted+deduped) and default to `["Yes","No"]`.
7. **`resolution_at_ms` = exact deadline millis** (not bucketed). **`max_resolution_window_ms` = `SPOT_ORACLE_MAX_RESOLUTION_BUFFER_MS`**, passed as `Some(u64)`.
8. **`resolution_policy_hash`**: `market_key_hash` for `create_spot_market_for_claim`; the 32 raw bytes of the claim object address for `link_post_to_spot_claim`.
9. **`claim_index` is hardcoded `0`** in both create and link calls (single-claim baseline).
10. **`claim_manifest_hash` is always `None`.**
11. **Gas:** first coin only, fixed budget, live RGP, `WaitForLocalExecution`, fresh cap object ref per tx.
12. **`oracle_resolve` and `refund_unresolved` do not verify tx success** — if you want robustness in TS, add the `status_ok()` check that `create_*` uses.
13. **`chain_configured` gate:** missing any of `private_key_hex`, `spot_config_object_id`, `admin_cap_object_id`, `spot_registry_object_id` silently degrades to off-chain-only mode with state transitions still applied.
14. **Idempotency nonces** and the `emarketexists`/`eclaimexists`/code 25/27 recovery path must be reproduced or you'll get hard failures on re-runs.
