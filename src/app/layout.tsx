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
  title: "Onboarding",
  description: "Guided onboarding concierge",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
