import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted Syne (woff2 in public/fonts). No Google Fonts — repo rule.
const syne = localFont({
  src: "../../public/fonts/Syne.woff2",
  variable: "--font-body",
  display: "swap",
  weight: "400 800",
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
    <html lang="en" className={syne.variable}>
      <body className="bg-[#141414] text-[#ede6e6] antialiased font-sans">{children}</body>
    </html>
  );
}
