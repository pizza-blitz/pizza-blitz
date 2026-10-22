import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "Pizza Blitz — Hot pizza, pickup and delivery",
    template: "%s | Pizza Blitz",
  },
  description:
    "Pizza Blitz is a restaurant operating platform: order online for pickup or delivery, customise every item, apply offers, and track your order live.",
  applicationName: "Pizza Blitz",
  openGraph: {
    title: "Pizza Blitz — Hot pizza, pickup and delivery",
    description:
      "Order pizza, sides, burgers, desserts and drinks for pickup or delivery, with live order tracking.",
    type: "website",
    siteName: "Pizza Blitz",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#17130f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
