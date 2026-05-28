import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ADALO Intelligence OCR",
  description:
    "Herramienta simple para transformar documentos PDF en archivos CSV claros y listos para trabajar.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
