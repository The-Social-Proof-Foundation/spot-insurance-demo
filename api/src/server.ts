// Copyright (c) The Social Proof Foundation, LLC.
// SPDX-License-Identifier: Apache-2.0
//
// Demo API server: read-only aggregation over the chain GraphQL + social
// indexer REST, plus operator endpoints that submit transactions signed by the
// simulated SPoT oracle key.
//
// Zero HTTP framework dependencies — a small explicit router over node:http.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { OracleActionError } from "./errors.js";
import { oracleBalanceMist, oracleAddress, oracleKeyStatus } from "./chain.js";
import { env } from "./env.js";
import { listObjectsByType } from "./gql.js";
import { moveTypes, resolveCoreIds } from "./ids.js";
import { loadMarketDetail, loadMarketRows, loadMarketExposure } from "./markets.js";
import {
  approvePostForSpot,
  quoteCoverage,
  buyCoverage,
  claimPayout,
  createInsuranceVault,
  currentVaultId,
  depositVaultCapital,
  placeBet,
  readSpotConfig,
  resolveMarket,
  seedDemoPost,
  setInsuranceEnabled,
  updateSpotConfig,
} from "./oracle.js";
import { social } from "./social.js";

type Handler = (ctx: {
  body: Record<string, unknown>;
  params: Record<string, string>;
  query: URLSearchParams;
}) => Promise<unknown>;

interface Route {
  method: "GET" | "POST";
  pattern: string;
  handler: Handler;
}

function str(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text === "" ? undefined : text;
}

function requireStr(body: Record<string, unknown>, key: string): string {
  const value = str(body, key);
  if (!value) throw new OracleActionError(`Missing required field "${key}".`, 400);
  return value;
}

function num(body: Record<string, unknown>, key: string, fallback?: number): number {
  const value = body[key];
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) return fallback;
    throw new OracleActionError(`Missing required numeric field "${key}".`, 400);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new OracleActionError(`Field "${key}" must be a number.`, 400);
  }
  return parsed;
}

function strArray(body: Record<string, unknown>, key: string): string[] | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.map((entry) => String(entry)).filter(Boolean);
  return String(value)
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Best-effort service reachability probe for the header status pills. */
async function servicesStatus() {
  const probe = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return true;
    } catch {
      return false;
    }
  };

  const [rpc, graphql, socialServer] = await Promise.all([
    probe(async () => {
      const { client } = await import("./chain.js");
      await client.getChainIdentifier();
    }),
    probe(() => listObjectsByType(moveTypes.spotConfig, { maxPages: 1 })),
    probe(() => social.health()),
  ]);

  return { rpc, graphql, socialServer };
}

const routes: Route[] = [
  {
    method: "GET",
    pattern: "/api/health",
    handler: async () => {
      const services = await servicesStatus();
      // `ok` means the backend AND everything it depends on is reachable.
      return { ok: Object.values(services).every(Boolean), services };
    },
  },

  {
    method: "GET",
    pattern: "/api/overview",
    handler: async () => {
      const [ids, spotConfig, insuranceConfig, vaults, pendingPosts, balance, services] =
        await Promise.all([
          resolveCoreIds(),
          readSpotConfig().catch(() => null),
          social.insuranceConfig().catch(() => null),
          social.insuranceVaults(50).catch(() => []),
          social.pendingPosts(50).catch(() => []),
          oracleBalanceMist().catch(() => null),
          servicesStatus(),
        ]);

      // Do not silently turn an upstream outage into "zero markets" — record it so
      // the UI can distinguish "nothing exists" from "we could not ask".
      const warnings: string[] = [];
      const markets = await loadMarketRows().catch((error: unknown) => {
        warnings.push(
          `Market data unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
        return [];
      });
      const exposure = await loadMarketExposure().catch(() => new Map<string, string>());

      if (!services.graphql) {
        warnings.push(
          `Chain GraphQL unreachable at ${env.graphqlUrl} — markets cannot be enumerated.`,
        );
      }
      if (!services.rpc) {
        warnings.push(`MySo node RPC unreachable at ${env.mysoRpcUrl} — oracle actions unavailable.`);
      }
      if (!services.socialServer) {
        warnings.push(
          `Social API unreachable at ${env.socialApiUrl} — indexed escrow and insurance are stale.`,
        );
      }

      const degraded = warnings.length > 0;

      return {
        services,
        degraded,
        warnings,
        oracle: {
          ...oracleKeyStatus(),
          balanceMist: balance === null ? null : balance.toString(),
          privateKeySource: env.oraclePrivateKey ? "SPOT_ORACLE_PRIVATE_KEY" : null,
          dryRun: env.dryRun,
        },
        endpoints: {
          mysoRpcUrl: env.mysoRpcUrl,
          graphqlUrl: env.graphqlUrl,
          socialApiUrl: env.socialApiUrl,
          socialPackageId: env.socialPackageId,
        },
        ids,
        spotConfig,
        insuranceConfig,
        vaultId: await currentVaultId().catch(() => null),
        stats: {
          marketCount: markets.length,
          openCount: markets.filter((row) => row.isOpen).length,
          resolvedCount: markets.filter((row) => !row.isOpen).length,
          pendingPostCount: pendingPosts.length,
          vaultCount: vaults.length,
          coveredMist: markets
            .reduce((sum, row) => sum + BigInt(row.insurance.coveredMist), 0n)
            .toString(),
          tvlMist: markets.reduce((sum, row) => sum + BigInt(row.totalEscrowMist), 0n).toString(),
          exposureByMarket: Object.fromEntries(exposure),
        },
        demoDefaults: env.demo,
      };
    },
  },

  {
    method: "GET",
    pattern: "/api/markets",
    handler: async () => {
      const [rows, exposure] = await Promise.all([
        loadMarketRows(),
        loadMarketExposure().catch(() => new Map<string, string>()),
      ]);
      return {
        markets: rows.map((row) => ({
          ...row,
          insurance: {
            ...row.insurance,
            exposureMist: exposure.get(row.marketId) ?? "0",
          },
        })),
      };
    },
  },

  {
    method: "GET",
    pattern: "/api/markets/:marketId",
    handler: async ({ params }) => {
      const detail = await loadMarketDetail(params.marketId ?? "");
      if (!detail) throw new OracleActionError(`Market ${params.marketId} not found.`, 404);
      return detail;
    },
  },

  {
    method: "GET",
    pattern: "/api/pending-posts",
    handler: async () => ({ posts: await social.pendingPosts(100) }),
  },

  {
    method: "GET",
    pattern: "/api/posts",
    handler: async ({ query }) => {
      const limit = Number(query.get("limit") ?? 25);
      const nodes = await listObjectsByType(moveTypes.post, { pageSize: 25, maxPages: 2 });
      const markets = await loadMarketRows().catch(() => []);
      const byPost = new Map(markets.map((row) => [row.postId.toLowerCase(), row]));

      return {
        posts: nodes.slice(0, limit).map((node) => {
          const json = node.json ?? {};
          const market = byPost.get(node.address.toLowerCase());
          return {
            postId: node.address,
            owner: (json.owner as string | undefined) ?? null,
            content: (json.content as string | undefined) ?? "",
            createdAtMs: Number(String(json.created_at ?? json.created_at_ms ?? 0)) || 0,
            spotAnalysisStatus: Number(String(json.spot_analysis_status ?? 0)),
            enableSpot: json.enable_spot === true,
            marketId: market?.marketId ?? null,
            marketStatus: market?.status ?? null,
          };
        }),
      };
    },
  },

  {
    method: "GET",
    pattern: "/api/insurance/vaults",
    handler: async () => {
      const vaults = await social.insuranceVaults(100).catch(() => []);
      const enriched = await Promise.all(
        vaults.map(async (vault) => ({
          ...vault,
          exposures: await social.insuranceVaultExposures(vault.vault_id).catch(() => []),
        })),
      );
      return { vaults: enriched };
    },
  },

  {
    method: "GET",
    pattern: "/api/insurance/policies",
    handler: async ({ query }) => {
      const marketId = query.get("marketId") ?? undefined;
      const policies = await social.insurancePolicies({
        market_id: marketId,
        limit: Number(query.get("limit") ?? 100),
      });
      return { policies };
    },
  },

  // ---- Simulated oracle / admin actions -------------------------------

  {
    method: "POST",
    pattern: "/api/oracle/approve",
    handler: async ({ body }) => {
      const postId = requireStr(body, "postId");
      const result = await approvePostForSpot({
        postId,
        claimText: str(body, "claimText"),
        resolutionAtMs: body.resolutionAtMs !== undefined ? num(body, "resolutionAtMs") : undefined,
        bettingOptions: strArray(body, "bettingOptions"),
        maxResolutionWindowMs:
          body.maxResolutionWindowMs !== undefined ? num(body, "maxResolutionWindowMs") : undefined,
      });
      return result;
    },
  },

  {
    method: "POST",
    pattern: "/api/oracle/resolve",
    handler: async ({ body }) => {
      const tx = await resolveMarket({
        marketId: requireStr(body, "marketId"),
        outcomeOptionId: num(body, "outcomeOptionId"),
        confidenceBps: body.confidenceBps !== undefined ? num(body, "confidenceBps") : undefined,
        reasoning: requireStr(body, "reasoning"),
        evidenceUrls: strArray(body, "evidenceUrls") ?? [],
      });
      return { tx };
    },
  },

  {
    method: "POST",
    pattern: "/api/oracle/config/spot",
    handler: async ({ body }) => {
      const truthEnabled = body.truthEnabled === true || String(body.truthEnabled) === "true";
      const result = await updateSpotConfig({
        truthEnabled,
        confidenceThresholdBps:
          body.confidenceThresholdBps !== undefined
            ? num(body, "confidenceThresholdBps")
            : undefined,
      });
      return { digest: result.tx.digest, config: result.config };
    },
  },

  {
    method: "POST",
    pattern: "/api/oracle/config/insurance",
    handler: async ({ body }) => {
      const enabled = body.enabled === true || String(body.enabled) === "true";
      const tx = await setInsuranceEnabled(enabled);
      return { digest: tx.digest, enabled };
    },
  },

  {
    method: "POST",
    pattern: "/api/oracle/bet",
    handler: async ({ body }) => {
      const tx = await placeBet({
        marketId: requireStr(body, "marketId"),
        postId: requireStr(body, "postId"),
        optionId: num(body, "optionId", 0),
        amountMist: num(body, "amountMist", env.demo.betMist),
      });
      return { tx };
    },
  },

  {
    method: "POST",
    pattern: "/api/oracle/vault",
    handler: async ({ body }) => {
      const existing = await currentVaultId();
      let vaultId = existing;
      const created: string[] = [];
      if (!vaultId) {
        const result = await createInsuranceVault();
        created.push(result.tx.digest);
        vaultId = result.vaultId;
      }
      const amountMist = num(body, "amountMist", env.demo.vaultDepositMist);
      if (amountMist > 0 && vaultId) {
        const deposit = await depositVaultCapital({ vaultId, amountMist });
        created.push(deposit.digest);
      }
      return { vaultId, digests: created };
    },
  },

  {
    method: "POST",
    pattern: "/api/oracle/quote",
    handler: async ({ body }) => ({
      quote: await quoteCoverage({
        marketId: requireStr(body, "marketId"),
        optionId: num(body, "optionId", 0),
        coveredAmountMist: num(body, "coveredAmountMist", env.demo.betMist),
        coverageBps: body.coverageBps !== undefined ? num(body, "coverageBps") : undefined,
        durationMs: body.durationMs !== undefined ? num(body, "durationMs") : undefined,
        vaultId: str(body, "vaultId"),
      }),
    }),
  },

  {
    method: "POST",
    pattern: "/api/oracle/coverage",
    handler: async ({ body }) => {
      const result = await buyCoverage({
        marketId: requireStr(body, "marketId"),
        optionId: num(body, "optionId", 0),
        coverageAmountMist: num(body, "coverageAmountMist", env.demo.betMist),
        coverageBps: body.coverageBps !== undefined ? num(body, "coverageBps") : undefined,
        durationMs: body.durationMs !== undefined ? num(body, "durationMs") : undefined,
        premiumMist: body.premiumMist !== undefined ? num(body, "premiumMist") : undefined,
        vaultId: str(body, "vaultId"),
      });
      return { digest: result.tx.digest, policyId: result.policyId };
    },
  },

  {
    method: "POST",
    pattern: "/api/oracle/payout",
    handler: async ({ body }) => {
      const tx = await claimPayout({
        marketId: requireStr(body, "marketId"),
        postId: requireStr(body, "postId"),
      });
      return { tx };
    },
  },

  {
    method: "POST",
    pattern: "/api/oracle/seed-post",
    handler: async ({ body }) => {
      const result = await seedDemoPost({
        claimText: str(body, "claimText"),
        username: str(body, "username"),
        displayName: str(body, "displayName"),
      });
      return result;
    },
  },
];

function matchRoute(
  method: string,
  pathname: string,
): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const routeParts = route.pattern.split("/");
    const pathParts = pathname.split("/");
    if (routeParts.length !== pathParts.length) continue;

    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < routeParts.length; i += 1) {
      const routePart = routeParts[i] ?? "";
      const pathPart = pathParts[i] ?? "";
      if (routePart.startsWith(":")) {
        params[routePart.slice(1)] = decodeURIComponent(pathPart);
      } else if (routePart !== pathPart) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}

function applyCors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", env.corsOrigin);
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > 1_000_000) throw new OracleActionError("Request body too large.", 413);
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text === "") return {};
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new OracleActionError("Request body must be valid JSON.", 400);
  }
}

export function startServer(): Promise<{ port: number; url: string }> {
  const server = createServer(async (req, res) => {
    applyCors(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const match = matchRoute(req.method ?? "GET", url.pathname);

    if (!match) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `No route for ${req.method} ${url.pathname}` }));
      return;
    }

    try {
      const body = req.method === "POST" ? await readBody(req) : {};
      const started = Date.now();
      const payload = await match.route.handler({ body, params: match.params, query: url.searchParams });
      const elapsed = Date.now() - started;
      console.log(
        `${req.method} ${url.pathname} -> 200 (${elapsed}ms)`,
      );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    } catch (error) {
      const status = error instanceof OracleActionError ? error.status : 500;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${req.method} ${url.pathname} -> ${status}: ${message}`);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: message, status }));
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(env.port, "127.0.0.1", () => {
      resolve({ port: env.port, url: `http://127.0.0.1:${env.port}` });
    });
  });
}

export { oracleAddress };
