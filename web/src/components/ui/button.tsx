import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
    "focus-ring inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
    {
        variants: {
            variant: {
                primary:
                    "bg-primary text-primary-foreground shadow-[0_0_0_1px_hsl(var(--primary)/0.5),0_6px_20px_-8px_hsl(var(--primary)/0.7)] hover:brightness-110 active:brightness-95",
                secondary:
                    "border border-border bg-surface-raised text-foreground hover:border-muted-foreground/40 hover:bg-muted",
                outline:
                    "border border-border bg-transparent text-foreground hover:border-primary/60 hover:text-primary",
                ghost: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                danger:
                    "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20 hover:border-danger/60",
                warning:
                    "border border-warning/40 bg-warning/10 text-warning hover:bg-warning/20",
            },
            size: {
                sm: "h-8 px-2.5 text-xs",
                md: "h-9 px-3.5",
                lg: "h-10 px-4",
                icon: "h-8 w-8",
            },
        },
        defaultVariants: { variant: "secondary", size: "md" },
    },
);

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
        VariantProps<typeof buttonVariants> {
    loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, loading, children, disabled, ...props }, ref) => (
        <button
            ref={ref}
            className={cn(buttonVariants({ variant, size }), className)}
            disabled={disabled || loading}
            {...props}
        >
            {loading ? (
                <span
                    aria-hidden
                    className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
                />
            ) : null}
            {children}
        </button>
    ),
);
Button.displayName = "Button";

export { buttonVariants };
