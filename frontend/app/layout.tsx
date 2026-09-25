import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lingo Live - Subtítulos en vivo',
  description: 'Transcripción y traducción simultánea en tiempo real para conferencias',
  icons: [{ url: '/logo.jpeg' }],
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
