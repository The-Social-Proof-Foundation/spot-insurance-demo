import {
    BadgeCheck,
    Calculator,
    CircleDollarSign,
    FilePlus2,
    Gavel,
    Lock,
    Play,
    RefreshCw,
    ShieldCheck,
    Sparkles,
    Terminal,
    Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, type ChainPost, type CoverageQuote, type MarketRow, type Overview } from "@/lib/api";
import { formatMyso, relativeTime, shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

type LogEntry = { at: number; tone: "ok" | "err" | "info"; text: string };

const SPOT_ANALYSIS_LABEL: Record<number, string> = {
    0: "pending",
    1: "completed",
    2: "no actionable claim",
};

export function OracleConsole({
    overview,
    posts,
    markets,
    refresh,
}: {
    overview: Overview | undefined;
    posts: ChainPost[];
    markets: MarketRow[];
    refresh: () => Promise<void>;
}) {
    const [log, setLog] = useState<LogEntry[]>([]);
    const [busy, setBusy] = useState<string | null>(null);
    const [quote, setQuote] = useState<CoverageQuote | null>(null);

    const [seedText, setSeedText] = useState(
        overview?.demoDefaults.claimText ??
            "The LA Rams will win at least one playoff game in the 2026-27 NFL season.",
    );
    const [claimText, setClaimText] = useState("");
    const [windowMinutes, setWindowMinutes] = useState(2);
    const [optionsText, setOptionsText] = useState(
        (overview?.demoDefaults.bettingOptions ?? ["Yes", "No"]).join(","),
    );

    const [resolve, setResolve] = useState({
        marketId: markets[0]?.marketId ?? "",
        outcomeOptionId: 0,
        confidenceBps: overview?.demoDefaults.confidenceBps ?? 8500,
        reasoning:
            "Reviewed the official league results and the team's published schedule; the claim resolved against the recorded outcome.",
        evidenceUrls: "https://www.nfl.com/playoffs/,https://www.espn.com/nfl/",
    });
    const [bet, setBet] = useState({
        marketId: markets[0]?.marketId ?? "",
        optionId: 0,
        amountMist: overview?.demoDefaults.betMist ?? 250_000_000,
    });
    const [coverage, setCoverage] = useState({
        marketId: markets[0]?.marketId ?? "",
        optionId: 0,
        coverageAmountMist: overview?.demoDefaults.betMist ?? 250_000_000,
        coverageBps: overview?.demoDefaults.coverageBps ?? 8000,
        premiumMist: overview?.demoDefaults.premiumMist ?? 50_000_000,
        durationMs: 1_800_000,
    });

    const unapprovedPosts = useMemo(
        () => posts.filter((post) => !post.marketId),
        [posts],
    );

    const record = (tone: LogEntry["tone"], text: string) =>
        setLog((prev) => [{ at: Date.now(), tone, text }, ...prev].slice(0, 40));

    async function run(label: string, fn: () => Promise<string>) {
        setBusy(label);
        record("info", `${label} — submitting…`);
        try {
            const detail = await fn();
            record("ok", `${label} — ${detail}`);
            await refresh();
        } catch (error) {
            record("err", `${label} — ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setBusy(null);
        }
    }

    const spotEnabled = overview?.spotConfig?.truthEnabled ?? false;
    const insuranceEnabled = overview?.insuranceConfig?.insurance_enabled ?? false;
    const oracleReady = overview?.oracle.configured ?? false;

    return (
        <div className="space-y-4">
            {!oracleReady ? (
                <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-xs text-warning">
                    <p className="font-medium">Simulated oracle key not configured</p>
                    <p className="mt-1 leading-relaxed text-warning/90">
                        Set <span className="num">SPOT_ORACLE_PRIVATE_KEY</span> in{" "}
                        <span className="num">.env</span> and restart the API to enable on-chain
                        actions.{" "}
                        {overview?.oracle.error ? <span>({overview.oracle.error})</span> : null} The
                        read-only views still work.
                    </p>
                </div>
            ) : null}

            {/* Step 0 — capability switches */}
            <div className="panel space-y-3 p-4">
                <div className="flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                        <Sparkles className="size-4 text-primary" />
                        Environment switches
                    </h3>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void refresh()}
                        title="Re-read every source"
                    >
                        <RefreshCw />
                        Refresh
                    </Button>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                    <SwitchRow
                        icon={<BadgeCheck className="size-3.5" />}
                        label="SPoT truth layer"
                        detail="SpotConfig.truth_enabled — required before any market can be created"
                        on={spotEnabled}
                        busy={busy === "update_spot_config"}
                        disabled={!oracleReady}
                        onToggle={() =>
                            void run("update_spot_config", async () => {
                                const result = await api.setSpotTruth(!spotEnabled);
                                return `truth_enabled=${!spotEnabled} · ${result.digest}`;
                            })
                        }
                    />
                    <SwitchRow
                        icon={<ShieldCheck className="size-3.5" />}
                        label="Insurance module"
                        detail="InsuranceConfig.insurance_enabled — required for vault deposits and coverage"
                        on={insuranceEnabled}
                        busy={busy === "set_insurance_enabled"}
                        disabled={!oracleReady}
                        onToggle={() =>
                            void run("set_insurance_enabled", async () => {
                                const result = await api.setInsuranceEnabled(!insuranceEnabled);
                                return `insurance_enabled=${!insuranceEnabled} · ${result.digest}`;
                            })
                        }
                    />
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    <Button
                        size="sm"
                        variant="secondary"
                        disabled={!oracleReady || !insuranceEnabled}
                        loading={busy === "create_vault"}
                        onClick={() =>
                            void run("create_vault + deposit_capital", async () => {
                                const result = await api.ensureVault(
                                    overview?.demoDefaults.vaultDepositMist ?? 1_000_000_000,
                                );
                                return `vault ${shortAddress(result.vaultId, 8, 6)} · ${result.digests.length} tx`;
                            })
                        }
                    >
                        <Wallet />
                        {overview?.vaultId ? "Top up underwriter vault" : "Create underwriter vault"}
                    </Button>
                    <span className="num text-[11px] text-muted-foreground">
                        vault {overview?.vaultId ? shortAddress(overview.vaultId, 8, 6) : "—"}
                    </span>
                </div>
            </div>

            {/* Step 1 — create a post */}
            <div className="panel space-y-3 p-4">
                <StepHeading
                    step="1"
                    title="Publish a post"
                    detail="Posts are the substrate SPoT reasons over. The demo signs as the oracle/admin account."
                />
                <textarea
                    value={seedText}
                    onChange={(event) => setSeedText(event.target.value)}
                    rows={2}
                    className="focus-ring w-full resize-none rounded-md border border-input bg-background/60 px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground"
                    placeholder="What claim does this post assert?"
                />
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        size="sm"
                        variant="primary"
                        disabled={!oracleReady || !seedText.trim()}
                        loading={busy === "create_public_post"}
                        onClick={() =>
                            void run("post::create_public_post", async () => {
                                const result = await api.seedPost(seedText.trim());
                                setClaimText(seedText.trim());
                                if (result.postId) setResolveFromPost(result.postId, seedText.trim());
                                return `post ${shortAddress(result.postId, 8, 6)} · ${result.tx.digest}`;
                            })
                        }
                    >
                        <FilePlus2 />
                        Publish post
                    </Button>
                    <span className="text-[11px] leading-relaxed text-muted-foreground">
                        Requires an approved platform membership — the backend joins one
                        automatically on the first call.
                    </span>
                </div>
            </div>

            {/* Step 2 — approve SPoT */}
            <div className="panel space-y-3 p-4">
                <StepHeading
                    step="2"
                    title="Approve the post's SPoT  (this is the faked oracle)"
                    detail="Signs create_and_finalize_spot_market_for_post with the SpotOracleAdminCap: registers the semantic claim, opens the prediction market, links the post and finalises its SPoT status."
                />

                {unapprovedPosts.length > 0 ? (
                    <div className="space-y-1.5">
                        <p className="label-xs">Posts without a market ({unapprovedPosts.length})</p>
                        <ul className="max-h-44 space-y-1 overflow-y-auto pr-1">
                            {unapprovedPosts.map((post) => (
                                <li key={post.postId}>
                                    <button
                                        type="button"
                                        onClick={() => setResolveFromPost(post.postId, post.content)}
                                        className={cn(
                                            "focus-ring row-hover flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left",
                                            resolve.marketId === post.postId
                                                ? "border-primary/50 bg-primary/10"
                                                : "border-border",
                                        )}
                                    >
                                        <span className="min-w-0 flex-1">
                                            <span className="line-clamp-1 block text-xs font-medium">
                                                {post.content || "(empty content)"}
                                            </span>
                                            <span className="num block text-[10px] text-muted-foreground">
                                                {shortAddress(post.postId, 8, 6)} · spot{" "}
                                                {SPOT_ANALYSIS_LABEL[post.spotAnalysisStatus] ??
                                                    post.spotAnalysisStatus}{" "}
                                                · {relativeTime(post.createdAtMs)}
                                            </span>
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : (
                    <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                        Every readable post already has a market. Publish another post in step 1, or
                        paste a post object id below.
                    </p>
                )}

                <Field label="Post object id">
                    <input
                        value={resolve.marketId}
                        onChange={(event) =>
                            setResolve((prev) => ({ ...prev, marketId: event.target.value }))
                        }
                        className="focus-ring num w-full rounded-md border border-input bg-background/60 px-3 py-2 text-xs"
                        placeholder="0x…"
                    />
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Claim text (canonicalised before hashing)">
                        <textarea
                            value={claimText}
                            onChange={(event) => setClaimText(event.target.value)}
                            rows={2}
                            className="focus-ring w-full resize-none rounded-md border border-input bg-background/60 px-3 py-2 text-xs leading-relaxed"
                            placeholder="Defaults to the post's content"
                        />
                    </Field>
                    <div className="space-y-3">
                        <Field label="Betting options (comma separated, 2–10)">
                            <input
                                value={optionsText}
                                onChange={(event) => setOptionsText(event.target.value)}
                                className="focus-ring w-full rounded-md border border-input bg-background/60 px-3 py-2 text-xs"
                            />
                        </Field>
                        <Field label="Resolution window (minutes from now)">
                            <input
                                type="number"
                                min={1}
                                value={windowMinutes}
                                onChange={(event) => setWindowMinutes(Number(event.target.value))}
                                className="focus-ring num w-full rounded-md border border-input bg-background/60 px-3 py-2 text-xs"
                            />
                        </Field>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        size="sm"
                        variant="primary"
                        disabled={!oracleReady || !spotEnabled || !resolve.marketId}
                        loading={busy === "approve_post"}
                        onClick={() =>
                            void run("oracle approve (create_and_finalize)", async () => {
                                const result = await api.approve({
                                    postId: resolve.marketId,
                                    claimText: claimText.trim() || undefined,
                                    resolutionAtMs: Date.now() + windowMinutes * 60_000,
                                    bettingOptions: optionsText
                                        .split(",")
                                        .map((option) => option.trim())
                                        .filter(Boolean),
                                });
                                return result.alreadyExisted
                                    ? `deduplicated onto existing market ${shortAddress(result.marketId, 8, 6)} (EMarketExists)`
                                    : `market ${shortAddress(result.marketId, 8, 6)} · claim ${shortAddress(result.claimId, 8, 6)} · ${result.tx.digest}`;
                            })
                        }
                    >
                        <BadgeCheck />
                        Approve SPoT
                    </Button>
                    {!spotEnabled ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-warning">
                            <Lock className="size-3" />
                            enable the SPoT truth layer above first
                        </span>
                    ) : null}
                </div>
            </div>

            {/* Step 3 — bet + insure */}
            <div className="panel space-y-3 p-4">
                <StepHeading
                    step="3"
                    title="Bet, then insure the position"
                    detail="buy_coverage caps the covered amount at your escrow on that option, so a position must exist first."
                />

                <MarketPicker
                    value={bet.marketId}
                    onChange={(marketId) => {
                        setBet((prev) => ({ ...prev, marketId }));
                        setCoverage((prev) => ({ ...prev, marketId }));
                        setResolve((prev) => ({ ...prev, marketId }));
                    }}
                    markets={markets}
                />

                <div className="grid gap-3 sm:grid-cols-4">
                    <Field label="Option">
                        <OptionSelect
                            market={markets.find((row) => row.marketId === bet.marketId)}
                            value={bet.optionId}
                            onChange={(optionId) => {
                                setBet((prev) => ({ ...prev, optionId }));
                                setCoverage((prev) => ({ ...prev, optionId }));
                            }}
                        />
                    </Field>
                    <Field label="Bet (MIST)">
                        <input
                            type="number"
                            value={bet.amountMist}
                            onChange={(event) =>
                                setBet((prev) => ({ ...prev, amountMist: Number(event.target.value) }))
                            }
                            className="focus-ring num w-full rounded-md border border-input bg-background/60 px-3 py-2 text-xs"
                        />
                    </Field>
                    <Field label="Coverage (MIST)">
                        <input
                            type="number"
                            value={coverage.coverageAmountMist}
                            onChange={(event) =>
                                setCoverage((prev) => ({
                                    ...prev,
                                    coverageAmountMist: Number(event.target.value),
                                }))
                            }
                            className="focus-ring num w-full rounded-md border border-input bg-background/60 px-3 py-2 text-xs"
                        />
                    </Field>
                    <Field label="Premium (MIST)">
                        <input
                            type="number"
                            value={coverage.premiumMist}
                            onChange={(event) =>
                                setCoverage((prev) => ({
                                    ...prev,
                                    premiumMist: Number(event.target.value),
                                }))
                            }
                            className="focus-ring num w-full rounded-md border border-input bg-background/60 px-3 py-2 text-xs"
                        />
                    </Field>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={!oracleReady || !overview?.vaultId || !coverage.marketId}
                        loading={busy === "quote"}
                        onClick={() =>
                            void run("quote_vault_for_spot_coverage", async () => {
                                // Dev-inspect the on-chain quoter: buy_coverage enforces
                                // slippage guards, so the premium must come from here.
                                const result = await api.quoteCoverage({
                                    marketId: coverage.marketId,
                                    optionId: coverage.optionId,
                                    coveredAmountMist: coverage.coverageAmountMist,
                                    coverageBps: coverage.coverageBps,
                                    durationMs: coverage.durationMs,
                                });
                                setQuote(result.quote);
                                setCoverage((prev) => ({
                                    ...prev,
                                    premiumMist: Number(result.quote.premiumMist),
                                }));
                                return `premium ${formatMyso(result.quote.premiumMist)} MYSO · ${result.quote.skippedReasonLabel}`;
                            })
                        }
                    >
                        <Calculator />
                        Quote premium
                    </Button>

                    <Button
                        size="sm"
                        variant="secondary"
                        disabled={
                            !oracleReady ||
                            !spotEnabled ||
                            !bet.marketId ||
                            !markets.find((row) => row.marketId === bet.marketId)?.postId
                        }
                        loading={busy === "place_bet"}
                        onClick={() =>
                            void run("place_spot_bet_for_post", async () => {
                                const market = markets.find((row) => row.marketId === bet.marketId);
                                if (!market) throw new Error("Select a market first.");
                                const result = await api.placeBet({
                                    marketId: market.marketId,
                                    postId: market.postId,
                                    optionId: bet.optionId,
                                    amountMist: bet.amountMist,
                                });
                                return `${formatMyso(bet.amountMist)} MYSO on option ${bet.optionId} · ${result.tx.digest}`;
                            })
                        }
                    >
                        <CircleDollarSign />
                        Place bet
                    </Button>

                    <Button
                        size="sm"
                        variant="secondary"
                        disabled={
                            !oracleReady ||
                            !insuranceEnabled ||
                            !overview?.vaultId ||
                            !coverage.marketId
                        }
                        loading={busy === "buy_coverage"}
                        onClick={() =>
                            void run("insurance::buy_coverage", async () => {
                                const result = await api.buyCoverage({
                                    marketId: coverage.marketId,
                                    optionId: coverage.optionId,
                                    coverageAmountMist: coverage.coverageAmountMist,
                                    coverageBps: coverage.coverageBps,
                                    durationMs: coverage.durationMs,
                                    premiumMist: coverage.premiumMist,
                                });
                                return `policy ${shortAddress(result.policyId, 8, 6)} · ${result.digest}`;
                            })
                        }
                    >
                        <ShieldCheck />
                        Buy coverage
                    </Button>

                    {!overview?.vaultId ? (
                        <span className="text-[11px] text-muted-foreground">
                            create a vault first (top of this panel)
                        </span>
                    ) : null}
                </div>

                {quote ? (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border border-border bg-surface-raised/40 px-3 py-2.5 text-[11px] sm:grid-cols-4">
                        <QuoteStat label="Premium" value={`${formatMyso(quote.premiumMist)} MYSO`} />
                        <QuoteStat
                            label="Reserve required"
                            value={`${formatMyso(quote.reserveRequiredMist)} MYSO`}
                        />
                        <QuoteStat
                            label="Implied prob"
                            value={`${(quote.impliedProbWinBps / 100).toFixed(1)}%`}
                        />
                        <QuoteStat
                            label="Risk multiplier"
                            value={`${(quote.riskMultiplierBps / 10_000).toFixed(2)}×`}
                        />
                        <QuoteStat
                            label="Max fill"
                            value={`${formatMyso(quote.maxFillCoveredAmountMist)} MYSO`}
                        />
                        <QuoteStat
                            label="Vault utilisation"
                            value={`${(quote.utilizationBps / 100).toFixed(1)}%`}
                        />
                        <QuoteStat
                            label="Free capacity"
                            value={`${formatMyso(quote.availableCapacityReserveMist)} MYSO`}
                        />
                        <QuoteStat
                            label="Status"
                            value={quote.skippedReasonLabel}
                            tone={quote.skippedReason === 0 ? "ok" : "warn"}
                        />
                    </dl>
                ) : null}
            </div>

            {/* Step 4 — resolve */}
            <div className="panel space-y-3 p-4">
                <StepHeading
                    step="4"
                    title="Resolve the market"
                    detail="oracle_resolve settles escrow and pays out. Confidence below SpotConfig.confidence_threshold_bps escalates to the DAO instead — try both."
                />

                <MarketPicker
                    value={resolve.marketId}
                    onChange={(marketId) => setResolve((prev) => ({ ...prev, marketId }))}
                    markets={markets}
                />

                <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Winning option">
                        <OptionSelect
                            market={markets.find((row) => row.marketId === resolve.marketId)}
                            value={resolve.outcomeOptionId}
                            onChange={(outcomeOptionId) =>
                                setResolve((prev) => ({ ...prev, outcomeOptionId }))
                            }
                        />
                    </Field>
                    <Field label="Confidence (bps)">
                        <input
                            type="number"
                            value={resolve.confidenceBps}
                            onChange={(event) =>
                                setResolve((prev) => ({
                                    ...prev,
                                    confidenceBps: Number(event.target.value),
                                }))
                            }
                            className="focus-ring num w-full rounded-md border border-input bg-background/60 px-3 py-2 text-xs"
                        />
                    </Field>
                    <Field label="Evidence URLs (comma separated)">
                        <input
                            value={resolve.evidenceUrls}
                            onChange={(event) =>
                                setResolve((prev) => ({ ...prev, evidenceUrls: event.target.value }))
                            }
                            className="focus-ring w-full rounded-md border border-input bg-background/60 px-3 py-2 text-xs"
                        />
                    </Field>
                </div>

                <Field label="Reasoning (length-bounded on chain)">
                    <textarea
                        value={resolve.reasoning}
                        onChange={(event) =>
                            setResolve((prev) => ({ ...prev, reasoning: event.target.value }))
                        }
                        rows={2}
                        className="focus-ring w-full resize-none rounded-md border border-input bg-background/60 px-3 py-2 text-xs leading-relaxed"
                    />
                </Field>

                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        size="sm"
                        variant="primary"
                        disabled={!oracleReady || !spotEnabled || !resolve.marketId}
                        loading={busy === "oracle_resolve"}
                        onClick={() =>
                            void run("oracle_resolve", async () => {
                                const result = await api.resolve({
                                    marketId: resolve.marketId,
                                    outcomeOptionId: resolve.outcomeOptionId,
                                    confidenceBps: resolve.confidenceBps,
                                    reasoning: resolve.reasoning,
                                    evidenceUrls: resolve.evidenceUrls
                                        .split(",")
                                        .map((url) => url.trim())
                                        .filter(Boolean),
                                });
                                return `option ${resolve.outcomeOptionId} at ${resolve.confidenceBps}bps · ${result.tx.digest}`;
                            })
                        }
                    >
                        <Gavel />
                        Resolve
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        disabled={
                            !oracleReady ||
                            !resolve.marketId ||
                            !markets.find((row) => row.marketId === resolve.marketId)?.postId
                        }
                        loading={busy === "claim_payout"}
                        onClick={() =>
                            void run("claim_payout", async () => {
                                const market = markets.find((row) => row.marketId === resolve.marketId);
                                if (!market) throw new Error("Select a market first.");
                                const result = await api.claimPayout({
                                    marketId: market.marketId,
                                    postId: market.postId,
                                });
                                return result.tx.digest;
                            })
                        }
                    >
                        <Play />
                        Claim payout
                    </Button>
                    {overview?.spotConfig ? (
                        <span className="num text-[11px] text-muted-foreground">
                            threshold {overview.spotConfig.confidenceThresholdBps} bps
                        </span>
                    ) : null}
                </div>
            </div>

            {/* Log */}
            <div className="panel overflow-hidden">
                <div className="flex items-center gap-2 border-b border-border bg-surface-raised/60 px-4 py-2">
                    <Terminal className="size-3.5 text-muted-foreground" />
                    <span className="label-xs">Transaction log</span>
                </div>
                <ul className="max-h-60 divide-y divide-border/60 overflow-y-auto">
                    {log.length === 0 ? (
                        <li className="px-4 py-6 text-center text-[11px] text-muted-foreground">
                            Oracle actions and digests will appear here.
                        </li>
                    ) : (
                        log.map((entry, index) => (
                            <li
                                key={`${entry.at}-${index}`}
                                className="flex items-start gap-3 px-4 py-2 text-[11px] leading-relaxed"
                            >
                                <span className="num shrink-0 text-muted-foreground">
                                    {new Date(entry.at).toLocaleTimeString()}
                                </span>
                                <span
                                    className={cn(
                                        "break-all",
                                        entry.tone === "ok" && "text-positive",
                                        entry.tone === "err" && "text-danger",
                                        entry.tone === "info" && "text-muted-foreground",
                                    )}
                                >
                                    {entry.text}
                                </span>
                            </li>
                        ))
                    )}
                </ul>
            </div>
        </div>
    );

    function setResolveFromPost(postId: string, content: string) {
        setResolve((prev) => ({ ...prev, marketId: postId }));
        if (content) setClaimText(content);
    }
}

function QuoteStat({
    label,
    value,
    tone,
}: {
    label: string;
    value: string;
    tone?: "ok" | "warn";
}) {
    return (
        <div>
            <dt className="label-xs">{label}</dt>
            <dd
                className={cn(
                    "num mt-0.5 font-medium",
                    tone === "ok" && "text-positive",
                    tone === "warn" && "text-warning",
                )}
            >
                {value}
            </dd>
        </div>
    );
}

function StepHeading({
    step,
    title,
    detail,
}: {
    step: string;
    title: string;
    detail: string;
}) {
    return (
        <div className="flex items-start gap-3">
            <span className="num mt-0.5 grid size-5 shrink-0 place-items-center rounded border border-primary/40 bg-primary/10 text-[10px] font-semibold text-primary">
                {step}
            </span>
            <div className="space-y-0.5">
                <h3 className="text-sm font-semibold leading-tight">{title}</h3>
                <p className="text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
            </div>
        </div>
    );
}

function SwitchRow({
    icon,
    label,
    detail,
    on,
    busy,
    disabled,
    onToggle,
}: {
    icon: React.ReactNode;
    label: string;
    detail: string;
    on: boolean;
    busy: boolean;
    disabled: boolean;
    onToggle: () => void;
}) {
    return (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-raised/40 px-3 py-2.5">
            <div className="min-w-0 space-y-0.5">
                <p className="flex items-center gap-1.5 text-xs font-medium">
                    <span className="text-muted-foreground">{icon}</span>
                    {label}
                </p>
                <p className="text-[10px] leading-relaxed text-muted-foreground">{detail}</p>
            </div>
            <Button
                size="sm"
                variant={on ? "danger" : "primary"}
                disabled={disabled}
                loading={busy}
                onClick={onToggle}
            >
                {on ? "Disable" : "Enable"}
            </Button>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block space-y-1">
            <span className="label-xs">{label}</span>
            {children}
        </label>
    );
}

function MarketPicker({
    value,
    onChange,
    markets,
}: {
    value: string;
    onChange: (marketId: string) => void;
    markets: MarketRow[];
}) {
    return (
        <Field label={`Market (${markets.length})`}>
            <select
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="focus-ring w-full rounded-md border border-input bg-background/60 px-3 py-2 text-xs"
            >
                <option value="">Select a market…</option>
                {markets.map((market) => (
                    <option key={market.marketId} value={market.marketId}>
                        {market.statusLabel} · {market.claimText?.slice(0, 64) ?? market.marketId}
                    </option>
                ))}
            </select>
        </Field>
    );
}

function OptionSelect({
    market,
    value,
    onChange,
}: {
    market: MarketRow | undefined;
    value: number;
    onChange: (optionId: number) => void;
}) {
    const options = market?.bettingOptions ?? [];
    return (
        <select
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
            className="focus-ring w-full rounded-md border border-input bg-background/60 px-3 py-2 text-xs"
        >
            {(options.length > 0 ? options : ["option 0", "option 1"]).map((option, index) => (
                <option key={`${option}-${index}`} value={index}>
                    {index} · {option}
                </option>
            ))}
        </select>
    );
}
