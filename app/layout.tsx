import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "yt-comment-bot",
  description: "YouTube 댓글 답글 자동화 — 수집 · 초안 생성 · 검토 · 게시.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Pretendard:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full">
        <main className="min-h-full">{children}</main>
      </body>
    </html>
  );
}
