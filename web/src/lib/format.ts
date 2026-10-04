/** Formatting helpers. All on-chain amounts are MIST (1 MYSO = 1e9 MIST). */

export const MIST_PER_MYSO = 1_000_000_000n;

export function mistToMyso(mist: string | number | bigint | null | undefined): number {
    if (mist === null || mist === undefined) return 0;
    try {
        const value = BigInt(typeof mist === "number" ? Math.trunc(mist) : mist);
        return Number(value) / Number(MIST_PER_MYSO);
    } catch {
        return 0;
    }
}

/**
 * Compact MYSO amount. Large values abbreviate; sub-unit values keep enough
 * significant digits to stay meaningful (MIST granularity is 1e-9 MYSO).
 */
export function formatMyso(mist: string | number | bigint | null | undefined, digits = 2): string {
    const value = mistToMyso(mist);
    if (value === 0) return "0";
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(digits)}M`;
    if (abs >= 10_000) return `${(value / 1_000).toFixed(digits)}K`;
    if (abs < 0.000_001) {
        // 1 MIST = 1e-9 MYSO — show it exactly rather than in exponent form.
        return abs < 0.000_000_5 ? value.toFixed(9) : value.toFixed(7);
    }
    if (abs < 0.01) return value.toFixed(6);
    return value.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: digits,
    });
}

export function formatBps(bps: number | null | undefined): string {
    if (bps === null || bps === undefined) return "—";
    return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

export function shortAddress(value: string | null | undefined, lead = 6, tail = 4): string {
    if (!value) return "—";
    if (value.length <= lead + tail + 2) return value;
    return `${value.slice(0, lead + 2)}…${value.slice(-tail)}`;
}

export function formatDateTime(ms: number | null | undefined): string {
    if (!ms || !Number.isFinite(ms)) return "—";
    return new Date(ms).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

/** "in 4m 12s" / "3h ago" */
export function relativeTime(ms: number | null | undefined, now = Date.now()): string {
    if (!ms || !Number.isFinite(ms)) return "—";
    const delta = ms - now;
    const abs = Math.abs(delta);
    const units: Array<[number, string]> = [
        [86_400_000, "d"],
        [3_600_000, "h"],
        [60_000, "m"],
        [1_000, "s"],
    ];
    for (const [size, suffix] of units) {
        if (abs >= size) {
            const value = Math.floor(abs / size);
            return delta >= 0 ? `in ${value}${suffix}` : `${value}${suffix} ago`;
        }
    }
    return delta >= 0 ? "now" : "just now";
}

export function formatDuration(ms: number | null | undefined): string {
    if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
    const days = Math.floor(ms / 86_400_000);
    const hours = Math.floor((ms % 86_400_000) / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${Math.round(ms / 1000)}s`;
}

export function formatCount(value: number | null | undefined): string {
    if (value === null || value === undefined) return "—";
    return value.toLocaleString();
}

/** `pluralize(1, "policy")` -> "1 policy"; `pluralize(2, "policy")` -> "2 policies". */
export function pluralize(count: number | null | undefined, singular: string, plural?: string): string {
    const value = count ?? 0;
    const word = value === 1 ? singular : (plural ?? `${singular}s`);
    return `${value.toLocaleString()} ${word}`;
}
