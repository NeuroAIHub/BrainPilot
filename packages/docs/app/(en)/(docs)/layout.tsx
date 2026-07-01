import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import { i18n } from '@/lib/i18n';
import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  const lang = i18n.defaultLanguage;
  return (
    <DocsLayout tree={source.getPageTree(lang)} {...baseOptions(lang)}>
      {children}
    </DocsLayout>
  );
}
