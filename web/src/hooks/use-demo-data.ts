import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type HealthResponse, type MarketRow, type Overview } from "@/lib/api";

/** Polling cadence — the local chain index advances continuously. */
const REFRESH_MS = 8_000;
/** Health is cheap, so check it more often than the data. */
const HEALTH_MS = 5_000;

export function useHealth() {
    return useQuery({
        queryKey: ["health"],
        queryFn: api.health,
        refetchInterval: HEALTH_MS,
        // No retries: a failed probe is itself the signal, and retrying only
        // delays the verdict.
        retry: false,
    });
}

export function useOverview() {
    return useQuery({
        queryKey: ["overview"],
        queryFn: api.overview,
        refetchInterval: REFRESH_MS,
        retry: 1,
    });
}

export function useMarkets() {
    return useQuery({
        queryKey: ["markets"],
        queryFn: async () => (await api.markets()).markets,
        refetchInterval: REFRESH_MS,
        retry: 1,
    });
}

export function useMarket(marketId: string | null) {
    return useQuery({
        queryKey: ["market", marketId],
        queryFn: () => api.market(marketId as string),
        enabled: Boolean(marketId),
        refetchInterval: REFRESH_MS,
        retry: 1,
    });
}

export function usePendingPosts() {
    return useQuery({
        queryKey: ["pendingPosts"],
        queryFn: async () => (await api.pendingPosts()).posts,
        refetchInterval: REFRESH_MS,
        retry: 1,
    });
}

export function useChainPosts(limit = 20) {
    return useQuery({
        queryKey: ["posts", limit],
        queryFn: async () => (await api.posts(limit)).posts,
        refetchInterval: REFRESH_MS,
        retry: 1,
    });
}

export function useVaults() {
    return useQuery({
        queryKey: ["vaults"],
        queryFn: async () => (await api.vaults()).vaults,
        refetchInterval: REFRESH_MS * 2,
        retry: 1,
    });
}

export function usePolicies(marketId?: string) {
    return useQuery({
        queryKey: ["policies", marketId ?? "all"],
        queryFn: async () => (await api.policies(marketId)).policies,
        refetchInterval: REFRESH_MS,
        retry: 1,
    });
}

// ---------------------------------------------------------------------------
// Connection state
// ---------------------------------------------------------------------------

export type ServiceName = "rpc" | "graphql" | "socialServer";

export interface ConnectionFailure {
    /** The demo backend itself could not be reached (the health probe failed). */
    apiDown: boolean;
    /** Backend reachable, but these upstream services are down. */
    failingServices: ServiceName[];
    /** Backend and services look fine, yet a data query is failing. */
    dataUnavailable: boolean;
    /** When this outage was first observed (latched, not per-refetch). */
    since: number;
    /** Human-readable detail from the last failed attempt. */
    detail: string | null;
}

export interface ConnectionState {
    failure: ConnectionFailure | null;
    /** A health probe is in flight and we have no verdict yet. */
    checking: boolean;
    recheck: () => Promise<void>;
}

const SERVICE_LABELS: Record<ServiceName, string> = {
    rpc: "MySo node RPC (:9000)",
    graphql: "Chain GraphQL (:9125)",
    socialServer: "Social API (:9126)",
};

export function serviceLabel(name: ServiceName): string {
    return SERVICE_LABELS[name];
}

/**
 * Single source of truth for "is this thing connected?".
 *
 * React Query resets a query's `error` when a new fetch starts, so deriving a
 * banner straight from `error` makes it blink on every polling cycle: hidden at
 * the start of a refetch, visible again once that refetch fails. Errors also
 * arrive from several queries at different times, so two of them disagreeing
 * produces the same symptom.
 *
 * Instead we LATCH the first failure and only clear it once a probe has
 * positively confirmed that everything is healthy again. The banner therefore
 * reflects the real state continuously, rather than the in-flight moment.
 */
export function useConnectionState(): ConnectionState {
    const health = useHealth();
    const markets = useMarkets();

    const [failure, setFailure] = useState<ConnectionFailure | null>(null);
    const [checked, setChecked] = useState(false);
    const failureRef = useRef<ConnectionFailure | null>(null);
    failureRef.current = failure;

    const evaluate = useCallback(() => {
        const services: HealthResponse["services"] | undefined = health.data?.services;

        // A failed *health* probe is the only thing that means "the backend is
        // gone". A failing data query while health is fine is degraded, not down.
        const apiDown = health.isError;
        const failingServices: ServiceName[] = services
            ? (Object.entries(services) as Array<[ServiceName, boolean]>)
                  .filter(([, ok]) => !ok)
                  .map(([name]) => name)
            : [];
        const dataUnavailable = !apiDown && markets.isError;

        const healthy =
            !apiDown &&
            !dataUnavailable &&
            services !== undefined &&
            failingServices.length === 0;

        if (healthy) {
            // Only a confirmed-good probe clears the banner.
            if (failureRef.current) setFailure(null);
            setChecked(true);
            return;
        }

        // Not yet conclusive (first load, no verdict from either source).
        if (!apiDown && services === undefined && !dataUnavailable) return;

        const detail =
            (health.error as Error | null)?.message ??
            (markets.error as Error | null)?.message ??
            null;

        setFailure((previous) =>
            previous
                ? { ...previous, apiDown, failingServices, dataUnavailable, detail }
                : {
                      apiDown,
                      failingServices,
                      dataUnavailable,
                      since: Date.now(),
                      detail,
                  },
        );
        setChecked(true);
    }, [health.data, health.isError, health.error, markets.isError, markets.error]);

    useEffect(() => {
        evaluate();
    }, [evaluate]);

    const recheck = useCallback(async () => {
        await Promise.all([health.refetch(), markets.refetch()]);
    }, [health, markets]);

    return {
        failure,
        checking: !checked && health.isLoading,
        recheck,
    };
}

/** Invalidate every derived view after an on-chain action. */
export function useRefreshAll() {
    const queryClient = useQueryClient();
    return async (extraDelayMs = 1500) => {
        // Give the local indexer a moment to observe the new checkpoint.
        await new Promise((resolve) => setTimeout(resolve, extraDelayMs));
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["overview"] }),
            queryClient.invalidateQueries({ queryKey: ["markets"] }),
            queryClient.invalidateQueries({ queryKey: ["market"] }),
            queryClient.invalidateQueries({ queryKey: ["posts"] }),
            queryClient.invalidateQueries({ queryKey: ["pendingPosts"] }),
            queryClient.invalidateQueries({ queryKey: ["vaults"] }),
            queryClient.invalidateQueries({ queryKey: ["policies"] }),
            queryClient.invalidateQueries({ queryKey: ["health"] }),
        ]);
    };
}

export { useMutation };
export type { MarketRow, Overview };
