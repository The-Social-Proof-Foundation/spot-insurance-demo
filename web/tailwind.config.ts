import animate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
    darkMode: "class",
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    theme: {
        container: {
            center: true,
            padding: "1.5rem",
            screens: { "2xl": "1440px" },
        },
        extend: {
            colors: {
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                surface: {
                    DEFAULT: "hsl(var(--surface))",
                    raised: "hsl(var(--surface-raised))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                primary: {
                    DEFAULT: "hsl(var(--primary))",
                    foreground: "hsl(var(--primary-foreground))",
                },
                accent: {
                    DEFAULT: "hsl(var(--accent))",
                    foreground: "hsl(var(--accent-foreground))",
                },
                positive: "hsl(var(--positive))",
                warning: "hsl(var(--warning))",
                danger: "hsl(var(--danger))",
                info: "hsl(var(--info))",
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
            },
            fontFamily: {
                sans: [
                    "ui-sans-serif",
                    "-apple-system",
                    "BlinkMacSystemFont",
                    "Segoe UI",
                    "Inter",
                    "system-ui",
                    "sans-serif",
                ],
                mono: [
                    "ui-monospace",
                    "SFMono-Regular",
                    "SF Mono",
                    "Menlo",
                    "Consolas",
                    "monospace",
                ],
            },
            keyframes: {
                "fade-up": {
                    from: { opacity: "0", transform: "translateY(6px)" },
                    to: { opacity: "1", transform: "translateY(0)" },
                },
                "dialog-in": {
                    from: { opacity: "0", transform: "translate(-50%, -48%) scale(0.97)" },
                    to: { opacity: "1", transform: "translate(-50%, -50%) scale(1)" },
                },
                "dialog-out": {
                    from: { opacity: "1", transform: "translate(-50%, -50%) scale(1)" },
                    to: { opacity: "0", transform: "translate(-50%, -48%) scale(0.97)" },
                },
                shimmer: {
                    "100%": { transform: "translateX(100%)" },
                },
            },
            animation: {
                "fade-up": "fade-up 220ms cubic-bezier(0.16, 1, 0.3, 1) both",
                "dialog-in": "dialog-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both",
                "dialog-out": "dialog-out 140ms ease-in both",
            },
        },
    },
    plugins: [animate],
};
