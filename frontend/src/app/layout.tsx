import type { Metadata } from "next";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://teleport.example";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Teleport — Instant P2P File Transfer & Video Calls",
  description:
    "Zero-cloud, peer-to-peer file transfer, screen sharing, and video calls. Drop files to teleport them instantly. No sign-up, no limits, end-to-end encrypted.",
  keywords: [
    "p2p file transfer",
    "peer to peer",
    "webrtc video call",
    "screen share",
    "video chat",
    "file sharing",
    "clipboard sync",
    "open source",
    "self-hosted",
  ],
  openGraph: {
    title: "Teleport — Instant P2P File Transfer & Video Calls",
    description:
      "Zero-cloud, peer-to-peer file transfer, screen sharing, and video calls. No sign-up required.",
    url: "/",
    siteName: "Teleport",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Teleport" }],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Teleport — Instant P2P File Transfer & Calls",
    description:
      "Zero-cloud, peer-to-peer file transfer, screen sharing, and video calls.",
    images: ["/og.png"],
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="teleport-root min-h-screen bg-[#0a0a0f] text-white overflow-hidden antialiased">
        {children}
      </body>
    </html>
  );
}
