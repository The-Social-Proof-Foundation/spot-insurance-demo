// Copyright (c) The Social Proof Foundation, LLC.
// SPDX-License-Identifier: Apache-2.0
//
// MySo chain access: client construction, oracle keypair loading, and a single
// execute helper used by every write path in the demo.

import { MySoJsonRpcClient } from "@socialproof/myso/jsonRpc";
import { Ed25519Keypair } from "@socialproof/myso/keypairs/ed25519";
import { Transaction } from "@socialproof/myso/transactions";
import { env } from "./env.js";

export const client = new MySoJsonRpcClient({ url: env.mysoRpcUrl, network: env.network });

/**
 * A factory for short-lived clients.
 *
 * The SDK keeps an object cache per client. Because the oracle address spends
 * from a single MYSO coin, sequential transactions invalidate that coin's
 * `(id, version, digest)` ref — reusing a cached client makes the next
 * transaction fail with "Object ... is invalid". The reference Rust oracle
 * builds a fresh client per transaction for the same reason.
 */
export function freshClient(): MySoJsonRpcClient {
  return new MySoJsonRpcClient({ url: env.mysoRpcUrl, network: env.network });
}

export class ChainError extends Error {
  constructor(
    message: string,
    readonly digest?: string,
  ) {
    super(message);
    this.name = "ChainError";
  }
}

/** Decode the many shapes a private key may arrive in into 32 raw seed bytes. */
function decodePrivateKey(raw: string): Uint8Array {
  const value = raw.trim();
  if (value === "") throw new Error("empty private key");

  // bech32 `mysoprivkey…`
  if (value.toLowerCase().startsWith("mysoprivkey")) {
    const { decodeMySoPrivateKey } = requireCrypto();
    const parsed = decodeMySoPrivateKey(value);
    return parsed.secretKey;
  }

  // base64 (with or without the scheme flag byte)
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0) {
    const bytes = Uint8Array.from(Buffer.from(value, "base64"));
    if (bytes.length === 33 || bytes.length === 32) {
      return bytes.length === 33 ? bytes.slice(1) : bytes;
    }
  }

  // hex, optionally 0x-prefixed, optionally with the 0x00 Ed25519 scheme flag
  const hex = value.replace(/^0x/i, "");
  if (/^[0-9a-fA-F]+$/.test(hex) && (hex.length === 64 || hex.length === 66)) {
    const bytes = Uint8Array.from(Buffer.from(hex, "hex"));
    return bytes.length === 33 ? bytes.slice(1) : bytes;
  }

  throw new Error(
    "Unrecognised private key format. Use 32-byte hex, 0x/00-prefixed 66-char hex, base64, or a bech32 mysoprivkey string.",
  );
}

// Lazily imported to keep the module graph small when no key is configured.
function requireCrypto(): { decodeMySoPrivateKey: (v: string) => { secretKey: Uint8Array } } {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = globalThis.__mysoCrypto ?? null;
  if (!mod) {
    throw new Error(
      "bech32 private keys are not supported in this build; pass hex or base64 instead.",
    );
  }
  return mod as { decodeMySoPrivateKey: (v: string) => { secretKey: Uint8Array } };
}

declare global {
  // eslint-disable-next-line no-var
  var __mysoCrypto: unknown;
}

let cachedKeypair: Ed25519Keypair | null = null;
let keypairError: string | null = null;

/** The simulated SPoT oracle / admin keypair, or null when unconfigured/invalid. */
export function oracleKeypair(): Ed25519Keypair | null {
  if (cachedKeypair) return cachedKeypair;
  if (keypairError) return null;
  if (!env.oraclePrivateKey) {
    keypairError = "SPOT_ORACLE_PRIVATE_KEY is not set";
    return null;
  }
  try {
    cachedKeypair = Ed25519Keypair.fromSecretKey(decodePrivateKey(env.oraclePrivateKey));
    return cachedKeypair;
  } catch (error) {
    keypairError = (error as Error).message;
    return null;
  }
}

export function oracleAddress(): string | null {
  return oracleKeypair()?.getPublicKey().toMySoAddress() ?? null;
}

export function oracleKeyStatus(): { configured: boolean; address: string | null; error: string | null } {
  const keypair = oracleKeypair();
  return {
    configured: keypair !== null,
    address: keypair ? keypair.getPublicKey().toMySoAddress() : null,
    error: keypair ? null : keypairError,
  };
}

export interface TxEvent {
  eventType: string;
  json: Record<string, unknown> | null;
  sender?: string;
}

export interface ExecutedTx {
  digest: string;
  status: "success" | "failure";
  error: string | null;
  events: TxEvent[];
  gasUsed: string | null;
  createdObjects: string[];
  /** objectId -> fully-qualified Move type, for objects in the effects. */
  objectTypes: Record<string, string>;
}

/** Find a created object id by its Move struct name, e.g. `Post` or `SpotMarket`. */
export function findCreatedObject(tx: ExecutedTx, structName: string): string | null {
  for (const id of tx.createdObjects) {
    const type = tx.objectTypes[id] ?? "";
    if (type.split("::").pop() === structName) return id;
  }
  // Fall back to any object of that type (in case effects came back without `created`).
  for (const [id, type] of Object.entries(tx.objectTypes)) {
    if (type.split("::").pop() === structName && !tx.createdObjects.includes(id)) return id;
  }
  return null;
}

/** Extract created (non-package) object ids from transaction effects. */
function createdObjectIds(effects: unknown): string[] {
  const changed = (effects as { changedObjects?: Array<{ objectId?: string; idOperation?: string }> })
    ?.changedObjects;
  if (!Array.isArray(changed)) return [];
  return changed
    .filter((entry) => String(entry.idOperation ?? "").toLowerCase().includes("creat"))
    .map((entry) => entry.objectId ?? "")
    .filter(Boolean);
}

function normalizeEvents(events: unknown): TxEvent[] {
  if (!Array.isArray(events)) return [];
  return events.map((event) => {
    const record = event as Record<string, unknown>;
    return {
      eventType: String(record.eventType ?? record.type ?? ""),
      json: (record.json as Record<string, unknown> | null) ?? null,
      sender: typeof record.sender === "string" ? record.sender : undefined,
    };
  });
}

/** Find the first event whose Move struct name matches (e.g. `SpotMarketCreatedEvent`). */
export function findEvent(tx: ExecutedTx, structName: string): TxEvent | null {
  return tx.events.find((event) => event.eventType.split("::").pop() === structName) ?? null;
}

/**
 * Sign and execute a PTB with the simulated oracle keypair.
 *
 * The transaction is built with `tx.build({ client })`, which runs the SDK's
 * resolution plugin: it fills sender, gas price, gas budget, gas coins and the
 * (objectId, version, digest) refs for every input — including inferring the
 * mutability of shared objects from how the Move call consumes them.
 *
 * A short-lived client is used per attempt because the SDK caches object refs;
 * and a bounded retry absorbs the local node's coin-index lag, which would
 * otherwise surface as `Version 0x… is not available for consumption`.
 */
export async function executeAsOracle(
  build: (tx: Transaction, sender: string) => void,
  label: string,
): Promise<ExecutedTx> {
  const keypair = oracleKeypair();
  if (!keypair) {
    throw new ChainError(
      `Simulated oracle key unavailable (${keypairError ?? "unknown"}). Set SPOT_ORACLE_PRIVATE_KEY in .env.`,
    );
  }
  const sender = keypair.getPublicKey().toMySoAddress();

  const attempts = 6;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    // Fresh client per attempt — see `freshClient()`.
    const txClient = freshClient();
    const tx = new Transaction();
    build(tx, sender);
    tx.setSenderIfNotSet(sender);

    let bytes: Uint8Array;
    try {
      bytes = await tx.build({ client: txClient });
    } catch (error) {
      lastError = error;
      if (attempt < attempts && isRetryable(error)) {
        await sleep(500 * attempt);
        continue;
      }
      throw describe(error, label, "failed to build");
    }

    if (env.dryRun) {
      const sim = await txClient.core.simulateTransaction({
        transaction: bytes,
        include: { commandResults: true, effects: true },
      });
      const ok = sim.$kind === "Transaction";
      throw new ChainError(
        `SPOT_ORACLE_DRY_RUN is enabled — ${label} was simulated ${ok ? "successfully" : "and FAILED"}: ${JSON.stringify(sim).slice(0, 600)}`,
      );
    }

    let result;
    try {
      result = await txClient.core.signAndExecuteTransaction({
        transaction: bytes,
        signer: keypair,
        include: { effects: true, events: true, objectTypes: true },
      });
    } catch (error) {
      lastError = error;
      if (attempt < attempts && isRetryable(error)) {
        console.warn(`${label}: retryable submit failure (attempt ${attempt}/${attempts})`);
        await sleep(900 * attempt);
        continue;
      }
      throw describe(error, label, "failed to submit");
    }

    const payload = result.$kind === "Transaction" ? result.Transaction : result.FailedTransaction;
    const status = payload.status;
    const succeeded = result.$kind === "Transaction" && status?.success === true;

    const executed: ExecutedTx = {
      digest: payload.digest,
      status: succeeded ? "success" : "failure",
      error: succeeded ? null : JSON.stringify(status?.error ?? "unknown error"),
      events: normalizeEvents(payload.events),
      gasUsed:
        (payload.effects as { gasUsed?: { computationCost?: string } } | undefined)?.gasUsed
          ?.computationCost ?? null,
      createdObjects: createdObjectIds(payload.effects),
      objectTypes: (payload.objectTypes as Record<string, string> | undefined) ?? {},
    };

    if (!succeeded) {
      throw new ChainError(`${label} aborted: ${executed.error}`, executed.digest);
    }

    // Block until the local node has the effect applied. Without this, a write that
    // immediately depends on the previous one (bet -> buy_coverage, approve ->
    // resolve) can be built against a read that has not observed it yet.
    await txClient
      .waitForTransaction({ digest: executed.digest, timeout: 15_000 })
      .catch(() => undefined);

    return executed;
  }

  throw describe(lastError, label, "exhausted retries");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Stale object refs, gas-coin races and epoch-boundary rejections are all retryable. */
function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /is not available for consumption|not available for consumption|Object ID .* is invalid|rejected as invalid|Version 0x[0-9a-f]+ Digest|object version|reserved for another transaction|needs to be re-signed|transaction is already finalized|does not exist|input objects are invalid|epoch/i.test(
    message,
  );
}

function describe(error: unknown, label: string, phase: string): ChainError {
  const message = error instanceof Error ? error.message : String(error);
  return error instanceof ChainError ? error : new ChainError(`${label} ${phase}: ${message}`);
}

/** Convenience: the oracle's MYSO balance in mist (as a bigint). */
export async function oracleBalanceMist(): Promise<bigint | null> {
  const address = oracleAddress();
  if (!address) return null;
  const balance = await client.getBalance({ owner: address });
  return BigInt(balance.totalBalance ?? "0");
}
