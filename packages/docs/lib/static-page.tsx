import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RenderDocsPage } from '@/components/docs-page';
import { source } from '@/lib/source';

export function StaticDocsPage({
  slug,
  lang,
}: {
  slug: string;
  lang: string;
}) {
  return <RenderDocsPage slug={[slug]} lang={lang} />;
}

export function staticPageMetadata(slug: string, lang: string): Metadata {
  const page = source.getPage([slug], lang);
  if (!page) notFound();
  return {
    title: page.data.title,
    description: page.data.description,
  };
}
