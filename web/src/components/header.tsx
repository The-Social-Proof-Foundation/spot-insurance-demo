import { Activity, LogIn, LogOut, Wallet } from "lucide-react";
import { useState } from "react";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMySocialAuth } from "@/contexts/mysocial-auth-context";
import type { Overview } from "@/lib/api";
import { shortAddress } from "@/lib/format";

export function Header({ overview }: { overview: Overview | undefined }) {
    const { identity, isConfigured, signIn, signOut, deriving, deriveError, keypair, startDemoSession } =
        useMySocialAuth();
    const [busy, setBusy] = useState(false);

    const services = overview?.services;
    const oracle = overview?.oracle;
    const spotEnabled = overview?.spotConfig?.truthEnabled ?? false;
    const insuranceEnabled = overview?.insuranceConfig?.insurance_enabled ?? false;

    return (
        <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-md">
            <div className="container flex h-14 items-center gap-4">
                <div className="flex items-center gap-2.5">
                    <img
                        src="/logo.svg"
                        alt="MySo"
                        width={26}
                        height={26}
                        className="size-[26px] shrink-0 select-none"
                        draggable={false}
                    />
                    <p className="text-sm font-semibold leading-none tracking-tight">
                        SPoT <span className="text-muted-foreground">×</span> Insurance
                    </p>
                </div>

                <div className="ml-2 hidden items-center gap-1.5 xl:flex">
                    <ServicePill label="RPC" ok={services?.rpc} />
                    <ServicePill label="GraphQL" ok={services?.graphql} />
                    <ServicePill label="Social API" ok={services?.socialServer} />
                </div>

                <div className="ml-auto flex items-center gap-2">
                    <Badge tone={spotEnabled ? "success" : "danger"}>
                        <Activity className="size-3" />
                        SPoT {spotEnabled ? "enabled" : "disabled"}
                    </Badge>
                    <Badge tone={insuranceEnabled ? "success" : "danger"}>
                        Insurance {insuranceEnabled ? "enabled" : "disabled"}
                    </Badge>
                    {oracle?.configured ? (
                        <Badge tone="outline" title={`${oracle.address ?? ""} · signed by ${oracle.privateKeySource ?? "env"}`}>
                            <Wallet className="size-3" />
                            oracle {shortAddress(oracle.address, 4, 4)}
                        </Badge>
                    ) : (
                        <Badge tone="warning">oracle key missing</Badge>
                    )}

                    {identity ? (
                        <div className="flex items-center gap-2">
                            <div className="hidden text-right sm:block">
                                <p className="max-w-[14rem] truncate text-xs font-medium">
                                    {identity.label}
                                </p>
                                <p className="num text-[10px] text-muted-foreground">
                                    {identity.source === "demo"
                                        ? identity.address
                                        : `${shortAddress(identity.address, 6, 4)}${keypair ? " · signer ready" : deriving ? " · deriving…" : ""}`}
                                </p>
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Sign out"
                                onClick={() => {
                                    void signOut();
                                }}
                            >
                                <LogOut />
                            </Button>
                        </div>
                    ) : (
                        <Button
                            variant="primary"
                            size="sm"
                            loading={busy}
                            title={
                                isConfigured
                                    ? "Opens the MySocial sign-in popup"
                                    : "VITE_MYSOCIAL_* is not configured — start a local demo session"
                            }
                            onClick={() => {
                                if (!isConfigured) {
                                    startDemoSession("Demo Operator");
                                    return;
                                }
                                // Safari requires the popup to open synchronously in the click handler.
                                setBusy(true);
                                void signIn()
                                    .catch(() => undefined)
                                    .finally(() => setBusy(false));
                            }}
                        >
                            <LogIn />
                            {isConfigured ? "Sign in with MySocial" : "Start demo session"}
                        </Button>
                    )}
                </div>
            </div>

            {deriveError ? (
                <div className="border-t border-warning/30 bg-warning/10 px-4 py-1.5 text-[11px] text-warning">
                    Keypair derivation: {deriveError}
                </div>
            ) : null}
        </header>
    );
}

function ServicePill({ label, ok }: { label: string; ok: boolean | undefined }) {
    return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] text-muted-foreground">
            <StatusDot ok={ok === true} />
            {label}
        </span>
    );
}
