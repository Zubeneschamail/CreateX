# CreatorX

CreatorX 是一个轻量级 Web 建模应用，用点、线、面、体组织几何结构，并提供 AI 辅助生成模型的能力。项目适合做建模交互原型、几何拓扑实验和小型三维草图工具。

## 功能

- 点、线、面、体的基础建模与选择
- 默认鼠标为选择工具，支持新增点工具
- 点、线、面、体默认白色，可用油漆桶给选中元素着色
- RGB 取色器与色板
- 构建平面切换与平面偏移
- 选中元素后可在当前坐标系中平移
- 点和线拥有更小的显示尺寸，同时保留较大的命中热区
- 支持圆、椭圆和 512 面球体生成
- AI 生成模型，支持 OpenAI 和 OpenRouter
- AI 拓扑输出采用 `points -> edges -> faces -> solids` 结构
- AI 面数上限可在设置面板中调整
- Mac 友好的快捷键提示与操作

## 技术栈

- React
- TypeScript
- Vite
- Three.js
- OpenAI SDK

## 本地运行

安装依赖：

```bash
npm install
```

启动开发服务器：

```bash
npm run dev
```

默认地址：

```txt
http://127.0.0.1:5173/
```

构建生产版本：

```bash
npm run build
```

预览构建结果：

```bash
npm run preview
```

## 线上部署

推荐部署到 Vercel，项目已经包含线上可用的 `/api/ai-model` Function 和 `vercel.json` 部署配置：

1. 将仓库导入 Vercel。
2. 确认 Framework Preset 为 `Vite`。
3. 确认 Build Command 为 `npm run build`。
4. 确认 Output Directory 为 `dist`。
5. 部署完成后，用户在应用右侧设置面板中填写自己的 OpenAI 或 OpenRouter API Key。

不要在 Vercel 环境变量中配置 `OPENAI_API_KEY` 或 `OPENROUTER_API_KEY`。AI Key 由用户在浏览器里填写，只随生成请求发送到 `/api/ai-model`。

可选环境变量：

```bash
SITE_URL=https://your-domain.com/
```

`SITE_URL` 用于 OpenRouter 请求来源标识；部署到 Vercel 时如果不配置，会自动尝试使用 Vercel 提供的域名。

## AI 配置

可以在应用右侧设置面板中配置：

- AI 服务商：OpenAI 或 OpenRouter
- API Key
- AI 面数上限

API Key 和面数上限只保存在当前浏览器，不需要部署环境变量。模型选择在 AI 生成模型窗口中完成。

AI 生成接口路径：

```txt
/api/ai-model
```

本地开发时该接口由 Vite 插件提供；部署到 Vercel 后由 `api/ai-model.ts` Function 提供。

## 快捷键

- `V`：选择工具
- `P`：新增点工具
- `Cmd + Z`：撤销
- `Cmd + 拖拽`：框选点
- `1 / 2 / 3`：切换 XZ / XY / YZ 构建平面
- `[ / ]`：降低 / 抬高构建平面
- `F`：只显示面
- `Delete / Backspace`：删除选中元素
- `Esc`：退出当前绘制或清空选择

## 建模数据结构

核心几何数据由以下元素组成：

- `points`：三维坐标点
- `edges`：由两个点连接的线
- `faces`：由一圈有序边界点形成的面
- `solids`：由多个面组成的体

AI 生成模型时会先生成点和有 id 的线，再让面引用一圈有序线，最后让体引用面，从而减少点线面关系混乱的问题。

## 目录结构

```txt
api/
  ai-model.ts         Vercel AI 生成接口
src/
  App.tsx             主应用状态与工具栏
  Workspace3D.tsx     Three.js 视图与交互
  aiModelApi.ts       AI 生成服务端共享逻辑
  aiModel.ts          AI 模型规范化与合并逻辑
  aiSchema.ts         AI JSON Schema 与上限设置
  aiModels.ts         AI 服务商与模型选项
  SettingsDialog.tsx  设置面板
  AiModelDialog.tsx   AI 生成面板
  model.ts            几何模型类型与基础操作
  shortcuts.ts        Mac/Windows 快捷键适配
  styles.css          应用样式
```

## 说明

当前项目仍处于独立开发和快速迭代阶段，重点是验证浏览器内建模交互、几何拓扑表达和 AI 生成结构化模型的可行性。
