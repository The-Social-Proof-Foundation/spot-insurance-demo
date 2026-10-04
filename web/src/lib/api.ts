/**
 * Typed client for the demo backend (api/).
 *
 * The backend owns the simulated oracle key and talks to the chain GraphQL
 * (127.0.0.1:9125) and the social indexer REST API (127.0.0.1:9126); this module
 * only ever talks to the backend.
 */

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || "";

export class ApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
        response = await fetch(`${BASE}${path}`, {
            ...init,
            headers: { accept: "application/json", ...(init?.headers ?? {}) },
        });
    } catch (cause) {
        throw new ApiError(
            `Cannot reach the demo API at ${BASE || window.location.origin}. Is it running (pnpm dev:api)?`,
            0,
        );
    }

    const text = await response.text();
    let payload: unknown = null;
    if (text.trim() !== "") {
        try {
            payload = JSON.parse(text);
        } catch {
            payload = text;
        }
    }

    if (!response.ok) {
        const message =
            payload && typeof payload === "object" && "error" in payload
                ? String((payload as { error: unknown }).error)
                : typeof payload === "string"
                  ? payload
                  : `Request failed with ${response.status}`;
        throw new ApiError(message, response.status);
    }

    return payload as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

// ---- Shared types (mirror api/src/markets.ts + api/src/social.ts) ----------

export interface MarketInsuranceSummary {
    policyCount: number;
    activeCount: number;
    claimedCount: number;
    coveredMist: string;
    premiumMist: string;
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
    optionEscrow: Record<string, string>;
    optionEscrowSource: "indexer" | "chain" | "none";
    totalEscrowMist: string;
    totalBets: number;
    createdAtMs: number;
    resolutionAtMs: number;
    lastResolutionAtMs: number | null;
    maxResolutionWindowMs: string | null;
    isOpen: boolean;
    claimText: string | null;
    postOwner: string | null;
    semanticClaimHash: string | null;
    insurance: MarketInsuranceSummary;
    indexed: boolean;
}

export interface InsurancePolicy {
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
    status: number;
    route_id: string | null;
    route_leg_index: number | null;
    backstop_sweep_amount: number;
    start_time_ms?: number;
    expiry_time_ms?: number;
    vault_id?: string;
}

export interface SpotBet {
    post_id: string;
    user_address: string;
    option_id: number;
    escrow_amount: number;
    amm_amount: number;
    timestamp_ms: number;
}

export interface SpotTransfer {
    user_address: string;
    amount: number;
    timestamp_ms: number;
}

export interface IndexerRecord {
    post_id: string;
    status: number;
    outcome: number | null;
    betting_options: string[];
    option_escrow: Record<string, number>;
    resolved_at_ms?: number | null;
    last_resolution_at_ms: number | null;
    created_at_ms: number;
    oracle_proposed_outcome: number | null;
    proposed_outcome: number | null;
    dao_escalated_at_ms: number | null;
}

export interface MarketDetail extends MarketRow {
    marketObject: Record<string, unknown> | null;
    claimObject: Record<string, unknown> | null;
    postObject: Record<string, unknown> | null;
    indexerRecord: IndexerRecord | null;
    bets: SpotBet[];
    payouts: SpotTransfer[];
    refunds: SpotTransfer[];
    policies: InsurancePolicy[];
}

export interface InsuranceConfig {
    insurance_enabled: boolean;
    min_coverage_bps: number;
    max_coverage_bps: number;
    max_duration_ms: number;
    fee_bps: number;
    min_spot_total_liquidity: number;
    max_coverage_fraction_of_option_bps: number;
    max_risk_multiplier_bps: number;
    min_premium_amount: number;
    implied_prob_floor_bps: number;
    odds_cap_bps: number;
    exposure_cap_bps: number;
    odds_base_bps: number;
    router: { paused: boolean; max_route_legs: number } | null;
}

export interface SpotConfig {
    truthEnabled: boolean;
    confidenceThresholdBps: number;
    minBettingOptions: number;
    maxBettingOptions: number;
    minReasoningLength: number;
    maxReasoningLength: number;
    maxEvidenceUrls: number;
    oracleAddress: string;
    maxClaimPerPost: number;
    objectId: string;
}

export interface Overview {
    services: { rpc: boolean; graphql: boolean; socialServer: boolean };
    /** True when at least one upstream could not be read. */
    degraded: boolean;
    /** Human-readable reasons the data below is incomplete. */
    warnings: string[];
    oracle: {
        configured: boolean;
        address: string | null;
        error: string | null;
        balanceMist: string | null;
        privateKeySource: string | null;
        dryRun: boolean;
    };
    endpoints: {
        mysoRpcUrl: string;
        graphqlUrl: string;
        socialApiUrl: string;
        socialPackageId: string;
    };
    ids: Record<string, string | null>;
    spotConfig: SpotConfig | null;
    insuranceConfig: InsuranceConfig | null;
    vaultId: string | null;
    stats: {
        marketCount: number;
        openCount: number;
        resolvedCount: number;
        pendingPostCount: number;
        vaultCount: number;
        coveredMist: string;
        tvlMist: string;
        exposureByMarket: Record<string, string>;
    };
    demoDefaults: {
        claimText: string;
        bettingOptions: string[];
        resolutionWindowMs: number;
        maxResolutionWindowMs: number;
        confidenceBps: number;
        coverageBps: number;
        coverageDurationMs: number;
        betMist: number;
        premiumMist: number;
        vaultDepositMist: number;
    };
}

export interface PendingPost {
    post_id: string;
    owner: string;
    content: string;
    created_at: number;
    post_type: string | null;
}

export interface ChainPost {
    postId: string;
    owner: string | null;
    content: string;
    createdAtMs: number;
    spotAnalysisStatus: number;
    enableSpot: boolean;
    marketId: string | null;
    marketStatus: number | null;
}

export interface Vault {
    vault_id: string;
    underwriter: string;
    capital_balance: number;
    reserved: number;
    base_rate_bps_per_day: number;
    utilization_multiplier_bps: number;
    enabled: boolean;
    paused: boolean;
    exposures: Array<{ market_id: string; option_id: number; total_exposure: number }>;
}

export interface ApproveResult {
    marketId: string | null;
    claimId: string | null;
    semanticClaimHashHex: string;
    marketKeyHashHex: string;
    identityJson: string;
    marketKeyJson: string;
    alreadyExisted: boolean;
    tx: { digest: string; status: string };
}

export interface CoverageQuote {
    premiumMist: string;
    premiumRawMist: string;
    reserveRequiredMist: string;
    availableCapacityReserveMist: string;
    riskMultiplierBps: number;
    impliedProbWinBps: number;
    utilizationBps: number;
    maxFillCoveredAmountMist: string;
    skippedReason: number;
    skippedReasonLabel: string;
}

export interface SeedPostResult {
    postId: string | null;
    profileId: string | null;
    memoryAccountId: string | null;
    createdProfile: boolean;
    tx: { digest: string; status: string };
}

export interface HealthResponse {
    ok: boolean;
    services: { rpc: boolean; graphql: boolean; socialServer: boolean };
}

// ---- Endpoints ------------------------------------------------------------

export const api = {
    /** Liveness of the demo backend *and* the three services it depends on. */
    health: () => request<HealthResponse>("/api/health"),
    overview: () => request<Overview>("/api/overview"),
    markets: () => request<{ markets: MarketRow[] }>("/api/markets"),
    market: (marketId: string) => request<MarketDetail>(`/api/markets/${marketId}`),
    pendingPosts: () => request<{ posts: PendingPost[] }>("/api/pending-posts"),
    posts: (limit = 25) => request<{ posts: ChainPost[] }>(`/api/posts?limit=${limit}`),
    vaults: () => request<{ vaults: Vault[] }>("/api/insurance/vaults"),
    policies: (marketId?: string) =>
        request<{ policies: InsurancePolicy[] }>(
            `/api/insurance/policies${marketId ? `?marketId=${marketId}` : ""}`,
        ),

    seedPost: (claimText: string, username?: string, displayName?: string) =>
        post<SeedPostResult>("/api/oracle/seed-post", { claimText, username, displayName }),

    approve: (input: {
        postId: string;
        claimText?: string;
        resolutionAtMs?: number;
        bettingOptions?: string[];
    }) => post<ApproveResult>("/api/oracle/approve", input),

    resolve: (input: {
        marketId: string;
        outcomeOptionId: number;
        confidenceBps?: number;
        reasoning: string;
        evidenceUrls: string[];
    }) => post<{ tx: { digest: string; status: string } }>("/api/oracle/resolve", input),

    setSpotTruth: (truthEnabled: boolean) =>
        post<{ digest: string; config: SpotConfig }>("/api/oracle/config/spot", { truthEnabled }),

    setInsuranceEnabled: (enabled: boolean) =>
        post<{ digest: string; enabled: boolean }>("/api/oracle/config/insurance", { enabled }),

    ensureVault: (amountMist: number) =>
        post<{ vaultId: string | null; digests: string[] }>("/api/oracle/vault", { amountMist }),

    placeBet: (input: { marketId: string; postId: string; optionId: number; amountMist: number }) =>
        post<{ tx: { digest: string; status: string } }>("/api/oracle/bet", input),

    quoteCoverage: (input: {
        marketId: string;
        optionId: number;
        coveredAmountMist: number;
        coverageBps?: number;
        durationMs?: number;
        vaultId?: string;
    }) => post<{ quote: CoverageQuote }>("/api/oracle/quote", input),

    buyCoverage: (input: {
        marketId: string;
        optionId: number;
        coverageAmountMist: number;
        coverageBps?: number;
        durationMs?: number;
        premiumMist?: number;
    }) => post<{ digest: string; policyId: string | null }>("/api/oracle/coverage", input),

    claimPayout: (input: { marketId: string; postId: string }) =>
        post<{ tx: { digest: string; status: string } }>("/api/oracle/payout", input),
};
