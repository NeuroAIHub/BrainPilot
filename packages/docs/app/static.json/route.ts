import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

export const revalidate = false;

// Fumadocs 16.15 uses ZBSearch's multilingual tokenizer by default. It keeps
// English and Chinese in one export and uses Intl.Segmenter for CJK word
// boundaries, so no legacy per-locale Orama database is required.
const server = createFromSource(source);

export async function GET() {
  return server.staticGET();
}
