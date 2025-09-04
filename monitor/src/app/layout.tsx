import "./globals.css"; // ✅ 글로벌 스타일 적용

export const metadata = {
  title: "Sentry Release Monitoring",
  description: "Release monitoring control UI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}