import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, gitConfig } from './shared';
import { i18n } from './i18n';

export function baseOptions(lang?: string): BaseLayoutProps {
  const localePrefix =
    lang && lang !== i18n.defaultLanguage ? `/${lang}` : '';

  return {
    nav: {
      title: appName,
      url: `${localePrefix}/`,
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    links: [
      {
        text: 'npm',
        url: 'https://www.npmjs.com/package/@brainpilot/app',
        external: true,
      },
    ],
    i18n: true,
  };
}
