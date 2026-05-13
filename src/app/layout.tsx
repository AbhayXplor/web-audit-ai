import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Enrichment Engine | Lead Intel Dashboard",
  description: "AI-powered lead enrichment and website auditing platform.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body
        className={`${inter.variable} ${outfit.variable} font-sans min-h-full flex flex-col bg-[#020617] text-slate-200`}
      >
        {children}
      </body>
    </html>
  );
}
