# 本地补丁清单

**当前状态：无本地补丁。**

本插件（orchestrator2-region-switch）不改 `dsh-orchestrator2` 预设的任何文件，只通过它公开的落点协作：

| 文件 | 谁写 | 形状 |
| --- | --- | --- |
| `<DSH_HOME>/orchestrator2/model-routes.json` | 预设的 `set_role_model` / 本插件保存场景时派生 | v1：`{ schemaVersion: 1, roles: { researcher\|reviewer\|developer: { default, fallback } } }` |
| `<DSH_HOME>/orchestrator2/scenarios.json` | 只由本插件写 | `{ schemaVersion: 1, activeScenario, scenarios: [...] }` |
| `<DSH_HOME>/orchestrator2/guard.json` | 只由本插件写 | 铁律开关 + 最近一次本插件写入的内容 + 回滚记录 |
| `<DSH_HOME>/orchestrator2/sessions/<主会话ID>.json` | 预设写；本插件只在「应用 / 覆盖」时改 `roles[role].overrideRoute` 一个字段 | 预设的形状（`roles[*].{epoch, overrideRoute?, degraded}`、`children[*].{appliedRoute, …}`） |
| `<DSH_HOME>/orchestrator2/failover-signal.json` | 预设的 `route-fallback` 在限流时写 | `{ schemaVersion, at, reason, code, role }` |

两文件分工的理由见 CHANGELOG 2.3.24：预设保存角色模型时会整份重写 `model-routes.json` 为 v1 形状，所以场景表不能再住在那个文件里。

## 预设升级后怎么自查（不用改预设源码）

```powershell
node tools/check-contract.mjs
```

它 import 预设自己的模块（纯函数、无副作用），把上面这些隐含契约变成 5 条可执行断言：路径是否逐字相同、路由表形状、会话表形状、失效信号形状、预设是否仍会写路由表。全 PASS = 无需适配；任一 FAIL 会指出要改本插件的哪个文件。可用 `OR2_PRESET_DIR=<预设包根>` 指向别的安装目录。

**升级顺序提醒**：若预设大版本改了 `model-routes.json` 的形状，先在弹窗里把「模型变更管控（铁律）」关掉 → 让预设自己写一次 → 跑上面的自查并按结果适配 → 再把铁律打开（重新打开时以当前文件内容为基线，不会回滚你刚确认的内容）。

若预设以后改了形状或路径而铁律没关，本插件会在 `/api/orchestrator2-region-switch/state` 的 `drift` / `driftRoles` / `driftSessions` 上体现出来（弹窗顶部提示条 + 逐会话「应用 / 放弃」），不需要临时改预设源码。
