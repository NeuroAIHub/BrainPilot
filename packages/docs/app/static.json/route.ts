import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';
import { createTokenizer as createMandarinTokenizer } from '@orama/tokenizers/mandarin';
import { ORAMA_TOKENIZER, type OramaTokenizer } from '@/lib/locales.mjs';

export const revalidate = false;

function oramaConfig(tokenizer: OramaTokenizer) {
  switch (tokenizer) {
    case 'mandarin':
      return { components: { tokenizer: createMandarinTokenizer() } };
    default:
      return tokenizer;
  }
}

const localeMap = Object.fromEntries(
  Object.entries(ORAMA_TOKENIZER).map(([locale, tokenizer]) => [
    locale,
    oramaConfig(tokenizer),
  ]),
);

const server = createFromSource(source, { localeMap });

export async function GET() {
  return server.staticGET();
}
