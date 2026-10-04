import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
    return (
        <div
            className={cn(
                "relative overflow-hidden rounded-md bg-muted/70",
                "after:absolute after:inset-0 after:animate-[shimmer_1.6s_infinite] after:bg-gradient-to-r after:from-transparent after:via-white/5 after:to-transparent",
                className,
            )}
        />
    );
}
