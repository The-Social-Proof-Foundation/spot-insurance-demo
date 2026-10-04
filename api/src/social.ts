// Copyright (c) The Social Proof Foundation, LLC.
// SPDX-License-Identifier: Apache-2.0
//
// Read-only client for myso-social-server (the social indexer REST API).
//
// NOTE: this server has NO "list all spot markets" route — `spot_markets` is only
// read for a single post inside GET /spot/route/:post_id. Market enumeration is
// therefore done against the chain GraphQL (see gql.ts); this client supplies the
// indexed enrichment: per-post escrow, bets, payouts, refunds and insurance.
//
// Error bodies from this server are PLAIN TEXT, not JSON.

import { env } from "./env.js";

export class SocialApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    path: string,
  ) {
    super(`social server ${status} on ${path}: ${body}`);
    this.name = "SocialApiError";
  }
}

export interface SpotRecordResponse {
  post_id: string;
  /** 1=OPEN 2=DAO_REQUIRED 3=RESOLVED 4=REFUNDABLE */
  status: number;
  /** winning option index; 254=UNAPPLICABLE, 255=DRAW */
  outcome: number | null;
  betting_options: string[];
  /** option index (as a string key) -> total escrow in mist */
  option_escrow: Record<string, number>;
  resolution_window_ms: number | null;
  max_resolution_window_ms: number | null;
  created_at_ms: number;
  last_resolution_at_ms: number | null;
  record_object_id: string | null;
  active_proposal_id: string | null;
  oracle_proposed_outcome: number | null;
  proposed_outcome: number | null;
  dao_escalated_at_ms: number | null;
}

export interface PendingSpotPostRow {
  post_id: string;
  owner: string;
  content: string;
  created_at: number;
  post_type: string | null;
}

export interface SpotBetRow {
  post_id: string;
  user_address: string;
  option_id: number;
  escrow_amount: number;
  amm_amount: number;
  timestamp_ms: number;
}

export interface SpotTransferRow {
  user_address: string;
  amount: number;
  timestamp_ms: number;
}

export interface SpotRouteResponse {
  post_id: string;
  claim_object_id: string | null;
  target_market_id: string | null;
  link_kind: string | null;
  routing_reason: "open_market" | "claim_without_open_market" | "pending" | "no_actionable" | string;
}

export interface SpotConfigInfo {
  updated_by: string;
  truth_enabled: boolean;
  confidence_threshold_bps: number;
  resolution_window_ms: number;
  max_resolution_window_ms: number;
  payout_delay_ms: number;
  platform_fee_bps: number;
  ecosystem_fee_bps: number;
  creator_fee_bps: number;
  creator_claim_window_ms: number;
  expired_creator_ecosystem_bps: number;
  min_betting_options: number;
  max_betting_options: number;
  min_reasoning_length: number;
  max_reasoning_length: number;
  max_evidence_urls: number;
  oracle_address: string;
  max_single_bet: number;
  max_bets_per_record: number;
  max_claim_per_post: number;
  spot_governance_registry_id: string | null;
  version: number;
  updated_at: number;
  time: string;
  transaction_id: string;
}

export interface InsuranceConfigInfo {
  updated_by: string;
  insurance_enabled: boolean;
  min_coverage_bps: number;
  max_coverage_bps: number;
  max_duration_ms: number;
  fee_bps: number;
  version: number;
  updated_at: number;
  time: string;
  transaction_id: string;
  min_spot_total_liquidity: number;
  max_coverage_fraction_of_option_bps: number;
  max_risk_multiplier_bps: number;
  min_premium_amount: number;
  spot_smoothing_per_option: number;
  implied_prob_floor_bps: number;
  odds_floor_1x: boolean;
  odds_cap_bps: number;
  liq_cap_bps: number;
  liq_ref_amount: number;
  exposure_cap_bps: number;
  exposure_k_bps: number;
  odds_base_bps: number;
}

export interface InsuranceRouterConfigInfo {
  updated_by: string;
  paused: boolean;
  max_route_reserve_market: number;
  max_route_reserve_user: number;
  max_route_reserve_option: number;
  max_vault_concentration_bps: number;
  min_vault_health_factor_bps: number;
  max_route_legs: number;
  version: number;
  updated_at: number;
  time: string;
  transaction_id: string;
}

export type InsuranceConfigurationResponse = InsuranceConfigInfo & {
  router: InsuranceRouterConfigInfo | null;
};

export interface InsuranceVault {
  vault_id: string;
  underwriter: string;
  capital_balance: number;
  reserved: number;
  base_rate_bps_per_day: number;
  utilization_multiplier_bps: number;
  max_exposure_per_market: number;
  max_exposure_per_user: number;
  max_exposure_per_option: number;
  enabled: boolean;
  paused: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  transaction_id: string;
}

export interface InsuranceVaultExposureRow {
  market_id: string;
  option_id: number;
  total_exposure: number;
}

/** List-shaped policy (omits start/expiry/vault_id — those need the single fetch). */
export interface InsurancePolicyRow {
  policy_id: string;
  market_id: string;
  insured: string;
  option_id: number;
  covered_amount: number;
  coverage_bps: number;
  premium_paid: number;
  premium_raw: number;
  implied_probability_bps: number;
  risk_multiplier_bps: number;
  base_premium: number;
  market_total_amount: number;
  option_escrow_amount: number;
  /** 1=ACTIVE 2=CANCELLED 3=CLAIMED 4=EXPIRED */
  status: number;
  route_id: string | null;
  route_leg_index: number | null;
  backstop_sweep_amount: number;
}

export interface InsurancePolicyInfo extends InsurancePolicyRow {
  start_time_ms: number;
  expiry_time_ms: number;
  vault_id: string;
}

const BASE = env.socialApiUrl.replace(/\/$/, "");

async function request<T>(
  path: string,
  init: { query?: Record<string, string | number | undefined>; secret?: boolean } = {},
): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = { accept: "application/json" };
  // Only /spot/pending-posts is gated, and only when the server has the secret set.
  if (init.secret && env.socialSyncSecret) {
    headers["x-spot-oracle-sync-secret"] = env.socialSyncSecret;
  }

  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  } catch (cause) {
    throw new SocialApiError(0, (cause as Error).message, path);
  }

  const text = await response.text();
  if (!response.ok) throw new SocialApiError(response.status, text.trim(), path);
  if (text.trim() === "") return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SocialApiError(response.status, `unparseable body: ${text.slice(0, 200)}`, path);
  }
}

/** Returns null instead of throwing on 404 (record simply not indexed yet). */
async function requestOptional<T>(path: string, init: Parameters<typeof request>[1] = {}) {
  try {
    return await request<T>(path, init);
  } catch (error) {
    if (error instanceof SocialApiError && error.status === 404) return null;
    throw error;
  }
}

export interface ApprovedPlatformRow {
  platform_id: string;
  name?: string;
  tagline?: string;
  logo?: string | null;
  [key: string]: unknown;
}

export const social = {
  health: () => request<{ status: string; message: string; timestamp: string }>("/health"),

  /** Platforms approved in the on-chain registry — the only ones a user may join. */
  approvedPlatforms: (limit = 25) =>
    request<ApprovedPlatformRow[]>("/platforms/approved", { query: { limit } }),

  spotConfig: () => requestOptional<SpotConfigInfo>("/spot/configuration"),
  spotRecordForPost: (postId: string) =>
    requestOptional<SpotRecordResponse>(`/spot/records/${encodeURIComponent(postId)}`),
  spotRouteForPost: (postId: string) =>
    requestOptional<SpotRouteResponse>(`/spot/route/${encodeURIComponent(postId)}`),
  spotBetsForPost: (postId: string, limit = 100) =>
    request<SpotBetRow[]>(`/spot/records/${encodeURIComponent(postId)}/bets`, {
      query: { limit },
    }),
  spotPayoutsForPost: (postId: string, limit = 100) =>
    request<SpotTransferRow[]>(`/spot/records/${encodeURIComponent(postId)}/payouts`, {
      query: { limit },
    }),
  spotRefundsForPost: (postId: string, limit = 100) =>
    request<SpotTransferRow[]>(`/spot/records/${encodeURIComponent(postId)}/refunds`, {
      query: { limit },
    }),
  contestedRecords: (limit = 100) =>
    request<SpotRecordResponse[]>("/spot/contested-records", { query: { limit } }),
  /** Oracle-gated (only when SPOT_ORACLE_SYNC_SECRET is set on the server). */
  pendingPosts: (limit = 100, cursor?: number) =>
    request<PendingSpotPostRow[]>("/spot/pending-posts", {
      query: { limit, cursor },
      secret: true,
    }),
  creatorStats: (address: string) =>
    requestOptional<{
      creator: string;
      lifetime_earnings: number;
      earnings_last_30d: number;
      pending_earnings: number;
    }>(`/spot/creators/${encodeURIComponent(address)}/stats`),

  insuranceConfig: () => requestOptional<InsuranceConfigurationResponse>("/insurance/configuration"),
  insuranceVaults: (limit = 100) =>
    request<InsuranceVault[]>("/insurance/vaults", { query: { limit } }),
  insuranceVault: (vaultId: string) =>
    requestOptional<InsuranceVault>(`/insurance/vaults/${encodeURIComponent(vaultId)}`),
  insuranceVaultExposures: (vaultId: string) =>
    request<InsuranceVaultExposureRow[]>(
      `/insurance/vaults/${encodeURIComponent(vaultId)}/exposures`,
    ),
  insurancePolicies: (
    filters: { insured?: string; market_id?: string; vault_id?: string; status?: number; limit?: number } = {},
  ) =>
    request<InsurancePolicyRow[]>("/insurance/policies", {
      query: {
        insured: filters.insured,
        market_id: filters.market_id,
        vault_id: filters.vault_id,
        status: filters.status,
        limit: filters.limit ?? 100,
      },
    }),
  insurancePolicy: (policyId: string) =>
    requestOptional<InsurancePolicyInfo>(`/insurance/policies/${encodeURIComponent(policyId)}`),
  insuranceMarketPolicies: (marketId: string, limit = 100) =>
    request<InsurancePolicyRow[]>(`/insurance/markets/${encodeURIComponent(marketId)}/policies`, {
      query: { limit },
    }),
};

export type SocialApi = typeof social;
