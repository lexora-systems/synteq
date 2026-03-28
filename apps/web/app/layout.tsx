import type { Metadata } from "next";
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
      </body>
    </html>
  );
}
