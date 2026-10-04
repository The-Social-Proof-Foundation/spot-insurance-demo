import { Info, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MechanicsStep {
    title: string;
    body: string;
    /** Move entrypoint this step maps to, shown as a mono chip. */
    call?: string;
    /** Small right-aligned tag, e.g. "off-chain" or "on-chain". */
    tag?: string;
}

export interface MechanicsContent {
    heading: string;
    lead: string;
    steps: MechanicsStep[];
    /** The one rule worth remembering. */
    invariant: string;
}

/**
 * A quiet, scannable explainer of the on-chain mechanics behind a table.
 *
 * Deliberately restrained: numbered cards, one idea each, and the Move
 * entrypoint a step maps to — so the numbers in the table above can be traced
 * back to a specific contract call.
 */
export function Mechanics({ content }: { content: MechanicsContent }) {
    return (
        <section className="panel animate-fade-up overflow-hidden">
            <header className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-border bg-surface-raised/40 px-4 py-3">
                <div className="flex items-center gap-2">
                    <Sparkles className="size-3.5 text-primary" />
                    <h2 className="text-sm font-semibold tracking-tight">{content.heading}</h2>
                </div>
                <p className="w-full text-[11px] leading-relaxed text-muted-foreground sm:w-auto sm:flex-1">
                    {content.lead}
                </p>
            </header>

            <ol className="grid gap-px bg-border/60 sm:grid-cols-2 xl:grid-cols-3">
                {content.steps.map((step, index) => (
                    <li key={step.title} className="group relative bg-surface/80 p-4">
                        <div className="flex items-start gap-3">
                            <span className="num mt-px grid size-6 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary/10 text-[11px] font-semibold text-primary">
                                {index + 1}
                            </span>
                            <div className="min-w-0 flex-1 space-y-1.5">
                                <div className="flex items-baseline justify-between gap-2">
                                    <h3 className="text-xs font-semibold leading-snug text-foreground/95">
                                        {step.title}
                                    </h3>
                                    {step.tag ? (
                                        <span className="label-xs shrink-0">{step.tag}</span>
                                    ) : null}
                                </div>
                                <p className="text-[11px] leading-relaxed text-muted-foreground">
                                    {step.body}
                                </p>
                                {step.call ? (
                                    <code className="num mt-0.5 block truncate rounded border border-border bg-background/50 px-1.5 py-1 text-[10px] text-accent transition-colors group-hover:border-accent/30">
                                        {step.call}
                                    </code>
                                ) : null}
                            </div>
                        </div>

                        {/* Progress hairline — quietly implies order without arrows. */}
                        <span
                            aria-hidden
                            className="absolute inset-x-4 bottom-0 h-px bg-gradient-to-r from-primary/40 to-transparent"
                        />
                    </li>
                ))}
            </ol>

            <footer className="flex items-start gap-2.5 border-t border-border bg-surface-raised/40 px-4 py-3">
                <Info className="mt-0.5 size-3.5 shrink-0 text-warning" />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground/85">Key invariant — </span>
                    {content.invariant}
                </p>
            </footer>
        </section>
    );
}

/** Mechanics for the markets table. */
export const SPOT_MECHANICS: MechanicsContent = {
    heading: "How a post becomes a market",
    lead: "Every figure in the table above is the result of this pipeline. Each step maps to a Move entrypoint in social_contracts::social_proof_of_truth.",
    steps: [
        {
            title: "A post asserts a claim",
            body: "SPoT is always-on: any post is a claim candidate, with nothing to opt into. The indexer watches for PostCreatedEvent.",
            call: "post::create_public_post",
            tag: "on-chain",
        },
        {
            title: "The oracle derives a canonical identity",
            body: "The claim text is normalised into structured fields — subject, predicate, deadline — then hashed. In production this is an LLM pass over the post plus trusted sources; in this demo it is the Approve button.",
            tag: "off-chain",
        },
        {
            title: "Two hashes fix the market's identity",
            body: "The semantic hash groups posts asking the same question. The market key — same identity plus the deadline day and the sorted options — is the registry's deduplication key.",
        },
        {
            title: "Claim and market open together",
            body: "Registers the SpotClaim, opens a SpotMarket at status OPEN, links the post at claim index 0, and marks the post's analysis completed. That last flag is the gate that unlocks both betting and insurance.",
            call: "create_and_finalize_spot_market_for_post",
            tag: "on-chain",
        },
        {
            title: "Bets escrow against options",
            body: "Each stake is locked to one option. The per-option totals become the market's implied probabilities — and the pricing input for the insurance module.",
            call: "place_spot_bet_for_post",
            tag: "on-chain",
        },
        {
            title: "The oracle settles, or hands over to the DAO",
            body: "Above the confidence threshold the market settles and winners claim. Below it the market escalates to DAO_REQUIRED instead of paying out. Anything left unresolved becomes refundable.",
            call: "oracle_resolve",
            tag: "on-chain",
        },
    ],
    invariant:
        "approving the same claim on the same deadline day reuses the existing market (EMarketExists) rather than splitting liquidity across duplicates — which is why the approval step reports a dedup instead of an error.",
};

/** Mechanics for the insurance panel. */
export const INSURANCE_MECHANICS: MechanicsContent = {
    heading: "How coverage is priced and paid",
    lead: "The insurance module is a hedge on top of SPoT, not a separate market. Its pricing reads the escrow numbers above, and it cannot exist without them.",
    steps: [
        {
            title: "The module is inert until enabled",
            body: "Every entrypoint asserts insurance_enabled and reverts with EDisabled otherwise. This is why the header pill and the console switch matter before anything else works.",
            call: "set_insurance_enabled",
            tag: "gate",
        },
        {
            title: "Underwriters supply the capital",
            body: "A vault holds capital alongside a reserved counter. Free capital — capital minus reserved — is everything still available to back new policies.",
            call: "create_vault · deposit_capital",
            tag: "on-chain",
        },
        {
            title: "Premiums are read off SPoT liquidity",
            body: "Your option's share of escrow is treated as the implied win probability, scaled by a risk multiplier from elapsed time and vault utilisation, then clamped by the odds cap and exposure limits.",
            call: "quote_vault_for_spot_coverage",
            tag: "view",
        },
        {
            title: "You can only insure what you staked",
            body: "Covered amount is capped at your own escrow on that option. A holder with no position cannot buy coverage at all — that is what keeps the module a hedge rather than a side bet.",
        },
        {
            title: "Buying coverage reserves vault capital",
            body: "The premium must clear the quoted amount or the transaction reverts on slippage. The reserve — covered amount times the coverage ratio — is locked out of the vault, and large policies are split across several vaults.",
            call: "buy_coverage",
            tag: "on-chain",
        },
        {
            title: "Settlement mirrors the SPoT outcome",
            body: "If the covered option loses, the policy pays out of the vault's reserved capital. A backstop pool absorbs tail risk beyond the per-market caps.",
            call: "insurance::claim",
            tag: "on-chain",
        },
    ],
    invariant:
        "coverage can never be bought on a market whose SPoT analysis is not completed — the position cap and the market-open check both depend on the oracle having finalised the post first.",
};

/** Compact one-line legend used under tables too small to need the full flow. */
export function MechanicsLegend({ children }: { children: React.ReactNode }) {
    return (
        <p className={cn("text-[11px] leading-relaxed text-muted-foreground")}>{children}</p>
    );
}
