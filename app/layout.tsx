import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Contrarian Academy Members",
  description: "Membership metrics dashboard for Contrarian Academy",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
