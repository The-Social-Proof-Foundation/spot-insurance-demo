import { Activity, Info, Layers, Percent, ShieldCheck, Vault } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { InsuranceConfig, Vault as VaultRow } from "@/lib/api";
import { formatBps, formatDuration, formatMyso } from "@/lib/format";

/**
 * Insurance desk: the pricing surface plus the underwriter side.
 *
 * `insurance_enabled` gates everything — with it false the module reverts
 * (`EDisabled`) on deposit_capital and buy_coverage, which is why the header
 * pill and the console switch matter.
 */
export function InsurancePanel({
    config,
    vaults,
    loading,
}: {
    config: InsuranceConfig | null | undefined;
    vaults: VaultRow[] | undefined;
    loading: boolean;
}) {
    const enabled = config?.insurance_enabled ?? false;
    const totalCapital = (vaults ?? []).reduce((sum, vault) => sum + BigInt(vault.capital_balance || 0), 0n);
    const totalReserved = (vaults ?? []).reduce((sum, vault) => sum + BigInt(vault.reserved || 0), 0n);
    const utilisation =
        totalCapital > 0n ? Number((totalReserved * 10_000n) / totalCapital) / 100 : 0;

    return (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            {/* Pricing config */}
            <div className="panel space-y-3 p-4">
                <div className="flex items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                        <Percent className="size-4 text-primary" />
                        Pricing parameters
                    </h3>
                    <Badge tone={enabled ? "success" : "danger"}>
                        {enabled ? "enabled" : "disabled"}
                    </Badge>
                </div>

                {loading && !config ? (
                    <p className="text-xs text-muted-foreground">Loading configuration…</p>
                ) : !config ? (
                    <p className="text-xs text-muted-foreground">
                        Insurance configuration not indexed yet.
                    </p>
                ) : (
                    <>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                            <Pair label="Coverage range" value={`${formatBps(config.min_coverage_bps)} – ${formatBps(config.max_coverage_bps)}`} />
                            <Pair label="Protocol fee" value={formatBps(config.fee_bps)} />
                            <Pair label="Max duration" value={formatDuration(config.max_duration_ms)} />
                            <Pair label="Min premium" value={`${formatMyso(config.min_premium_amount)} MYSO`} />
                            <Pair label="Min SPoT liquidity" value={`${formatMyso(config.min_spot_total_liquidity)} MYSO`} />
                            <Pair
                                label="Max cover / option"
                                value={formatBps(config.max_coverage_fraction_of_option_bps)}
                            />
                            <Pair
                                label="Implied prob floor"
                                value={formatBps(config.implied_prob_floor_bps)}
                            />
                            <Pair label="Odds cap" value={`${(config.odds_cap_bps / 10_000).toFixed(1)}×`} />
                            <Pair
                                label="Max risk multiplier"
                                value={`${(config.max_risk_multiplier_bps / 10_000).toFixed(1)}×`}
                            />
                            <Pair label="Exposure cap" value={formatBps(config.exposure_cap_bps)} />
                        </dl>
                        <p className="flex items-start gap-2 rounded-md border border-border bg-surface-raised/40 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
                            <Info className="mt-0.5 size-3 shrink-0" />
                            <span>
                                Premiums are a function of SPoT liquidity: the covered option&apos;s share
                                of escrow becomes the implied win probability, scaled by a risk multiplier
                                derived from elapsed time and utilisation, then clamped by the caps above.
                            </span>
                        </p>
                    </>
                )}
            </div>

            {/* Vaults */}
            <div className="panel space-y-3 p-4">
                <div className="flex items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                        <Vault className="size-4 text-primary" />
                        Underwriter vaults
                    </h3>
                    <span className="num text-[11px] text-muted-foreground">
                        {vaults?.length ?? 0} vaults
                    </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                    <MiniStat label="Capital" value={`${formatMyso(totalCapital.toString())}`} unit="MYSO" />
                    <MiniStat label="Reserved" value={`${formatMyso(totalReserved.toString())}`} unit="MYSO" />
                    <MiniStat label="Utilisation" value={utilisation.toFixed(1)} unit="%" />
                </div>

                {loading && !vaults ? (
                    <p className="text-xs text-muted-foreground">Loading vaults…</p>
                ) : (vaults?.length ?? 0) === 0 ? (
                    <p className="rounded-md border border-dashed border-border px-3 py-3 text-[11px] leading-relaxed text-muted-foreground">
                        No underwriter vault yet. Create and fund one from the Oracle console —
                        <span className="text-foreground/70"> deposit_capital</span> reverts while the
                        module is disabled.
                    </p>
                ) : (
                    <ul className="space-y-2">
                        {(vaults ?? []).map((vault) => {
                            const capital = BigInt(vault.capital_balance || 0);
                            const reserved = BigInt(vault.reserved || 0);
                            const util =
                                capital > 0n ? Number((reserved * 10_000n) / capital) / 100 : 0;
                            return (
                                <li
                                    key={vault.vault_id}
                                    className="space-y-2 rounded-md border border-border bg-surface-raised/40 px-3 py-2.5"
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="num text-[11px] text-muted-foreground">
                                            {vault.vault_id.slice(0, 10)}…{vault.vault_id.slice(-6)}
                                        </span>
                                        <span className="flex items-center gap-1.5">
                                            {!vault.enabled ? <Badge tone="danger">disabled</Badge> : null}
                                            {vault.paused ? <Badge tone="warning">paused</Badge> : null}
                                            <Badge tone="outline">
                                                {vault.base_rate_bps_per_day} bps/day
                                            </Badge>
                                        </span>
                                    </div>
                                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                        <div
                                            className="h-full rounded-full bg-primary/70"
                                            style={{ width: `${Math.min(util, 100)}%` }}
                                        />
                                    </div>
                                    <div className="num flex items-center justify-between text-[10px] text-muted-foreground">
                                        <span>{formatMyso(capital.toString())} MYSO capital</span>
                                        <span>
                                            {formatMyso(reserved.toString())} reserved · {util.toFixed(1)}%
                                        </span>
                                    </div>
                                    {vault.exposures.length > 0 ? (
                                        <div className="space-y-1 border-t border-border pt-2">
                                            <p className="label-xs flex items-center gap-1">
                                                <Layers className="size-3" />
                                                Open exposure
                                            </p>
                                            <ul className="space-y-0.5">
                                                {vault.exposures.slice(0, 5).map((exposure) => (
                                                    <li
                                                        key={`${exposure.market_id}-${exposure.option_id}`}
                                                        className="num flex justify-between text-[10px] text-muted-foreground"
                                                    >
                                                        <span>
                                                            {exposure.market_id.slice(0, 8)}… · option{" "}
                                                            {exposure.option_id}
                                                        </span>
                                                        <span>{formatMyso(exposure.total_exposure)} MYSO</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>
                )}

                <p className="flex items-start gap-2 border-t border-border pt-3 text-[10px] leading-relaxed text-muted-foreground">
                    <Activity className="mt-0.5 size-3 shrink-0" />
                    <span>
                        Reserved capital is what the router has locked against outstanding coverage across
                        all markets — the difference between it and total capital is what is still
                        available to underwrite new policies.
                    </span>
                </p>
            </div>
        </div>
    );
}

function Pair({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="num font-medium">{value}</dd>
        </div>
    );
}

function MiniStat({ label, value, unit }: { label: string; value: string; unit: string }) {
    return (
        <div className="rounded-md border border-border bg-surface-raised/50 px-2.5 py-2">
            <p className="label-xs">{label}</p>
            <p className="num mt-0.5 text-sm font-semibold">
                {value}
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">{unit}</span>
            </p>
        </div>
    );
}
