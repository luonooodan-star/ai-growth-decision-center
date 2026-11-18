import path from 'path';
import { defineConfig } from '@lark-apaas/fullstack-vite-preset';
import type { Plugin } from 'vite';

function companyStandalonePlugin(): Plugin {
  return {
    name: 'company-standalone-runtime',
    enforce: 'pre',
    apply: 'build',
    transform(code: string, id: string): string | null {
      if (
        process.env.MIAODA_BUILD_TARGET !== 'standalone' ||
        !/[/\\]client[/\\]src[/\\]index[.](tsx?|jsx?)$/u.test(id)
      ) {
        return null;
      }

      return code
        .replace("import '@lark-apaas/client-toolkit/runtime';\n", '')
        .replace(/\bHashRouter\b/gu, 'BrowserRouter');
    },
  };
}

const companyWeb = process.env.GROWTH_COMPANY_WEB === '1';
const config = defineConfig({
  build: {
    ...(companyWeb && {
      manifest: true,
      rollupOptions: { output: { format: 'es' as const } },
    }),
    // 公司 Mac 的浏览器版本较旧。平台默认 target 会保留 optional
    // chaining / nullish coalescing 等新语法，浏览器会在 React 启动前
    // 解析失败并表现为纯白页。
    target: ['es2015', 'safari12'],
    cssTarget: 'safari12',
  },
  plugins: [companyStandalonePlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
    },
  },
});

// The company server serves modules over HTTP(S). Only offline file exports
// need the preset's classic script tag and single-file bundle.
if (companyWeb) {
  config.plugins = config.plugins?.filter(
    (plugin) =>
      !(plugin && 'name' in plugin && plugin.name === 'miaoda-standalone-html'),
  );
}
export default config;
