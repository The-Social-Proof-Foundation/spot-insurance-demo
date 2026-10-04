import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export const DialogOverlay = forwardRef<
    React.ElementRef<typeof DialogPrimitive.Overlay>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Overlay
        ref={ref}
        className={cn(
            "fixed inset-0 z-50 bg-background/80 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            className,
        )}
        {...props}
    />
));
DialogOverlay.displayName = "DialogOverlay";

export const DialogContent = forwardRef<
    React.ElementRef<typeof DialogPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { hideClose?: boolean }
>(({ className, children, hideClose, ...props }, ref) => (
    <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
            ref={ref}
            className={cn(
                "fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[min(60rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col",
                "animate-dialog-in overflow-hidden rounded-xl border border-border bg-surface shadow-[0_32px_90px_-30px_rgba(0,0,0,0.95)]",
                "focus:outline-none",
                className,
            )}
            {...props}
        >
            {children}
            {hideClose ? null : (
                <DialogPrimitive.Close
                    className="focus-ring absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label="Close"
                >
                    <X className="size-4" />
                </DialogPrimitive.Close>
            )}
        </DialogPrimitive.Content>
    </DialogPortal>
));
DialogContent.displayName = "DialogContent";

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn(
                "flex flex-col gap-1.5 border-b border-border px-5 py-4 pr-12",
                className,
            )}
            {...props}
        />
    );
}

export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn("flex-1 space-y-5 overflow-y-auto px-5 py-5", className)}
            {...props}
        />
    );
}

export const DialogTitle = forwardRef<
    React.ElementRef<typeof DialogPrimitive.Title>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Title
        ref={ref}
        className={cn("text-base font-semibold leading-tight tracking-tight", className)}
        {...props}
    />
));
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = forwardRef<
    React.ElementRef<typeof DialogPrimitive.Description>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Description
        ref={ref}
        className={cn("text-xs leading-relaxed text-muted-foreground", className)}
        {...props}
    />
));
DialogDescription.displayName = "DialogDescription";
