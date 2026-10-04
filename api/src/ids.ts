// Copyright (c) The Social Proof Foundation, LLC.
// SPDX-License-Identifier: Apache-2.0
//
// Object-ID discovery.
//
// Every shared/owned object this demo touches is located by Move type via the
// chain GraphQL index, then cached. Nothing here writes to the chain or to the
// indexer — it is pure discovery, so the demo keeps working across regenesis
// without any hard-coded object ids.

import { env } from "./env.js";
import { firstObjectOfType, listObjectsByType, ownedObjectsOfType } from "./gql.js";
import { oracleAddress } from "./chain.js";

const PKG = env.socialPackageId;

export const moveTypes = {
  spotConfig: `${PKG}::social_proof_of_truth::SpotConfig`,
  spotRegistry: `${PKG}::social_proof_of_truth::SpotClaimRegistry`,
  spotClaim: `${PKG}::social_proof_of_truth::SpotClaim`,
  spotMarket: `${PKG}::social_proof_of_truth::SpotMarket`,
  spotAdminCap: `${PKG}::social_proof_of_truth::SpotAdminCap`,
  spotOracleAdminCap: `${PKG}::social_proof_of_truth::SpotOracleAdminCap`,
  insuranceConfig: `${PKG}::insurance::InsuranceConfig`,
  insuranceRouterConfig: `${PKG}::insurance::InsuranceRouterConfig`,
  insuranceBackstop: `${PKG}::insurance::InsuranceBackstopPool`,
  insuranceAdminCap: `${PKG}::insurance::InsuranceAdminCap`,
  underwriterVault: `${PKG}::insurance::UnderwriterVault`,
  coveragePolicy: `${PKG}::insurance::CoveragePolicy`,
  platform: `${PKG}::platform::Platform`,
  platformConfig: `${PKG}::platform::PlatformConfig`,
  platformRegistry: `${PKG}::platform::PlatformRegistry`,
  ecosystemTreasury: `${PKG}::profile::EcosystemTreasury`,
  usernameRegistry: `${PKG}::profile::UsernameRegistry`,
  profileConfig: `${PKG}::profile::ProfileConfig`,
  profile: `${PKG}::profile::Profile`,
  blockListRegistry: `${PKG}::block_list::BlockListRegistry`,
  postConfig: `${PKG}::post::PostConfig`,
  memoryConfig: `${PKG}::memory::MemoryConfig`,
  memoryRegistry: `${PKG}::memory::MemoryRegistry`,
  memoryAccount: `${PKG}::memory::MemoryAccount`,
  mydataRegistry: `${PKG}::mydata::MyDataRegistry`,
  aiCreditConfig: `${PKG}::ai_credit::AiCreditConfig`,
  post: `${PKG}::post::Post`,
} as const;

export type IdKey = keyof typeof moveTypes;

const TTL_MS = 20_000;
const cache = new Map<IdKey, { value: string | null; at: number }>();

/** The subset of ids that is required for the oracle write paths to function. */
export interface ResolvedIds {
  spotConfig: string | null;
  spotRegistry: string | null;
  spotOracleAdminCap: string | null;
  spotAdminCap: string | null;
  insuranceConfig: string | null;
  insuranceRouterConfig: string | null;
  insuranceBackstop: string | null;
  insuranceAdminCap: string | null;
  platform: string | null;
  ecosystemTreasury: string | null;
  clock: string;
}

async function discover(key: IdKey): Promise<string | null> {
  const override = env.overrides[key as keyof typeof env.overrides];
  if (override) return override;

  const type = moveTypes[key];
  const owner = oracleAddress();

  // Capabilities are owned objects transferred by bootstrap; everything else is shared.
  if (owner && (key.endsWith("AdminCap") || key === "memoryAccount" || key === "profile")) {
    const owned = await ownedObjectsOfType(owner, type, { last: true });
    const match = owned[owned.length - 1];
    return match?.address ?? null;
  }

  const node = await firstObjectOfType(type, { last: key.endsWith("AdminCap") });
  if (node) return node.address;

  // Fall back to an owned scan (some caps may be address-owned rather than shared).
  if (owner) {
    const owned = await ownedObjectsOfType(owner, type, { last: true });
    return owned[owned.length - 1]?.address ?? null;
  }
  return null;
}

export async function getId(key: IdKey, options: { refresh?: boolean } = {}): Promise<string | null> {
  const hit = cache.get(key);
  if (!options.refresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let value: string | null = null;
  try {
    value = await discover(key);
  } catch {
    value = null;
  }
  cache.set(key, { value, at: Date.now() });
  return value;
}

export async function getIdOrThrow(key: IdKey): Promise<string> {
  const value = await getId(key);
  if (!value) {
    throw new Error(
      `Could not discover the ${key} object (${moveTypes[key]}) on chain. ` +
        `Is the local network running and bootstrapped?`,
    );
  }
  return value;
}

/** Resolve everything the SPoT/insurance write paths need, in parallel. */
export async function resolveCoreIds(): Promise<ResolvedIds> {
  const [
    spotConfig,
    spotRegistry,
    spotOracleAdminCap,
    spotAdminCap,
    insuranceConfig,
    insuranceRouterConfig,
    insuranceBackstop,
    insuranceAdminCap,
    platform,
    ecosystemTreasury,
  ] = await Promise.all([
    getId("spotConfig"),
    getId("spotRegistry"),
    getId("spotOracleAdminCap"),
    getId("spotAdminCap"),
    getId("insuranceConfig"),
    getId("insuranceRouterConfig"),
    getId("insuranceBackstop"),
    getId("insuranceAdminCap"),
    getId("platform"),
    getId("ecosystemTreasury"),
  ]);

  return {
    spotConfig,
    spotRegistry,
    spotOracleAdminCap,
    spotAdminCap,
    insuranceConfig,
    insuranceRouterConfig,
    insuranceBackstop,
    insuranceAdminCap,
    platform,
    ecosystemTreasury,
    clock: env.clockObjectId,
  };
}

export function clearIdCache(): void {
  cache.clear();
}

/** Find a shared object of a type whose JSON field equals `expected` (e.g. MemoryAccount.owner). */
export async function findObjectByField(
  key: IdKey,
  field: string,
  expected: string,
): Promise<string | null> {
  const nodes = await listObjectsByType(moveTypes[key], { maxPages: 10 });
  const target = expected.toLowerCase();
  const match = nodes.find(
    (node) => String(node.json?.[field] ?? "").toLowerCase() === target,
  );
  return match?.address ?? null;
}
