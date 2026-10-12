# Open Image Playground · 图像服务商扩展

此目录承载 OpenAI / OpenRouter 的模型启用管理、跨配置模型选择，以及 OpenRouter 模型目录、图像 API 和费用估算。供应商逻辑集中于扩展目录，减少对上游大型 store / InputBar 的侵入。

项目仓库：[liubaicai/open_image_playground](https://github.com/liubaicai/open_image_playground)。基于 [CookSleep/gpt_image_playground](https://github.com/CookSleep/gpt_image_playground) 修改，保留上游 [MIT 许可与版权声明](../../../LICENSE)。

## 模型启用与统一选择

- 设置中的 OpenAI 配置保留逗号分隔的模型 ID 输入，再通过勾选管理启用状态；OpenRouter 配置从公开目录选择模型，刷新目录不会自动启用新模型。
- `ApiProfile.model` 保存配置模型列表，`enabledModels` 记录其中启用的 ID，`selectedModel` 记录当前选择。`enabledModels` 缺省兼容旧版全部启用，空数组明确全部停用；新建 OpenRouter 配置需先启用模型。
- 生成栏只有一个模型下拉，按 OpenAI / OpenRouter 和已有其他供应商分组。重复模型按配置名称区分，同名配置用 ID 消歧；一次设置更新同时切换配置及其模型，保证请求使用对应配置的密钥。
- OpenRouter 模型只有在当前图像能力目录中可用时才进入生成选项；目录尚未加载时可能保留已有选择，但发送前仍会校验。配置中的失效模型不会被静默删除。
- 当前界面仅提供画廊模式，旧 Agent 数据保留为兼容归档，不恢复执行。提示词优化由独立的 [`../promptOptimization`](../promptOptimization) 扩展负责，单独选择 OpenAI / OpenRouter 文本配置与模型；图像模型启用列表不充当文本模型能力证明。

## 与上游的边界

- `src/types.ts`：新增内置供应商 ID `openrouter` 和可选 `ApiProfile.enabledModels`，其余任务记录格式不变。
- `src/lib/apiProfiles.ts`：供应商默认值、标签、设置清洗、启用模型解析与供应商草稿迁移。
- `src/lib/api.ts`：在统一图像入口增加一个适配器分支，OpenAI / fal / 自定义供应商路径保留。
- `src/components/SettingsModal.tsx`：OpenRouter 配置入口，以及 OpenAI / OpenRouter 共用的模型启用组件。
- `src/components/InputBar.tsx`：启用模型列表、跨配置分组选择器及 OpenRouter 参数组件；OpenAI 保留原有参数面板。
- `src/components/input/inputParamsPanel.tsx`：可选 `modelSelector` 插槽；没有传入时保持上游原模型选择器。
- 本目录内的 `catalog.ts` / `openrouter.ts` / `pricing.ts` / `imageTokenBudget.ts` 分别处理目录与费率、图像请求、费用计算和 token 预算；`ModelSettings` / `GroupedModelSelect` / `OpenRouterParams` / `ModelCost` 处理 UI。

## OpenRouter 合约

目录首先读取用户指定的完整前端列表：
`https://openrouter.ai/api/frontend/v1/models/find?order=newest`

仅筛选输出能力包含 `image` 的模型，输入视觉能力不代表能够生成图片。使用 `slug` 作为请求 ID；前端接口变动时采用官方 `/api/v1/models?output_modalities=image` 目录并提示来源。与 `/api/v1/images/models` 的当前可用能力交叉核对，无法通过图像接口调用的模型不会被当成可用选项。

图像请求走 `POST https://openrouter.ai/api/v1/images`。该协议不同于 OpenAI Images API 的 `/images/generations`，不复用原有适配器。公开目录及价格查询不携带 API Key，目录与端点价格在内存中缓存 5 分钟。模型输入/输出能力、参数取值以当前目录为依据；参考图需要对应输入能力，遮罩编辑明确拒绝。

数量限制为 1–10 张；超过模型单次能力时拆分请求。部分成功保留已返回图片及失败明细，不自动补发失败请求，避免状态不明时重复计费。目录筛选和本地校验不代表所有模型都已通过真实调用验证。

## 费用来源与估算边界

费用组件目前只对 OpenRouter 显示，位于尺寸、数量旁；详情弹层提供来源链接、预算假设与未计费用。批量提示词的显示值仅对应一条提示词，多条提交会累加费用。

- 费率优先来自 `/api/v1/images/models/{model}/endpoints` 的明确 `billable` / `unit` / `cost_usd`。没有可用图像单价时，回退到前端目录 `display_pricing` 的明确单位，并提示实际路由价格可能不同。
- 保留分辨率、画质档位和条件价格。展示 multiplier 只控制格式，token 原始价格已是 USD/token；通用目录的 `image_output` 不直接当作每张价格。
- 明确每张价格用于图片小计；按 token 计费时，`imageTokenBudget.ts` 对明确匹配的模型引用相应官方 token 表作为基准，其余采用标明的通用预算假设。提示词、参考图和附带文本的 token 数也属于粗估，不是 API 实际用量。
- 尺寸、受支持画质、参考图与数量参与计算。自动/未知尺寸暂按 1K 并扩大区间，不代表服务商默认值；像素计费说明面积和取整假设。未明确匹配的档位保留范围或条件价，不把最低价冒充固定总价。
- 缺失费率不补造，无法确认时显示“费用待确认”或“按用量计费”；已知小计与未计费用分开说明。区间不是置信区间或费用上限，全部金额为 USD，以 OpenRouter 实际账单为准。OpenAI 及兼容服务的价格不由此组件估算。

## 安全与迁移

- API Key 沿用应用现有用户本地配置机制；目录缓存只保存公开数据，不保存密钥。这不意味着生成时数据不离开本机：请求会将提示词、参考图及认证信息发送到所选服务。
- 新建 OpenRouter 配置为空密钥，保留原有主渠道。直接将同一个配置切换到/离开 OpenRouter 时清空密钥，防止误发其他服务商的凭据。
- OpenRouter 请求目标固定为官方地址，导入配置不能把密钥重定向到任意网站。
- 模型启用状态按配置保存，并随供应商草稿切换。旧数据无新字段时维持原有行为。
- 本目录测试使用模拟目录、价格和请求响应；不据此宣称完成真实密钥、付费生图或全模型兼容验证。

## 验证和上游同步

修改后运行 `npm run build` 与 `npm test`；聚焦验证可运行 `npm test -- src/extensions/imageProviders`。将此扩展目录作为整体保留；合并上游时重点检查上述接入点、`ApiProfile` 归一化及 `CallApiOptions` / `CallApiResult` 契约。提示词优化和画廊归档边界需分别保留，避免上游合并重新打开已关闭的 Agent 执行入口。

官方资料：
- https://openrouter.ai/docs/guides/overview/multimodal/image-generation
- https://openrouter.ai/docs/api/api-reference/images/generate-an-image
- https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties
