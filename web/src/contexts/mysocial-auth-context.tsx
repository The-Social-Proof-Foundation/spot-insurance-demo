// Copyright (c) The Social Proof Foundation, LLC.
// SPDX-License-Identifier: Apache-2.0
//
// MySocial auth, mirroring orderbook-sandbox-main/sandbox/dashboard:
// `createMySocialAuth` -> popup sign-in -> salt service -> Ed25519 keypair.
//
// Differences for this demo:
//  * the keypair is only used to prove the session is a real signing identity —
//    every chain write is submitted by the backend's simulated oracle key;
//  * when the `VITE_MYSOCIAL_*` vars are unset the provider exposes a local
//    "demo operator" session so the UI is still fully explorable.

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import {
    createMySocialAuth,
    type MySocialAuth,
    type Session,
    type SignInOptions,
} from "@socialproof/mysocial-auth";
import { Ed25519Keypair } from "@socialproof/myso/keypairs/ed25519";
import {
    addressesMatch,
    deriveKeypairFromSession,
    getMySocialSaltUrl,
    keypairFromWalletCredentials,
} from "@/lib/derive-mysocial-keypair";

const DEMO_SESSION_KEY = "spot_demo_session";

export interface DemoOperator {
    /** Local-only label shown when MySocial auth is not configured. */
    label: string;
    address: string;
    signedInAt: number;
}

export type AuthMode = "mysocial" | "demo";

export interface MySocialAuthContextValue {
    auth: MySocialAuth | null;
    isConfigured: boolean;
    mode: AuthMode;
    session: Session | null;
    keypair: Ed25519Keypair | null;
    deriving: boolean;
    deriveError: string | null;
    signIn: (options?: SignInOptions) => Promise<Session | undefined>;
    signOut: () => Promise<void>;
    /** Local demo session, used when MySocial auth is not configured. */
    demoOperator: DemoOperator | null;
    startDemoSession: (label?: string) => void;
    identity: { address: string; label: string; source: AuthMode } | null;
}

const MySocialAuthContext = createContext<MySocialAuthContextValue | null>(null);

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
                ? (import.meta.env.VITE_MYSOCIAL_STORAGE as "memory" | "session")
                : ("session" as const),
    };
}

function readDemoSession(): DemoOperator | null {
    try {
        const raw = sessionStorage.getItem(DEMO_SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as DemoOperator;
        return parsed?.address ? parsed : null;
    } catch {
        return null;
    }
}

export function MySocialAuthProvider({ children }: { children: ReactNode }) {
    const env = useMemo(() => readMySocialEnv(), []);
    const isConfigured = Boolean(env.apiBaseUrl && env.authOrigin && env.clientId && env.redirectUri);

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

    const [session, setSession] = useState<Session | null>(null);
    const [keypair, setKeypair] = useState<Ed25519Keypair | null>(null);
    const [deriving, setDeriving] = useState(false);
    const [deriveError, setDeriveError] = useState<string | null>(null);
    const [demoOperator, setDemoOperator] = useState<DemoOperator | null>(() => readDemoSession());

    const credentialsKeypairRef = useRef<Ed25519Keypair | null>(null);
    const sessionRef = useRef<Session | null>(null);
    const derivedForRef = useRef<string | null>(null);

    useEffect(() => {
        if (!auth) {
            setSession(null);
            return;
        }
        void auth.getSession().then(setSession);
        return auth.onAuthStateChange(setSession);
    }, [auth]);

    sessionRef.current = session;

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

        const currentSession = sessionRef.current;
        if (!currentSession) return;

        let cancelled = false;
        setDeriving(true);
        setDeriveError(null);

        void deriveKeypairFromSession(auth, currentSession, env.saltUrl)
            .then((derived) => {
                if (cancelled) return;
                derivedForRef.current = deriveKey;
                setKeypair(derived);
                setDeriveError(null);
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                derivedForRef.current = null;
                setKeypair(null);
                setDeriveError(
                    error instanceof Error ? error.message : "Failed to derive signing key.",
                );
            })
            .finally(() => {
                if (!cancelled) setDeriving(false);
            });

        return () => {
            cancelled = true;
        };
    }, [auth, deriveKey, env.saltUrl, sessionAddress]);

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
                    } catch (error) {
                        credentialsKeypairRef.current = null;
                        setDeriveError(
                            error instanceof Error
                                ? error.message
                                : "Failed to import wallet credentials.",
                        );
                    }
                    options?.onWalletCredentials?.(credentials);
                },
            });
        },
        [auth],
    );

    const signOut = useCallback(async () => {
        credentialsKeypairRef.current = null;
        derivedForRef.current = null;
        setKeypair(null);
        setDeriveError(null);
        setDeriving(false);
        if (auth) await auth.signOut();
        setSession(null);
    }, [auth]);

    const startDemoSession = useCallback((label = "Demo Operator") => {
        const operator: DemoOperator = {
            label,
            address: `demo:${Math.random().toString(16).slice(2, 10)}`,
            signedInAt: Date.now(),
        };
        sessionStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(operator));
        setDemoOperator(operator);
    }, []);

    const value = useMemo<MySocialAuthContextValue>(() => {
        const identity = session?.user?.address
            ? {
                  address: session.user.address,
                  label: session.user.name ?? session.user.email ?? "MySocial user",
                  source: "mysocial" as const,
              }
            : demoOperator
              ? { address: demoOperator.address, label: demoOperator.label, source: "demo" as const }
              : null;

        return {
            auth,
            isConfigured,
            mode: isConfigured ? "mysocial" : "demo",
            session,
            keypair,
            deriving,
            deriveError,
            signIn,
            signOut,
            demoOperator,
            startDemoSession,
            identity,
        };
    }, [
        auth,
        isConfigured,
        session,
        keypair,
        deriving,
        deriveError,
        signIn,
        signOut,
        demoOperator,
        startDemoSession,
    ]);

    return <MySocialAuthContext.Provider value={value}>{children}</MySocialAuthContext.Provider>;
}

export function useMySocialAuth(): MySocialAuthContextValue {
    const ctx = useContext(MySocialAuthContext);
    if (!ctx) throw new Error("useMySocialAuth must be used within MySocialAuthProvider");
    return ctx;
}
