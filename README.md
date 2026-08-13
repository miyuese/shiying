# 拾影 ShiYing · Chrome 扩展（MV3）

> 网页图片 AI 工具：反推提示词 × 换脸 × 双参考重绘 × 拍一套 × 本地素材库
> 原生 TS + Vite，零运行时第三方依赖

## 开发

```bash
npm install
npm run dev          # 监听构建
npm run build        # 类型检查 + 生产构建
npm test             # 单元测试
```

构建产物在 `dist/`，可直接在 Chrome 加载 `dist/` 为"已解压的扩展程序"。

## 目录

```
src/
├── shared/          # 所有端共享（types/constants/utils/prompts + 设计系统 CSS）
├── background/      # Service Worker（设置/存储/任务/API）
├── content/         # 网页悬浮层（shadow DOM 双圆形按钮）
├── panel/           # 侧边栏工作台（5 个 Tab）
├── popup/           # 弹窗（快捷操作）
└── options/         # 设置页（API 配置 + 测试连接）

icons/               # 品牌图标 16/32/48/128
scripts/gen_icons.py # 图标生成脚本（纯标准库，无需 Pillow）
tests/               # Vitest 单元测试
```

## 设计语言

- **深色暖调 + 蓝色主调**：深蓝 `#2E5EA8` / 主蓝 `#4D8DFF` / 浅蓝填充 `rgba(77,141,255,.12)`
- **全圆角体系**：卡片 16 / 按钮 12 / 标签全圆 / 头像正圆
- **零阴影 / 零渐变**：paint 阶段最快
- **状态色**：成功 `#34D399` / 警告 `#FBBF24` / 危险 `#FB7185`

详见 `src/shared/styles.css`。

## 提示词体系

- 反推方案：10 个内置方案（`src/shared/prompts.ts`），用户可在设置选择
- 人物卡 / 换脸 / 拍一套：参考自研究的设计要点已重新组织为自研模板