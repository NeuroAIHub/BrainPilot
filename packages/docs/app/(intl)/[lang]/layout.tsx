import '../../global.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { RootShell } from '@/components/root-shell';

export const metadata: Metadata = {
  title: {
    default: 'BrainPilot Docs',
    template: '%s | BrainPilot Docs',
  },
  icons: {
    icon: '/docs/favicon.svg',
  },
};

export default async function Layout({
  children,
  params,
}: LayoutProps<'/[lang]'>) {
  const { lang } = await params;
  return <RootShell lang={lang}>{children}</RootShell>;
}
