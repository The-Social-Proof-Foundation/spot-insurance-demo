import { AlertCircle, BarChart3, Coins, Layers, RefreshCw, ShieldCheck, Sliders } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Header } from "@/components/header";
import { InsurancePanel } from "@/components/insurance-panel";
import { MarketDialog } from "@/components/market-dialog";
import { MarketTable } from "@/components/market-table";
import {
    INSURANCE_MECHANICS,
    Mechanics,
    SPOT_MECHANICS,
} from "@/components/mechanics";
import { OracleConsole } from "@/components/oracle-console";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMySocialAuth } from "@/contexts/mysocial-auth-context";
import {
    serviceLabel,
    useChainPosts,
    useConnectionState,
    useMarket,
    useMarkets,
    useOverview,
    useRefreshAll,
    useVaults,
} from "@/hooks/use-demo-data";
import type { MarketRow } from "@/lib/api";
import type { ConnectionFailure } from "@/hooks/use-demo-data";
import { formatCount, formatMyso } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tab = "markets" | "insurance" | "oracle";

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: "markets", label: "Markets", icon: <BarChart3 className="size-4" /> },
    { id: "insurance", label: "Insurance", icon: <ShieldCheck className="size-4" /> },
    { id: "oracle", label: "Oracle console", icon: <Sliders className="size-4" /> },
];

const TAB_IDS: Tab[] = ["markets", "insurance", "oracle"];

/** Tabs are deep-linkable (`?tab=oracle`) so a demo can be pointed at a view. */
function readTabFromUrl(): Tab {
    const value = new URLSearchParams(window.location.search).get("tab");
    return value && (TAB_IDS as string[]).includes(value) ? (value as Tab) : "markets";
}

export default function App() {
    const [tab, setTabState] = useState<Tab>(() => readTabFromUrl());

    const setTab = (next: Tab) => {
        setTabState(next);
        const url = new URL(window.location.href);
        if (next === "markets") url.searchParams.delete("tab");
        else url.searchParams.set("tab", next);
        window.history.replaceState(null, "", url);
    };

    /** Keep the URL in step with the open dialog so views are shareable. */
    const selectMarket = (market: MarketRow | null) => {
        setSelected(market);
        const url = new URL(window.location.href);
        if (market) url.searchParams.set("market", market.marketId);
        else url.searchParams.delete("market");
        window.history.replaceState(null, "", url);
    };
    const [selected, setSelected] = useState<MarketRow | null>(null);
    const [statusFilter, setStatusFilter] = useState<"all" | "open" | "closed" | "insured">("all");

    const overview = useOverview();
    const marketsQuery = useMarkets();
    const postsQuery = useChainPosts(25);
    const vaultsQuery = useVaults();
    const detailQuery = useMarket(selected?.marketId ?? null);
    const refresh = useRefreshAll();
    const connection = useConnectionState();
    const { identity, isConfigured } = useMySocialAuth();

    const markets = marketsQuery.data;
    const degraded = overview.data?.degraded ?? false;

    // `?market=<id>` deep-links straight into a market's detail dialog.
    const [pendingMarketId] = useState(
        () => new URLSearchParams(window.location.search).get("market"),
    );
    useEffect(() => {
        if (!pendingMarketId || !markets || selected) return;
        const match = markets.find(
            (market) => market.marketId.toLowerCase() === pendingMarketId.toLowerCase(),
        );
        if (match) setSelected(match);
    }, [pendingMarketId, markets, selected]);

    const filtered = useMemo(() => {
        if (!markets) return markets;
        switch (statusFilter) {
            case "open":
                return markets.filter((market) => market.isOpen);
            case "closed":
                return markets.filter((market) => !market.isOpen);
            case "insured":
                return markets.filter((market) => market.insurance.policyCount > 0);
            default:
                return markets;
        }
    }, [markets, statusFilter]);

    return (
        <div className="relative z-10 min-h-screen">
            <Header overview={overview.data} />

            {connection.failure ? (
                <div className="container pt-4">
                    <ConnectionBanner
                        failure={connection.failure}
                        onRetry={connection.recheck}
                    />
                </div>
            ) : null}

            <main className="container space-y-5 py-6">
                {/* Stats strip */}
                <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <StatCard
                        icon={<Layers className="size-4" />}
                        label="SPoT markets"
                        value={
                            degraded
                                ? "—"
                                : formatCount(overview.data?.stats.marketCount ?? markets?.length ?? 0)
                        }
                        hint={
                            degraded
                                ? "unavailable while the chain is unreachable"
                                : `${formatCount(overview.data?.stats.openCount ?? markets?.filter((m) => m.isOpen).length ?? 0)} open · ${formatCount(overview.data?.stats.resolvedCount ?? 0)} settled`
                        }
                        loading={overview.isLoading}
                    />
                    <StatCard
                        icon={<Coins className="size-4" />}
                        label="Escrow under truth"
                        value={degraded ? "—" : formatMyso(overview.data?.stats.tvlMist ?? "0")}
                        unit={degraded ? undefined : "MYSO"}
                        hint={
                            degraded
                                ? "unavailable while the chain is unreachable"
                                : "Total SPoT escrow across all markets"
                        }
                        loading={overview.isLoading}
                    />
                    <StatCard
                        icon={<ShieldCheck className="size-4" />}
                        label="Insured coverage"
                        value={degraded ? "—" : formatMyso(overview.data?.stats.coveredMist ?? "0")}
                        unit={degraded ? undefined : "MYSO"}
                        hint={
                            degraded
                                ? "unavailable while the chain is unreachable"
                                : `${formatCount(overview.data?.stats.vaultCount ?? 0)} underwriter vaults`
                        }
                        loading={overview.isLoading}
                    />
                    <StatCard
                        icon={<BarChart3 className="size-4" />}
                        label="Posts awaiting SPoT"
                        value={
                            degraded
                                ? "—"
                                : formatCount(overview.data?.stats.pendingPostCount ?? 0)
                        }
                        hint={
                            degraded
                                ? "unavailable while the indexer is unreachable"
                                : "Indexer-visible posts with spot_analysis_status = pending"
                        }
                        loading={overview.isLoading}
                    />
                </section>

                {/* Tabs */}
                <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
                        {TABS.map((entry) => (
                            <button
                                key={entry.id}
                                type="button"
                                onClick={() => setTab(entry.id)}
                                className={cn(
                                    "focus-ring inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                                    tab === entry.id
                                        ? "bg-surface-raised text-foreground shadow-sm"
                                        : "text-muted-foreground hover:text-foreground",
                                )}
                            >
                                {entry.icon}
                                {entry.label}
                            </button>
                        ))}
                    </div>

                    {tab === "markets" ? (
                        <div className="ml-auto flex items-center gap-1.5">
                            {(["all", "open", "closed", "insured"] as const).map((filter) => (
                                <Button
                                    key={filter}
                                    size="sm"
                                    variant={statusFilter === filter ? "secondary" : "ghost"}
                                    onClick={() => setStatusFilter(filter)}
                                >
                                    {filter === "all"
                                        ? `All (${markets?.length ?? 0})`
                                        : filter === "open"
                                          ? "Active"
                                          : filter === "closed"
                                            ? "Past"
                                            : "Insured"}
                                </Button>
                            ))}
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void refresh(0)}
                                aria-label="Refresh"
                            >
                                <RefreshCw />
                            </Button>
                        </div>
                    ) : null}
                </div>

                {/* Identity hint */}
                {identity?.source === "demo" && tab === "markets" ? (
                    <p className="rounded-lg border border-border bg-surface/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                        Signed in as a local demo operator.{" "}
                        {isConfigured
                            ? "Use the header button to sign in with MySocial for a real session."
                            : "Set VITE_MYSOCIAL_API_BASE / _AUTH_ORIGIN / _CLIENT_ID / _REDIRECT_URI in .env to enable MySocial popup sign-in."}{" "}
                        Simulated-oracle transactions are signed server-side by the admin key, so the
                        browser session never holds a spending key.
                    </p>
                ) : null}

                {tab === "markets" ? (
                    <>
                        <MarketTable
                            markets={filtered}
                            loading={marketsQuery.isLoading}
                            onSelect={selectMarket}
                            selectedId={selected?.marketId}
                        />
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                            Each row carries three live data points —{" "}
                            <span className="text-foreground/80">SPoT escrow</span>,{" "}
                            <span className="text-foreground/80">insured coverage</span> and{" "}
                            <span className="text-foreground/80">resolution state</span>. Open a row for
                            the option breakdown, canonical claim hashes, insurance policy ledger, bets,
                            payouts and the raw Move objects.
                        </p>

                        <Mechanics content={SPOT_MECHANICS} />
                    </>
                ) : null}

                {tab === "insurance" ? (
                    <>
                        <InsurancePanel
                            config={overview.data?.insuranceConfig}
                            vaults={vaultsQuery.data}
                            loading={overview.isLoading || vaultsQuery.isLoading}
                        />
                        <Mechanics content={INSURANCE_MECHANICS} />
                    </>
                ) : null}

                {tab === "oracle" ? (
                    <OracleConsole
                        overview={overview.data}
                        posts={postsQuery.data ?? []}
                        markets={markets ?? []}
                        refresh={() => refresh()}
                    />
                ) : null}
            </main>

            <footer className="container flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border py-6 text-[11px] text-muted-foreground">
                <span>
                    Chain GraphQL{" "}
                    <span className="num text-foreground/70">
                        {overview.data?.endpoints.graphqlUrl ?? "—"}
                    </span>
                </span>
                <span>
                    Social API{" "}
                    <span className="num text-foreground/70">
                        {overview.data?.endpoints.socialApiUrl ?? "—"}
                    </span>
                </span>
                <span>
                    Package{" "}
                    <span className="num text-foreground/70">
                        {overview.data?.endpoints.socialPackageId ?? "—"}
                    </span>
                </span>
                {overview.data?.oracle.dryRun ? <Badge tone="warning">dry-run mode</Badge> : null}
                <span className="ml-auto">
                    Read-only against the indexers — only the simulated oracle key signs transactions.
                </span>
            </footer>

            <MarketDialog
                market={selected}
                detail={detailQuery.data}
                loading={detailQuery.isLoading}
                open={selected !== null}
                onOpenChange={(open) => {
                    if (!open) selectMarket(null);
                }}
                onChanged={async () => {
                    await refresh(1000);
                }}
            />
        </div>
    );
}

/**
 * Sticky outage notice.
 *
 * Rendered purely from `useConnectionState()`, which latches a failure until a
 * probe confirms recovery — so it stays put across polling cycles instead of
 * blinking on every refetch.
 */
function ConnectionBanner({
    failure,
    onRetry,
}: {
    failure: ConnectionFailure;
    onRetry: () => Promise<void>;
}) {
    const [retrying, setRetrying] = useState(false);

    const title = failure.apiDown
        ? "Cannot reach the SPoT demo API"
        : failure.failingServices.length > 0
          ? `Upstream ${failure.failingServices.length === 1 ? "service is" : "services are"} unavailable`
          : "Market data unavailable";

    return (
        <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3"
        >
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" />
            <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-danger">{title}</p>
                    <span className="num text-[10px] text-muted-foreground">
                        since {new Date(failure.since).toLocaleTimeString()}
                    </span>
                </div>

                {failure.apiDown ? (
                    <p className="num text-[11px] leading-relaxed text-danger/90">
                        {failure.detail ?? "The backend is not answering."}
                    </p>
                ) : failure.failingServices.length > 0 ? (
                    <ul className="space-y-0.5">
                        {failure.failingServices.map((name) => (
                            <li key={name} className="num text-[11px] text-danger/90">
                                {serviceLabel(name)} — not reachable
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="num text-[11px] leading-relaxed text-danger/90">
                        {failure.detail ?? "A data query is failing."}
                    </p>
                )}

                <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {failure.apiDown ? (
                        <>
                            Start it with <span className="num text-foreground/80">pnpm dev</span> from
                            the project root, or{" "}
                            <span className="num text-foreground/80">pnpm dev:api</span> for the backend
                            alone.
                        </>
                    ) : (
                        <>
                            These are read from the local MySo devnet. Restart it with{" "}
                            <span className="num text-foreground/80">
                                myso start --with-indexer=&hellip; --with-social-indexer=&hellip;
                                --with-graphql
                            </span>{" "}
                            (see the project README). Read-only views below will be empty until it
                            returns.
                        </>
                    )}
                </p>
            </div>

            <Button
                size="sm"
                variant="danger"
                loading={retrying}
                onClick={() => {
                    setRetrying(true);
                    void onRetry().finally(() => setRetrying(false));
                }}
            >
                <RefreshCw />
                Retry
            </Button>
        </div>
    );
}

function StatCard({
    icon,
    label,
    value,
    unit,
    hint,
    loading,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    unit?: string;
    hint: string;
    loading: boolean;
}) {
    return (
        <div className="panel animate-fade-up p-4">
            <div className="flex items-center justify-between gap-2">
                <p className="label-xs flex items-center gap-1.5">
                    <span className="text-muted-foreground">{icon}</span>
                    {label}
                </p>
            </div>
            <p className="num mt-2 text-2xl font-semibold leading-none tracking-tight">
                {loading ? <span className="text-muted-foreground">…</span> : value}
                {unit && !loading ? (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">{unit}</span>
                ) : null}
            </p>
            <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">{hint}</p>
        </div>
    );
}
