import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "0friction — AI Compute via 0G, Paid in USDC",
  description:
    "Chat with AI powered by 0G Compute Network. Pay per message with USDC — no bridging, no A0GI tokens, no gas required.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
