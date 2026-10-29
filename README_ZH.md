<p align="right">
  <a href="./README.md">English</a> · <strong>简体中文</strong>
</p>

# DeepSeek Harness Ultracode

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-ultracode"><img src="https://img.shields.io/npm/v/dsh-ultracode.svg" alt="npm 版本"></a> <a href="./LICENSE"><img src="https://img.shields.io/npm/l/dsh-ultracode.svg" alt="MIT 许可证"></a> <img src="https://img.shields.io/badge/DeepSeek%20Harness-plugin-202724" alt="DeepSeek Harness 插件">
</p>

## 一个开关，拉满深度。

`dsh-ultracode` 给 DeepSeek Harness 加一个 **ultra 档位**：一个按会话生效的开关——把每个模型请求钉在当前模型声明的最深推理档上，同时激活常驻的编排策略：实质性任务默认 workflow 扇出、汇报前对抗验证、上下文卫生。委托子代理以“执行者策略”继承档位（最深推理档、对抗验证），不带 workflow 授权，编排只留在顶层。

对标 Claude Code 的 `ultracode` 档位：这个档位的实质是常驻编排策略，而不是更深的推理参数。适用于任何适配器档位落在共享词表内的 provider——DeepSeek（`max`）、GLM / Kimi 路由（`high` 或 `max`，取模型声明的最高档）、以及完全自定义的 OpenAI 兼容路由。

<p align="center">
  <img src="./assets/readme.gif" width="100%" alt="在输入框切换 ultra 模式：ULTRA 芯片切换档位、档位选择器跟随、输入卡亮起动态彩虹描边">
</p>

<p align="center">
  <em>在输入框边切换：模型选择器旁会出现 <strong>ULTRA</strong> 芯片，档位生效期间输入卡亮起动态彩虹描边。</em>
</p>

## 它改变了什么

| 能力 | 变化 |
| --- | --- |
| **按会话的 effort 档位** | 一个开关把每个模型请求钉在当前模型声明的最深档（`auto`），或钉在配置的字面值上。 |
| **编排策略** | 激活期间一段部署侧拥有的提示词段随系统提示下发：workflow 常驻授权、对抗验证、provider 并发受限时改窄波次重试——仅对顶层会话生效。 |
| **输入框芯片 + 彩虹描边** | 输入栏出现 ULTRA 芯片；档位生效期间输入卡发光（系统开启“减少动态效果”时为静态渐变）。 |
| **选择器一致性** | 宿主经 `agent.model.select()` 记录档位，原生选择器和模型请求使用同一份持久化选择。 |
| **委托感知** | spawn 子代理沿委托链继承生效状态——钉档加执行者策略（`childSection`），绝不含 workflow 授权；fork 子代理经种子前缀继承并在那里冻结。 |

## 安装

> [!NOTE]
> 需要已安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) `0.2.2-alpha.2` 或兼容版本（`@deepseek-ai/dsh-*@^0.2.2-alpha.2`），以及 Node.js `>=24.9.0`。

### npm

```sh
dsh plugin --profile <name> add dsh-ultracode
```

### 从源码构建

```sh
git clone https://github.com/BackMountainBird/dsh-ultracode.git
cd dsh-ultracode
pnpm install
pnpm build
dsh plugin --profile <name> add .
```

改完源码再跑一次 `pnpm build`。本地安装保持链接到该 checkout。

校验组合并重启 DSH：

```sh
dsh --profile <name> --dump-config
dsh --profile <name> web
```

然后打开档位——点输入框芯片，或直接：

> /ultra
>
> 用 ultra 模式把这个仓库的每一个集成点对照锁定的依赖逐一核实，并行验证。

用 `/ultra off`（或再点一次芯片）退出。

## 工作原理

1. **开关就是一条命令。** `/ultra`（和 `/ultra off`）经 harness 命令运行时执行，它在调用处理器*之前*追加 `command/run` 会话事件。这个事件就是持久化开关状态，resume 和重放会恢复它，最后一条命令获胜。一条经过校验、可忽略的 `plugin:dsh-ultracode/effort-pin` 记录保存插件拥有的显式模型选择，重载和恢复时可释放继承的钉档，同时保留用户后续手动修改的选择。
2. **策略随系统提示下发，按委托深度分流。** 激活期间，`ultra:policy` 段渲染进每个请求。顶层会话（`delegationDepth` 为零）渲染 `section`：编排策略（workflow 常驻授权、对抗验证、上下文卫生、provider 并发打满导致并行子代理超时时改窄波次）。委托子代理（`delegationDepth` 大于零）渲染 `childSection`：执行者策略，保留 workflow 工具的默认 opt-in 规则——授权若随继承递归，每个子代理都会再扇出自己的 workflow，而 workflow 路径上没有委托深度预算拦它。
3. **档位在请求准入前确定。** 命令处理器和 `agent/created` 监听器经 `agent.model.select()` 记录当前模型声明的最深档。`auto`（默认）按共享的 `off…max` 词表排序；字面值精确钉定，适配器不声明则报错。`agent/pre-step` 检查会纠正手动档位修改和继承状态变化。如果步骤已捕获其他档位，插件保留已领取的消息，取消这次准备，再用修正后的模型选择和一条通知唤醒新一轮。日志可能因此多出一次准备阶段的取消记录，但不会按过期档位发出模型请求。DSH `0.2.2` 已禁止在废弃的 `agent/request` 瀑布中修改档位。
4. **委托会继承。** spawn 子代理沿委托链上溯（每个子会话的 `parentSession`，经活会话存储解析）获得钉档和执行者策略——档位按*子代理自己的*模型解析。fork 子代理（`header.isSeeded`，包括空种子）只经种子完成前缀继承；父会话之后的切换不会影响已经派生的分支。
5. **模型会被告知。** 每次真实切换注入一条来源标记为 `dsh-ultracode` 的 notice 用户消息，模型无需 diff 提示词段就能感知变化。
6. **选择器跟随。** 宿主记录的模型选择驱动原生档位选择器。芯片只执行命令，不再发起第二次模型选择请求，避免覆盖固定 `effort` 配置。关闭时清除显式档位，恢复适配器默认值。
7. **Web 半边是一个 client bundle。** ULTRA 芯片占用输入栏的 `conversation.input.right` 座位；状态走宿主计算的 `ultra` projection（客户端零 ultra 状态）；激活期间芯片标记输入卡，注入的样式表渲染彩虹描边。bundle 以闭包工厂（`window.__ModuleLoader__.load`）发布，平台依赖经 loader 模块表解析。

## 配置

Profile 的 `dsh-ultracode` 行：

```yaml
- id: dsh-ultracode
  config:
    effort: auto
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `section` | 内置策略文案 | 激活期间为顶层会话（`delegationDepth` 为零）渲染的 `ultra:policy` 提示词段 |
| `childSection` | 内置执行者策略 | 委托子代理（`delegationDepth` 大于零）渲染它替代 `section`；默认值保留 workflow 工具的 opt-in 规则，授权不再递归 |
| `effort` | `auto` | `auto` 把每个请求钉在当前模型声明的最深档；字面值必须是服务适配器声明的档位之一（否则大声失败） |
| `promptSectionOrder` | `120` | 提示词段顺序 |

## 边界

- 开关使用 harness 自有的 `command/run` 事件；钉档归属使用可忽略的插件记录，不扩展正式会话事件词表。工具目录跨模式不变（请求缓存稳定）。
- 继承只增不减：子代理会话没有用户命令面，子级无法退出。
- 编排授权不递归：子代理渲染 `childSection`（执行者策略），保留 workflow 工具的默认 opt-in 规则——默认只有顶层会话做编排。
- ultra 期间手动改选的档位会在下次请求准入前重新对齐；宿主记录的模型选择同时驱动请求和原生选择器。切换前已经准备完成的请求保留当时捕获的模型选择。
- 扇出容量属于 provider：默认策略要求模型把超时的并行工作改窄波次重试，而不是放弃。
- ultra 不触碰 plan 模式：两者是独立的日志化状态，可自由叠加（`/plan` + `/ultra` = plan 只读约束下的最高档规划）。

## 开发

```sh
pnpm install
pnpm run typecheck
pnpm run build
pnpm run verify
```

Host 半边在 `src/`（命令、持久化档位选择、步骤准入检查、提示词段、会话投影、委托链上溯）；浏览器半边在 `src/client/`（输入栏芯片、彩虹样式、命令传输）。DSH peer 下限为 `^0.2.2-alpha.2`，devDependencies 钉定 `0.2.2-alpha.2`，Cordis 和 Schemastery 分别为 `4.0.6-alpha.1`、`3.18.6-alpha.1`。验证在离线环境检查构建后的宿主和客户端产物，并使用 mock 适配器运行已发布的 DSH agent loop。

## 许可证

[MIT](./LICENSE)
