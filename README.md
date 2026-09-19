# miaodesign · AI 游戏素材平台（自用版）

聚合多模型（Seedream / GPT-image 等）的游戏素材生图工作台：风格与素材类型「配方化」管理、描述一键优化、生图/润色引擎分离。零 npm 依赖，单文件 Node.js 服务，数据全部存本地。

## 功能

- **多模型聚合生图**：OpenAI 兼容接口直连（火山方舟 / CherryIN 等聚合网关），生图下拉只显示「已测试通过」的模型
- **配方三层正交**：风格词（怎么画）/ 素材类型词（输出规格）/ 主体描述（用户输入）互不污染，可视化配方管理面板随时调优
- **一键优化**：LLM 结构化解析描述（主体/外观/动作/场景/情绪）→ 自动匹配风格与类型 → 产出优化提示词
- **风格工坊**：上传图片 → 视觉 LLM 拆解美术风格 → 沉淀为可复用风格卡（带参考图）
- **API 管理**：快速接入（选平台 → 贴 Key → 探测模型列表勾选接入）、Key 遮蔽显示、连通测试、文字/图片模型分类
- **生成历史**：本地持久化，结果图点击放大查看完整提示词与参数

## 快速开始

```bash
# 1. 复制配置模板（首次运行前，填入你的 API Key）
cp config.example.json config.json

# 2. 启动（零依赖，无需 npm install）
node server.js

# 3. 打开
# http://127.0.0.1:8787
```

> 配置数据只存本地 `config.json`（已被 .gitignore 排除），不会上传。

## 技术栈

- 后端：Node.js 原生 `http` 模块，零 npm 依赖，单文件 `server.js`
- 前端：原生 HTML/CSS/JS（`public/`），localStorage 持久化生成历史
- 模型：任意 OpenAI 兼容生图接口（火山 Seedream、CherryIN/网关 GPT-image 等）+ OpenAI 兼容对话 LLM（提示词优化 / 风格分析）

## 版本

见 [CHANGELOG.md](CHANGELOG.md)。
