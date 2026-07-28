import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Geist } from "next/font/google";
import "./globals.css";

// Self-hosted Syne (woff2 in public/fonts). No Google Fonts -- repo rule for Syne only
// (ss04 alternate g is stripped by Google Fonts CDN). Syne is the heading/display font.
const syne = localFont({
  src: "../../public/fonts/Syne.woff2",
  variable: "--font-body",
  display: "swap",
  weight: "400 800",
});

// Geist for numeric displays (next/font auto-downloads and self-hosts at build time).
// Exposes --font-num so theme.ts FONT_NUM resolves without a Google Fonts runtime request.
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-num",
  weight: ["300", "400"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mate",
  description: "Your onboarding concierge",
  // Neutral, white-label PWA manifest. Per-client branding is applied at runtime
  // via theming; the install icon + manifest stay generic (no Auto Mate, no client).
  manifest: "/manifest.json",
  applicationName: "Mate",
  appleWebApp: {
    capable: true,
    title: "Mate",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#141414",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${syne.variable} ${geist.variable}`}>
      <body className="bg-[#141414] text-[#ede6e6] antialiased font-sans">{children}</body>
    </html>
  );
}
