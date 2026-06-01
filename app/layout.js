import "./globals.css";
import { Inter, Space_Grotesk } from "next/font/google";

export const metadata = {
  metadataBase: new URL("https://fortsafe.vercel.app"),
  title: {
    default: "FORT — A fortress for your assets",
    template: "%s · FORT",
  },
  description:
    "FORT is a multisig wallet for secure onchain payments on Arc Testnet. Create a safe with 3 owners and 2-of-3 confirmations.",
  applicationName: "FORT",
  keywords: ["FORT", "multisig", "wallet", "Arc", "Arc Testnet", "onchain payments", "safe"],
  openGraph: {
    type: "website",
    url: "https://fortsafe.vercel.app",
    siteName: "FORT",
    title: "FORT — A fortress for your assets",
    description:
      "Multisig wallet for secure onchain payments on Arc Testnet. 3 owners, 2-of-3 confirmations.",
  },
  twitter: {
    card: "summary_large_image",
    title: "FORT — A fortress for your assets",
    description:
      "Multisig wallet for secure onchain payments on Arc Testnet. 3 owners, 2-of-3 confirmations.",
    creator: "@Gioddddd",
  },
};

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const brand = Space_Grotesk({ subsets: ["latin"], variable: "--font-brand", display: "swap" });

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${brand.variable}`}>
      <body>{children}</body>
    </html>
  );
}
