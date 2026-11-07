import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { loadResults } from '../src/lib/load.ts';
import './globals.css';

export const metadata: Metadata = {
  title: 'CV Trojan Tracker',
  description:
    'Does hidden text in a CV change how AI screeners score candidates? Measured per model, repeatedly.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const { meta } = loadResults();
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {meta.sample ? (
          <div
            role="note"
            className="px-4 py-2 text-center text-sm"
            style={{ background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}
          >
            <strong>Sample data, not a measurement.</strong>{' '}
            {meta.note ??
              'Model results on this page are synthetic, with planted effects, to show the layout.'}
            {meta.survival_is_measured ? ' The survival table is measured.' : ''}
          </div>
        ) : null}
        <header className="mx-auto flex max-w-4xl items-baseline justify-between gap-4 px-4 pt-8 pb-4">
          <a href="/" className="text-lg font-semibold">
            CV Trojan Tracker
          </a>
          <nav className="flex gap-4 text-sm text-[var(--ink-2)]">
            <a href="/">Results</a>
            <a href="/methodology/">Methodology</a>
            <a href="/data/">Data</a>
          </nav>
        </header>
        <main className="mx-auto max-w-4xl px-4 pb-16">{children}</main>
      </body>
    </html>
  );
}
