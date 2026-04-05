import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'The Real Earth',
  description: 'High-resolution cloud-free satellite imagery — Web, iOS, Android',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
