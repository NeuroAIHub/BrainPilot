import '../global.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { RootShell } from '@/components/root-shell';
import { i18n } from '@/lib/i18n';

export const metadata: Metadata = {
  title: {
    default: 'BrainPilot Docs',
    template: '%s | BrainPilot Docs',
  },
  icons: {
    icon: '/docs/favicon.svg',
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <RootShell lang={i18n.defaultLanguage}>{children}</RootShell>;
}
