import {
    Banknote,
    CalendarClock,
    Coins,
    FileText,
    Fingerprint,
    Gavel,
    ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogBody,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type MarketDetail, type MarketRow } from "@/lib/api";
import {
    formatBps,
    formatDateTime,
    formatMyso,
    pluralize,
    relativeTime,
    shortAddress,
} from "@/lib/format";
import { cn } from "@/lib/utils";

const POLICY_STATUS: Record<number, { label: string; tone: "success" | "neutral" | "resolved" | "danger" }> = {
    1: { label: "Active", tone: "success" },
    2: { label: "Cancelled", tone: "neutral" },
    3: { label: "Claimed", tone: "resolved" },
    4: { label: "Expired", tone: "danger" },
};

export function MarketDialog({
    market,
    detail,
    loading,
    open,
    onOpenChange,
    onChanged,
}: {
    market: MarketRow | null;
    detail: MarketDetail | undefined;
    loading: boolean;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onChanged: () => Promise<void>;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <div className="flex flex-wrap items-center gap-2">
                        <DialogTitle>
                            {market?.claimText ?? `Market ${shortAddress(market?.marketId, 8, 6)}`}
                        </DialogTitle>
                        {market ? (
                            <Badge
                                tone={
                                    market.status === 1
                                        ? "open"
                                        : market.status === 3
                                          ? "resolved"
                                          : market.status === 4
                                            ? "danger"
                                            : "warning"
                                }
                            >
                                {market.statusLabel}
                                {market.status === 3 ? ` · ${market.outcomeLabel}` : ""}
                            </Badge>
                        ) : null}
                    </div>
                    <DialogDescription>
                        Social Proof of Truth market
                        {market?.postId ? (
                            <>
                                {" "}
                                on post{" "}
                                <span className="num text-foreground/80">
                                    {shortAddress(market.postId, 10, 8)}
                                </span>
                            </>
                        ) : null}
                        . Every figure below is read from the chain GraphQL index or the
                        social indexer — the demo never writes to either.
                    </DialogDescription>
                </DialogHeader>

                <DialogBody>
                    {loading || !market ? (
                        <div className="space-y-3">
                            <Skeleton className="h-20" />
                            <Skeleton className="h-32" />
                            <Skeleton className="h-24" />
                        </div>
                    ) : (
                        <MarketDialogBody
                            market={market}
                            detail={detail}
                            onChanged={onChanged}
                        />
                    )}
                </DialogBody>
            </DialogContent>
        </Dialog>
    );
}

function MarketDialogBody({
    market,
    detail,
    onChanged,
}: {
    market: MarketRow;
    detail: MarketDetail | undefined;
    onChanged: () => Promise<void>;
}) {
    const options = market.bettingOptions;
    const totalEscrow = BigInt(market.totalEscrowMist || "0");

    return (
        <>
            {/* Headline metrics */}
            <div className="grid gap-3 sm:grid-cols-4">
                <Stat
                    icon={<Coins className="size-3.5" />}
                    label="SPoT escrow"
                    value={`${formatMyso(market.totalEscrowMist)} MYSO`}
                    hint={`${pluralize(market.totalBets || detail?.bets.length || 0, "on-chain bet")}`}
                />
                <Stat
                    icon={<ShieldCheck className="size-3.5" />}
                    label="Insured coverage"
                    value={
                        market.insurance.policyCount === 0
                            ? "—"
                            : `${formatMyso(market.insurance.coveredMist)} MYSO`
                    }
                    hint={`${pluralize(market.insurance.policyCount, "policy", "policies")} · ${market.insurance.activeCount} active`}
                />
                <Stat
                    icon={<Banknote className="size-3.5" />}
                    label="Premiums paid"
                    value={`${formatMyso(market.insurance.premiumMist)} MYSO`}
                    hint={`vs ${formatMyso(market.totalEscrowMist)} escrow`}
                />
                <Stat
                    icon={<Gavel className="size-3.5" />}
                    label="Outcome"
                    value={market.isOpen ? "Pending" : market.outcomeLabel}
                    hint={
                        market.isOpen
                            ? relativeTime(market.resolutionAtMs)
                            : formatDateTime(market.lastResolutionAtMs ?? market.resolutionAtMs)
                    }
                />
            </div>

            {/* Option breakdown */}
            <Section
                title="Betting options"
                icon={<Coins className="size-3.5" />}
                note={
                    market.optionEscrowSource === "indexer"
                        ? "amounts projected by the social indexer"
                        : market.optionEscrowSource === "chain"
                          ? "staked per option, summed from the market's on-chain bet vector"
                          : "no stake recorded on this market yet"
                }
            >
                <div className="space-y-2">
                    {options.map((option, index) => {
                        const escrow = BigInt(market.optionEscrow[String(index)] ?? "0");
                        const share =
                            totalEscrow > 0n ? Number((escrow * 10_000n) / totalEscrow) / 100 : 0;
                        const isWinner =
                            !market.isOpen && market.outcome !== null && market.outcome === index;
                        return (
                            <div key={`${option}-${index}`} className="space-y-1.5">
                                <div className="flex items-baseline justify-between gap-3 text-xs">
                                    <span className="flex items-center gap-2">
                                        <span className="num text-muted-foreground">#{index}</span>
                                        <span className="font-medium">{option}</span>
                                        {isWinner ? <Badge tone="success">winner</Badge> : null}
                                    </span>
                                    <span className="num text-muted-foreground">
                                        {formatMyso(escrow)} MYSO ·{" "}
                                        {share.toFixed(share === 0 ? 0 : 1)}%
                                    </span>
                                </div>
                                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                    <div
                                        className={cn(
                                            "h-full rounded-full transition-all duration-500",
                                            isWinner ? "bg-positive" : "bg-primary/70",
                                        )}
                                        style={{ width: `${Math.max(share, escrow > 0n ? 2 : 0)}%` }}
                                    />
                                </div>
                            </div>
                        );
                    })}
                    {options.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No options indexed yet.</p>
                    ) : null}
                </div>
            </Section>

            {/* Claim identity */}
            <Section title="Claim identity (canonical hashes)" icon={<Fingerprint className="size-3.5" />}>
                <dl className="space-y-1.5 text-xs">
                    <Row label="Semantic claim hash" value={detail?.semanticClaimHash ?? market.semanticClaimHash} mono />
                    <Row label="Market key hash" value={String(detail?.marketObject?.market_key_hash ?? "—")} mono />
                    <Row label="Claim object" value={market.claimId} mono />
                    <Row label="Market object" value={market.marketId} mono />
                    <Row label="Primary post" value={market.postId} mono />
                    <Row
                        label="Creator"
                        value={market.primaryCreator ?? market.postOwner}
                        mono
                    />
                </dl>
                <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                    The oracle derives both hashes as SHA-256 over canonical JSON. Because{" "}
                    <span className="text-foreground/70">market_key_hash</span> is the registry&apos;s
                    dedup key, re-approving the same claim on the same deadline day reuses the existing
                    market instead of opening a second one.
                </p>
            </Section>

            {/* Timing */}
            <Section title="Lifecycle" icon={<CalendarClock className="size-3.5" />}>
                <dl className="space-y-1.5 text-xs">
                    <Row label="Created" value={formatDateTime(market.createdAtMs)} />
                    <Row
                        label="Oracle may resolve from"
                        value={formatDateTime(market.resolutionAtMs)}
                    />
                    <Row
                        label="Max resolution window"
                        value={
                            market.maxResolutionWindowMs
                                ? `${Math.round(Number(market.maxResolutionWindowMs) / 60000)} min after deadline`
                                : "—"
                        }
                    />
                    <Row
                        label="Settled at"
                        value={market.isOpen ? "—" : formatDateTime(market.lastResolutionAtMs)}
                    />
                    <Row
                        label="DAO escalation"
                        value={
                            detail?.indexerRecord?.dao_escalated_at_ms
                                ? formatDateTime(detail.indexerRecord.dao_escalated_at_ms)
                                : "none (oracle confidence above threshold)"
                        }
                    />
                </dl>
            </Section>

            {/* Insurance policies */}
            <Section title="Insurance policies" icon={<ShieldCheck className="size-3.5" />}>
                {detail && detail.policies.length > 0 ? (
                    <div className="overflow-hidden rounded-md border border-border">
                        <table className="w-full text-left text-xs">
                            <thead className="bg-surface-raised/60 text-[10px] uppercase tracking-wider text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 font-medium">Policy</th>
                                    <th className="px-3 py-2 font-medium">Insured</th>
                                    <th className="px-3 py-2 font-medium text-right">Covered</th>
                                    <th className="px-3 py-2 font-medium text-right">Coverage</th>
                                    <th className="px-3 py-2 font-medium text-right">Premium</th>
                                    <th className="px-3 py-2 font-medium text-right">Impl. prob / mult.</th>
                                    <th className="px-3 py-2 font-medium">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/70">
                                {detail.policies.map((policy) => {
                                    const status = POLICY_STATUS[policy.status] ?? {
                                        label: `Status ${policy.status}`,
                                        tone: "neutral" as const,
                                    };
                                    return (
                                        <tr key={policy.policy_id}>
                                            <td className="num px-3 py-2 text-muted-foreground">
                                                {shortAddress(policy.policy_id, 6, 4)}
                                            </td>
                                            <td className="num px-3 py-2 text-muted-foreground">
                                                {shortAddress(policy.insured, 6, 4)}
                                            </td>
                                            <td className="num px-3 py-2 text-right font-medium">
                                                {formatMyso(policy.covered_amount)}
                                            </td>
                                            <td className="num px-3 py-2 text-right">
                                                {formatBps(policy.coverage_bps)}
                                            </td>
                                            <td className="num px-3 py-2 text-right">
                                                {formatMyso(policy.premium_paid)}
                                            </td>
                                            <td className="num px-3 py-2 text-right text-muted-foreground">
                                                {formatBps(policy.implied_probability_bps)} /{" "}
                                                {(policy.risk_multiplier_bps / 10_000).toFixed(2)}×
                                            </td>
                                            <td className="px-3 py-2">
                                                <Badge tone={status.tone}>{status.label}</Badge>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <EmptyNote
                        icon={<ShieldCheck className="size-3.5" />}
                        text="No coverage written on this market. Insurance premiums are priced from SPoT escrow, so a bettor must hold a position before the router will underwrite it."
                    />
                )}
            </Section>

            {detail && detail.policies.length > 0 ? (
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                    Premiums are quoted from SPoT liquidity: implied win probability is the covered
                    option&apos;s share of escrow, scaled by a risk multiplier and capped by the
                    configured exposure limits.
                </p>
            ) : null}

            {/* Bets */}
            <Section title={`Bets (${detail?.bets.length ?? 0})`} icon={<Coins className="size-3.5" />}>
                {detail && detail.bets.length > 0 ? (
                    <ul className="divide-y divide-border/70 overflow-hidden rounded-md border border-border">
                        {detail.bets.slice(0, 25).map((bet, index) => (
                            <li
                                key={`${bet.user_address}-${bet.timestamp_ms}-${index}`}
                                className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                            >
                                <span className="num text-muted-foreground">
                                    {shortAddress(bet.user_address, 8, 6)}
                                </span>
                                <span className="flex items-center gap-3">
                                    <Badge tone="outline">
                                        {options[bet.option_id] ?? `option ${bet.option_id}`}
                                    </Badge>
                                    <span className="num font-medium">
                                        {formatMyso(bet.escrow_amount)} MYSO
                                    </span>
                                    <span className="num text-[10px] text-muted-foreground">
                                        {relativeTime(bet.timestamp_ms)}
                                    </span>
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <EmptyNote
                        icon={<Coins className="size-3.5" />}
                        text="No bets indexed for this market yet."
                    />
                )}
            </Section>

            {/* Settlement flows */}
            {(detail?.payouts.length ?? 0) > 0 || (detail?.refunds.length ?? 0) > 0 ? (
                <Section title="Settlement" icon={<Banknote className="size-3.5" />}>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <FlowList title="Payouts" rows={detail?.payouts ?? []} tone="positive" />
                        <FlowList title="Refunds" rows={detail?.refunds ?? []} tone="warning" />
                    </div>
                </Section>
            ) : null}

            {/* Raw objects */}
            <Section title="Raw on-chain objects" icon={<FileText className="size-3.5" />}>
                <div className="space-y-2">
                    <RawJson label="SpotMarket" value={detail?.marketObject} />
                    <RawJson label="SpotClaim" value={detail?.claimObject} />
                    <RawJson label="Post" value={detail?.postObject} />
                </div>
            </Section>

            <ResolvePanel market={market} onChanged={onChanged} />
        </>
    );
}

/** Oracle actions available from the dialog (settle / claim payout). */
function ResolvePanel({
    market,
    onChanged,
}: {
    market: MarketRow;
    onChanged: () => Promise<void>;
}) {
    const [busy, setBusy] = useState<string | null>(null);
    const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

    const run = async (label: string, fn: () => Promise<{ digest: string } | string>) => {
        setBusy(label);
        setMessage(null);
        try {
            const result = await fn();
            const digest = typeof result === "string" ? result : result.digest;
            setMessage({ tone: "ok", text: `${label} confirmed · ${digest}` });
            await onChanged();
        } catch (error) {
            setMessage({ tone: "err", text: error instanceof Error ? error.message : String(error) });
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="rounded-lg border border-border bg-surface-raised/50 p-3">
            <p className="label-xs mb-2">Oracle actions</p>
            <div className="flex flex-wrap gap-2">
                {market.isOpen ? (
                    <Button
                        size="sm"
                        variant="primary"
                        loading={busy === "settle"}
                        onClick={() =>
                            void run("oracle_resolve", async () =>
                                (await api.resolve({
                                    marketId: market.marketId,
                                    outcomeOptionId: market.outcome ?? 0,
                                    reasoning:
                                        "Manual settlement issued from the demo console: the operator reviewed the trusted sources and recorded the winning option.",
                                    evidenceUrls: ["https://example.org/spot-demo-evidence"],
                                })).tx,
                            )
                        }
                    >
                        <Gavel />
                        Settle as “{market.bettingOptions[market.outcome ?? 0] ?? "option 0"}”
                    </Button>
                ) : (
                    <Button
                        size="sm"
                        variant="secondary"
                        loading={busy === "payout"}
                        onClick={() =>
                            void run(
                                "claim_payout",
                                async () =>
                                    (
                                        await api.claimPayout({
                                            marketId: market.marketId,
                                            postId: market.postId,
                                        })
                                    ).tx,
                            )
                        }
                    >
                        <Banknote />
                        Claim winner payout
                    </Button>
                )}
            </div>
            {market.isOpen ? (
                <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                    Settlement is rejected before the resolution deadline, while confidence is below the
                    configured threshold the market escalates to the DAO instead of paying out. Use the
                    Oracle console for full control over outcome, confidence and evidence.
                </p>
            ) : null}
            {message ? (
                <p
                    className={cn(
                        "mt-2 break-all text-[11px]",
                        message.tone === "ok" ? "text-positive" : "text-danger",
                    )}
                >
                    {message.text}
                </p>
            ) : null}
        </div>
    );
}

function FlowList({
    title,
    rows,
    tone,
}: {
    title: string;
    rows: Array<{ user_address: string; amount: number; timestamp_ms: number }>;
    tone: "positive" | "warning";
}) {
    return (
        <div className="overflow-hidden rounded-md border border-border">
            <p className="label-xs border-b border-border bg-surface-raised/60 px-3 py-2">{title}</p>
            {rows.length === 0 ? (
                <p className="px-3 py-3 text-[11px] text-muted-foreground">none</p>
            ) : (
                <ul className="divide-y divide-border/70">
                    {rows.slice(0, 8).map((row, index) => (
                        <li
                            key={`${row.user_address}-${index}`}
                            className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                        >
                            <span className="num text-muted-foreground">
                                {shortAddress(row.user_address, 6, 4)}
                            </span>
                            <span
                                className={cn(
                                    "num font-medium",
                                    tone === "positive" ? "text-positive" : "text-warning",
                                )}
                            >
                                {formatMyso(row.amount)} MYSO
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function RawJson({ label, value }: { label: string; value: Record<string, unknown> | null | undefined }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="overflow-hidden rounded-md border border-border">
            <button
                type="button"
                onClick={() => setOpen((prev) => !prev)}
                className="focus-ring flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-surface-raised/60"
            >
                <span className="font-medium">{label}</span>
                <span className="text-[10px] text-muted-foreground">
                    {value ? (open ? "hide" : "show JSON") : "not readable yet"}
                </span>
            </button>
            {open && value ? (
                <pre className="max-h-56 overflow-auto border-t border-border bg-background/60 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
                    {JSON.stringify(value, null, 2)}
                </pre>
            ) : null}
        </div>
    );
}

function Section({
    title,
    icon,
    note,
    children,
}: {
    title: string;
    icon: React.ReactNode;
    note?: string;
    children: React.ReactNode;
}) {
    return (
        <section className="space-y-2.5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <h4 className="flex items-center gap-2 text-xs font-semibold text-foreground/90">
                    <span className="text-muted-foreground">{icon}</span>
                    {title}
                </h4>
                {note ? <span className="text-[10px] text-muted-foreground">{note}</span> : null}
            </div>
            {children}
        </section>
    );
}

function Stat({
    icon,
    label,
    value,
    hint,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    hint: string;
}) {
    return (
        <div className="rounded-lg border border-border bg-surface-raised/50 px-3 py-2.5">
            <p className="label-xs flex items-center gap-1.5">
                {icon}
                {label}
            </p>
            <p className="num mt-1 truncate text-base font-semibold">{value}</p>
            <p className="num truncate text-[10px] text-muted-foreground">{hint}</p>
        </div>
    );
}

function Row({
    label,
    value,
    mono,
}: {
    label: string;
    value: string | null | undefined;
    mono?: boolean;
}) {
    return (
        <div className="flex items-baseline justify-between gap-4">
            <dt className="shrink-0 text-muted-foreground">{label}</dt>
            <dd
                className={cn("min-w-0 truncate text-right", mono && "num text-[11px]")}
                title={typeof value === "string" ? value : undefined}
            >
                {value ?? "—"}
            </dd>
        </div>
    );
}

function EmptyNote({ icon, text }: { icon: React.ReactNode; text: string }) {
    return (
        <div className="flex items-start gap-2.5 rounded-md border border-dashed border-border px-3 py-3">
            <span className="mt-0.5 text-muted-foreground">{icon}</span>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{text}</p>
        </div>
    );
}

