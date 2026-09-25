import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LiveCast Translate - Subtítulos en vivo',
  description: 'Transcripción y traducción simultánea en tiempo real para conferencias',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
