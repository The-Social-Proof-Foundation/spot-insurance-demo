// Copyright (c) The Social Proof Foundation, LLC.
// SPDX-License-Identifier: Apache-2.0
//
// Environment + runtime configuration for the SPoT / Insurance demo backend.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Load the workspace `.env` (if present) before anything reads `process.env`. */
function loadDotEnv(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../.env"),
    resolve(dirname(process.argv[1] ?? ""), "../../.env"),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      // Node >= 20.12 / 21.7
      (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(file);
      return;
    } catch {
      // Already loaded or unsupported — env-file flag path covers this.
      return;
    }
  }
}

loadDotEnv();

function str(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value.trim();
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

/** The 0x50c1 social contracts package, in canonical short form. */
const RAW_PACKAGE = str("SOCIAL_PACKAGE_ID", "0x50c1");

/** `0x50c1` -> `0x000...050c1`. Already-padded values pass through unchanged. */
export function normalizePackageId(value: string): string {
  const bare = value.replace(/^0x/i, "");
  if (bare.length >= 64) return `0x${bare.toLowerCase()}`;
  return `0x${bare.padStart(64, "0").toLowerCase()}`;
}

export const env = {
  port: num("PORT", 8787),
  /** MySo JSON-RPC endpoint (the local node's fullnode RPC). */
  mysoRpcUrl: str("MYSO_RPC_URL", "http://127.0.0.1:9000"),
  /** Chain GraphQL — source of truth for enumerating SpotMarket objects. */
  graphqlUrl: str("GRAPHQL_URL", "http://127.0.0.1:9125/graphql"),
  /** myso-social-server REST API. */
  socialApiUrl: str("SOCIAL_API_URL", "http://127.0.0.1:9126"),
  /** Social contracts Move package. */
  socialPackageId: RAW_PACKAGE,
  socialPackageIdFull: normalizePackageId(RAW_PACKAGE),
  /** Shared `Clock` object (0x6 on MySo/Sui-style chains). */
  clockObjectId: str("CLOCK_OBJECT_ID", "0x6"),
  /**
   * The simulated ("fake") SPoT oracle / admin private key.
   *
   * Accepts: 32-byte hex seed, `0x`-prefixed hex, `00`-flagged 66-char hex,
   * base64 (32 or 33 bytes, flag byte optional), or a bech32 `myso-privkey-…` string.
   * When unset, all write endpoints are disabled but the read-only UI still works.
   */
  oraclePrivateKey: str("SPOT_ORACLE_PRIVATE_KEY", str("PRIVATE_KEY", "")),
  /** Shared secret for the oracle-only `/spot/pending-posts` route, when configured. */
  socialSyncSecret: str("SPOT_ORACLE_SYNC_SECRET", ""),
  /** Comma-separated allowed browser origins, or `*`. */
  corsOrigin: str("CORS_ORIGIN", "*"),
  /** Network label passed to the SDK client (only used for chain-id derivation). */
  network: str("MYSO_NETWORK", "localnet"),
  /** Explicit object overrides — auto-discovered from the chain when empty. */
  overrides: {
    spotConfig: str("SPOT_CONFIG_ID", ""),
    spotRegistry: str("SPOT_REGISTRY_ID", ""),
    spotAdminCap: str("SPOT_ADMIN_CAP_ID", ""),
    spotOracleAdminCap: str("SPOT_ORACLE_ADMIN_CAP_ID", ""),
    insuranceConfig: str("INSURANCE_CONFIG_ID", ""),
    insuranceRouterConfig: str("INSURANCE_ROUTER_CONFIG_ID", ""),
    insuranceBackstop: str("INSURANCE_BACKSTOP_ID", ""),
    insuranceAdminCap: str("INSURANCE_ADMIN_CAP_ID", ""),
    platform: str("PLATFORM_OBJECT_ID", ""),
    ecosystemTreasury: str("ECOSYSTEM_TREASURY_ID", ""),
  },
  /** Demo defaults used when the fake oracle approves a post or seeds a demo post. */
  demo: {
    claimText: str(
      "DEMO_CLAIM_TEXT",
      "The LA Rams will win at least one playoff game in the 2026-27 NFL season.",
    ),
    bettingOptions: str("DEMO_BETTING_OPTIONS", "Yes,No")
      .split(",")
      .map((option) => option.trim())
      .filter(Boolean),
    resolutionWindowMs: num("DEMO_RESOLUTION_WINDOW_MS", 7 * 24 * 60 * 60 * 1000),
    maxResolutionWindowMs: num("DEMO_MAX_RESOLUTION_WINDOW_MS", 30 * 24 * 60 * 60 * 1000),
    confidenceBps: num("DEMO_CONFIDENCE_BPS", 8500),
    /** Vault `deposit_capital` seeding for the demo underwriter. */
    vaultDepositMist: num("DEMO_VAULT_DEPOSIT_MIST", 1_000_000_000),
    /** Default premium the demo pays for coverage. */
    premiumMist: num("DEMO_PREMIUM_MIST", 50_000_000),
    coverageBps: num("DEMO_COVERAGE_BPS", 8000),
    coverageDurationMs: num("DEMO_COVERAGE_DURATION_MS", 3 * 24 * 60 * 60 * 1000),
    betMist: num("DEMO_BET_MIST", 250_000_000),
  },
  /** Log every built transaction (dry-run only) instead of executing. */
  dryRun: bool("SPOT_ORACLE_DRY_RUN", false),
} as const;

export type Env = typeof env;
