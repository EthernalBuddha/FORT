import "./globals.css";
import { Inter, Space_Grotesk } from "next/font/google";

export const metadata = {
  title: "FORT",
  description: "FORT dApp",
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
