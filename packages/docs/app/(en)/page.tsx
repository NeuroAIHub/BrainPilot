import { IndexRedirect } from '@/components/index-redirect';
import { DOCS_BASE_PATH } from '@/lib/locales.mjs';

export default function HomePage() {
  return <IndexRedirect target={`${DOCS_BASE_PATH}/getting-started`} />;
}
