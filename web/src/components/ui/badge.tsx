import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
    "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight tabular-nums transition-colors",
    {
        variants: {
            tone: {
                neutral: "border-border bg-muted/60 text-muted-foreground",
                open: "border-primary/35 bg-primary/12 text-primary",
                resolved: "border-accent/35 bg-accent/12 text-accent",
                warning: "border-warning/40 bg-warning/12 text-warning",
                danger: "border-danger/40 bg-danger/12 text-danger",
                success: "border-positive/40 bg-positive/12 text-positive",
                outline: "border-border bg-transparent text-foreground",
            },
        },
        defaultVariants: { tone: "neutral" },
    },
);

export interface BadgeProps
    extends React.HTMLAttributes<HTMLSpanElement>,
        VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
    return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** Small status dot used in the service-health pills. */
export function StatusDot({ ok, className }: { ok: boolean; className?: string }) {
    return (
        <span
            aria-hidden
            className={cn(
                "relative inline-flex size-1.5 shrink-0 rounded-full",
                ok ? "bg-positive" : "bg-danger",
                className,
            )}
        >
            <span
                className={cn(
                    "absolute inset-0 animate-ping rounded-full opacity-60",
                    ok ? "bg-positive" : "bg-danger",
                )}
            />
        </span>
    );
}
