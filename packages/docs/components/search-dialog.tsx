'use client';

import { useI18n } from 'fumadocs-ui/contexts/i18n';
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogFooter,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
} from 'fumadocs-ui/components/dialog/search';
import type { SharedProps } from 'fumadocs-ui/contexts/search';
import { useDocsSearch } from 'fumadocs-core/search/client';
import { create } from '@orama/orama';
import { createTokenizer as createMandarinTokenizer } from '@orama/tokenizers/mandarin';
import {
  ORAMA_TOKENIZER,
  DEFAULT_LANGUAGE,
  DOCS_BASE_PATH,
} from '@/lib/locales.mjs';

const STATIC_API = `${DOCS_BASE_PATH}/static.json`;

function initOrama(loc?: string) {
  const tokenizer = ORAMA_TOKENIZER[loc ?? DEFAULT_LANGUAGE] ?? 'english';
  switch (tokenizer) {
    case 'mandarin':
      return create({
        schema: { _: 'string' },
        components: { tokenizer: createMandarinTokenizer() },
      });
    default:
      return create({ schema: { _: 'string' }, language: tokenizer });
  }
}

export default function StaticSearchDialog(props: SharedProps) {
  const { locale } = useI18n();
  const { search, setSearch, query } = useDocsSearch({
    type: 'static',
    from: STATIC_API,
    locale,
    initOrama,
  });

  return (
    <SearchDialog
      search={search}
      onSearchChange={setSearch}
      isLoading={query.isLoading}
      {...props}
    >
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList items={query.data !== 'empty' ? query.data : null} />
      </SearchDialogContent>
      <SearchDialogFooter />
    </SearchDialog>
  );
}
