import type { Metadata } from "next";
import Script from "next/script";
import { Manrope, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { ThemeModeSwitch } from "../components/theme-mode-switch";

const bodyFont = Manrope({ subsets: ["latin"], variable: "--font-body" });
const headingFont = Space_Grotesk({ subsets: ["latin"], variable: "--font-heading" });

export const metadata: Metadata = {
  title: "Synteq",
  description: "AI workflow monitoring and anomaly detection",
  icons: {
    icon: "/syn-logo.png",
    shortcut: "/syn-logo.png",
    apple: "/syn-logo.png"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${bodyFont.variable} ${headingFont.variable}`}>
        {children}
        <ThemeModeSwitch />
        {process.env.NODE_ENV === "production" ? (
          <Script
            src="https://static.cloudflareinsights.com/beacon.min.js"
            strategy="afterInteractive"
            data-cf-beacon='{"token":"b5ab86f723ca4aeeab42435236c5e4a"}'
          />
        ) : null}
      </body>
    </html>
  );
}
