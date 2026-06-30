'use client';

import { RootProvider } from 'fumadocs-ui/provider/next';
import { i18nProvider } from 'fumadocs-ui/i18n';
import type { ReactNode } from 'react';
import { translations } from '@/lib/i18n';
import StaticSearchDialog from '@/components/search-dialog';

export function DocsRootProvider({
  lang,
  dir,
  children,
}: {
  lang: string;
  dir: 'ltr' | 'rtl';
  children: ReactNode;
}) {
  return (
    <RootProvider
      dir={dir}
      i18n={i18nProvider(translations, lang)}
      search={{ SearchDialog: StaticSearchDialog }}
    >
      {children}
    </RootProvider>
  );
}
