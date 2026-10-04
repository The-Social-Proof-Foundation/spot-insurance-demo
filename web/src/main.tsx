import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "@/App";
import { MySocialAuthProvider } from "@/contexts/mysocial-auth-context";
import "@/index.css";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            refetchOnWindowFocus: false,
            staleTime: 2_000,
        },
    },
});

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root is missing from index.html");

createRoot(container).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <MySocialAuthProvider>
                <App />
            </MySocialAuthProvider>
        </QueryClientProvider>
    </StrictMode>,
);
