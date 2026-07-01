import { defineI18n } from 'fumadocs-core/i18n';
import { uiTranslations } from 'fumadocs-ui/i18n';
import { DEFAULT_LANGUAGE, LANGUAGES, LOCALE_LABELS, RTL_LOCALES } from './locales.mjs';

export const i18n = defineI18n({
  defaultLanguage: DEFAULT_LANGUAGE,
  languages: LANGUAGES,
  hideLocale: 'default-locale',
});

export const rtlLocales = new Set(RTL_LOCALES);
export const localeLabels = LOCALE_LABELS;

export const translations = i18n
  .translations()
  .extend(uiTranslations())
  .add('ui', {
    en: {
      displayName: LOCALE_LABELS.en,
    },
    'zh-cn': {
      displayName: LOCALE_LABELS['zh-cn'],
      'Choose a language(language switcher)': '选择语言',
      'Choose a language(language switcher)(aria-label)': '选择语言',
      'Close Search(search dialog)(aria-label)': '关闭搜索',
      'Collapse Sidebar(sidebar)(aria-label)': '收起侧边栏',
      'Copied Text(code block)(aria-label)': '已复制',
      'Copy Anchor Link(heading anchor)(aria-label)': '复制锚点链接',
      'Copy Text(code block)(aria-label)': '复制文本',
      'Dark(theme switcher)(aria-label)': '深色',
      'Light(theme switcher)(aria-label)': '浅色',
      'Next Page(pagination)': '下一页',
      'No results found(search dialog)': '没有找到结果',
      'On this page(table of contents)': '本页目录',
      'Open Search(search trigger)(aria-label)': '打开搜索',
      'Open Sidebar(sidebar)(aria-label)': '打开侧边栏',
      'Page Not Found(404 page)': '页面不存在',
      'Previous Page(pagination)': '上一页',
      'Search(search dialog)': '搜索',
      'Search(search trigger)': '搜索',
      'System(theme switcher)(aria-label)': '跟随系统',
      'Table of Contents(inline table of contents)': '目录',
      'Toggle Menu(mobile menu)(aria-label)': '切换菜单',
      'Toggle Theme(theme switcher)(aria-label)': '切换主题',
    },
  });
