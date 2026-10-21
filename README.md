# orchestrator2-region-switch

给 DSH（the assistant framework）的「自动开发调度器2.0」（`dsh-orchestrator2`）用的**场景化模型切换**插件：侧边栏一行按钮 + 一个设置弹窗，把三个子代理角色（研究员 / 审核员 / 开发员）的**主 / 备模型**做成若干「场景」，点一下就在场景的两侧之间互换。

- 不碰预设源码，只写它公开的数据落点（见 [LOCAL-PATCHES.md](LOCAL-PATCHES.md)）。
- 场景数量不限；每个场景一套自己的 A/B 两侧模型。
- 模型列表从 DSH 当前可用的提供商 / 模型目录里点选，不用手打。

## 功能

**侧边栏（一行）**
- `[侧 A 名 | 侧 B 名]`：点一侧就把当前使用中的场景切到那一侧（主槽指向它）。
- `设置`：打开设置弹窗（点这一行的任意空白处也能打开）。

**设置弹窗**
- **场景 TAB 条**：每个场景一个 TAB，文字 = 该场景两侧名字拼成 `A/B`。选中的 TAB 有底栏；「使用中」的场景带红环。
- **使用 / 应用 / 删除**：TAB 条右端一整套动作按钮，作用于当前选中的场景。
- **两侧名字**：A/B 两格可改名（侧边栏那两个按钮就用它们）。
- **三个角色 × 两侧**：研究员 / 审核员 / 开发员，各选主侧与备侧的提供商 + 模型（一个下拉同时选组和模型）。
- **失效自动切换顺序**：限流/额度失败时按顺序切到下一个场景；两列槽位（1 3 / 2 4 排布）、至少 4 格、不够留空、`✕` 清空该格、选重复自动互换；整轮冷却、每小时上限、模拟限流、重置历史。
- **模型变更管控（铁律）**：开着时，`model-routes.json` 被本插件以外的写入（例如预设的 `set_role_model`）会被检测出来并回滚，同时记一条回滚记录；需要让别的工具改文件时把开关关掉。
- **漂移提示**：文件里的模型与当前使用中场景不一致时，顶部出提示条，并按「哪个工作区、哪个会话」逐条列出，可**应用到该会话**或**放弃**。

## 安装

插件是「宿主半体 + 浏览器半体」两段式，两个半体都要就位：

1. 把本目录放到 DSH 的插件源目录，例如 `<DSH_HOME>/plugin-src/orchestrator2-region-switch`。
2. 让 profile 认识它——本插件自带 `cordis.patch.yml`（`dsh.bundle.patch` 层），需要在 profile 的清单里登记为 bundle 依赖，并把包链到 `profiles/<profile>/node_modules/orchestrator2-region-switch`（junction / symlink 均可）。
3. 重启 DSH。侧边栏出现那一行即加载成功；设置 → 插件 里应能看到 `orchestrator2-region-switch`。

> 只登记在用户 patch 层而不进 profile 清单时，宿主半体会加载、浏览器半体不会激活（插件不出现在侧边栏）。这一点写在 `cordis.patch.yml` 的注释里。

## 数据文件

全部在 `<DSH_HOME>/orchestrator2/` 下，`DSH_HOME` 缺省是 `~/.dsh`：

| 文件 | 说明 |
| --- | --- |
| `scenarios.json` | 场景表（本插件独占） |
| `model-routes.json` | 预设读的 v1 路由表，由当前使用中场景的主槽派生 |
| `guard.json` | 铁律开关、基线、回滚记录 |
| `sessions/<会话ID>.json` | 预设写；本插件只在「应用 / 覆盖」时改 `roles[角色].overrideRoute` 一个字段 |
| `failover-signal.json` | 预设的 `route-fallback` 在限流时写，本插件读它触发顺序切换 |

## 自测

```bash
node tools/selftest-host.mjs      # 宿主半体（79 项）
node tools/selftest-failover.mjs  # 失效自动切换状态机（144 项）
node tools/simulate-client.cjs    # 浏览器半体桩测（假 React + 假 fetch）
node tools/check-contract.mjs     # 与 dsh-orchestrator2 的 5 条契约自查
```

`check-contract.mjs` 会 import 已安装预设自己的模块（纯函数、无副作用）来核对隐含契约；可用 `OR2_PRESET_DIR=<预设包根>` 指定别的安装目录。

## 兼容性

- 与 `dsh-orchestrator2` **v2.10.3** 的契约自查 5/5 通过（路径、路由表形状、会话表形状、失效信号形状、预设是否仍写路由表）。
- 只改客户端半体的版本改动，热更新后重开一次弹窗即生效；改了 `host/` 需要重启 DSH。

## 许可

MIT，见 [LICENSE](LICENSE)。
