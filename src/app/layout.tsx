import type { Metadata, Viewport } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { currentTheme } from "@/lib/theme/server";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["500", "700"],
});

export const metadata: Metadata = {
  title: "ShelfLife",
  description: "Back-of-house operations for convenience retail",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1113" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every route already reads the session cookie, so reading this one costs no static page.
  const theme = await currentTheme();

  return (
    <html
      lang="en"
      data-theme={theme === "system" ? undefined : theme}
      className={`${instrumentSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
