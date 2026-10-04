// Copyright (c) The Social Proof Foundation, LLC.
// SPDX-License-Identifier: Apache-2.0
//
// Identical derivation to the orderbook sandbox dashboard:
// keypair seed = SHA-256(`${sub}_${salt}`)[0..32], asserted against the
// authenticated MySocial address.

import {
    isWalletOnlySession,
    WALLET_ONLY_ACCESS_TOKEN,
    type MySocialAuth,
    type Session,
    type WalletCredentials,
} from "@socialproof/mysocial-auth";
import { Ed25519Keypair } from "@socialproof/myso/keypairs/ed25519";

export function getMySocialSaltUrl(): string {
    const explicit = (import.meta.env.VITE_MYSOCIAL_SALT_URL as string | undefined)?.trim();
    if (explicit) return explicit;
    const base = (import.meta.env.VITE_MYSOCIAL_API_BASE as string | undefined)?.trim() ?? "";
    if (!base) return "https://salt.testnet.mysocial.network/salt";
    return `${base.replace(/\/$/, "")}/salt`;
}

export function addressesMatch(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
}

async function sha256First32Bytes(input: string): Promise<Uint8Array> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return new Uint8Array(digest).slice(0, 32);
}

function looksLikeOAuthSession(session: Session): boolean {
    const user = session.user;
    return !!(user?.email || user?.name || (user?.sub && user.sub !== user?.address));
}

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
