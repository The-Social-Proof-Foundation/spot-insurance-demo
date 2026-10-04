import { ChevronRight, Clock, Lock, ShieldCheck, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { MarketRow } from "@/lib/api";
import { formatCount, formatMyso, pluralize, relativeTime, shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

function statusTone(status: number) {
    switch (status) {
        case 1:
            return "open" as const;
        case 2:
            return "warning" as const;
        case 3:
            return "resolved" as const;
        case 4:
            return "danger" as const;
        default:
            return "neutral" as const;
    }
}

export function MarketTable({
    markets,
    loading,
    onSelect,
    selectedId,
}: {
    markets: MarketRow[] | undefined;
    loading: boolean;
    onSelect: (market: MarketRow) => void;
    selectedId?: string | null;
}) {
    if (loading && !markets) {
        return (
            <div className="panel divide-y divide-border/70">
                {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="flex items-center gap-6 px-4 py-4">
                        <Skeleton className="h-9 flex-1" />
                        <Skeleton className="h-9 w-28" />
                        <Skeleton className="h-9 w-28" />
                        <Skeleton className="h-9 w-32" />
                    </div>
                ))}
            </div>
        );
    }

    if (!markets || markets.length === 0) {
        return (
            <div className="panel grid place-items-center px-6 py-16 text-center">
                <div className="max-w-md space-y-2">
                    <div className="mx-auto grid size-10 place-items-center rounded-lg border border-border bg-surface-raised">
                        <TrendingUp className="size-5 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium">No SPoT markets yet</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                        Create a post, then let the simulated oracle approve it. Approving registers the
                        semantic claim, opens the prediction market and switches the post&apos;s SPoT
                        status to completed — which is what unlocks insurance.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="panel overflow-hidden">
            {/* Column header — the three row data points are called out explicitly. */}
            <div className="hidden grid-cols-[minmax(0,1fr)_9rem_9rem_10rem_2rem] items-center gap-4 border-b border-border bg-surface-raised/60 px-4 py-2 md:grid">
                <span className="label-xs">Claim / market</span>
                <span className="label-xs text-right">SPoT escrow</span>
                <span className="label-xs text-right">Insured</span>
                <span className="label-xs text-right">Resolution</span>
                <span />
            </div>

            <ul className="divide-y divide-border/70">
                {markets.map((market) => (
                    <li key={market.marketId}>
                        <button
                            type="button"
                            onClick={() => onSelect(market)}
                            className={cn(
                                "focus-ring row-hover grid w-full grid-cols-1 items-center gap-3 px-4 py-3.5 text-left md:grid-cols-[minmax(0,1fr)_9rem_9rem_10rem_2rem] md:gap-4",
                                selectedId === market.marketId && "bg-surface-raised/70",
                            )}
                        >
                            {/* Identity */}
                            <div className="min-w-0 space-y-1.5">
                                <div className="flex items-center gap-2">
                                    <Badge tone={statusTone(market.status)}>{market.statusLabel}</Badge>
                                    {market.insurance.policyCount > 0 ? (
                                        <Badge tone="success" className="gap-1">
                                            <ShieldCheck className="size-3" />
                                            insured
                                        </Badge>
                                    ) : null}
                                    {market.optionEscrowSource === "indexer" ? (
                                        <Badge
                                            tone="neutral"
                                            title="Per-option amounts projected by the social indexer"
                                        >
                                            indexed
                                        </Badge>
                                    ) : null}
                                </div>
                                <p className="line-clamp-1 text-sm font-medium leading-snug">
                                    {market.claimText ?? `Market ${shortAddress(market.marketId, 6, 4)}`}
                                </p>
                                <p className="num flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                                    <span title={market.marketId}>
                                        market {shortAddress(market.marketId, 8, 6)}
                                    </span>
                                    <span title={market.postId}>post {shortAddress(market.postId, 8, 6)}</span>
                                    <span>{market.bettingOptions.length} options</span>
                                </p>
                            </div>

                            {/* Data point 1 — SPoT escrow */}
                            <Metric
                                icon={<Lock className="size-3" />}
                                label="SPoT escrow"
                                value={`${formatMyso(market.totalEscrowMist)} MYSO`}
                                hint={escrowHint(market)}
                            />

                            {/* Data point 2 — insurance */}
                            <Metric
                                icon={<ShieldCheck className="size-3" />}
                                label="Insured"
                                value={
                                    market.insurance.policyCount === 0
                                        ? "—"
                                        : `${formatMyso(market.insurance.coveredMist)} MYSO`
                                }
                                hint={
                                    market.insurance.policyCount === 0
                                        ? "no policies"
                                        : `${pluralize(market.insurance.policyCount, "policy", "policies")}${
                                              market.insurance.activeCount > 0
                                                  ? ` · ${market.insurance.activeCount} active`
                                                  : ""
                                          }`
                                }
                            />

                            {/* Data point 3 — resolution */}
                            <Metric
                                icon={<Clock className="size-3" />}
                                label="Resolution"
                                value={market.isOpen ? "pending" : market.outcomeLabel}
                                hint={
                                    market.isOpen
                                        ? relativeTime(market.resolutionAtMs) === "—"
                                            ? "window not indexed"
                                            : relativeTime(market.resolutionAtMs)
                                        : `settled ${relativeTime(
                                              market.lastResolutionAtMs ?? market.resolutionAtMs,
                                          )}`
                                }
                                align="right"
                            />

                            <ChevronRight className="hidden size-4 justify-self-end text-muted-foreground md:block" />
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

/**
 * Per-option escrow only exists once the social indexer has projected the
 * market, so fall back to the option count instead of showing misleading zeros.
 */
function escrowHint(market: MarketRow): string {
    if (market.optionEscrowSource === "none") {
        return market.bettingOptions.length === 0
            ? "no options"
            : `${formatCount(market.bettingOptions.length)} options · no stake yet`;
    }
    if (market.bettingOptions.length <= 3) {
        return market.bettingOptions
            .map(
                (option, index) =>
                    `${option} ${formatMyso(market.optionEscrow[String(index)] ?? "0")}`,
            )
            .join(" · ");
    }
    return `${formatCount(market.bettingOptions.length)} options`;
}

function Metric({
    icon,
    label,
    value,
    hint,
    align = "right",
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    hint: string;
    align?: "left" | "right";
}) {
    return (
        <div className={cn("min-w-0 space-y-0.5", align === "right" && "md:text-right")}>
            <p
                className={cn(
                    "label-xs flex items-center gap-1",
                    align === "right" && "md:justify-end",
                )}
            >
                {icon}
                {label}
            </p>
            <p className="num truncate text-sm font-semibold">{value}</p>
            <p className="num truncate text-[10px] text-muted-foreground">{hint}</p>
        </div>
    );
}
