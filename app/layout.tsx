import type { Metadata } from "next";
import { Geist, Geist_Mono, STIX_Two_Text } from "next/font/google";
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from "@/app/brand";
import { THEME_SCRIPT } from "@/player/theme";
import "@/player/theme.css";

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: PRODUCT_DESCRIPTION,
};

// Self-hosted by next/font. The CSS variables are read by player/theme.css:
// Geist for the UI, Geist Mono for small labels, STIX Two Text for the board.
const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});
const stix = STIX_Two_Text({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-stix",
});

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The theme script sets data-theme before React hydrates (Next's "Preventing Flash"
    // guide), so React is told to accept the DOM's value.
    <html
      lang="en"
      data-theme="dark"
      className={`${geist.variable} ${geistMono.variable} ${stix.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
