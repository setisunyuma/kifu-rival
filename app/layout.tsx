import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "棋友 KIYU — 棋譜を重ね、技を磨く",
  description: "一局を指し、棋譜を残し、将棋を学ぶ。大人のための静かな将棋ライバル＆教材アプリ。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased">{children}</body>
    </html>
  );
}
