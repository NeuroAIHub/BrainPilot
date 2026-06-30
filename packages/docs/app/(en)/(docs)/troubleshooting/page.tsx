import { i18n } from '@/lib/i18n';
import { StaticDocsPage, staticPageMetadata } from '@/lib/static-page';

const slug = 'troubleshooting';
const lang = i18n.defaultLanguage;

export default function Page() {
  return <StaticDocsPage slug={slug} lang={lang} />;
}

export function generateMetadata() {
  return staticPageMetadata(slug, lang);
}
