// Copyright (c) The Social Proof Foundation, LLC.
// SPDX-License-Identifier: Apache-2.0
//
// Market aggregation.
//
// Enumeration comes from the chain GraphQL (objects of type SpotMarket) because
// myso-social-server has no "list all spot markets" route. Everything else —
// per-option escrow, bets, payouts, refunds and insurance policies — is
// enrichment from the social indexer REST API, which we treat as read-only.

import { env } from "./env.js";
import { getObjectJson, listObjectsByType } from "./gql.js";
import { moveTypes } from "./ids.js";
import {
  social,
  type InsurancePolicyRow,
  type SpotBetRow,
  type SpotRecordResponse,
  type SpotTransferRow,
} from "./social.js";

/** SPoT market lifecycle status — mirrors `STATUS_*` in social_proof_of_truth.move. */
export const SpotStatus = { OPEN: 1, DAO_REQUIRED: 2, RESOLVED: 3, REFUNDABLE: 4 } as const;
export const OUTCOME_DRAW = 255;
export const OUTCOME_UNAPPLICABLE = 254;

/** Insurance policy status — mirrors `STATUS_*` in insurance.move. */
export const PolicyStatus = { ACTIVE: 1, CANCELLED: 2, CLAIMED: 3, EXPIRED: 4 } as const;

export function statusLabel(status: number): string {
  switch (status) {
    case SpotStatus.OPEN:
      return "Open";
    case SpotStatus.DAO_REQUIRED:
      return "DAO Required";
    case SpotStatus.RESOLVED:
      return "Resolved";
    case SpotStatus.REFUNDABLE:
      return "Refundable";
    default:
      return `Unknown (${status})`;
  }
}

export function policyStatusLabel(status: number): string {
  switch (status) {
    case PolicyStatus.ACTIVE:
      return "Active";
    case PolicyStatus.CANCELLED:
      return "Cancelled";
    case PolicyStatus.CLAIMED:
      return "Claimed";
    case PolicyStatus.EXPIRED:
      return "Expired";
    default:
      return `Unknown (${status})`;
  }
}

export function outcomeLabel(outcome: number | null, options: string[]): string {
  if (outcome === null || outcome === undefined) return "—";
  if (outcome === OUTCOME_DRAW) return "Draw";
  if (outcome === OUTCOME_UNAPPLICABLE) return "Unapplicable";
  return options[outcome] ?? `Option ${outcome}`;
}

/** Move u64 fields arrive as decimal strings over GraphQL; normalize defensively. */
function toMist(value: unknown): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (typeof value === "string") {
    const clean = value.trim();
    if (clean === "") return 0n;
    try {
      return BigInt(clean);
    } catch {
      return 0n;
    }
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    // Move `Balance<MYSO>` serializes as `{ value: "123" }`.
    if ("value" in record) return toMist(record.value);
  }
  return 0n;
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toOption<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  // GraphQL renders `Option<T>` as either the bare value or `{ vec: [value] }`.
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.vec)) return (record.vec[0] as T) ?? null;
  }
  return value as T;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  return [];
}

export interface MarketInsuranceSummary {
  policyCount: number;
  activeCount: number;
  claimedCount: number;
  /** Sum of `covered_amount` across all policies, in mist. */
  coveredMist: string;
  /** Sum of `premium_paid` across all policies, in mist. */
  premiumMist: string;
  /** Sum reserved by the insurer for this market (underwriting exposure), in mist. */
  exposureMist: string;
}

export interface MarketRow {
  marketId: string;
  claimId: string;
  postId: string;
  primaryCreator: string | null;
  status: number;
  statusLabel: string;
  outcome: number | null;
  outcomeLabel: string;
  bettingOptions: string[];
  /** option index (string key) -> amount in mist. */
  optionEscrow: Record<string, string>;
  /** Where `optionEscrow` came from: the indexer projection or the chain bet vector. */
  optionEscrowSource: "indexer" | "chain" | "none";
  totalEscrowMist: string;
  totalBets: number;
  createdAtMs: number;
  resolutionAtMs: number;
  /** When the oracle actually settled it (0/null while still open). */
  lastResolutionAtMs: number | null;
  maxResolutionWindowMs: string | null;
  isOpen: boolean;
  /** Short preview of the claim/post the market settles. */
  claimText: string | null;
  postOwner: string | null;
  semanticClaimHash: string | null;
  insurance: MarketInsuranceSummary;
  /** True when the indexer has not caught up with the chain yet. */
  indexed: boolean;
}

export interface MarketDetail extends MarketRow {
  marketObject: Record<string, unknown> | null;
  claimObject: Record<string, unknown> | null;
  postObject: Record<string, unknown> | null;
  indexerRecord: SpotRecordResponse | null;
  bets: SpotBetRow[];
  payouts: SpotTransferRow[];
  refunds: SpotTransferRow[];
  policies: InsurancePolicyRow[];
}


/**
 * Derive per-option totals from the market's own `bets: vector<SpotBet>`.
 *
 * The `option_escrow` Table's contents are not serialized into the object JSON, and
 * the social indexer's `spot_markets` projection may lag, so the chain's bet vector
 * is the most reliable source available without extra round-trips.
 */
function optionTotalsFromBets(market: Record<string, unknown>): Record<string, string> {
  const raw = market.bets;
  if (!Array.isArray(raw)) return {};
  const totals = new Map<string, bigint>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const bet = entry as Record<string, unknown>;
    const option = String(bet.option_id ?? "0");
    totals.set(option, (totals.get(option) ?? 0n) + toMist(bet.amount));
  }
  return Object.fromEntries([...totals].map(([key, value]) => [key, value.toString()]));
}

/** Prefer the indexer's projection; fall back to the chain bet vector. */
function resolveOptionEscrow(
  indexed: Record<string, string>,
  market: Record<string, unknown>,
): { optionEscrow: Record<string, string>; source: "indexer" | "chain" | "none" } {
  if (Object.keys(indexed).length > 0) return { optionEscrow: indexed, source: "indexer" };
  const derived = optionTotalsFromBets(market);
  if (Object.keys(derived).length > 0) return { optionEscrow: derived, source: "chain" };
  return { optionEscrow: {}, source: "none" };
}

function aggregatePolicies(policies: InsurancePolicyRow[]): MarketInsuranceSummary {
  let covered = 0n;
  let premium = 0n;
  let active = 0;
  let claimed = 0;
  for (const policy of policies) {
    covered += toMist(policy.covered_amount);
    premium += toMist(policy.premium_paid ?? policy.premium_raw);
    if (policy.status === PolicyStatus.ACTIVE) active += 1;
    if (policy.status === PolicyStatus.CLAIMED) claimed += 1;
  }
  return {
    policyCount: policies.length,
    activeCount: active,
    claimedCount: claimed,
    coveredMist: covered.toString(),
    premiumMist: premium.toString(),
    exposureMist: "0",
  };
}

/** Read the post's text content from its Move object (the indexer only lists pending posts). */
function postContent(postJson: Record<string, unknown> | null): string | null {
  if (!postJson) return null;
  const content = postJson.content;
  return typeof content === "string" && content.trim() !== "" ? content : null;
}

function hashToHex(value: unknown): string | null {
  if (Array.isArray(value)) {
    return `0x${value.map((byte) => Number(byte).toString(16).padStart(2, "0")).join("")}`;
  }
  if (typeof value === "string" && value !== "") return value;
  return null;
}

interface RawMarket {
  market: Record<string, unknown>;
  marketId: string;
  claimId: string;
  postId: string;
  status: number;
  outcome: number | null;
  options: string[];
  escrowMist: bigint;
  createdAtMs: number;
  resolutionAtMs: number;
}

async function loadRawMarkets(): Promise<RawMarket[]> {
  // GraphQL `objects` returns the newest-first cursor stream; enumerate everything.
  const nodes = await listObjectsByType(moveTypes.spotMarket, { pageSize: 50, maxPages: 40 });
  const markets: RawMarket[] = [];

  for (const node of nodes) {
    const json = node.json;
    if (!json) continue;
    const options = toStringArray(json.betting_options);
    markets.push({
      market: json,
      marketId: node.address,
      claimId: String(json.claim_id ?? ""),
      postId: String(json.primary_post_id ?? ""),
      status: toNumber(json.status, 0),
      outcome: toOption<number>(json.outcome),
      options,
      escrowMist: toMist(json.escrow),
      createdAtMs: toNumber(json.created_at_ms),
      resolutionAtMs: toNumber(json.resolution_at_ms),
    });
  }

  markets.sort((a, b) => b.createdAtMs - a.createdAtMs);
  return markets;
}

/** Run async work over a list with bounded concurrency (keeps GraphQL traffic civil). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Build list rows for every market on chain, enriched with indexer + insurance data. */
export async function loadMarketRows(): Promise<MarketRow[]> {
  const raw = await loadRawMarkets();
  if (raw.length === 0) return [];

  // The list view shows each market's claim text; that lives on the Post object,
  // which the social indexer only exposes for *pending* posts, so read it from
  // the chain GraphQL instead (bounded to keep the row build fast).
  const postContents = new Map<string, string>();
  await mapLimit(raw.slice(0, 40), 6, async (entry) => {
    if (!entry.postId) return;
    try {
      const node = await getObjectJson(entry.postId);
      const content = node?.json?.content;
      if (typeof content === "string" && content.trim() !== "") {
        postContents.set(entry.postId.toLowerCase(), content.trim());
      }
    } catch {
      // Post not readable yet — the row falls back to the market id.
    }
  });

  // All insurance policies in one call, grouped client-side by market id.
  let policiesByMarket = new Map<string, InsurancePolicyRow[]>();
  try {
    const policies = await social.insurancePolicies({ limit: 100 });
    for (const policy of policies) {
      const bucket = policiesByMarket.get(policy.market_id) ?? [];
      bucket.push(policy);
      policiesByMarket.set(policy.market_id, bucket);
    }
  } catch {
    policiesByMarket = new Map();
  }

  const rows = await Promise.all(
    raw.map(async (entry): Promise<MarketRow> => {
      // Indexer records are keyed by post id and carry the authoritative per-option escrow.
      let record: SpotRecordResponse | null = null;
      if (entry.postId) {
        record = await social.spotRecordForPost(entry.postId).catch(() => null);
      }

      const indexedEscrow: Record<string, string> = {};
      if (record?.option_escrow) {
        for (const [key, value] of Object.entries(record.option_escrow)) {
          indexedEscrow[key] = String(value);
        }
      }
      const { optionEscrow, source: optionEscrowSource } = resolveOptionEscrow(
        indexedEscrow,
        entry.market,
      );

      const options = record?.betting_options?.length ? record.betting_options : entry.options;
      const status = record?.status ?? entry.status;
      const outcome = record?.outcome ?? entry.outcome;

      const totalEscrow = Object.values(optionEscrow).reduce(
        (sum, value) => sum + toMist(value),
        0n,
      );

      const policies = policiesByMarket.get(entry.marketId) ?? [];

      return {
        marketId: entry.marketId,
        claimId: entry.claimId,
        postId: entry.postId,
        primaryCreator: (entry.market.primary_creator as string | undefined) ?? null,
        status,
        statusLabel: statusLabel(status),
        outcome,
        outcomeLabel: outcomeLabel(outcome, options),
        bettingOptions: options,
        optionEscrow,
        optionEscrowSource,
        totalEscrowMist: (totalEscrow > 0n ? totalEscrow : entry.escrowMist).toString(),
        totalBets: Array.isArray(entry.market.bets) ? entry.market.bets.length : 0,
        createdAtMs: entry.createdAtMs,
        resolutionAtMs: record?.resolution_window_ms
          ? entry.createdAtMs + record.resolution_window_ms
          : entry.resolutionAtMs,
        lastResolutionAtMs:
          (record?.last_resolution_at_ms ?? toNumber(entry.market.last_resolution_at_ms, 0)) || null,
        maxResolutionWindowMs: toOption<number>(entry.market.max_resolution_window_ms)?.toString() ?? null,
        isOpen: status === SpotStatus.OPEN,
        claimText: postContents.get(entry.postId.toLowerCase()) ?? null,
        postOwner: null,
        semanticClaimHash: null,
        insurance: aggregatePolicies(policies),
        indexed: record !== null,
      };
    }),
  );

  return rows;
}

/** Full detail for the click-through dialog. */
export async function loadMarketDetail(marketId: string): Promise<MarketDetail | null> {
  const nodes = await listObjectsByType(moveTypes.spotMarket, { pageSize: 50, maxPages: 40 });
  const node = nodes.find((entry) => entry.address.toLowerCase() === marketId.toLowerCase());
  if (!node?.json) return null;

  const market = node.json;
  const claimId = String(market.claim_id ?? "");
  const postId = String(market.primary_post_id ?? "");
  const options = toStringArray(market.betting_options);

  const [claimNode, postNode, record, policies] = await Promise.all([
    claimId ? getObjectJson(claimId).catch(() => null) : Promise.resolve(null),
    postId ? getObjectJson(postId).catch(() => null) : Promise.resolve(null),
    postId ? social.spotRecordForPost(postId).catch(() => null) : Promise.resolve(null),
    social.insuranceMarketPolicies(marketId).catch(() => [] as InsurancePolicyRow[]),
  ]);

  const [bets, payouts, refunds] = await Promise.all([
    postId ? social.spotBetsForPost(postId).catch(() => [] as SpotBetRow[]) : Promise.resolve([]),
    postId
      ? social.spotPayoutsForPost(postId).catch(() => [] as SpotTransferRow[])
      : Promise.resolve([]),
    postId
      ? social.spotRefundsForPost(postId).catch(() => [] as SpotTransferRow[])
      : Promise.resolve([]),
  ]);

  const indexedEscrow: Record<string, string> = {};
  for (const [key, value] of Object.entries(record?.option_escrow ?? {})) {
    indexedEscrow[key] = String(value);
  }
  const { optionEscrow, source: optionEscrowSource } = resolveOptionEscrow(indexedEscrow, market);
  const totalEscrow = Object.values(optionEscrow).reduce((sum, value) => sum + toMist(value), 0n);
  const status = record?.status ?? toNumber(market.status, 0);
  const outcome = record?.outcome ?? toOption<number>(market.outcome);

  return {
    marketId,
    claimId,
    postId,
    primaryCreator: (market.primary_creator as string | undefined) ?? null,
    status,
    statusLabel: statusLabel(status),
    outcome,
    outcomeLabel: outcomeLabel(outcome, options),
    bettingOptions: options,
    optionEscrow,
    optionEscrowSource,
    totalEscrowMist: (totalEscrow > 0n ? totalEscrow : toMist(market.escrow)).toString(),
    totalBets: bets.length,
    createdAtMs: toNumber(market.created_at_ms),
    resolutionAtMs: toNumber(market.resolution_at_ms),
    lastResolutionAtMs: toNumber(market.last_resolution_at_ms, 0) || null,
    maxResolutionWindowMs: toOption<number>(market.max_resolution_window_ms)?.toString() ?? null,
    isOpen: status === SpotStatus.OPEN,
    claimText: postContent(postNode?.json ?? null),
    postOwner: (postNode?.json?.owner as string | undefined) ?? null,
    semanticClaimHash: hashToHex(claimNode?.json?.semantic_claim_hash),
    insurance: aggregatePolicies(policies),
    indexed: record !== null,
    marketObject: market,
    claimObject: claimNode?.json ?? null,
    postObject: postNode?.json ?? null,
    indexerRecord: record,
    bets,
    payouts,
    refunds,
    policies,
  };
}

/** Sum insurance exposure per market across all vaults (best-effort). */
export async function loadMarketExposure(): Promise<Map<string, string>> {
  const exposure = new Map<string, bigint>();
  try {
    const vaults = await social.insuranceVaults(100);
    for (const vault of vaults) {
      const rows = await social.insuranceVaultExposures(vault.vault_id).catch(() => []);
      for (const row of rows) {
        exposure.set(row.market_id, (exposure.get(row.market_id) ?? 0n) + toMist(row.total_exposure));
      }
    }
  } catch {
    // Insurance endpoints may 404 before the config is bootstrapped.
  }
  return new Map([...exposure].map(([key, value]) => [key, value.toString()]));
}

export const demoConfig = env.demo;
