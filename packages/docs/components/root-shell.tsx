import type { ReactNode } from 'react';
import { rtlLocales } from '@/lib/i18n';
import { DocsRootProvider } from '@/components/docs-root-provider';

export function RootShell({
  lang,
  children,
}: {
  lang: string;
  children: ReactNode;
}) {
  const dir = rtlLocales.has(lang) ? 'rtl' : 'ltr';

  return (
    <html lang={lang} dir={dir} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col" suppressHydrationWarning>
        <DocsRootProvider lang={lang} dir={dir}>
          {children}
        </DocsRootProvider>
      </body>
    </html>
  );
}
