import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/app/theme-provider";
import { PwaRegister } from "@/components/app/pwa-register";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "InvoiceFlow — Offline-First Invoices & Quotations",
  description:
    "Offline-first invoice and quotation management for Indian businesses. GST-ready, local-first with cloud sync, professional PDFs, works without internet.",
  keywords: ["invoice", "quotation", "GST", "offline-first", "India", "billing"],
  manifest: "/manifest.webmanifest",
  applicationName: "InvoiceFlow",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#059669" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1210" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider>
          {children}
          <Toaster position="bottom-right" richColors closeButton />
          <PwaRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
