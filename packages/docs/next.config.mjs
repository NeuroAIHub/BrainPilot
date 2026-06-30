import { createMDX } from 'fumadocs-mdx/next';
import { DOCS_BASE_PATH } from './lib/locales.mjs';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  output: 'export',
  basePath: DOCS_BASE_PATH,
  images: {
    unoptimized: true,
  },
};

export default withMDX(config);
