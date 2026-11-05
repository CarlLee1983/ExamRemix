import { defineConfig } from 'astro/config';
import { bankBuild } from './src/lib/bank-build.ts';

export default defineConfig({
  output: 'static',
  integrations: [bankBuild()],
});
