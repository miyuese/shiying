import { defineConfig, Plugin } from 'vite';
import { resolve } from 'path';
import { writeFileSync, mkdirSync, existsSync, copyFileSync } from 'fs';
import { execSync } from 'child_process';

/**
 * 生成 manifest.json 的 Vite 插件。
 * 构建完成后将各页面入口与产物映射写入 dist/manifest.json。
 */
function manifestPlugin(): Plugin {
  return {
    name: 'shiyin-manifest',
    apply: 'build',
    closeBundle() {
      const outDir = 'dist';
      const manifest = {
        manifest_version: 3,
        name: '拾影 ShiYing',
        version: '0.1.0',
        description: '网页图片 AI 工具：反推提示词 × 换脸 × 双参考重绘 × 拍一套 × 本地素材库',
        action: {
          default_popup: 'src/popup/index.html',
          default_title: '拾影 ShiYing',
        },
        side_panel: {
          default_path: 'src/panel/index.html',
        },
        options_page: 'src/options/index.html',
        background: {
          service_worker: 'src/background/index.js',
          type: 'module',
        },
        content_scripts: [
          {
            matches: ['<all_urls>'],
            js: ['src/content/index.js'],
            run_at: 'document_idle',
          },
        ],
        // tabs 权限已移除：只用到 chrome.tabs.query，url 可见性由 host_permissions 提供
        permissions: ['storage', 'activeTab', 'sidePanel', 'downloads', 'scripting', 'alarms', 'unlimitedStorage'],
        host_permissions: ['<all_urls>'],
        icons: {
          '16': 'icons/icon16.png',
          '32': 'icons/icon32.png',
          '48': 'icons/icon48.png',
          '128': 'icons/icon128.png',
        },
      };

      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

      // 复制图标（若存在），生成 SVG 占位
      ensureIcons(outDir);
    },
  };
}

/** 图标占位：生成品牌蓝色圆角方块 PNG（用 node zlib 手写最小 PNG 太复杂，这里写 SVG 占位并在清单回退） */
function ensureIcons(outDir: string) {
  const iconDir = resolve(outDir, 'icons');
  if (!existsSync(iconDir)) mkdirSync(iconDir, { recursive: true });
  // 生成 SVG 图标占位（Chrome 商店需 PNG，开发期用 SVG 占位即可加载）
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#2E5EA8"/><text x="64" y="82" font-size="52" font-family="PingFang SC, Microsoft YaHei, sans-serif" fill="#fff" text-anchor="middle" font-weight="600">影</text></svg>`;
  writeFileSync(resolve(iconDir, 'icon.svg'), svg, 'utf-8');

  // 尝试从真实 PNG（如 icons/ 源码目录）拷贝，否则复制 SVG 到 16/32/48/128 占位名
  const srcIcons = resolve('icons');
  for (const size of [16, 32, 48, 128]) {
    const png = resolve(srcIcons, `icon${size}.png`);
    if (existsSync(png)) {
      copyFileSync(png, resolve(iconDir, `icon${size}.png`));
    } else {
      copyFileSync(resolve(iconDir, 'icon.svg'), resolve(iconDir, `icon${size}.svg`));
    }
  }
}

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: false,
    minify: false,
    // 禁用 modulepreload 链接生成：Chrome 扩展页面不接受 crossorigin 属性，
    // 会报 cross-world extension resource mismatch 警告，掩盖真正的错误
    modulePreload: false,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/index.ts'),
        panel: resolve(__dirname, 'src/panel/index.html'),
        popup: resolve(__dirname, 'src/popup/index.html'),
        options: resolve(__dirname, 'src/options/index.html'),
      },
      output: {
        entryFileNames: (chunk) => `src/${chunk.name}/index.js`,
        chunkFileNames: 'src/shared/[name].js',
        assetFileNames: (asset) => {
          if (asset.name?.endsWith('.css')) return `src/${asset.name!.split('.')[0]}/index.css`;
          return 'assets/[name][extname]';
        },
      },
    },
  },
  plugins: [manifestPlugin()],
});
