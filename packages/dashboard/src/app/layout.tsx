import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kumiki A/B — Dashboard",
  description: "CRUD over the Kumiki A/B control API.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="site">
          <div className="inner">
            <Link href="/" className="brand">
              kumiki <span aria-hidden>·</span> a/b
            </Link>
            <span className="tag">control dashboard</span>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
