// Copyright (c) The Social Proof Foundation, LLC.
// SPDX-License-Identifier: Apache-2.0
//
// The simulated ("fake") SPoT oracle.
//
// In production `myso-spot-oracle` polls the social indexer, runs an LLM review
// over each post, derives canonical hashes and submits PTBs. For the demo we
// keep the *on-chain* half exactly as the real oracle does it — same package,
// same entrypoints, same SHA-256 canonicalization, same account — but replace
// the off-chain review with an operator-driven HTTP call from the browser.
//
// Every write here is signed by the key in `SPOT_ORACLE_PRIVATE_KEY`.

import { Transaction } from "@socialproof/myso/transactions";
import { deriveClaim, hexToBytes } from "./canonical.js";
import {
  ChainError,
  executeAsOracle,
  freshClient,
  findCreatedObject,
  oracleAddress,
  type ExecutedTx,
} from "./chain.js";
import { env } from "./env.js";
import { getObjectJson, ownedObjectsOfType } from "./gql.js";
import { findObjectByField, getIdOrThrow, moveTypes } from "./ids.js";
import { social } from "./social.js";

const MOVE = (fn: string) => `${env.socialPackageId}::social_proof_of_truth::${fn}`;
const INSURE = (fn: string) => `${env.socialPackageId}::insurance::${fn}`;
const POST = (fn: string) => `${env.socialPackageId}::post::${fn}`;
const PROFILE = (fn: string) => `${env.socialPackageId}::profile::${fn}`;

export interface SpotConfigState {
  truthEnabled: boolean;
  confidenceThresholdBps: number;
  resolutionWindowMs: number;
  maxResolutionWindowMs: number;
  payoutDelayMs: number;
  platformFeeBps: number;
  ecosystemFeeBps: number;
  creatorFeeBps: number;
  creatorClaimWindowMs: number;
  expiredCreatorEcosystemBps: number;
  minBettingOptions: number;
  maxBettingOptions: number;
  minReasoningLength: number;
  maxReasoningLength: number;
  maxEvidenceUrls: number;
  oracleAddress: string;
  maxSingleBet: number;
  maxBetsPerRecord: number;
  maxClaimPerPost: number;
  spotGovernanceRegistryId: string;
  version: number;
  objectId: string;
}

function numeric(value: unknown, fallback = 0): number {
  const parsed = Number(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Read the live SpotConfig so config updates preserve every other field. */
export async function readSpotConfig(): Promise<SpotConfigState> {
  const objectId = await getIdOrThrow("spotConfig");
  const node = await getObjectJson(objectId);
  const json = (node?.json ?? {}) as Record<string, unknown>;
  return {
    truthEnabled: json.truth_enabled === true,
    confidenceThresholdBps: numeric(json.confidence_threshold_bps, 7000),
    resolutionWindowMs: numeric(json.resolution_window_ms, 0),
    maxResolutionWindowMs: numeric(json.max_resolution_window_ms, 0),
    payoutDelayMs: numeric(json.payout_delay_ms, 0),
    platformFeeBps: numeric(json.platform_fee_bps, 50),
    ecosystemFeeBps: numeric(json.ecosystem_fee_bps, 50),
    creatorFeeBps: numeric(json.creator_fee_bps, 100),
    creatorClaimWindowMs: numeric(json.creator_claim_window_ms, 2_592_000_000),
    expiredCreatorEcosystemBps: numeric(json.expired_creator_ecosystem_bps, 10_000),
    minBettingOptions: numeric(json.min_betting_options, 2),
    maxBettingOptions: numeric(json.max_betting_options, 10),
    minReasoningLength: numeric(json.min_reasoning_length, 10),
    maxReasoningLength: numeric(json.max_reasoning_length, 5000),
    maxEvidenceUrls: numeric(json.max_evidence_urls, 10),
    oracleAddress: String(json.oracle_address ?? ""),
    maxSingleBet: numeric(json.max_single_bet, 0),
    maxBetsPerRecord: numeric(json.max_bets_per_record, 10_000),
    maxClaimPerPost: numeric(json.max_claim_per_post, 10),
    spotGovernanceRegistryId: String(json.spot_governance_registry_id ?? `0x${"0".repeat(64)}`),
    version: numeric(json.version, 0),
    objectId,
  };
}

/**
 * `update_spot_config` — flip `truth_enabled` (and optionally the confidence
 * threshold) while preserving every other field verbatim. Requires SpotAdminCap.
 */
export async function updateSpotConfig(
  patch: { truthEnabled?: boolean; confidenceThresholdBps?: number } = {},
): Promise<{ tx: ExecutedTx; config: SpotConfigState }> {
  const [config, capId] = await Promise.all([
    readSpotConfig(),
    getIdOrThrow("spotAdminCap"),
  ]);
  const clock = env.clockObjectId;

  const nextTruth = patch.truthEnabled ?? config.truthEnabled;
  const nextConfidence = patch.confidenceThresholdBps ?? config.confidenceThresholdBps;

  const tx = await executeAsOracle((tx) => {
    tx.moveCall({
      target: MOVE("update_spot_config"),
      arguments: [
        tx.object(capId),
        tx.object(config.objectId),
        tx.pure.bool(nextTruth),
        tx.pure.u64(nextConfidence),
        tx.pure.u64(config.resolutionWindowMs),
        tx.pure.u64(config.maxResolutionWindowMs),
        tx.pure.u64(config.payoutDelayMs),
        tx.pure.u64(config.platformFeeBps),
        tx.pure.u64(config.ecosystemFeeBps),
        tx.pure.u64(config.creatorFeeBps),
        tx.pure.u64(config.creatorClaimWindowMs),
        tx.pure.u64(config.expiredCreatorEcosystemBps),
        tx.pure.u64(config.minBettingOptions),
        tx.pure.u64(config.maxBettingOptions),
        tx.pure.u64(config.minReasoningLength),
        tx.pure.u64(config.maxReasoningLength),
        tx.pure.u64(config.maxEvidenceUrls),
        tx.pure.address(config.oracleAddress),
        tx.pure.u64(config.maxSingleBet),
        tx.pure.u64(config.maxBetsPerRecord),
        tx.pure.u64(config.maxClaimPerPost),
        tx.pure.id(config.spotGovernanceRegistryId),
        tx.object(clock),
      ],
    });
  }, `update_spot_config(truth_enabled=${nextTruth})`);

  return { tx, config: { ...config, truthEnabled: nextTruth, confidenceThresholdBps: nextConfidence } };
}

/** `insurance::set_insurance_enabled` — requires InsuranceAdminCap. */
export async function setInsuranceEnabled(enabled: boolean): Promise<ExecutedTx> {
  const [configId, capId] = await Promise.all([
    getIdOrThrow("insuranceConfig"),
    getIdOrThrow("insuranceAdminCap"),
  ]);

  return executeAsOracle((tx) => {
    tx.moveCall({
      target: INSURE("set_insurance_enabled"),
      arguments: [
        tx.object(capId),
        tx.object(configId),
        tx.pure.bool(enabled),
        tx.object(env.clockObjectId),
      ],
    });
  }, `set_insurance_enabled(${enabled})`);
}

export interface ApprovePostInput {
  postId: string;
  /** The claim text the market settles. Defaults to the on-chain post content. */
  claimText?: string;
  /** Absolute ms deadline when the oracle may first resolve. Default: now + demo window. */
  resolutionAtMs?: number;
  bettingOptions?: string[];
  maxResolutionWindowMs?: number;
  identity?: Parameters<typeof deriveClaim>[3];
}

export interface ApprovePostResult {
  tx: ExecutedTx;
  marketId: string | null;
  claimId: string | null;
  semanticClaimHashHex: string;
  marketKeyHashHex: string;
  identityJson: string;
  marketKeyJson: string;
  alreadyExisted: boolean;
}

/**
 * The fake-oracle "approve this post" action.
 *
 * Calls the single-call convenience entrypoint
 * `create_and_finalize_spot_market_for_post`, which registers the SpotClaim,
 * creates the SpotMarket, links the post at claim index 0 and finalizes the
 * post's SPoT analysis — after which `place_spot_bet_for_post` and
 * `insurance::buy_coverage` become usable.
 */
export async function approvePostForSpot(input: ApprovePostInput): Promise<ApprovePostResult> {
  const postId = input.postId;

  // Fall back to the on-chain post content when the caller omits the claim text.
  // The GraphQL consistent store lags a freshly written object by a checkpoint or
  // two, so poll briefly before giving up.
  let claimText = input.claimText?.trim() ?? "";
  if (!claimText) {
    for (let attempt = 0; attempt < 8 && !claimText; attempt += 1) {
      const post = await getObjectJson(postId).catch(() => null);
      const content = post?.json?.content;
      if (typeof content === "string" && content.trim() !== "") {
        claimText = content.trim();
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }
  if (!claimText) {
    throw new ChainError(
      `Could not read the content of post ${postId} yet. Pass "claimText" explicitly, or retry once the indexer catches up.`,
    );
  }

  const now = Date.now();
  const resolutionAtMs =
    input.resolutionAtMs ?? now + env.demo.resolutionWindowMs;
  if (resolutionAtMs < now) {
    throw new ChainError("resolutionAtMs must be in the future (the contract asserts ETooEarly).");
  }

  const bettingOptions = input.bettingOptions?.length
    ? input.bettingOptions
    : env.demo.bettingOptions;

  const claim = deriveClaim(claimText, resolutionAtMs, bettingOptions, input.identity);
  const maxResolutionWindowMs = input.maxResolutionWindowMs ?? env.demo.maxResolutionWindowMs;

  const [configId, registryId, oracleCapId] = await Promise.all([
    getIdOrThrow("spotConfig"),
    getIdOrThrow("spotRegistry"),
    getIdOrThrow("spotOracleAdminCap"),
  ]);

  try {
    const tx = await executeAsOracle((tx) => {
      tx.moveCall({
        target: MOVE("create_and_finalize_spot_market_for_post"),
        arguments: [
          tx.object(oracleCapId),
          tx.object(configId),
          tx.object(registryId),
          tx.object(postId),
          tx.pure.vector("u8", hexToBytes(claim.semanticClaimHashHex)),
          tx.pure.vector("u8", hexToBytes(claim.marketKeyHashHex)),
          tx.pure.vector("u8", hexToBytes(claim.marketKeyHashHex)),
          tx.pure.vector("string", claim.marketKey.betting_options),
          tx.pure.u64(resolutionAtMs),
          tx.pure.option("u64", maxResolutionWindowMs),
          tx.object(env.clockObjectId),
        ],
      });
    }, `approve_post(${postId.slice(0, 10)}…)`);

    const marketId = findCreatedObject(tx, "SpotMarket");
    const claimId = findCreatedObject(tx, "SpotClaim");

    return {
      tx,
      marketId,
      claimId,
      semanticClaimHashHex: claim.semanticClaimHashHex,
      marketKeyHashHex: claim.marketKeyHashHex,
      identityJson: claim.identityJson,
      marketKeyJson: claim.marketKeyJson,
      alreadyExisted: false,
    };
  } catch (error) {
    const message = (error as Error).message ?? "";
    // The contract dedups by market_key_hash: the same claim identity, on the
    // same deadline day, with the same options collapses onto ONE market and
    // aborts with EMarketExists (27). Surface it as a demoable outcome and
    // resolve the pre-existing market so the UI can navigate straight to it.
    if (/emarketexists|error code 27|abort code:?\s*27/i.test(message)) {
      const existing = await findMarketByPostId(postId).catch(() => null);
      return {
        tx: {
          digest: "",
          status: "failure",
          error: message,
          events: [],
          gasUsed: null,
          createdObjects: [],
          objectTypes: {},
        },
        marketId: existing,
        claimId: null,
        semanticClaimHashHex: claim.semanticClaimHashHex,
        marketKeyHashHex: claim.marketKeyHashHex,
        identityJson: claim.identityJson,
        marketKeyJson: claim.marketKeyJson,
        alreadyExisted: true,
      };
    }
    throw error;
  }
}

/** Locate the SpotMarket whose primary post is `postId` (dedup / re-approve path). */
export async function findMarketByPostId(postId: string): Promise<string | null> {
  const { listObjectsByType } = await import("./gql.js");
  const nodes = await listObjectsByType(moveTypes.spotMarket, { pageSize: 50, maxPages: 40 });
  const target = postId.toLowerCase();
  const match = nodes.find(
    (node) => String(node.json?.primary_post_id ?? "").toLowerCase() === target,
  );
  return match?.address ?? null;
}

export interface ResolveMarketInput {
  marketId: string;
  outcomeOptionId: number;
  confidenceBps?: number;
  reasoning: string;
  evidenceUrls: string[];
}

/**
 * `oracle_resolve` — settles the market, applies the confidence threshold and
 * triggers payout/refund accounting.
 *
 * Note: the real oracle does NOT request response options here and never checks
 * tx status; we keep the call shape identical but DO verify success.
 */
export async function resolveMarket(input: ResolveMarketInput): Promise<ExecutedTx> {
  const market = await getObjectJson(input.marketId);
  if (!market?.json) throw new ChainError(`Market ${input.marketId} not found on chain.`);

  const config = await readSpotConfig();
  const reasoning = input.reasoning.trim();
  const evidenceUrls = input.evidenceUrls.map((url) => url.trim()).filter(Boolean);

  if (reasoning.length < config.minReasoningLength || reasoning.length > config.maxReasoningLength) {
    throw new ChainError(
      `Reasoning must be ${config.minReasoningLength}-${config.maxReasoningLength} characters (got ${reasoning.length}).`,
    );
  }
  if (evidenceUrls.length === 0 || evidenceUrls.length > config.maxEvidenceUrls) {
    throw new ChainError(
      `Provide 1-${config.maxEvidenceUrls} evidence URLs (the contract requires at least one).`,
    );
  }

  const claimId = String(market.json.claim_id ?? "");
  const postId = String(market.json.primary_post_id ?? "");
  if (!claimId || !postId) throw new ChainError("Market is missing claim_id / primary_post_id.");

  const [configId, registryId, oracleCapId, platformId, treasuryId] = await Promise.all([
    getIdOrThrow("spotConfig"),
    getIdOrThrow("spotRegistry"),
    getIdOrThrow("spotOracleAdminCap"),
    getIdOrThrow("platform"),
    getIdOrThrow("ecosystemTreasury"),
  ]);

  const confidenceBps = input.confidenceBps ?? env.demo.confidenceBps;

  return executeAsOracle((tx) => {
    tx.moveCall({
      target: MOVE("oracle_resolve"),
      arguments: [
        tx.object(oracleCapId),
        tx.object(configId),
        tx.object(registryId),
        tx.object(claimId),
        tx.object(input.marketId),
        tx.object(postId),
        tx.object(platformId),
        tx.object(treasuryId),
        tx.pure.u8(input.outcomeOptionId),
        tx.pure.u64(confidenceBps),
        tx.pure.string(reasoning),
        tx.pure.vector("string", evidenceUrls),
        tx.object(env.clockObjectId),
      ],
    });
  }, `oracle_resolve(${input.marketId.slice(0, 10)}…)`);
}

/** `place_spot_bet_for_post` — signed by the oracle/admin for the demo wallet. */
export async function placeBet(input: {
  marketId: string;
  postId: string;
  optionId: number;
  amountMist: number;
}): Promise<ExecutedTx> {
  const [configId, registryId] = await Promise.all([
    getIdOrThrow("spotConfig"),
    getIdOrThrow("spotRegistry"),
  ]);

  return executeAsOracle((tx) => {
    tx.moveCall({
      target: MOVE("place_spot_bet_for_post"),
      arguments: [
        tx.object(configId),
        tx.object(registryId),
        tx.object(input.marketId),
        tx.object(input.postId),
        tx.splitCoins(tx.gas, [input.amountMist]),
        tx.pure.u8(input.optionId),
        tx.pure.u64(input.amountMist),
        tx.pure.option("address", null),
        tx.object(env.clockObjectId),
      ],
    });
  }, `place_spot_bet_for_post(option=${input.optionId})`);
}

/** `claim_payout` — pull the winner's payout for a resolved market. */
export async function claimPayout(input: { marketId: string; postId: string }): Promise<ExecutedTx> {
  const [configId] = await Promise.all([getIdOrThrow("spotConfig")]);

  return executeAsOracle((tx) => {
    tx.moveCall({
      target: MOVE("claim_payout"),
      arguments: [
        tx.object(configId),
        tx.object(input.marketId),
        tx.object(input.postId),
        tx.object(env.clockObjectId),
      ],
    });
  }, "claim_payout");
}

/**
 * `insurance::create_vault` — registers the demo underwriter and returns the new
 * vault id extracted from the `UnderwriterVaultCreatedEvent`.
 */
export async function createInsuranceVault(
  params: { baseRateBpsPerDay?: number; utilizationMultiplierBps?: number } = {},
): Promise<{ tx: ExecutedTx; vaultId: string | null }> {
  const tx = await executeAsOracle((tx) => {
    tx.moveCall({
      target: INSURE("create_vault"),
      arguments: [
        tx.pure.u64(params.baseRateBpsPerDay ?? 25),
        tx.pure.u64(params.utilizationMultiplierBps ?? 5000),
        tx.pure.u64(0),
        tx.pure.u64(0),
      ],
    });
  }, "insurance::create_vault");

  return { tx, vaultId: findCreatedObject(tx, "UnderwriterVault") };
}

/** `insurance::deposit_capital` — funds a vault so it can underwrite coverage. */
export async function depositVaultCapital(input: {
  vaultId: string;
  amountMist: number;
}): Promise<ExecutedTx> {
  const configId = await getIdOrThrow("insuranceConfig");
  return executeAsOracle((tx) => {
    tx.moveCall({
      target: INSURE("deposit_capital"),
      arguments: [
        tx.object(configId),
        tx.object(input.vaultId),
        tx.splitCoins(tx.gas, [input.amountMist]),
      ],
    });
  }, `insurance::deposit_capital(${input.amountMist})`);
}

/**
 * `insurance::buy_coverage` — the insured must already hold a position on the
 * covered option: the contract caps `covered_amount` at the caller's escrow on
 * that option (`spot::get_user_option_amount`).
 */
export async function buyCoverage(input: {
  marketId: string;
  optionId: number;
  coverageAmountMist: number;
  coverageBps?: number;
  durationMs?: number;
  premiumMist?: number;
  vaultId?: string;
}): Promise<{ tx: ExecutedTx; policyId: string | null }> {
  const [configId, routerId, backstopId, spotConfigId] = await Promise.all([
    getIdOrThrow("insuranceConfig"),
    getIdOrThrow("insuranceRouterConfig"),
    getIdOrThrow("insuranceBackstop"),
    getIdOrThrow("spotConfig"),
  ]);

  const vaultId = input.vaultId ?? (await currentVaultId());
  if (!vaultId) throw new ChainError("No underwriter vault exists yet — create and fund one first.");

  // `buy_coverage` compares the payment against an internally computed premium and
  // aborts with EInsufficientPremium on slippage, so quote first unless the caller
  // supplied an explicit amount.
  const premium =
    input.premiumMist ??
    (
      await quoteCoverage({
        marketId: input.marketId,
        optionId: input.optionId,
        coveredAmountMist: input.coverageAmountMist,
        coverageBps: input.coverageBps,
        durationMs: input.durationMs,
        vaultId: input.vaultId,
      })
    ).premiumMist;

  const tx = await executeAsOracle((tx) => {
    tx.moveCall({
      target: INSURE("buy_coverage"),
      arguments: [
        tx.object(configId),
        tx.object(routerId),
        tx.object(backstopId),
        tx.object(spotConfigId),
        tx.object(vaultId),
        tx.object(input.marketId),
        tx.pure.u8(input.optionId),
        tx.pure.u64(input.coverageAmountMist),
        tx.pure.u64(input.coverageBps ?? env.demo.coverageBps),
        tx.pure.u64(input.durationMs ?? env.demo.coverageDurationMs),
        tx.splitCoins(tx.gas, [premium]),
        tx.object(env.clockObjectId),
      ],
    });
  }, `insurance::buy_coverage(option=${input.optionId})`);

  return { tx, policyId: findCreatedObject(tx, "CoveragePolicy") };
}

/**
 * The demo underwriter's vault.
 *
 * `insurance::create_vault` shares the vault (`transfer::share_object`), so it is
 * a shared object rather than an owned one — locate it by its `underwriter` field.
 */
export async function currentVaultId(): Promise<string | null> {
  const owner = oracleAddress();
  if (!owner) return null;
  return findObjectByField("underwriterVault", "underwriter", owner);
}

/** Whether the demo profile/MemoryAccount already exist for the oracle address. */
export async function findMemoryAccountId(): Promise<string | null> {
  const owner = oracleAddress();
  if (!owner) return null;
  return findObjectByField("memoryAccount", "owner", owner);
}

/**
 * Pick the platform the demo operates on.
 *
 * `post::resolve_social_actor` asserts `platform::has_joined_platform`, and
 * `platform::join_platform` asserts the platform is approved in the registry —
 * so we prefer an approved platform from the indexer, falling back to the first
 * Platform object on chain.
 */
export async function resolvePlatformId(): Promise<string | null> {
  try {
    const approved = await social.approvedPlatforms(10);
    const first = approved[0]?.platform_id;
    if (first) return first;
  } catch {
    // Indexer may lag; fall through to the on-chain lookup.
  }
  return getIdOrThrow("platform");
}

/**
 * `platform::join_platform`. Idempotent from the caller's perspective: an
 * `EAlreadyJoined` (abort code 3) abort means we are already a member.
 */
export async function joinPlatform(
  platformId: string,
): Promise<{ joined: boolean; digest: string | null }> {
  const [platformRegistry, blockListRegistry] = await Promise.all([
    getIdOrThrow("platformRegistry"),
    getIdOrThrow("blockListRegistry"),
  ]);

  try {
    const tx = await executeAsOracle((tx) => {
      tx.moveCall({
        target: `${env.socialPackageId}::platform::join_platform`,
        arguments: [
          tx.object(platformRegistry),
          tx.object(blockListRegistry),
          tx.object(platformId),
          tx.object(env.clockObjectId),
        ],
      });
    }, "platform::join_platform");
    return { joined: true, digest: tx.digest };
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (/ealreadyjoined|abort code:?\s*3\b|error code 3\b/i.test(message)) {
      return { joined: false, digest: null };
    }
    throw error;
  }
}

export interface SeedPostResult {
  tx: ExecutedTx;
  postId: string | null;
  profileId: string | null;
  memoryAccountId: string | null;
  createdProfile: boolean;
}

/**
 * Create the demo post that the fake oracle will later approve.
 *
 * Mirrors `scripts/spot-oracle-runnable.sh`: if the admin has no profile yet,
 * first `profile::create_profile` (which also creates the shared MemoryAccount),
 * then `post::create_public_post` with SPoT always-on.
 */
export async function seedDemoPost(input: {
  claimText?: string;
  displayName?: string;
  username?: string;
}): Promise<SeedPostResult> {
  const claimText = (input.claimText ?? env.demo.claimText).trim();
  let createdProfile = false;
  let profileId: string | null = null;
  let memoryAccountId = await findMemoryAccountId();

  if (!memoryAccountId) {
    const [usernameRegistry, profileConfig, memoryRegistry, aiCreditConfig] = await Promise.all([
      getIdOrThrow("usernameRegistry"),
      getIdOrThrow("profileConfig"),
      getIdOrThrow("memoryRegistry"),
      getIdOrThrow("aiCreditConfig"),
    ]);

    const username = input.username ?? "spotdemo";
    const displayName = input.displayName ?? "SPoT Demo Operator";

    const profileTx = await executeAsOracle((tx) => {
      tx.moveCall({
        target: PROFILE("create_profile"),
        arguments: [
          tx.object(usernameRegistry),
          tx.object(profileConfig),
          tx.object(memoryRegistry),
          tx.object(aiCreditConfig),
          tx.pure.string(displayName),
          tx.pure.string(username),
          tx.pure.string("Simulated SPoT oracle operator for the insurance demo."),
          tx.pure.vector("u8", []),
          tx.pure.vector("u8", []),
          tx.object(env.clockObjectId),
        ],
      });
    }, "profile::create_profile");

    const owner = oracleAddress() ?? "";
    createdProfile = true;
    profileId = (await ownedObjectsOfType(owner, moveTypes.profile))[0]?.address ?? null;
    memoryAccountId = await findMemoryAccountId();
    void profileTx;

    if (!memoryAccountId) {
      throw new ChainError(
        "Profile was created but no MemoryAccount could be located; cannot create a post.",
      );
    }
  }

  const [
    usernameRegistry,
    platformRegistry,
    blockListRegistry,
    postConfig,
    memoryConfig,
    mydataRegistry,
  ] = await Promise.all([
    getIdOrThrow("usernameRegistry"),
    getIdOrThrow("platformRegistry"),
    getIdOrThrow("blockListRegistry"),
    getIdOrThrow("postConfig"),
    getIdOrThrow("memoryConfig"),
    getIdOrThrow("mydataRegistry"),
  ]);

  // `post::resolve_social_actor` requires membership of an *approved* platform.
  const platform = await resolvePlatformId();
  if (!platform) throw new ChainError("No platform found to post into.");
  await joinPlatform(platform);

  const tx = await executeAsOracle((tx) => {
    tx.moveCall({
      target: POST("create_public_post"),
      arguments: [
        tx.object(usernameRegistry),
        tx.object(platformRegistry),
        tx.object(platform),
        tx.object(blockListRegistry),
        tx.object(postConfig),
        tx.object(memoryConfig),
        tx.pure.string(claimText),
        tx.pure.vector("id", []),
        // media_urls, mentions, metadata_json, allow_comments, allow_reactions,
        // allow_reposts, allow_quotes, allow_tips
        tx.pure.option("vector<string>", null),
        tx.pure.option("vector<address>", null),
        tx.pure.option("string", null),
        tx.pure.option("bool", null),
        tx.pure.option("bool", null),
        tx.pure.option("bool", null),
        tx.pure.option("bool", null),
        tx.pure.option("bool", null),
        // enable_spt, enable_spot — SPT needs a dedicated create path
        // (`ESptRequiresDedicatedCreate`), SPoT is the always-on truth layer.
        tx.pure.option("bool", false),
        tx.pure.option("bool", true),
        tx.object(mydataRegistry),
        tx.object(memoryAccountId),
        tx.object(env.clockObjectId),
      ],
    });
  }, "post::create_public_post");

  // `PostCreatedEvent.post_id` is not the Post object itself (it is the
  // attribution dynamic field), so resolve the created `post::Post` by type.
  const postId = findCreatedObject(tx, "Post");

  return { tx, postId, profileId, memoryAccountId, createdProfile };
}

export { moveTypes };

// ---------------------------------------------------------------------------
// Coverage quoting
//
// `insurance::buy_coverage` enforces slippage guards (EInsufficientPremium,
// ESlippageCovered) against an internally computed quote, so guessing the premium
// is not workable. `insurance::quote_vault_for_spot_coverage` is a `public fun`
// returning a `VaultCoverageQuote`, which lets us dev-inspect the exact numbers
// before building the real transaction.
// ---------------------------------------------------------------------------

export interface CoverageQuote {
  premiumMist: string;
  premiumRawMist: string;
  reserveRequiredMist: string;
  availableCapacityReserveMist: string;
  riskMultiplierBps: number;
  impliedProbWinBps: number;
  utilizationBps: number;
  maxFillCoveredAmountMist: string;
  /** 0 = quotable; see SKIPPED_* in insurance.move. */
  skippedReason: number;
  skippedReasonLabel: string;
}

const SKIPPED_REASONS: Record<number, string> = {
  0: "ok",
  1: "vault disabled",
  2: "vault paused",
  3: "router paused",
  4: "market paused",
  5: "unhealthy vault",
  6: "risk multiplier too high",
  7: "zero capacity",
  8: "market too thin",
};

/** Decode `VaultCoverageQuote` (8 × u64 then u8, fixed-size BCS). */
function decodeVaultCoverageQuote(bytes: Uint8Array): CoverageQuote {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const read = (index: number) => view.getBigUint64(index * 8, true);
  const skippedReason = bytes.length > 64 ? bytes[64]! : 0;
  return {
    premiumMist: read(0).toString(),
    premiumRawMist: read(1).toString(),
    reserveRequiredMist: read(2).toString(),
    availableCapacityReserveMist: read(3).toString(),
    riskMultiplierBps: Number(read(4)),
    impliedProbWinBps: Number(read(5)),
    utilizationBps: Number(read(6)),
    maxFillCoveredAmountMist: read(7).toString(),
    skippedReason,
    skippedReasonLabel: SKIPPED_REASONS[skippedReason] ?? `unknown (${skippedReason})`,
  };
}

export async function quoteCoverage(input: {
  marketId: string;
  optionId: number;
  coveredAmountMist: number;
  coverageBps?: number;
  durationMs?: number;
  vaultId?: string;
}): Promise<CoverageQuote> {
  const [configId, routerId, spotConfigId] = await Promise.all([
    getIdOrThrow("insuranceConfig"),
    getIdOrThrow("insuranceRouterConfig"),
    getIdOrThrow("spotConfig"),
  ]);
  const vaultId = input.vaultId ?? (await currentVaultId());
  if (!vaultId) throw new ChainError("No underwriter vault exists yet — create and fund one first.");

  // `insured` is the account that will buy; the quote depends on its position.
  const insured = oracleAddress();
  if (!insured) throw new ChainError("Simulated oracle key unavailable.");

  const tx = new Transaction();
  tx.moveCall({
    target: INSURE("quote_vault_for_spot_coverage"),
    arguments: [
      tx.object(configId),
      tx.object(routerId),
      tx.object(vaultId),
      tx.object(input.marketId),
      tx.pure.address(insured),
      tx.pure.u8(input.optionId),
      tx.pure.u64(input.coveredAmountMist),
      tx.pure.u64(input.coverageBps ?? env.demo.coverageBps),
      tx.pure.u64(input.durationMs ?? env.demo.coverageDurationMs),
    ],
  });
  tx.setSenderIfNotSet(insured);

  const txClient = freshClient();
  const bytes = await tx.build({ client: txClient });
  const sim = await txClient.core.simulateTransaction({
    transaction: bytes,
    include: { commandResults: true },
  });

  const returnValue = sim.commandResults?.[0]?.returnValues?.[0]?.bcs;
  if (!returnValue) {
    throw new ChainError(
      `Quote simulation returned no value: ${JSON.stringify(sim).slice(0, 400)}`,
    );
  }
  return decodeVaultCoverageQuote(returnValue as Uint8Array);
}
