import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Whiteboard",
  description: "An AI tutor that teaches by drawing.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
