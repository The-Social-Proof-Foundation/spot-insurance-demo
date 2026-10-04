# MySocial Auth + MySo Transaction Signing — Reverse-Engineering Report

Source project: `/Users/brandonshaw/Offline-Projects/ProjectYZ/orderbook-sandbox-main/sandbox/dashboard/`
Target: rebuild the identical pattern in a new TypeScript app.

---

## 0. TL;DR architecture

```
main.tsx
 └─ <QueryClientProvider>                     @tanstack/react-query
     └─ <MySocialAuthProvider>                src/contexts/mysocial-auth-context.tsx
         └─ <DAppKitProvider dAppKit>          src/dapp-kit.ts (@socialproof/dapp-kit-react)
             └─ <App />
                 ├─ <MySocialWalletBridge />  useMySocialWallet() — registers derived keypair as a
                 │                            Wallet Standard wallet, then connectWallet()
                 └─ <BrowserRouter>
                     ├─ /auth/callback        AuthCallbackPage (redirect-mode return)
                     ├─ /                     HealthPage
                     ├─ /market-maker         MarketMakerPage
                     ├─ /trading              TradingPage     ← all writes via dAppKit.signAndExecuteTransaction
                     └─ /deployment           DeploymentPage
```

Two independent credential systems coexist:

1. **MySocial OAuth** (`@socialproof/mysocial-auth`) → `Session` → **derived `Ed25519Keypair`**
   (`SHA-256(sub + "_" + salt)` truncated to 32 bytes).
2. **dApp-kit / Wallet Standard** (`@socialproof/dapp-kit-react`) → the connected wallet that
   actually signs. The derived keypair is *injected* into dApp-kit as a synthetic in-memory wallet
   named `"MySocial Wallet"`.

Signing always goes through **`dAppKit.signAndExecuteTransaction({ transaction })`** — the derived
keypair never calls `MySoGrpcClient.signAndExecuteTransaction` directly in app code. It reaches the
chain via the Wallet Standard feature `myso:signAndExecuteTransaction`, which the in-memory wallet
implements by calling `Ed25519Keypair.signAndExecuteTransaction({ transaction, client })`.

---

## 1. Exact dependency list

All packages come from the **public npm registry** (`https://registry.npmjs.org/`). There is:

- **no `.npmrc`** anywhere in `orderbook-sandbox-main/`, `sandbox/`, or `sandbox/dashboard/`;
- **no `pnpm-workspace.yaml`**;
- **no `link:` / `file:` / `workspace:` references** in any `package.json`;
- a `.gitmodules` at repo root pointing at `external/orderbook` (MystenLabs/orderbookv3) — unrelated to the dashboard's npm deps;
- `pnpm-lock.yaml` `settings.default: https://registry.npmjs.org/`.

### 1.1 `package.json` verbatim

```json
{
    "name": "dashboard",
    "private": true,
    "version": "0.0.0",
    "type": "module",
    "scripts": {
        "dev": "vite",
        "build": "tsc -b && vite build",
        "lint": "eslint .",
        "preview": "vite preview"
    },
    "dependencies": {
        "@radix-ui/react-popover": "^1.1.15",
        "@radix-ui/react-tooltip": "^1.2.8",
        "@socialproof/dapp-kit-core": "^0.0.4",
        "@socialproof/dapp-kit-react": "^0.0.4",
        "@socialproof/myso": "^0.0.4",
        "@socialproof/mysocial-auth": "^0.12.0",
        "@socialproof/orderbook": "^0.0.4",
        "@socialproof/signers": "^0.0.4",
        "@socialproof/wallet-standard": "^0.0.2",
        "@tanstack/react-query": "^5.0.0",
        "autoprefixer": "^10.4.24",
        "class-variance-authority": "^0.7.1",
        "clsx": "^2.1.1",
        "lucide-react": "^0.575.0",
        "postcss": "^8.5.6",
        "react": "^19.2.0",
        "react-dom": "^19.2.0",
        "react-router-dom": "^7.13.1",
        "recharts": "^3.7.0",
        "tailwind-merge": "^3.5.0",
        "tailwindcss": "^3.4.19",
        "tailwindcss-animate": "^1.0.7"
    },
    "devDependencies": {
        "@eslint/js": "^9.39.1",
        "@types/node": "^24.10.1",
        "@types/react": "^19.2.7",
        "@types/react-dom": "^19.2.3",
        "@vitejs/plugin-react": "^5.1.1",
        "eslint": "^9.39.1",
        "eslint-config-prettier": "^10.1.8",
        "eslint-plugin-prettier": "^5.5.5",
        "eslint-plugin-react-hooks": "^7.0.1",
        "eslint-plugin-react-refresh": "^0.4.24",
        "globals": "^16.5.0",
        "prettier": "^3.8.1",
        "typescript": "~5.9.3",
        "typescript-eslint": "^8.48.0",
        "vite": "^7.3.1"
    }
}
```

### 1.2 Declared range vs. actually locked version (from `pnpm-lock.yaml`)

| Package | Declared | Resolved / installed | Source |
|---|---|---|---|
| `@socialproof/myso` | `^0.0.4` | `0.0.4(typescript@5.9.3)` | npm |
| `@socialproof/mysocial-auth` | `^0.12.0` | `0.12.0` | npm |
| `@socialproof/dapp-kit-core` | `^0.0.4` | `0.0.4(@socialproof/myso@0.0.4)` | npm |
| `@socialproof/dapp-kit-react` | `^0.0.4` | `0.0.4(@socialproof/myso@0.0.4)(@types/react@19.2.14)(react@19.2.4)` | npm |
| `@socialproof/orderbook` | `^0.0.4` | `0.0.4(@socialproof/myso@0.0.4)` | npm |
| `@socialproof/signers` | `^0.0.4` | `0.0.4(@socialproof/myso@0.0.4)` | npm |
| `@socialproof/wallet-standard` | `^0.0.2` | `0.0.2(@socialproof/myso@0.0.4)` | npm |
| `@radix-ui/react-popover` | `^1.1.15` | `1.1.15` | npm |
| `@radix-ui/react-tooltip` | `^1.2.8` | `1.2.8` | npm |
| `@tanstack/react-query` | `^5.0.0` | `5.90.21(react@19.2.4)` | npm |
| `autoprefixer` | `^10.4.24` | `10.4.24(postcss@8.5.6)` | npm |
| `class-variance-authority` | `^0.7.1` | `0.7.1` | npm |
| `clsx` | `^2.1.1` | `2.1.1` | npm |
| `lucide-react` | `^0.575.0` | `0.575.0(react@19.2.4)` | npm |
| `postcss` | `^8.5.6` | `8.5.6` | npm |
| `react` | `^19.2.0` | `19.2.4` | npm |
| `react-dom` | `^19.2.0` | `19.2.4(react@19.2.4)` | npm |
| `react-router-dom` | `^7.13.1` | `7.13.1` | npm |
| `recharts` | `^3.7.0` | `3.7.0` | npm |
| `tailwind-merge` | `^3.5.0` | `3.5.0` | npm |
| `tailwindcss` | `^3.4.19` | `3.4.19` | npm |
| `tailwindcss-animate` | `^1.0.7` | `1.0.7(tailwindcss@3.4.19)` | npm |
| `@eslint/js` | `^9.39.1` | `9.39.3` | npm |
| `@types/node` | `^24.10.1` | `24.10.13` | npm |
| `@types/react` | `^19.2.7` | `19.2.14` | npm |
| `@types/react-dom` | `^19.2.3` | `19.2.3` | npm |
| `@vitejs/plugin-react` | `^5.1.1` | `5.1.4(vite@7.3.1)` | npm |
| `eslint` | `^9.39.1` | `9.39.3(jiti@1.21.7)` | npm |
| `eslint-config-prettier` | `^10.1.8` | `10.1.8` | npm |
| `eslint-plugin-prettier` | `^5.5.5` | `5.5.5` | npm |
| `eslint-plugin-react-hooks` | `^7.0.1` | `7.0.1` | npm |
| `eslint-plugin-react-refresh` | `^0.4.24` | `0.4.26` | npm |
| `globals` | `^16.5.0` | `16.5.0` | npm |
| `prettier` | `^3.8.1` | `3.8.1` | npm |
| `typescript` | `~5.9.3` | `5.9.3` | npm |
| `typescript-eslint` | `^8.48.0` | `8.56.1` | npm |
| `vite` | `^7.3.1` | `7.3.1(@types/node@24.10.13)(jiti@1.21.7)` | npm |

### 1.3 Minimum set for a MySocial-auth + signing app

If you are not replicating the orderbook order-entry feature, the essential subset is:

```
@socialproof/myso            ^0.0.4
@socialproof/mysocial-auth   ^0.12.0
@socialproof/dapp-kit-core   ^0.0.4
@socialproof/dapp-kit-react  ^0.0.4
@socialproof/wallet-standard ^0.0.2
@tanstack/react-query        ^5.0.0
react ^19.2.0  react-dom ^19.2.0  react-router-dom ^7.13.1
clsx ^2.1.1  tailwind-merge ^3.5.0  class-variance-authority ^0.7.1  lucide-react ^0.575.0
@radix-ui/react-popover ^1.1.15  @radix-ui/react-tooltip ^1.2.8
tailwindcss ^3.4.19  tailwindcss-animate ^1.0.7  postcss ^8.5.6  autoprefixer ^10.4.24
vite ^7.3.1  @vitejs/plugin-react ^5.1.1  typescript ~5.9.3  @types/node ^24.10.1
@types/react ^19.2.7  @types/react-dom ^19.2.3
```

**Peer/engine notes (real, from the SDK `package.json`s):**

- `@socialproof/myso` — `"engines": { "node": ">=22" }`, `"type": "module"`.
- `@socialproof/dapp-kit-core` — `peerDependencies: { "@socialproof/myso": "^0.0.4" }`.
- `@socialproof/dapp-kit-react` — `peerDependencies: { "@types/react": ">=17.0.0", "react": ">=17.0.0" }`.
- `@socialproof/orderbook` — `peerDependencies: { "@socialproof/myso": "^0.0.4" }`, `engines.node >= 22`.
- `@socialproof/wallet-standard` — `peerDependencies: { "@socialproof/myso": "*" }`.
- `@socialproof/mysocial-auth` — no peers; dependency `@socialproof/utils@^0.0.2`.

Very important: `@socialproof/mysocial-auth` exists as its own package/repo
(`the-social-proof-foundation/myso-ts-sdks`), whereas `myso` / `dapp-kit-*` / `wallet-standard` /
`orderbook` / `signers` are mirrored from `MystenLabs/ts-sdks` under the `@socialproof` scope.

---

## 2. Env var contract

There is **no `.env` in `sandbox/dashboard/`**. The dashboard's Vite config sets
`envDir` to its **parent** (`sandbox/`), so the effective env file is
`sandbox/.env` (and `sandbox/.env.example`). Root `orderbook-sandbox-main/.env` does **not** exist.

```ts
// vite.config.ts:79
const sandboxEnv = loadEnv(mode, path.resolve(configDir, ".."), "");
```

`loadEnv(mode, dir, "")` with an **empty prefix** loads *all* keys (not just `VITE_*`) — that is how
`PRIVATE_KEY` from `sandbox/.env` becomes available to the config.

There are exactly **eight** `import.meta.env` reads in `src/`, plus three `process.env` reads and
four `sandboxEnv.*` reads in `vite.config.ts`.

### 2.1 Client-side (`import.meta.env`) — the full list

| Var | Read at | Meaning | Default when unset |
|---|---|---|---|
| `VITE_MYSOCIAL_API_BASE` | `src/contexts/mysocial-auth-context.tsx:40`, `src/lib/derive-mysocial-keypair.ts:13` | MySocial API base URL. Used as `apiBaseUrl` for `/auth/refresh` + `/auth/logout`, and as the **salt URL base**. | `""` → auth considered **unconfigured** (login button disabled); salt falls back to the hardcoded testnet URL |
| `VITE_MYSOCIAL_AUTH_ORIGIN` | `mysocial-auth-context.tsx:41` | Origin hosting the MySocial login page. Popup URL origin + `postMessage` origin check. | `""` → unconfigured |
| `VITE_MYSOCIAL_CLIENT_ID` | `mysocial-auth-context.tsx:42` | OAuth `client_id`; must be allowlisted server-side with the redirect URI. | `""` → unconfigured |
| `VITE_MYSOCIAL_REDIRECT_URI` | `mysocial-auth-context.tsx:43` | Redirect/callback URI; must match the `/auth/callback` route. | `""` → unconfigured |
| `VITE_MYSOCIAL_STORAGE` | `mysocial-auth-context.tsx:46-49` | `"memory"` or `"session"` session persistence. Anything else → `"session"`. | `"session"` |
| `VITE_MYSOCIAL_SALT_URL` | `src/lib/derive-mysocial-keypair.ts:11` | Explicit salt endpoint. | falls back to `${VITE_MYSOCIAL_API_BASE}/salt`, else `https://salt.testnet.mysocial.network/salt` |
| `VITE_MYSO_GRPC_{LOCALNET,TESTNET,MAINNET}_URL` | `src/lib/networks.ts:23,28,31,33` | gRPC fullnode base URLs for the Local/Test/Main switcher (`envUrl(key)` reads dynamically). | `http://localhost:9000`, `https://fullnode.testnet.mysocial.network:443`, `https://fullnode.mainnet.mysocial.network:443` |
| `VITE_SANDBOX_ENABLE_ORACLE` | `src/config/sandbox-features.ts:8` | `"true"` enables the `/api/oracle` proxy + oracle health UI. | `false` |
| `VITE_DEV_WALLET_PRIVATE_KEY` | `src/dapp-kit.ts:10` | **Not a real env var** — synthesized by Vite `define` from `PRIVATE_KEY` (see §2.2). | `""` → random ephemeral keypair |
| `VITE_ORDERBOOK_API_URL`, `VITE_MM_API_URL` | `vite.config.ts:82,86` | Dev-proxy targets; **not** exposed to client code beyond the proxy. | `http://localhost:9008`, `http://localhost:3012` |

#### Code that reads them

```ts
// src/contexts/mysocial-auth-context.tsx:38-51
function readMySocialEnv() {
    return {
        apiBaseUrl: (import.meta.env.VITE_MYSOCIAL_API_BASE as string | undefined)?.trim() ?? "",
        authOrigin: (import.meta.env.VITE_MYSOCIAL_AUTH_ORIGIN as string | undefined)?.trim() ?? "",
        clientId: (import.meta.env.VITE_MYSOCIAL_CLIENT_ID as string | undefined)?.trim() ?? "",
        redirectUri: (import.meta.env.VITE_MYSOCIAL_REDIRECT_URI as string | undefined)?.trim() ?? "",
        saltUrl: getMySocialSaltUrl(),
        storage:
            import.meta.env.VITE_MYSOCIAL_STORAGE === "memory" ||
            import.meta.env.VITE_MYSOCIAL_STORAGE === "session"
                ? import.meta.env.VITE_MYSOCIAL_STORAGE
                : ("session" as const),
    };
}
```

The **configuration gate** — all four are required or the Login button renders disabled:

```ts
// src/contexts/mysocial-auth-context.tsx:55-57
const isConfigured = Boolean(
    env.apiBaseUrl && env.authOrigin && env.clientId && env.redirectUri,
);
```

```ts
// src/lib/networks.ts:22-34
function envUrl(key: string): string {
    return ((import.meta.env[key] as string | undefined) ?? "").trim().replace(/\/$/, "");
}

export function getGrpcBaseUrl(network: SandboxNetwork): string {
    if (network === "mainnet") {
        return envUrl("VITE_MYSO_GRPC_MAINNET_URL") || "https://fullnode.mainnet.mysocial.network:443";
    }
    if (network === "testnet") {
        return envUrl("VITE_MYSO_GRPC_TESTNET_URL") || "https://fullnode.testnet.mysocial.network:443";
    }
    return envUrl("VITE_MYSO_GRPC_LOCALNET_URL") || "http://localhost:9000";
}
```

### 2.2 Build-time / server-side (`process.env` + `sandboxEnv`) in `vite.config.ts`

```ts
// vite.config.ts:75-92
export default defineConfig(({ mode }) => {
    // Read sandbox/.env (parent of dashboard) so PRIVATE_KEY managed by
    // deploy-all is exposed to the dev wallet without duplication.
    // process.env wins so docker build args / CI overrides take effect.
    const sandboxEnv = loadEnv(mode, path.resolve(configDir, ".."), "");
    const privateKey = process.env.PRIVATE_KEY ?? sandboxEnv.PRIVATE_KEY ?? "";
    const orderbookApiUrl =
        process.env.VITE_ORDERBOOK_API_URL ??
        sandboxEnv.VITE_ORDERBOOK_API_URL ??
        "http://localhost:9008";
    const mmApiUrl =
        process.env.VITE_MM_API_URL ??
        sandboxEnv.VITE_MM_API_URL ??
        "http://localhost:3012";

    const oracleProxyEnabled =
        process.env.VITE_SANDBOX_ENABLE_ORACLE === "true" ||
        sandboxEnv.VITE_SANDBOX_ENABLE_ORACLE === "true";
```

```ts
// vite.config.ts:102-104 — PRIVATE_KEY → client-visible define
define: {
    "import.meta.env.VITE_DEV_WALLET_PRIVATE_KEY": JSON.stringify(privateKey),
},
```

> **Security warning to carry over:** this bakes the deployer private key into the browser bundle.
> It is deliberate for a localnet sandbox (`Dockerfile` even defaults `ARG PRIVATE_KEY`), but the
> new app should NOT do this for mainnet.

### 2.3 Example values (real, from `sandbox/.env`)

```bash
# ---- MySocial login (all four required to enable the button) ----
VITE_MYSOCIAL_API_BASE=https://salt.testnet.mysocial.network
VITE_MYSOCIAL_AUTH_ORIGIN=https://auth.testnet.mysocial.network
VITE_MYSOCIAL_CLIENT_ID=mysocial-auth-client-id
VITE_MYSOCIAL_REDIRECT_URI=http://localhost:5173/auth/callback

# Optional overrides
# VITE_MYSOCIAL_STORAGE=session
# VITE_MYSOCIAL_SALT_URL=https://salt.testnet.mysocial.network/salt
# VITE_MYSO_GRPC_LOCALNET_URL=http://localhost:9000
# VITE_MYSO_GRPC_TESTNET_URL=https://fullnode.testnet.mysocial.network:443
# VITE_MYSO_GRPC_MAINNET_URL=https://fullnode.mainnet.mysocial.network:443

VITE_SANDBOX_ENABLE_ORACLE=true
VITE_ORDERBOOK_API_URL=http://localhost:9008
VITE_MM_API_URL=http://localhost:3012

# Build-time only (baked into the bundle by vite define)
PRIVATE_KEY=mysoprivkey1....   # or 0x… hex
```

The commented example block from `sandbox/.env.example` also documents the intended defaults:

```
# VITE_MYSOCIAL_API_BASE=https://api.mysocial.network
# VITE_MYSOCIAL_AUTH_ORIGIN=https://auth.mysocial.network
# VITE_MYSOCIAL_CLIENT_ID=
# VITE_MYSOCIAL_REDIRECT_URI=http://localhost:5173/auth/callback
# Optional: session (default) | memory. memory clears session on full reload.
# VITE_MYSOCIAL_STORAGE=session
# Salt endpoint for deriving the MySocial signing keypair (defaults to ${VITE_MYSOCIAL_API_BASE}/salt).
# VITE_MYSOCIAL_SALT_URL=https://salt.testnet.mysocial.network/salt
```

### 2.4 Package IDs — **not** env vars in the dashboard

Unlike the deploy scripts (`ORDERBOOK_PACKAGE_ID`, `MYUSD_TOKEN_PACKAGE_ID`, … all live in
`sandbox/.env` for the Node scripts), the dashboard gets package IDs from **three** sources:

1. `@socialproof/orderbook`'s bundled constants for testnet/mainnet:
   `mainnetPackageIds`, `mainnetCoins`, `mainnetPools`, `testnetPackageIds`, `testnetCoins`, `testnetPools`.
2. **Localnet:** a deployment manifest fetched at runtime from `/api/manifest`
   (`src/hooks/use-orderbook-client.ts:204-215`), which the Vite dev plugin serves from
   `sandbox/deployments/localnet.json`:

```ts
// vite.config.ts:44-66
if (pathname === "/api/manifest" || pathname === "/api/manifest/") {
    const manifestPath = path.join(configDir, "..", "deployments", "localnet.json");
    if (!existsSync(manifestPath)) {
        res.statusCode = 503;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({
            error: "No deployment manifest found",
            hint: "Run `pnpm deploy-all` from `sandbox/` (writes deployments/localnet.json) or start the sandbox API on port 9009.",
        }));
        return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(readFileSync(manifestPath, "utf-8"));
    return;
}
```

3. The manifest shape consumed by the client:

```ts
// src/hooks/use-orderbook-client.ts:46-61
interface ManifestPackage {
    packageId: string;
    objects: Array<{ objectId: string; objectType: string }>;
}
interface ManifestPool {
    poolId: string;
    baseCoinType: string;
    quoteCoinType: string;
}
export interface Manifest {
    packages: Record<string, ManifestPackage>;
    pools: Record<string, ManifestPool>;
    deployerAddress: string;
}
```

Those `sandbox/.env` package IDs (`ORDERBOOK_PACKAGE_ID`, `MYUSD_TOKEN_PACKAGE_ID`,
`MYUSD_TREASURY_ID`, `MYSO_MYUSD_POOL_ID`, `BTC_MYUSD_POOL_ID`, `ETH_MYUSD_POOL_ID`,
`PYTH_PACKAGE_ID`, `*_PRICE_INFO_OBJECT_ID`, `MM_POOLS`, …) are consumed by the **Node deploy/MM
scripts**, not by dashboard browser code.

---

## 3. Auth flow, step by step

### 3.1 `createMySocialAuth(config)` — what it needs

```ts
// node_modules/@socialproof/mysocial-auth/dist/types.d.mts
interface MySocialAuthConfig {
  apiBaseUrl: string;
  authOrigin: string;
  clientId: string;
  redirectUri: string;
  storage?: StorageOption;          // 'memory' (SDK default) | 'session' | custom StorageAdapter
  /** Popup timeout in ms (default 120000 = 2 min) */
  popupTimeout?: number;
  /** Use request_id flow: call /auth/request before opening popup (requires backend support) */
  useRequestId?: boolean;
}
```

Returns `MySocialAuth`:

```ts
// node_modules/@socialproof/mysocial-auth/dist/auth.d.mts
interface MySocialAuth {
  signIn(options?: SignInOptions): Promise<Session>;
  signOut(): Promise<void>;
  getSession(): Promise<Session | null>;
  refresh(): Promise<Session | null>;
  handleRedirectCallback(url?: string): Promise<Session>;
  onAuthStateChange(callback: AuthStateChangeCallback): () => void;
  /** Returns token for Authorization: Bearer. Refreshes if expired. Use for /salt and protected endpoints. */
  getAccessTokenForApi(): Promise<string | undefined>;
}
```

Instantiation is guarded by `isConfigured` and memoized:

```tsx
// src/contexts/mysocial-auth-context.tsx:59-68
const auth = useMemo<MySocialAuth | null>(() => {
    if (!isConfigured) return null;
    return createMySocialAuth({
        apiBaseUrl: env.apiBaseUrl,
        authOrigin: env.authOrigin,
        clientId: env.clientId,
        redirectUri: env.redirectUri,
        storage: env.storage,
    });
}, [isConfigured, env]);
```

### 3.2 Session persistence + subscription

```tsx
// src/contexts/mysocial-auth-context.tsx:78-88
useEffect(() => {
    if (!auth) {
        setSession(null);
        return;
    }
    void auth.getSession().then(setSession);
    const unsub = auth.onAuthStateChange(setSession);
    return () => unsub();
}, [auth]);

sessionRef.current = session;
```

Storage internals (from the SDK): key `mysocial_auth_session`; redirect state under
`mysocial_auth_redirect_<state>` in **sessionStorage** (always sessionStorage for the redirect flow,
since memory cannot survive navigation). `"session"` → `sessionStorage`; `"memory"` → in-process `Map`.

### 3.3 `signIn` — popup mode, provider `none`

The app **always** calls popup mode with `provider: "none"`, letting the MySocial home screen
pick the provider, and threads `onWalletCredentials` through:

```tsx
// src/contexts/mysocial-auth-context.tsx:147-168
const signIn = useCallback(
    async (options?: SignInOptions) => {
        if (!auth) return undefined;
        return auth.signIn({
            mode: "popup",
            provider: "none",
            ...options,
            onWalletCredentials: (credentials) => {
                try {
                    credentialsKeypairRef.current = keypairFromWalletCredentials(credentials);
                } catch (err) {
                    credentialsKeypairRef.current = null;
                    setDeriveError(
                        err instanceof Error ? err.message : "Failed to import wallet credentials.",
                    );
                }
                options?.onWalletCredentials?.(credentials);
            },
        });
    },
    [auth],
);
```

The trigger must stay on a **direct click** with no `await` before the popup opens (Safari):

```tsx
// src/components/mysocial-login-button.tsx:81-84
onClick={() => {
    setBusy(true);
    void signIn().finally(() => setBusy(false));
}}
```

#### What the SDK actually does in popup mode (`dist/popup.mjs`)

1. `state = generateState()`, `nonce = generateNonce()` — 16 random bytes, base64url.
2. `returnOrigin = window.location.origin`.
3. Optional `request_id` via `POST ${apiBaseUrl}/auth/request` with
   `{ client_id, redirect_uri, return_origin }` (only when `useRequestId: true`).
4. Popup features: `getPopupFeatures(420, 720)` →
   `width=420,height=720,left=…,top=…,popup=yes`, opened as `window.open("about:blank", "_blank", features)`
   (Safari-safe: open blank first, then navigate). Throws `PopupBlockedError` if null.
5. Login URL:

```js
const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    nonce,
    return_origin: returnOrigin,
    mode: "popup",
    provider: provider ?? "none",
    code_challenge_method: "S256",
});
if (requestId) params.set("request_id", requestId);
const loginUrl = `${authOrigin.replace(/\/$/, "")}/login?${params.toString()}`;
popup.location.href = loginUrl;
```

6. Waits for `window.addEventListener("message", handler)`; validates `event.origin === authOrigin`,
   `event.source === popup`, and `msg.state`/`msg.nonce`/`msg.clientId`/`msg.requestId` match.
   Message types: `MYSOCIAL_AUTH_RESULT`, `MYSOCIAL_WALLET_RESULT`, `MYSOCIAL_AUTH_ERROR`.
   Timeout (default 120000 ms) → `AuthTimeoutError`; a 200 ms interval detects a user-closed popup
   → `PopupClosedError`.
7. On `MYSOCIAL_AUTH_RESULT` it builds the `Session`, calls `onWalletCredentials` **only** if
   `(msg.mnemonic ?? msg.privateKey) && user.address`, then resolves.

Note the subtle service-name mismatch worth knowing: `sandbox/.env` points `VITE_MYSOCIAL_API_BASE`
at `https://salt.testnet.mysocial.network`, which is *also* the salt host — so
`getMySocialSaltUrl()` derives `https://salt.testnet.mysocial.network/salt`.

### 3.4 Redirect mode + `AuthCallbackPage`

`redirectUri` must match a real route. The app registers `/auth/callback`:

```tsx
// src/App.tsx:86
<Route path="/auth/callback" element={<AuthCallbackPage />} />
```

```tsx
// src/components/auth-callback-page.tsx
export function AuthCallbackPage() {
    const navigate = useNavigate();
    const { auth, isConfigured } = useMySocialAuth();

    useEffect(() => {
        if (!isConfigured || !auth) {
            navigate("/", { replace: true });
            return;
        }
        void auth
            .handleRedirectCallback()
            .then(() => navigate("/", { replace: true }))
            .catch(() => navigate("/", { replace: true }));
    }, [auth, isConfigured, navigate]);

    return (
        <p className="text-sm text-muted-foreground">Completing MySocial sign-in…</p>
    );
}
```

In redirect mode `signIn` does `window.location.href = loginUrl` with `mode=redirect` and returns a
never-resolving Promise. `handleRedirectCallback` reads `code`, `state`, `nonce`, `request_id`,
`salt`, `user`, and tokens from **both** query params and the URL hash, verifies state/nonce (and
request_id when used) against sessionStorage, then persists the session.

### 3.5 The `Session` object

```ts
// node_modules/@socialproof/mysocial-auth/dist/types.d.mts
interface Session {
  /**
   * OAuth provider token or WALLET_ONLY_ACCESS_TOKEN for wallet-only sessions.
   * Never use directly for Authorization: Bearer. Use getAccessTokenForApi() or session_access_token.
   */
  access_token: string;
  /** Our JWT (30 min) for API calls. Use for Authorization: Bearer on /salt and protected endpoints. */
  session_access_token?: string;
  refresh_token?: string;
  /** OAuth id_token (JWT). */
  id_token?: string;
  expires_at: number;
  /** Stable user ID for keypair derivation (user.sub ?? user.id). Use for salt + sub derivation. */
  sub: string;
  user: AuthUser;
  salt?: string;
}

interface AuthUser {
  id?: string;
  /** Stable OAuth/OIDC subject identifier for keypair derivation. Falls back to id when absent. */
  sub?: string;
  email?: string;
  name?: string;
  address?: string;
  [key: string]: unknown;
}
```

`WALLET_ONLY_ACCESS_TOKEN = "wallet-only"` is a sentinel: a wallet-only session
(create/import flow without backend auth) can **not** be used to call `/salt` and therefore can
**not** derive a signing keypair. `isWalletOnlySession(session)` = "no `session_access_token` and no
`refresh_token`".

Other SDK surface: `AuthProvider = 'google'|'apple'|'facebook'|'twitch'|'none'`,
`AuthMode = 'popup'|'redirect'`,
`SignInOptions = { provider?, mode?, onWalletCredentials? }`,
`WalletCredentials = { address: string; mnemonic?: string; privateKey?: string }`, and the error
classes `MySocialAuthError, PopupBlockedError, PopupClosedError, AuthTimeoutError,
InvalidOriginError, InvalidSourceError, InvalidStateError, SessionRevokedError, RateLimitError`.

### 3.6 `onWalletCredentials` → `keypairFromWalletCredentials`

The create/import-wallet flow hands back an **ephemeral** mnemonic or private key. The dashboard
converts it immediately and never stores it:

```tsx
// src/contexts/mysocial-auth-context.tsx:74
const credentialsKeypairRef = useRef<Ed25519Keypair | null>(null);
```

```ts
// src/lib/derive-mysocial-keypair.ts:86-100
export function keypairFromWalletCredentials(credentials: WalletCredentials): Ed25519Keypair {
    let keypair: Ed25519Keypair;
    if (credentials.privateKey?.trim()) {
        keypair = Ed25519Keypair.fromSecretKey(credentials.privateKey.trim());
    } else if (credentials.mnemonic?.trim()) {
        keypair = Ed25519Keypair.deriveKeypair(credentials.mnemonic.trim());
    } else {
        throw new Error("Wallet credentials did not include a private key or mnemonic.");
    }

    if (!addressesMatch(keypair.getPublicKey().toMySoAddress(), credentials.address)) {
        throw new Error("Wallet credentials do not match the MySocial address.");
    }
    return keypair;
}
```

That ref is consumed **first** in the derivation effect, avoiding a salt round-trip when the wallet
was created/imported in this session:

```tsx
// src/contexts/mysocial-auth-context.tsx:104-116
if (derivedForRef.current === deriveKey) return;

const fromCreds = credentialsKeypairRef.current;
if (fromCreds) {
    credentialsKeypairRef.current = null;
    if (addressesMatch(fromCreds.getPublicKey().toMySoAddress(), sessionAddress)) {
        derivedForRef.current = deriveKey;
        setKeypair(fromCreds);
        setDeriving(false);
        setDeriveError(null);
        return;
    }
}
```

### 3.7 Salt URL derivation — quoted verbatim

```ts
// src/lib/derive-mysocial-keypair.ts:10-16
export function getMySocialSaltUrl(): string {
    const explicit = (import.meta.env.VITE_MYSOCIAL_SALT_URL as string | undefined)?.trim();
    if (explicit) return explicit;
    const base = (import.meta.env.VITE_MYSOCIAL_API_BASE as string | undefined)?.trim() ?? "";
    if (!base) return "https://salt.testnet.mysocial.network/salt";
    return `${base.replace(/\/$/, "")}/salt`;
}
```

Precedence: `VITE_MYSOCIAL_SALT_URL` → `${VITE_MYSOCIAL_API_BASE}/salt` (trailing slash stripped) →
`https://salt.testnet.mysocial.network/salt`.

### 3.8 Salt HTTP request shape — quoted verbatim

```ts
// src/lib/derive-mysocial-keypair.ts:45-65
async function resolveSalt(session: Session, token: string, saltUrl: string): Promise<string> {
    if (session.salt) return session.salt;

    const saltResponse = await fetch(saltUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
    });

    if (!saltResponse.ok) {
        throw new Error(`Salt service request failed (${saltResponse.status}).`);
    }

    const { salt } = (await saltResponse.json()) as { salt?: string };
    if (!salt) {
        throw new Error("Salt service returned an invalid response.");
    }
    return salt;
}
```

**Note the shape:** `POST <saltUrl>` with **no body**, JSON content type, `Authorization: Bearer <token>`,
response `{ "salt": "<string>" }`. If the session already carries `salt` (popup/redirect flows can
return it), the request is skipped entirely.

### 3.9 Bearer token resolution

```ts
// src/lib/derive-mysocial-keypair.ts:32-43
async function resolveBearerToken(
    auth: MySocialAuth,
    session: Session,
): Promise<string | undefined> {
    const fromApi = await auth.getAccessTokenForApi();
    if (fromApi) return fromApi;
    if (session.session_access_token) return session.session_access_token;
    if (session.access_token && session.access_token !== WALLET_ONLY_ACCESS_TOKEN) {
        return session.access_token;
    }
    return undefined;
}
```

`getAccessTokenForApi()` internally returns `undefined` for wallet-only sessions and otherwise
`session.session_access_token ?? (session.refresh_token ? session.access_token : undefined)`.

### 3.10 `deriveKeypairFromSession` → `Ed25519Keypair` — the whole algorithm

```ts
// src/lib/derive-mysocial-keypair.ts:22-25
async function sha256First32Bytes(input: string): Promise<Uint8Array> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return new Uint8Array(digest).slice(0, 32);
}
```

```ts
// src/lib/derive-mysocial-keypair.ts:102-131
export async function deriveKeypairFromSession(
    auth: MySocialAuth,
    session: Session,
    saltUrl: string = getMySocialSaltUrl(),
): Promise<Ed25519Keypair> {
    const address = session.user?.address;
    if (!address) {
        throw new Error("Session is missing user address.");
    }

    const token = await resolveBearerToken(auth, session);
    if (!token) {
        throw signingUnavailableError(session);
    }

    const salt = await resolveSalt(session, token, saltUrl);
    const sub = session.sub ?? session.user?.sub ?? session.user?.id;
    if (!sub) {
        throw new Error("Session is missing a stable user identifier for keypair derivation.");
    }

    const seed = await sha256First32Bytes(`${sub}_${salt}`);
    const keypair = Ed25519Keypair.fromSecretKey(seed);

    if (!addressesMatch(keypair.getPublicKey().toMySoAddress(), address)) {
        throw new Error("Derived keypair address does not match authenticated MySocial address.");
    }

    return keypair;
}
```

**The exact formula:** `seed = SHA-256(utf8(`${sub}_${salt}`))[0..32]` → `Ed25519Keypair.fromSecretKey(seed)` →
must satisfy `keypair.getPublicKey().toMySoAddress() === session.user.address` (case-insensitive trim compare).

Error messages for every failure branch:

```ts
// src/lib/derive-mysocial-keypair.ts:67-84
function signingUnavailableError(session: Session): Error {
    if (session.access_token === WALLET_ONLY_ACCESS_TOKEN) {
        return new Error(
            "Signing unavailable — sign in with full MySocial auth (wallet-only sessions cannot sign).",
        );
    }
    if (isWalletOnlySession(session) && looksLikeOAuthSession(session)) {
        return new Error(
            "OAuth session is missing API tokens. Check your allowlisted VITE_MYSOCIAL_CLIENT_ID and redirect URI.",
        );
    }
    if (isWalletOnlySession(session)) {
        return new Error(
            "Signing unavailable — sign in with full MySocial auth (wallet-only sessions cannot sign).",
        );
    }
    return new Error("Signing unavailable — no API access token. Sign in with full MySocial auth.");
}

function looksLikeOAuthSession(session: Session): boolean {
    const user = session.user;
    return !!(user?.email || user?.name || (user?.sub && user.sub !== user?.address));
}
```

### 3.11 The derivation effect (caching, cancellation, keying)

```tsx
// src/contexts/mysocial-auth-context.tsx:90-145 (condensed but complete logic)
const sessionAddress = session?.user?.address ?? null;
const sessionSub = session?.sub ?? session?.user?.sub ?? session?.user?.id ?? null;
const deriveKey = sessionAddress ? `${sessionAddress}:${sessionSub ?? ""}` : null;

useEffect(() => {
    if (!auth || !deriveKey || !sessionAddress) {
        setKeypair(null);
        setDeriving(false);
        setDeriveError(null);
        credentialsKeypairRef.current = null;
        derivedForRef.current = null;
        return;
    }
    if (derivedForRef.current === deriveKey) return;
    /* …credentials fast-path (see §3.6)… */
    const currentSession = sessionRef.current;
    if (!currentSession) return;
    let cancelled = false;
    setDeriving(true);
    setDeriveError(null);
    void deriveKeypairFromSession(auth, currentSession, env.saltUrl)
        .then((kp) => { if (cancelled) return; derivedForRef.current = deriveKey; setKeypair(kp); setDeriveError(null); })
        .catch((err: unknown) => {
            if (cancelled) return;
            derivedForRef.current = null;
            setKeypair(null);
            setDeriveError(err instanceof Error ? err.message : "Failed to derive signing key.");
        })
        .finally(() => { if (!cancelled) setDeriving(false); });
    return () => { cancelled = true; };
}, [auth, deriveKey, env.saltUrl, sessionAddress]);
```

### 3.12 Context value + sign-out

```tsx
// src/contexts/mysocial-auth-context.tsx:25-34
export type MySocialAuthContextValue = {
    auth: MySocialAuth | null;
    isConfigured: boolean;
    session: Session | null;
    keypair: Ed25519Keypair | null;
    deriving: boolean;
    deriveError: string | null;
    signIn: (options?: SignInOptions) => Promise<Session | undefined>;
    signOut: () => Promise<void>;
};
```

```tsx
// src/contexts/mysocial-auth-context.tsx:170-178
const signOut = useCallback(async () => {
    credentialsKeypairRef.current = null;
    derivedForRef.current = null;
    setKeypair(null);
    setDeriveError(null);
    setDeriving(false);
    if (auth) await auth.signOut();
    setSession(null);
}, [auth]);
```

`auth.signOut()` internally `POST ${apiBaseUrl}/auth/logout` with `{ refresh_token }` (best-effort,
errors swallowed), then clears storage and emits `change → null`.

---

## 4. Transaction signing — complete mechanics

### 4.1 The client class: `MySoGrpcClient`

```ts
// src/dapp-kit.ts:40-42
createClient(network: SandboxNetwork) {
    return new MySoGrpcClient({ network, baseUrl: getGrpcBaseUrl(network) });
},
```

`MySoGrpcClientOptions` (from the SDK):

```ts
// node_modules/@socialproof/myso/dist/grpc/client.d.mts
type MySoGrpcClientOptions = {
  network: MySoClientTypes.Network;   // 'mainnet' | 'testnet' | 'devnet' | 'localnet' | (string & {})
  mvr?: MySoClientTypes.MvrOptions;
} & ({ transport: RpcTransport } | MySoGrpcTransportOptions);   // GrpcWebOptions, i.e. { baseUrl }

declare class MySoGrpcClient extends BaseClient implements MySoClientTypes.TransportMethods {
  core: GrpcCoreClient;
  get mvr(): MySoClientTypes.MvrMethods;
  transactionExecutionService: TransactionExecutionServiceClient;
  ledgerService / stateService / subscriptionService / movePackageService / signatureVerificationService: …
  constructor(options: MySoGrpcClientOptions);
  executeTransaction<Include>(input): Promise<TransactionResult<Include>>;
  signAndExecuteTransaction<Include>(input): Promise<TransactionResult<Include>>;
  waitForTransaction<Include>(input): Promise<TransactionResult<Include>>;
  simulateTransaction<Include>(input): Promise<SimulateTransactionResult<Include>>;
  getReferenceGasPrice(): Promise<GetReferenceGasPriceResponse>;
  listBalances(input): Promise<ListBalancesResponse>;
  …
}
```

Because `ClientWithCoreApi = ClientWithExtensions<{ core: CoreClient }>`, and `CoreClient` extends
`BaseClient` and declares `core: this`, the same object is reachable as `client.core.*`.
`useCurrentClient()` in dapp-kit returns exactly this `MySoGrpcClient`.

### 4.2 Three supported signing entry points

| # | API | When used here |
|---|---|---|
| A | `dAppKit.signAndExecuteTransaction({ transaction })` | **The app's only path** (`src/components/trading/hooks.ts`) |
| B | `keypair.signAndExecuteTransaction({ transaction, client })` | Inside the in-memory wallet's Wallet Standard feature handler (`src/sandbox-dev-wallet.ts`) |
| C | `client.core.signAndExecuteTransaction({ transaction, signer })` | **Documented in the UI only** — `src/components/trading/sdk-snippets.ts` shows it to users; the dashboard itself does not call it |

#### Option A — what the app calls (100% of writes)

```ts
// src/components/trading/hooks.ts (one representative body; all others are identical in shape)
const placeLimitOrder = useCallback(
    async (params: { price: number; quantity: number; isBid: boolean }) => {
        if (!client) throw new Error("SDK client not ready");
        const tx = new Transaction();
        client.orderbook.orderbook.placeLimitOrder({
            poolKey,
            balanceManagerKey: BALANCE_MANAGER_KEY,
            clientOrderId: String(Date.now()),
            price: params.price,
            quantity: params.quantity,
            isBid: params.isBid,
            orderType: OrderType.NO_RESTRICTION,
            selfMatchingOption: SelfMatchingOptions.SELF_MATCHING_ALLOWED,
            payWithMyUSD: false,
        })(tx);
        const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
        await waitAndInvalidate(result.Transaction!.digest);
        return result.Transaction!.digest;
    },
    [client, poolKey, dAppKit, waitAndInvalidate],
);
```

Result shape handling:

```ts
// src/components/trading/hooks.ts:299-306
/** Wait for the chain to index the transaction, then invalidate caches. */
const waitAndInvalidate = useCallback(
    async (digest: string) => {
        await mysoClient.waitForTransaction({ digest });
        invalidateAll();
    },
    [mysoClient, invalidateAll],
);
```

```ts
// src/components/trading/hooks.ts:463-469 — explicit failure branch
const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
if (result.$kind === "FailedTransaction") {
    throw new Error(result.FailedTransaction.status.error?.message ?? "Transaction failed");
}
await mysoClient.waitForTransaction({ digest: result.Transaction!.digest });
```

#### Where `setSenderIfNotSet` happens — inside dapp-kit, not in app code

```js
// node_modules/@socialproof/dapp-kit-core/dist/index.mjs:488-520 (deobfuscated-minified, verbatim)
return async function signAndExecuteTransaction({ transaction, ...standardArgs }) {
    const { account, supportedIntents } = $connection.get();
    if (!account) throw new WalletNotConnectedError("No wallet is connected.");
    const underlyingAccount = getWalletAccountForUiWalletAccount_DO_NOT_USE_OR_YOU_WILL_BE_FIRED(account);
    const mysoClient = $currentClient.get();
    const chain = getChain(mysoClient.network);
    const transactionWrapper = { toJSON: async () => {
        if (typeof transaction === "string") return transaction;
        transaction.setSenderIfNotSet(account.address);
        return await transaction.toJSON({
            client: mysoClient,
            supportedIntents
        });
    } };
    const signAndExecuteTransactionFeature = tryGetAccountFeature({
        account,
        chain,
        featureName: MySoSignAndExecuteTransaction
    });
    if (signAndExecuteTransactionFeature) {
        const result = await signAndExecuteTransactionFeature.signAndExecuteTransaction({
            ...standardArgs,
            account: underlyingAccount,
            transaction: transactionWrapper,
            chain
        });
        const transactionBytes = fromBase64(result.bytes);
        const effectsBytes = fromBase64(result.effects);
        return buildTransactionResult(result.digest, result.signature, transactionBytes, effectsBytes);
    }
    /* fallback: MySoSignAndExecuteTransactionBlock … */
    throw new FeatureNotSupportedError(`The account ${account.address} does not support signing and executing transactions.`);
};
```

**Key takeaways for replication:**
- `transaction.setSenderIfNotSet(account.address)` is applied by dapp-kit inside `toJSON` — the app never sets the sender.
- `transaction.toJSON({ client, supportedIntents })` is what **resolves object versions, gas price, and gas budget** via the client (transaction resolution plugins), so no explicit gas handling is needed in app code.
- `chain` is computed from the client's network (`getChain(mysoClient.network)` → `myso:<network>`).
- The wallet returns base64 `{ bytes, signature, digest, effects }`, and dapp-kit reconstructs a `TransactionResult` from them.

`SignAndExecuteTransactionArgs` / result types:

```ts
// dapp-kit-core types
type SignAndExecuteTransactionArgs = { transaction: Transaction | string }
  & Omit<MySoSignAndExecuteTransactionInput, 'account' | 'chain' | 'transaction'>;
type TransactionResultWithEffects = MySoClientTypes.TransactionResult<{ effects: true; transaction: true; bcs: true }>;

// core client result (myso/dist/client/types.d.mts)
type TransactionResult<Include> =
  | { $kind: 'Transaction';        Transaction: Transaction<Include>;        FailedTransaction?: never }
  | { $kind: 'FailedTransaction';  Transaction?: never;                      FailedTransaction: Transaction<Include> };
```

#### Option B — the Wallet Standard signer implementation (this is the code that actually signs)

`src/sandbox-dev-wallet.ts` is a hand-written in-memory Wallet Standard wallet. It is a deliberate
reimplementation of dapp-kit's internal "unsafe burner wallet" (which the file explicitly mirrors —
compare against `dapp-kit-core/dist/index.mjs` lines ~690-740, which are byte-for-byte the same logic).

```ts
// src/sandbox-dev-wallet.ts:132-161
#signAndExecuteTransaction = async (input: {
    transaction: { toJSON: () => Promise<unknown> };
    signal?: AbortSignal;
    chain: string;
}) => {
    input.signal?.throwIfAborted();
    const client = this.#chainConfig[input.chain];
    if (!client) throw new Error(`Invalid chain "${input.chain}" specified.`);
    const json = (await input.transaction.toJSON()) as TransactionFromInput;
    const parsedTransaction = Transaction.from(json);
    const bytes = await parsedTransaction.build({ client });
    const result = await this.#keypair.signAndExecuteTransaction({
        transaction: parsedTransaction,
        client,
    });
    const tx = result.Transaction ?? result.FailedTransaction;
    const effectsBcs = tx.effects.bcs;
    const effectsEncoded =
        effectsBcs == null
            ? ""
            : typeof effectsBcs === "string"
              ? effectsBcs
              : uint8ToBase64(effectsBcs);
    return {
        bytes: uint8ToBase64(bytes),
        signature: tx.signatures[0],
        digest: tx.digest,
        effects: effectsEncoded,
    };
};
```

Sign-only variant:

```ts
// src/sandbox-dev-wallet.ts:119-130
#signTransaction = async (input: {
    transaction: { toJSON: () => Promise<unknown> };
    signal?: AbortSignal;
    chain: string;
}) => {
    input.signal?.throwIfAborted();
    const client = this.#chainConfig[input.chain];
    if (!client) throw new Error(`Invalid chain "${input.chain}" specified.`);
    const json = (await input.transaction.toJSON()) as TransactionFromInput;
    const builtTransaction = await Transaction.from(json).build({ client });
    return await this.#keypair.signTransaction(builtTransaction);
};
```

The `Signer` base class provides the actual signing plumbing:

```ts
// node_modules/@socialproof/myso/dist/cryptography/keypair.d.mts
interface SignAndExecuteOptions {
  transaction: Transaction;
  client: ClientWithCoreApi;
}
abstract class Signer {
  abstract sign(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>>;
  signWithIntent(bytes: Uint8Array, intent: IntentScope): Promise<SignatureWithBytes>;
  signTransaction(bytes: Uint8Array): Promise<SignatureWithBytes>;
  signPersonalMessage(bytes: Uint8Array): Promise<{ bytes: string; signature: string }>;
  signAndExecuteTransaction({ transaction, client }: SignAndExecuteOptions)
      : Promise<MySoClientTypes.TransactionResult<{ transaction: true; effects: true }>>;
  toMySoAddress(): string;
  abstract getKeyScheme(): SignatureScheme;
  abstract getPublicKey(): PublicKey;
}
```

So `Ed25519Keypair.signAndExecuteTransaction` internally builds the transaction
(`Transaction.build({ client })` → `signTransaction(bytes)` → `client.core.executeTransaction({ transaction: bytes, signatures })`),
which is why the app code never touches gas or the RPC directly.

#### Option C — direct client signing (shown to users in the UI, not used by the app)

```ts
// src/components/trading/sdk-snippets.ts:19-33
const tx = new Transaction();
client.orderbook.balanceManager.depositIntoManager(
    "MANAGER_1",  // balance manager key
    "MYSO",         // coin key
    1,          // amount in human units
)(tx);

await client.core.signAndExecuteTransaction({
    transaction: tx,
    signer,
    include: { effects: true },
});
```

Matching SDK signature:

```ts
// node_modules/@socialproof/myso/dist/client/types.d.mts
interface SignAndExecuteTransactionOptions<Include extends TransactionInclude = {}> extends CoreClientMethodOptions {
  transaction: Uint8Array | Transaction;
  signer: Signer;
  additionalSignatures?: string[];
  include?: Include;
}
```
(so `{ transaction, signer, include: { effects: true } }` is exact)

### 4.3 Gas handling — the complete story

- **`GAS_BUDGET = 250000000`** is a constant exported by `@socialproof/orderbook` (`utils/config.d.mts`). The dashboard does **not** import it and does **not** call `setGasBudget` / `setGasPrice` anywhere.
- Gas is resolved implicitly: `transaction.toJSON({ client })` in dapp-kit triggers the client's `resolveTransactionPlugin()`, which fills gas price, gas budget, payment coins, and object versions; then the in-memory wallet re-hydrates with `Transaction.from(json).build({ client })`.
- No `setSenderIfNotSet` and no `setGasBudgetIfNotSet` calls exist anywhere in `src/` (verified by grep). Their only occurrence is inside `dapp-kit-core` (`setSenderIfNotSet`) and they exist as `Transaction` methods for sponsored flows.
- Chain enum values must come from the **client network**, not env: `chainIdForClient(client) => \`myso:${client.network}\`` (`src/sandbox-dev-wallet.ts:36-38`).

`Transaction` methods available (from `myso/dist/transactions/Transaction.d.mts`) if you need manual
control: `setSender`, `setSenderIfNotSet`, `setExpiration`, `setGasPrice`, `setGasBudget`,
`setGasBudgetIfNotSet`, `setGasOwner`, `setGasPayment`, `getData`, `pure`, `gas`, `object`,
`objectRef`, `receivingRef`, `sharedObjectRef`, `add`, `splitCoins`, `mergeCoins`, `publish`,
`upgrade`, `moveCall`, `transferObjects`, `makeMoveVec`, `withdrawal`, `serialize`, `toJSON`,
`sign({ signer })`, `build(options)`, `getDigest({ client })`, `isFullyResolved`,
`isPreparedForSerialization`.

### 4.4 Raw-moveCall PTB example (bundling three commands, one signature)

```ts
// src/components/trading/hooks.ts:443-470
const tx = new Transaction();

// Raw calls against the local package. SDK helpers default to the
// published testnet ORDERBOOK_PACKAGE_ID, which does not exist here.
const bm = tx.moveCall({
    target: `${orderbookPkgId}::balance_manager::new_with_custom_owner`,
    arguments: [tx.pure.address(address)],
});

tx.moveCall({
    target: `${orderbookPkgId}::balance_manager::register_balance_manager`,
    arguments: [bm, tx.object(registryId)],
});

tx.moveCall({
    target: "0x2::transfer::public_share_object",
    arguments: [bm],
    typeArguments: [`${orderbookPkgId}::balance_manager::BalanceManager`],
});

const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
if (result.$kind === "FailedTransaction") {
    throw new Error(result.FailedTransaction.status.error?.message ?? "Transaction failed");
}
await mysoClient.waitForTransaction({ digest: result.Transaction!.digest });
queryClient.invalidateQueries({ queryKey: ["balance-manager-id"] });
return result.Transaction!.digest;
```

### 4.5 Read-only simulation (no signing)

```ts
// src/components/trading/hooks.ts:93-110
const packageId = manifest.packages.orderbook.packageId;
const tx = new Transaction();
tx.moveCall({
    target: `${packageId}::balance_manager::balance`,
    arguments: [tx.object(balanceManagerId)],
    typeArguments: [coinType],
});
const res = await mysoClient.core.simulateTransaction({
    transaction: tx,
    include: { commandResults: true, effects: true },
});
const bytes = res.commandResults?.[0]?.returnValues?.[0]?.bcs;
if (!bytes) return "0";
return String(Number(bcs.U64.parse(bytes)) / coinScalar(symbol));
```

`bcs` comes from `import { bcs } from "@socialproof/myso/bcs"`.

### 4.6 SDK module entry points (real `exports` map of `@socialproof/myso@0.0.4`)

```
/socialproof/myso
  ./bcs              ./client           ./cryptography     ./faucet
  ./graphql          ./grpc             ./jsonRpc          ./keypairs/ed25519
  ./keypairs/secp256k1  ./keypairs/secp256r1  ./keypairs/passkey
  ./multisig         ./transactions     ./utils            ./verify
  ./zklogin          ./graphql/schema
```

Imports the dashboard actually uses:

```ts
import { MySoGrpcClient } from "@socialproof/myso/grpc";                  // src/dapp-kit.ts:2
import { Ed25519Keypair } from "@socialproof/myso/keypairs/ed25519";      // contexts + sandbox-dev-wallet
import { decodeMySoPrivateKey } from "@socialproof/myso/cryptography";    // src/dapp-kit.ts:4
import { Transaction } from "@socialproof/myso/transactions";             // trading/hooks.ts, sandbox-dev-wallet.ts
import { bcs } from "@socialproof/myso/bcs";                              // trading/hooks.ts:21
import type { ClientWithExtensions, ClientWithCoreApi } from "@socialproof/myso/client";
```

`Ed25519Keypair` API used:

```ts
new Ed25519Keypair()                                  // random
Ed25519Keypair.fromSecretKey(seed: Uint8Array | string, { skipValidation? })
Ed25519Keypair.deriveKeypair(mnemonic: string, path?) // DEFAULT_ED25519_DERIVATION_PATH = "m/44'/6976'/0'/0'/0'"
keypair.getPublicKey().toMySoAddress()                // 0x…
keypair.getPublicKey().toMySoBytes()                  // raw 32 bytes
keypair.getSecretKey()                                // bech32 "mysoprivkey…"
keypair.signTransaction(bytes) / signPersonalMessage(bytes) / signAndExecuteTransaction({transaction, client})
```

---

## 5. Dapp-kit / wallet wiring

### 5.1 Providers in `main.tsx` (verbatim, provider order matters)

```tsx
// src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DAppKitProvider } from "@socialproof/dapp-kit-react";
import { dAppKit } from "./dapp-kit.ts";
import { MySocialAuthProvider } from "./contexts/mysocial-auth-context.tsx";
import "./index.css";
import App from "./App.tsx";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <MySocialAuthProvider>
                <DAppKitProvider dAppKit={dAppKit}>
                    <App />
                </DAppKitProvider>
            </MySocialAuthProvider>
        </QueryClientProvider>
    </StrictMode>,
);
```

`MySocialAuthProvider` is **outside** `DAppKitProvider` — but `useMySocialWallet()` (inside `App`)
needs both, which is why the bridge component sits under both providers.

### 5.2 Network config shape — `src/dapp-kit.ts` (full file)

```ts
import { createDAppKit } from "@socialproof/dapp-kit-react";
import { MySoGrpcClient } from "@socialproof/myso/grpc";
import { Ed25519Keypair } from "@socialproof/myso/keypairs/ed25519";
import { decodeMySoPrivateKey } from "@socialproof/myso/cryptography";

import { sandboxDevWalletInitializer } from "./sandbox-dev-wallet.ts";
import { getGrpcBaseUrl, type SandboxNetwork } from "./lib/networks.ts";

// Injected at build time by vite.config.ts from sandbox/.env (PRIVATE_KEY).
const PRIVATE_KEY = import.meta.env.VITE_DEV_WALLET_PRIVATE_KEY ?? "";

function getSandboxKeypair(): Ed25519Keypair {
    const raw = PRIVATE_KEY.trim();
    if (!raw) {
        const kp = new Ed25519Keypair();
        console.warn(
            "[Sandbox Dev Wallet] PRIVATE_KEY missing — set it in sandbox/.env (deploy-all generates one on localnet). Using a fresh ephemeral key; fund it externally.",
        );
        return kp;
    }
    try {
        const { secretKey } = decodeMySoPrivateKey(raw);
        const keypair = Ed25519Keypair.fromSecretKey(secretKey);
        console.log("[Sandbox Dev Wallet] Using key from sandbox/.env (deployer / localnet)");
        return keypair;
    } catch (err) {
        console.warn(
            "[Sandbox Dev Wallet] PRIVATE_KEY could not be decoded (expect mysoprivkey… or consistent-case hex). Using a fresh ephemeral key. Fix sandbox/.env or remove PRIVATE_KEY for local dev.",
            err,
        );
        return new Ed25519Keypair();
    }
}

const sandboxKeypair = getSandboxKeypair();

export const dAppKit = createDAppKit({
    networks: ["localnet", "testnet", "mainnet"] satisfies readonly SandboxNetwork[],
    defaultNetwork: "localnet",
    createClient(network: SandboxNetwork) {
        return new MySoGrpcClient({ network, baseUrl: getGrpcBaseUrl(network) });
    },
    slushWalletConfig: null,
    walletInitializers: [sandboxDevWalletInitializer({ keypair: sandboxKeypair })],
});

declare module "@socialproof/dapp-kit-react" {
    interface Register {
        dAppKit: typeof dAppKit;
    }
}
```

Notes:
- `slushWalletConfig: null` **disables** the Slush browser wallet; only the injected in-memory wallets are available.
- The `declare module` augmentation is what makes `useDAppKit()` / `DAppKitProvider` fully typed (`Register` / `RegisteredDAppKit`).
- `createDAppKit` full options: `autoConnect` (default `true`), `networks`, `createClient`, `defaultNetwork` (default `networks[0]`), `slushWalletConfig`, `enableBurnerWallet` (default `false`), `storage` (default localStorage), `storageKey` (default `mysten-dapp-kit:selected-wallet-and-address`), `walletInitializers`.
- `DAppKit` object surface: `networks`, `getClient(network?)`, `signTransaction`, `signAndExecuteTransaction`, `signPersonalMessage`, `connectWallet`, `disconnectWallet`, `switchAccount`, `switchNetwork`, `stores: { $wallets, $connection, $currentNetwork, $currentClient }`.

### 5.3 Network helpers — `src/lib/networks.ts` (full file logic)

```ts
export const SANDBOX_NETWORKS = ["localnet", "testnet", "mainnet"] as const;
export type SandboxNetwork = (typeof SANDBOX_NETWORKS)[number];

export const NETWORK_LABELS: Record<SandboxNetwork, string> = {
    localnet: "Local",
    testnet: "Test",
    mainnet: "Main",
};

/** Orderbook SDK only accepts mainnet | testnet. Local uses the testnet profile + local manifest. */
export type OrderbookSdkNetwork = "testnet" | "mainnet";

export function toOrderbookSdkNetwork(network: SandboxNetwork): OrderbookSdkNetwork {
    return network === "mainnet" ? "mainnet" : "testnet";
}

export function isSandboxNetwork(value: string | undefined | null): value is SandboxNetwork {
    return value === "localnet" || value === "testnet" || value === "mainnet";
}

/** Present a client whose `.network` the Orderbook SDK will accept. */
export function withOrderbookSdkNetwork<T extends { network: string }>(
    client: T,
    network: OrderbookSdkNetwork,
): T {
    if (client.network === network) return client;
    return Object.create(client, {
        network: { value: network, enumerable: true, configurable: true },
    }) as T;
}
```

Network switching (from `src/components/network-switcher.tsx`):

```tsx
onClick={() => {
    if (active) return;
    dAppKit.switchNetwork(network);
    void queryClient.invalidateQueries();
}}
```

### 5.4 The wallet-based keypair fallback — `use-mysocial-wallet.ts` (full file)

```ts
import { useEffect, useRef } from "react";
import { useCurrentWallet, useDAppKit, useWallets } from "@socialproof/dapp-kit-react";
import { useMySocialAuth } from "@/contexts/mysocial-auth-context";
import { MYSOCIAL_WALLET_NAME, registerInMemoryWallet } from "@/sandbox-dev-wallet";

/**
 * Registers the derived MySocial keypair as a Wallet Standard wallet and connects
 * it through dApp Kit so Trading / BM discovery use `session.user.address`.
 */
export function useMySocialWallet() {
    const { keypair } = useMySocialAuth();
    const dAppKit = useDAppKit();
    const wallets = useWallets();
    const currentWallet = useCurrentWallet();
    const unregisterRef = useRef<(() => void) | null>(null);
    const registeredAddressRef = useRef<string | null>(null);

    useEffect(() => {
        if (!keypair) {
            unregisterRef.current?.();
            unregisterRef.current = null;
            registeredAddressRef.current = null;
            return;
        }

        const address = keypair.getPublicKey().toMySoAddress();
        if (registeredAddressRef.current === address && unregisterRef.current) {
            return;
        }

        unregisterRef.current?.();
        unregisterRef.current = registerInMemoryWallet({
            name: MYSOCIAL_WALLET_NAME,
            clients: dAppKit.networks.map((n) => dAppKit.getClient(n)),
            keypair,
        });
        registeredAddressRef.current = address;

        return () => {
            unregisterRef.current?.();
            unregisterRef.current = null;
            registeredAddressRef.current = null;
        };
    }, [dAppKit, keypair]);

    useEffect(() => {
        if (!keypair) {
            if (currentWallet?.name === MYSOCIAL_WALLET_NAME) {
                void dAppKit.disconnectWallet();
            }
            return;
        }

        const wallet = wallets.find((w) => w.name === MYSOCIAL_WALLET_NAME);
        if (!wallet) return;
        if (currentWallet?.name === MYSOCIAL_WALLET_NAME) return;

        void (async () => {
            try {
                if (currentWallet) await dAppKit.disconnectWallet();
                await dAppKit.connectWallet({ wallet });
            } catch (err: unknown) {
                console.error("[MySocial Wallet] Failed to connect:", err);
            }
        })();
    }, [currentWallet?.name, dAppKit, keypair, wallets]);
}
```

Mounted as a null-rendering bridge inside `App` (which is why provider order works):

```tsx
// src/App.tsx:75-78, 82-84
function MySocialWalletBridge() {
    useMySocialWallet();
    return null;
}
// …
<BrowserRouter>
    <MySocialWalletBridge />
    <Layout>…</Layout>
</BrowserRouter>
```

### 5.5 The in-memory Wallet Standard wallet — `src/sandbox-dev-wallet.ts`

Two exported names and one register function:

```ts
export const SANDBOX_DEV_WALLET_NAME = "Sandbox Dev Wallet";
export const MYSOCIAL_WALLET_NAME = "MySocial Wallet";
```

Imports:

```ts
import {
    MySoSignAndExecuteTransaction,
    MySoSignPersonalMessage,
    MySoSignTransaction,
    ReadonlyWalletAccount,
    StandardConnect,
    StandardEvents,
    getWallets,
    type IdentifierArray,
    type Wallet,
    type WalletIcon,
    type WalletVersion,
} from "@socialproof/wallet-standard";
import type { ClientWithCoreApi } from "@socialproof/myso/client";
import { Transaction } from "@socialproof/myso/transactions";
import { Ed25519Keypair } from "@socialproof/myso/keypairs/ed25519";
```

Constructor, chain map, and account:

```ts
// src/sandbox-dev-wallet.ts:36-64
function chainIdForClient(client: ClientWithCoreApi): string {
    return `myso:${client.network}`;
}

const WALLET_ICON =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" as WalletIcon;

class InMemoryWallet {
    readonly #name: string;
    readonly #chainConfig: Record<string, ClientWithCoreApi>;
    readonly #keypair: Ed25519Keypair;
    readonly #account: InstanceType<typeof ReadonlyWalletAccount>;

    constructor(options: { name: string; clients: ClientWithCoreApi[]; keypair: Ed25519Keypair }) {
        this.#name = options.name;
        this.#keypair = options.keypair;
        this.#chainConfig = options.clients.reduce<Record<string, ClientWithCoreApi>>((acc, client) => {
            acc[chainIdForClient(client)] = client;
            return acc;
        }, {});
        const chains = Object.keys(this.#chainConfig) as IdentifierArray;
        this.#account = new ReadonlyWalletAccount({
            address: this.#keypair.getPublicKey().toMySoAddress(),
            publicKey: this.#keypair.getPublicKey().toMySoBytes(),
            chains,
            features: [MySoSignTransaction, MySoSignAndExecuteTransaction, MySoSignPersonalMessage],
        });
    }
    // …
}
```

Feature set (versions matter):

```ts
// src/sandbox-dev-wallet.ts:86-109
get features() {
    return {
        [StandardConnect]: { version: "1.0.0", connect: this.#connect },
        [StandardEvents]:  { version: "1.0.0", on: this.#on },
        [MySoSignPersonalMessage]: { version: "1.1.0", signPersonalMessage: this.#signPersonalMessage },
        [MySoSignTransaction]:     { version: "2.0.0", signTransaction: this.#signTransaction },
        [MySoSignAndExecuteTransaction]: { version: "2.0.0", signAndExecuteTransaction: this.#signAndExecuteTransaction },
    };
}

#on = (): (() => void) => () => {};
#connect = async () => ({ accounts: this.accounts });
#signPersonalMessage = async (messageInput: { message: Uint8Array }) =>
    await this.#keypair.signPersonalMessage(messageInput.message);
```

Registration + the dapp-kit initializer:

```ts
// src/sandbox-dev-wallet.ts:164-193
export function registerInMemoryWallet(options: {
    name: string;
    clients: ClientWithCoreApi[];
    keypair: Ed25519Keypair;
}): () => void {
    const wallet = new InMemoryWallet(options);
    return getWallets().register(wallet as Wallet);
}

export function sandboxDevWalletInitializer(options: { keypair: Ed25519Keypair }) {
    return {
        id: "sandbox-dev-wallet-initializer",
        async initialize({ networks, getClient }: {
            networks: readonly string[];
            getClient: (network: string) => ClientWithCoreApi;
        }) {
            const clients = networks.map((n) => getClient(n));
            return {
                unregister: registerInMemoryWallet({
                    name: SANDBOX_DEV_WALLET_NAME,
                    clients,
                    keypair: options.keypair,
                }),
            };
        },
    };
}
```

`uint8ToBase64` helper (there is no atob/btoa-safe shortcut used):

```ts
// src/sandbox-dev-wallet.ts:26-32
function uint8ToBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary);
}
```

Wallet Standard input/output contracts you must satisfy:

```ts
// @socialproof/wallet-standard
declare const MySoSignTransaction = "myso:signTransaction";                 // v2.0.0
declare const MySoSignAndExecuteTransaction = "myso:signAndExecuteTransaction"; // v2.0.0
declare const MySoSignPersonalMessage = "myso:signPersonalMessage";        // v1.1.0

interface MySoSignTransactionInput {
  transaction: { toJSON: () => Promise<string> };
  account: WalletAccount;
  chain: IdentifierString;          // "myso:localnet" | "myso:testnet" | "myso:mainnet"
  signal?: AbortSignal;
}
interface SignedTransaction { bytes: string; signature: string; }         // base64
interface MySoSignAndExecuteTransactionOutput extends SignedTransaction {
  digest: string;
  effects: string;                  // base64 BCS effects
}
```

Chain constants available from the SDK: `MYSO_CHAINS, MYSO_LOCALNET_CHAIN, MYSO_TESTNET_CHAIN, MYSO_MAINNET_CHAIN, MYSO_DEVNET_CHAIN, isMySoChain`.

### 5.6 Consuming dapp-kit hooks (used across components)

```tsx
import {
    DAppKitProvider, ConnectButton, ConnectModal,
    useDAppKit, useWallets, useWalletConnection,
    useCurrentAccount, useCurrentWallet, useCurrentClient, useCurrentNetwork,
} from "@socialproof/dapp-kit-react";
```

`ui client.address` selection pattern — auth session wins over the dapp-kit account:

```ts
// src/hooks/use-orderbook-client.ts:342
const address = session?.user?.address ?? account?.address ?? null;
```

`useCurrentAccount()` returns a `UiWalletAccount` (`{ address, publicKey, chains, features, label, icon }`),
`useCurrentWallet()` a `UiWallet` (`{ name, icon, chains, accounts, features, version }`),
`useCurrentClient()` the `MySoGrpcClient` for the current network.

---

## 6. Vite config specifics

### 6.1 Full `vite.config.ts`

```ts
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";

const configDir = path.dirname(fileURLToPath(import.meta.url));

function isOraclePath(pathname: string): boolean {
    return pathname === "/api/oracle" || pathname === "/api/oracle/" || pathname.startsWith("/api/oracle/");
}

/** Dev-only: manifest from disk; stub GET /api/oracle when not proxying to the real oracle (:9010). */
function sandboxDevApiFallback(opts: { oracleProxyEnabled: boolean }) {
    return {
        name: "sandbox-dev-api-fallback",
        enforce: "pre" as const,
        configureServer(server: ViteDevServer) {
            server.middlewares.use(
                (req: IncomingMessage, res: ServerResponse, next: () => void) => {
                    if (req.method !== "GET") { next(); return; }
                    const pathname = (req.url ?? "").split("?")[0] ?? "";

                    if (!opts.oracleProxyEnabled && isOraclePath(pathname)) {
                        res.statusCode = 200;
                        res.setHeader("Content-Type", "application/json");
                        res.end(JSON.stringify({
                            status: "disabled", updates: 0, errors: 0, lastUpdate: null,
                            prices: { myso: null, myusd: null },
                            hint: "Set VITE_SANDBOX_ENABLE_ORACLE=true in sandbox/.env and start oracle-service (see docker-compose.yml comments).",
                        }));
                        return;
                    }

                    if (pathname === "/api/manifest" || pathname === "/api/manifest/") {
                        const manifestPath = path.join(configDir, "..", "deployments", "localnet.json");
                        if (!existsSync(manifestPath)) {
                            res.statusCode = 503;
                            res.setHeader("Content-Type", "application/json");
                            res.end(JSON.stringify({
                                error: "No deployment manifest found",
                                hint: "Run `pnpm deploy-all` from `sandbox/` (writes deployments/localnet.json) or start the sandbox API on port 9009.",
                            }));
                            return;
                        }
                        res.statusCode = 200;
                        res.setHeader("Content-Type", "application/json");
                        res.end(readFileSync(manifestPath, "utf-8"));
                        return;
                    }
                    next();
                },
            );
        },
    };
}

export default defineConfig(({ mode }) => {
    const sandboxEnv = loadEnv(mode, path.resolve(configDir, ".."), "");
    const privateKey = process.env.PRIVATE_KEY ?? sandboxEnv.PRIVATE_KEY ?? "";
    const orderbookApiUrl = process.env.VITE_ORDERBOOK_API_URL ?? sandboxEnv.VITE_ORDERBOOK_API_URL ?? "http://localhost:9008";
    const mmApiUrl = process.env.VITE_MM_API_URL ?? sandboxEnv.VITE_MM_API_URL ?? "http://localhost:3012";
    const oracleProxyEnabled =
        process.env.VITE_SANDBOX_ENABLE_ORACLE === "true" ||
        sandboxEnv.VITE_SANDBOX_ENABLE_ORACLE === "true";

    return {
        envDir: path.resolve(configDir, ".."),
        plugins: [sandboxDevApiFallback({ oracleProxyEnabled }), react()],
        resolve: {
            alias: { "@": path.resolve(configDir, "./src") },
        },
        define: {
            "import.meta.env.VITE_DEV_WALLET_PRIVATE_KEY": JSON.stringify(privateKey),
        },
        server: {
            proxy: {
                "/api/orderbook": { target: orderbookApiUrl, changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/orderbook/, "") },
                ...(oracleProxyEnabled
                    ? { "/api/oracle": { target: "http://localhost:9010", changeOrigin: true, rewrite: (p: string) => p.replace(/^\/api\/oracle/, "") } }
                    : {}),
                "/api/mm":   { target: mmApiUrl,             changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/mm/, "") },
                "/api/myso": { target: "http://localhost:9000", changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/myso/, "") },
                "/api":      { target: "http://localhost:9009", changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") },
            },
        },
    };
});
```

### 6.2 Specifics to carry over

| Aspect | Value / note |
|---|---|
| Aliases | `@` → `<root>/src` (Vite `resolve.alias` **and** tsconfig `paths: { "@/*": ["./src/*"] }`) |
| Plugins | `sandboxDevApiFallback` (custom middleware, `enforce: "pre"`) then `react()` |
| `envDir` | `<dashboard>/..` → the **parent** dir (`sandbox/`), so `sandbox/.env` is authoritative |
| `loadEnv` prefix | `""` — loads **all** keys incl. `PRIVATE_KEY` |
| `define` | `import.meta.env.VITE_DEV_WALLET_PRIVATE_KEY` = `JSON.stringify(privateKey)` |
| Server port | **not set** → Vite default **5173** (matches `VITE_MYSOCIAL_REDIRECT_URI=http://localhost:5173/auth/callback`) |
| Proxy order | `/api/orderbook`, `/api/oracle` (conditional), `/api/mm`, `/api/myso`, then catch-all `/api` → :9009. Vite matches longest-prefix-first, so the catch-all does not steal the others. |
| `optimizeDeps` | **none** — no `optimizeDeps` / `resolve.dedupe` / SSR config is needed for these SDKs to work |
| `build` options | none (defaults) |
| Special SDK handling | none. The only unusual thing is the `define` for the private key and the `Register` module augmentation in `src/dapp-kit.ts`. |

### 6.3 tsconfig

`tsconfig.json` (solution file, project references only):

```json
{
    "files": [],
    "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }]
}
```

`tsconfig.app.json`:

```json
{
    "compilerOptions": {
        "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
        "target": "ES2022",
        "useDefineForClassFields": true,
        "lib": ["ES2022", "DOM", "DOM.Iterable"],
        "module": "ESNext",
        "types": ["vite/client"],
        "skipLibCheck": true,

        /* Bundler mode */
        "moduleResolution": "bundler",
        "allowImportingTsExtensions": true,
        "verbatimModuleSyntax": true,
        "moduleDetection": "force",
        "noEmit": true,
        "jsx": "react-jsx",

        /* Path alias */
        "baseUrl": ".",
        "paths": {
            "@/*": ["./src/*"]
        },

        /* Linting */
        "strict": true,
        "noUnusedLocals": true,
        "noUnusedParameters": true,
        "erasableSyntaxOnly": true,
        "noFallthroughCasesInSwitch": true,
        "noUncheckedSideEffectImports": true
    },
    "include": ["src"]
}
```

`tsconfig.node.json` is the same shape with `target/lib: ES2023`, `"types": ["node"]`, and
`"include": ["vite.config.ts"]`.

**Two things that bite during replication:**
- `"types": ["vite/client"]` is what makes `import.meta.env.*` type-check; without it every env read errors.
- `"verbatimModuleSyntax": true` forces `import type { … }` for type-only imports (the codebase is
  consistent about this, e.g. `import type { Manifest, SandboxClient } from "@/hooks/use-orderbook-client"`).
- `"allowImportingTsExtensions": true` is why intra-src imports use explicit `.ts`/`.tsx` suffixes in
  some places (`./dapp-kit.ts`, `./lib/networks.ts`, `./sandbox-dev-wallet.ts`, `./contexts/mysocial-auth-context.tsx`)
  while shadcn-style imports use extensionless `@/…` paths. Both work.

### 6.4 Build script & Docker

```json
"build": "tsc -b && vite build"
```

`Dockerfile` (build-time private key injection is the notable part):

```dockerfile
# ---- Builder ----
FROM node:22-alpine AS builder
RUN corepack enable

# PRIVATE_KEY is baked into the bundle by Vite (via define) so the dev
# wallet has the deployer key available without a runtime fetch.
ARG PRIVATE_KEY="AAago5chHzTFNp+CkqhqzoXzoU31TYbIS/lGCvQ9/iLH"
ENV PRIVATE_KEY=$PRIVATE_KEY

WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install
COPY tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY vite.config.ts tailwind.config.ts postcss.config.js ./
COPY index.html ./
COPY public/ public/
COPY src/ src/
RUN pnpm run build

# ---- Runtime ----
FROM nginx:alpine
COPY --from=builder /app/dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

`nginx.conf` mirrors the dev proxy with `location /api/orderbook/`, `/api/oracle/`, `/api/mm/`,
`/api/myso/`, `/api/`, and `location / { try_files $uri $uri/ /index.html; }` (SPA fallback so
`/auth/callback` deep links work in production).

### 6.5 `index.html` (note the hard-coded dark class)

```html
<!doctype html>
<html lang="en" class="dark">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Orderbook Dashboard</title>
    </head>
    <body>
        <div id="root"></div>
        <script type="module" src="/src/main.tsx"></script>
    </body>
</html>
```

### 6.6 Tailwind / PostCSS / shadcn config

`postcss.config.js`:

```js
export default {
    plugins: {
        tailwindcss: {},
        autoprefixer: {},
    },
};
```

`tailwind.config.ts`:

```ts
import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
    darkMode: "class",
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    theme: {
        extend: {
            colors: {
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
                secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
                destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
                muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
                accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
                card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
                popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
            },
        },
    },
    plugins: [tailwindcssAnimate],
} satisfies Config;
```

`components.json` (shadcn/ui — note: **Tailwind v3 style**, no `tailwind.cssVariables` nesting):

```json
{
    "$schema": "https://ui.shadcn.com/schema.json",
    "style": "new-york",
    "rsc": false,
    "tsx": true,
    "tailwind": {
        "config": "tailwind.config.ts",
        "css": "src/index.css",
        "baseColor": "zinc",
        "cssVariables": true
    },
    "aliases": {
        "components": "@/components",
        "utils": "@/lib/utils"
    }
}
```

### 6.7 ESLint + Prettier

`eslint.config.js` (flat config, ESM):

```js
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import prettier from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
    globalIgnores(["dist"]),
    {
        files: ["**/*.{ts,tsx}"],
        extends: [
            js.configs.recommended,
            tseslint.configs.recommended,
            reactHooks.configs.flat.recommended,
            reactRefresh.configs.vite,
            prettierConfig,
        ],
        plugins: { prettier },
        rules: {
            "prettier/prettier": "warn",
            "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
        },
        languageOptions: { ecmaVersion: 2020, globals: globals.browser },
    },
]);
```

Repo-root `.prettierrc` = `{ "printWidth": 100 }`; the dashboard's 4-space indent therefore comes from
Prettier defaults (tabs? no — 4 spaces is set by editor config / `.editorconfig`), not from a local config.

---

## 7. Reusable UI primitives

### 7.1 `src/components/ui/` inventory (exactly six files)

| File | Exports | Notes |
|---|---|---|
| `badge.tsx` | `Badge`, `badgeVariants` | cva variants: `default \| secondary \| destructive \| outline \| success \| warning` (two custom additions: `success` → `bg-emerald-500/15 text-emerald-400`, `warning` → `bg-yellow-500/15 text-yellow-400`) |
| `button.tsx` | `Button`, `buttonVariants` | cva variants `default \| destructive \| outline \| secondary \| ghost \| link`; sizes `default(h-9 px-4 py-2) \| sm(h-8 px-3 text-xs) \| lg(h-10 px-8) \| icon(h-9 w-9)`; `React.forwardRef`, `displayName = "Button"` |
| `card.tsx` | `CardHeader`, `CardTitle`, `CardContent` | **no `Card` root component** — a bare `<div className="rounded-lg border bg-card …">` is used inline; `p-4` padding, `CardTitle` is `text-sm font-semibold` |
| `popover.tsx` | `Popover`, `PopoverTrigger`, `PopoverContent` | Radix wrapper; `PopoverContent` defaults `align="center" sideOffset={4}`, `z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md`, full animate-in/out data-attribute classes, `origin-[--radix-popover-content-transform-origin]`, rendered in a `Portal` |
| `skeleton.tsx` | `Skeleton` | `animate-pulse rounded-md bg-muted` |
| `tooltip.tsx` | `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider` | Radix wrapper; `sideOffset={4}`, `z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground` + animation classes |

Not present (so you'd need to add them if required): `dialog`, `select`, `input`, `tabs`, `table`,
`dropdown-menu`, `toast`, `separator`, `avatar`, `label`, `form`.

### 7.2 `src/lib/utils.ts` — the `cn` helper everything depends on

```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}
```

### 7.3 CSS variable tokens — `src/index.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
    :root {
        --background: 0 0% 100%;
        --foreground: 240 10% 3.9%;
        --card: 0 0% 100%;
        --card-foreground: 240 10% 3.9%;
        --primary: 240 5.9% 10%;
        --primary-foreground: 0 0% 98%;
        --secondary: 240 4.8% 95.9%;
        --secondary-foreground: 240 5.9% 10%;
        --muted: 240 4.8% 95.9%;
        --muted-foreground: 240 3.8% 46.1%;
        --accent: 240 4.8% 95.9%;
        --accent-foreground: 240 5.9% 10%;
        --destructive: 0 84.2% 60.2%;
        --destructive-foreground: 0 0% 98%;
        --border: 240 5.9% 90%;
        --input: 240 5.9% 90%;
        --popover: 0 0% 100%;
        --popover-foreground: 240 10% 3.9%;
        --ring: 240 5.9% 10%;
        --radius: 0.5rem;
    }

    .dark {
        --background: 240 10% 3.9%;
        --foreground: 0 0% 98%;
        --card: 240 10% 3.9%;
        --card-foreground: 0 0% 98%;
        --popover: 240 10% 3.9%;
        --popover-foreground: 0 0% 98%;
        --primary: 0 0% 98%;
        --primary-foreground: 240 5.9% 10%;
        --secondary: 240 3.7% 15.9%;
        --secondary-foreground: 0 0% 98%;
        --muted: 240 3.7% 15.9%;
        --muted-foreground: 240 5% 64.9%;
        --accent: 240 3.7% 15.9%;
        --accent-foreground: 0 0% 98%;
        --destructive: 0 62.8% 30.6%;
        --destructive-foreground: 0 0% 98%;
        --border: 240 3.7% 15.9%;
        --input: 240 3.7% 15.9%;
        --ring: 240 4.9% 83.9%;
    }
}
```

**Critical gotcha documented in the file itself** — dApp Kit's Lit web components read
`var(--background)` etc. as *real* CSS colors, but the Tailwind setup stores bare HSL components
(`240 10% 3.9%`). The fix is an unconditional override on the dApp Kit custom elements
(note: dApp Kit here still uses the `mysten-dapp-kit-*` tag names):

```css
/*
 * dApp Kit connect modal theming.
 * dApp Kit reads var(--background) etc. but our Tailwind setup stores raw HSL
 * components (e.g. "240 10% 3.9%") which aren't valid CSS colors.
 * Override with real color values on the dApp Kit elements.
 */
mysten-dapp-kit-connect-button,
mysten-dapp-kit-connect-modal {
    --background: #18181b;
    --foreground: #fafafa;
    --primary: #27272a;
    --primary-foreground: #fafafa;
    --secondary: #27272a;
    --secondary-foreground: #fafafa;
    --border: #3f3f46;
    --accent: #27272a;
    --accent-foreground: #fafafa;
    --muted: #27272a;
    --muted-foreground: #a1a1aa;
    --popover: #18181b;
    --popover-foreground: #fafafa;
    --ring: #a1a1aa;
}

@layer base {
    * {
        @apply border-border;
    }
    body {
        @apply bg-background text-foreground;
        font-family:
            system-ui,
            -apple-system,
            sans-serif;
    }
}
```

**Fonts:** no webfont is loaded — `font-family: system-ui, -apple-system, sans-serif` inline on
`body`. No `@font-face`, no Google Fonts link, no `fontFamily` key in the Tailwind theme.

### 7.4 Styling conventions observed

- **Dark-only app**: `<html class="dark">` in `index.html` + `darkMode: "class"`. Light-mode tokens exist but are never used at runtime.
- Semantic tokens everywhere (`bg-background`, `text-foreground`, `border-border`, `bg-card`, `text-muted-foreground`, `bg-accent`). **Locale-specific hard-coded zinc values** appear in chrome around dApp Kit / popovers: `bg-zinc-950 border-zinc-800 p-3` (both `PopoverContent`s), `text-zinc-200/400/500/600`, `ring-zinc-700 hover:ring-zinc-500`, `hover:bg-zinc-800`, `bg-zinc-900`, `text-emerald-400`.
- **Typography scale for dense UI**: `text-sm` body, `text-xs` for values, `text-[11px]` for section labels (usually paired with `uppercase tracking-wider text-zinc-600`), `text-[10px]` for hints.
- **Numbers**: `font-mono` + `tabular-nums` for balances/amounts; addresses truncated to `${addr.slice(0,8)}...${addr.slice(-6)}`.
- **Layout**: `mx-auto max-w-7xl px-6`, sticky header `h-16` with `bg-background/80 backdrop-blur-md ring-1 ring-border/50`; page body `py-8`.
- **Iconography**: `lucide-react`, sized `h-3 w-3` / `h-3.5 w-3.5` / `h-4 w-4` / `h-5 w-5`, all with `aria-hidden` when decorative.
- **Accessibility details worth copying**: `aria-busy`, `aria-label`, `aria-pressed`, `aria-disabled`, `role="group"` + `aria-label` on the network switcher, disabled-with-tooltip rendered as `<span className="inline-flex">` wrapper because a disabled button swallows pointer events.
- **`public/` assets referenced by the UI**: `logo.svg`, `default-avatar.webp`, `myso-icon-green.png`, `myUSD_icon.webp`, `btc-icon.png`, `eth-icon.png`, `svg/usdc.svg`, plus `deepbook.jpeg` / `vite.svg` (unused leftovers). `CoinIcon` maps symbol → asset with `h-4 w-4 rounded-full`:

```tsx
// src/components/trading/coin-icon.tsx
const COIN_ICONS: Record<string, { src: string; className: string }> = {
    MYUSD: { src: "/myUSD_icon.webp", className: "h-4 w-4 rounded-full" },
    MYSO: { src: "/myso-icon-green.png", className: "h-4 w-4 rounded-full" },
    USDC: { src: "/svg/usdc.svg", className: "h-4 w-4 rounded-full" },
    BTC: { src: "/btc-icon.png", className: "h-4 w-4 rounded-full" },
    ETH: { src: "/eth-icon.png", className: "h-4 w-4 rounded-full" },
};
```

---

## 8. Replication checklist / gotchas

1. `main.tsx` provider order: `QueryClientProvider` → `MySocialAuthProvider` → `DAppKitProvider` → `App`; mount a `useMySocialWallet()` bridge inside the router.
2. `createDAppKit({ networks, defaultNetwork, createClient, slushWalletConfig: null, walletInitializers })` + `declare module "@socialproof/dapp-kit-react" { interface Register { dAppKit: typeof dAppKit } }`.
3. `useCurrentClient()` returns a `MySoGrpcClient`; use `client.core.*` for direct calls, `dAppKit.signAndExecuteTransaction` for writes.
4. Never hand-set the sender or gas: `setSenderIfNotSet` + `toJSON({ client, supportedIntents })` happen inside dapp-kit, which resolves gas/objects.
5. Wallet Standard feature versions are load-bearing: `myso:signTransaction` **2.0.0**, `myso:signAndExecuteTransaction` **2.0.0**, `myso:signPersonalMessage` **1.1.0**, `standard:connect` / `standard:events` **1.0.0**.
6. Chain IDs are `` `myso:${client.network}` `` — build the `chainConfig` map per client.
7. Derived-keypair formula is exact: `SHA-256(utf8(sub + "_" + salt)).slice(0,32)` → `Ed25519Keypair.fromSecretKey`, then assert `toMySoAddress() === session.user.address`.
8. Salt request is a **bodyless POST** with `Authorization: Bearer <token>`; use `auth.getAccessTokenForApi()` and skip the call when `session.salt` exists.
9. Wallet-only sessions (`access_token === "wallet-only"`) cannot sign — surface that error explicitly.
10. `storage: "session"` for OAuth persistence (the app's default); the SDK's own default is `"memory"`.
11. `tsconfig.app.json` needs `"types": ["vite/client"]` for `import.meta.env` typing and `verbatimModuleSyntax` discipline for `import type`.
12. Override dApp Kit's Lit-component CSS variables with real hex colors, or the connect modal inherits invalid `hsl(240 10% 3.9%)`-style values.
13. Register `/auth/callback` as a route **and** keep the SPA fallback in nginx (`try_files … /index.html`).
14. Do not bake a real `PRIVATE_KEY` into the bundle outside a localnet sandbox.
