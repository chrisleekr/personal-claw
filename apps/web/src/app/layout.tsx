import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PersonalClaw Dashboard',
  description: 'Manage your PersonalClaw AI agent configurations',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background antialiased">{children}</body>
    </html>
  );
}
