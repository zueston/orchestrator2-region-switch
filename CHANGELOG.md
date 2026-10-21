# 变更记录

## 2.4.5

### 切换顺序表改成「两列槽位」（用户指定 1 3 / 2 4 布局）

1. 顺序表从「单列 + ↑ ↓ ✕」改成 **两列网格**：第 1 格、第 2 格在第一行，第 3 格、第 4 格在第二行（`STYLE.orderGrid` = `gridTemplateColumns: repeat(2, minmax(0,1fr))`）。顺序按格号读：第 1 格最早、第 4 格最晚。
2. **槽位固定至少 4 格**（`SLOT_MIN = 4`）：场景不够就留空；每个下拉第一项是「（空）」，所以清空之后还能再选回来。`↑`/`↓` 两个按钮退场，每格只留一个 `✕`（清空这一格）。
3. 一格选中的场景若已在别的格 → 两格**互换**（不会出现重复项）。
4. 提交仍是整份 `order`（去掉空格后的场景 id 序列），宿主校验「至少 2 个」的规矩不变；少于 2 个时给提示、不发请求。
5. **两处「启用 □」靠右对齐**：`失效自动切换顺序` 与 `模型变更管控` 的勾选框共用 `STYLE.enableBox`（`marginLeft: 'auto'`）。
6. **自测**：新增形态断言 `顺序表两列` / `去掉了上下移` / `启用都靠右`；新增桩断言 `[顺序槽位] 格数=4 清空按钮=4 有↑↓=false`、`[顺序槽位·清空] 空选项=true 已清掉=true`。**只改客户端半体，热更新后重开一次弹窗即生效。**

## 2.4.4

### 弹窗顶部那段说明压到两行（101 字，原来 168 字）

- 删掉可以靠界面自明的部分（「场景数量不设上限」「每个场景一套独立 A/B」「直接写 model-routes.json」），保留四件必须知道的：**两个按钮是名字、点一下互换主/备**；**应用立即生效 / 保存存整张表**；**主会话模型归聊天窗选**；**撞限流按「失效自动切换顺序」往下切、改动下一次派工生效**。
- 中英双语同步；新增形态断言 `说明压到两行`（`description` 字符串 ≤ 110 字），以后谁再往里堆字会被自测拦住。
**只改客户端半体，热更新后重开一次弹窗即生效。**

## 2.4.3

### 标题与行结构再收一遍（用户逐条指定）

1. 「失效自动切换」→ **「失效自动切换顺序」**（`failoverSection`），中英双语同步；顶部说明里的「按『切换顺序』」也改成「按这个顺序」。
2. 「模型变更管控」标题行的 `（铁律生效中）` / `（已关闭）` → 统一显示 **`启用`**，开关状态只由右端方框表达（`guardOn`/`guardOff` 两个键删除，新增 `guardEnable`）。
3. 「整轮冷却（分钟）」「每小时上限」：`numberBox` 从纵向（标签在输入框上方）改成横向（标签在输入框左侧），两个数字因此落在同一行；同行的两个动作按钮对齐方式跟着从 `flex-end` 改 `center`。
4. 去掉两行标签：「切换顺序」（标题已含「顺序」）、「回滚状态」（回滚记录直接跟在标题行下面）。`failoverOrder` / `guardRollback` 两个键、`STYLE.blockLabel` / `STYLE.guardRollbackTitle` 一并删除，`unused-keys` 仍归零。
5. **自测**：新增 4 条形态断言 `顺序标签行已去掉` / `回滚小标题已去掉` / `两个数字同行` / `失效标题含顺序`；`[铁律] 状态=启用`、`[铁律·关] 勾选=false 文案=true`、`[铁律·问号] 无回滚小标题=true`。
**只改客户端半体，热更新后重开一次弹窗即生效，不用重启 DSH。**

## 2.4.2

### 「模型变更管控」一节重排：长说明进 ？ 浮层、状态进括号、勾选框上方框、回滚记录加小标题

**为什么**：原来这一节是「标题 + 状态胶囊 + 一整段长说明 + 一行复选框文案 + 回滚记录」，长说明和复选框文案说的是同一件事，字挤在一起、主次不分。

1. **标题行**：`模型变更管控` + `？`（点开或悬停出浮层）+ `（铁律生效中）` / `（已关闭）` + 右端一个复选框方框（无可见文字，`aria-label` 保留完整说明，鼠标悬停不出原生气泡 —— 全插件统一只用浮层）。
2. **长说明收进 ？**：浮层文案含「勾上这个方框＝只有本插件能改模型表…」以及逃生门（取消勾选＝让会话自己改），正文不再出现这段。
3. **回滚记录**：新增「回滚状态」小标题，下面才是「还没有回滚记录。」或最近 3 条记录。
4. 词典新增 `guardHelp` / `guardRollback`，删掉已无处使用的 `guardHint`（中英双语），`unused-keys` 自测仍归零。
5. **自测**：客户端桩测新增 `[铁律·问号] 浮层=有 含回滚状态=true 含勾选说明=true 正文无长说明=true 回滚状态小标题=true`；`[悬浮说明] 原生title=无`。
**只改客户端半体，热更新后重开一次弹窗即生效，不用重启 DSH。**

## 2.4.1

### 新增 `tools/check-contract.mjs`：预设升级后的契约自查（一条命令）

**为什么**：本插件是纯注入式，不改预设任何文件，但和预设共用 `<DSH_HOME>/orchestrator2/` 下的几个数据文件。预设升级后若改了路径或形状，本插件会「静默失效」（漂移条一直亮 / 失效切换不触发 / 覆盖列表读不到）。把这些隐含契约变成可执行断言。

1. **做法**：动态 import 预设自己的模块（`model-routes.mjs` / `session-routes.mjs` / `route-fallback.mjs`，都是纯函数 + node 内置依赖，import 无副作用、不会调 `apply()`），拿它的导出与本插件 `host/paths.js` 对比 —— 比 grep 源码稳。
2. **5 条断言**：① 路径逐字一致（`model-routes.json` / `sessions/` / `failover-signal.json`）；② 路由表形状（`SCHEMA_VERSION=1` + 三角色 + `default/fallback`，并实读真实文件让预设自己解析）；③ 会话表形状（`emptySessionState` 含 `roles/children`，并逐个实读 `sessions/*.json` 走预设的 `loadSessionState` 校验）；④ 失效信号形状（`DEGRADABLE_CODES` + 信号文件键）；⑤ 预设是否仍会写 `model-routes.json`（否则铁律没有存在意义）。
3. **只读**：全程不写任何文件（用 `peekRoleRoutes` / `loadSessionState`，不用 `saveRoleState` / `updateSessionState`）。
4. **失败可定位**：任一 FAIL 会打印「→ 要适配：<本插件的哪个文件>」，退出码 1；全 PASS 打印「5/5 契约成立，无需适配」，退出码 0。可用 `OR2_PRESET_DIR` 指向别的安装目录。
5. **反向验证**（证明它不是橡皮图章）：把预设复制到 `.tmp/fake-preset` 并把 `routesPath()` 改成 `routes-v2.json`，脚本正确报 `[1] 路径一致 FAIL` 并指出改 `host/paths.js`，退出码 1。
6. **实测**（对已装的 v2.10.3）：5/5 PASS —— 3/3 路径逐字相同、实读 3 个角色、3/3 个会话文件通过预设 `loadSessionState`、`DEGRADABLE_CODES=RATE_LIMIT,ACCOUNT_QUOTA`、`role-tools.mjs` 仍调 `saveRoleRoute`。
7. `LOCAL-PATCHES.md` 补了「预设升级后怎么自查」与升级顺序提醒（先关铁律 → 让预设写一次 → 跑自查 → 再开铁律）。**纯工具脚本，不改宿主/客户端半体，不用重启 DSH。**

## 2.4.0

### 铁律：model-routes.json 只允许本插件写 + 漂移按会话归属处置

**为什么**：`model-routes.json` 是全 DSH 共享的一份角色线路表。会话里用预设自带的「设置角色模型」（`set_role_model`）或手改文件，都会把它改成和界面上场景不一致的内容 —— 于是派工用的模型和界面上看到的不是一回事，而且从文件本身看不出「是谁改的」。

1. **模型变更管控（铁律）**：新模块 `host/guard.js`。本插件每次写 `model-routes.json` 后把内容记成权威内容（`<DSH_HOME>/orchestrator2/guard.json` 的 `last`）；4 秒巡检一次，内容不一致就判定外部改动 —— 开（默认）时立刻写回权威内容并记一条回滚记录（时间 + 差在哪几个角色），关时只观察、不碰文件。
2. **界面**：弹窗底部新增「模型变更管控」卡片 —— 状态徽标（铁律生效中 / 已关闭）、一句话说明、开关勾选框、最近 3 条回滚记录（`HH:MM:SS · 涉及角色 · 已回滚`）。
3. **逃生门**：确实要让会话自己改模型表，就把开关关掉（关掉后仍显示漂移提示，由用户自己决定怎么处理）；重新打开时以「当前文件内容」为基线，不会把用户刚改的内容立刻回滚。
4. **漂移提示按会话归属**：`/state` 新增 `driftSessions: [{ sessionId, shortId, workspace, roles }]` —— 逐个会话列出「哪个工作区、哪个会话、差在哪几个角色」，每条带「应用到该会话 / 放弃」两个按钮；无会话归属时退回一句话说明。`POST /drift { action: "apply"|"dismiss", sessionId }` 处置，`dismiss` 记在 `drift-dismissed.json`（文件再变会重新提示）。
5. **路径收敛**：新增 `host/paths.js`（`dshHome` / `routesPath` / `scenariosPath` / `driftPath` / `guardPath` / `sessionStatesDir`），避免 `guard.js` 与 `region.js` 循环依赖。
6. **自测**：宿主 79 项（新增第 10 节：默认开、同内容 same、外部改写检出并回滚、写回内容正确、回滚记录 1 条、快照带管控状态、关掉后只观察且不动文件、重开以当前内容为基线）；客户端桩测新增 `[铁律] 卡片=有 状态=铁律生效中 勾选=true 回滚记录=1 记录含角色名=true`、`[铁律·关] 请求体={"enabled":false} 状态=已关闭`、`[漂移·会话] 行数=1 含工作区=true 含会话号=true 两个按钮=有/有` 与两条形态断言。
7. **改了宿主半体，必须重启 DSH 才生效。**

## 2.3.25

### 修：漂移提示条不出现（弹窗打开时不重读快照）

2.3.24 里 `drift` / `driftRoles` 已经在 `/state` 里算出来了（实测宿主返回 `drift=true, driftRoles=reviewer`），但**弹窗只在侧边栏首次加载时读过一次 `/state`**，之后再打开弹窗用的还是那份旧快照，所以提示条永远不出现。

- 弹窗打开时（`dialog.open` 变 true）主动调一次 `refreshConfig()`，重新读 `/state`；文件刚被预设的「设置角色模型」或手改动过，一打开就能看到提示条与「重新应用当前场景」按钮。
- 自测里给假宿主加了「真源快照」语义（`stateNow`）：`/switch`、`/adopt`、`/scenarios` 命中后就地更新快照，之后 `/state` 返回新值——与真实宿主一致；`[漂移提示] 提示条=有 按钮=重新应用当前场景 文案含角色名=true 点按钮发保存=1 成功文案=true` 由「打开即重读」这条真实路径驱动，不再靠手工塞 payload。
- 只有客户端半体改动，**重开一次弹窗即生效，不用重启**。宿主 67 项、失效切换 144 项不变。

## 2.3.24

### 场景表搬家：写自己的 scenarios.json，model-routes.json 退回上游原生形状

**为什么**：预设 dsh-orchestrator2 v2.10.3 自己的「设置角色模型」（`set_role_model`）也往 `model-routes.json` 写 v1 形状（只有 `schemaVersion` + `roles`）。两边共用一个文件就会互相覆盖：预设一保存，我们存在同一文件里的 `scenarios` / `activeScenario` 就被抹掉。

1. **场景表搬到 `<DSH_HOME>/orchestrator2/scenarios.json`**（本插件自有，含 `activeScenario` + `scenarios[]`）；`model-routes.json` 退回上游原生 v1 形状（`schemaVersion: 1` + `roles`），由生效场景的主槽派生后写回。这样预设写它的、我们写我们的，互不破坏。
2. **迁移**：读到旧的两合一文件（带 `scenarios`）→ 自动拆成两个文件，`migrated: true`，只做一次；`scenarios.json` 不存在且 `model-routes.json` 只有 `roles` → 由 roles 派生出「场景一」，不丢用户已配的模型。
3. **漂移检测**：`model-routes.json` 里的 `roles` 与「生效场景派生出来的值」不一致时（预设刚改过角色模型 / 手改过文件），`/state` 返回 `drift: true` + `driftRoles: [...]`；弹窗顶部出现提示条「model-routes.json 已被外部改动（涉及：审核员），当前场景未生效」+ 按钮「重新应用当前场景」，点一下就把当前场景再写一遍（既修好预设正在读的 roles，提示条也随之消失）。
4. 弹窗底部同时显示两个文件路径：`数据文件`（model-routes.json）与 `场景文件`（scenarios.json）。
5. **自测**：宿主 67 项、失效切换 144 项、客户端 46 条断言（新增 `[漂移提示] 提示条=有 按钮=重新应用当前场景 文案含角色名=true 点按钮发保存=1 成功文案=true`）、迁移演练（两合一 → 拆分、幂等二次读取不变）、词典无未用/缺键。**这次改到了宿主半体，必须重启 DSH 才生效。**

## 2.3.23

### 关闭 / 删除不要提示 + TIPS 窗口自适应宽度

1. **弹窗右上角的 ×** 与 **TAB 条上的「删除」** 也去掉悬停提示（连同只为它存在的词典键 `sceneOnly`，中英各一份）；现在有提示的按钮从 19 个降到 **17 个**。
2. **TIPS 窗口自适应**：`STYLE.tipFloat` 从固定 `width: min(360px, 64vw)` 改成 `width: max-content` + `maxWidth: min(360px, 64vw)` —— 文案短就只占一小块，长了才涨到上限并自动换行。侧边栏「切换失败」的一次性浮层同样改成 `max-content` + 上限 320px。
3. **「？」的说明块除外**（用户要求）：`helpPanel` 仍用 `TIP_CARD` 的固定宽度，322 字的冷却说明排版不变。
4. 自测新增 `[形态] 关闭与删除无提示=true TIPS 宽度自适应=true`，并给两条既有断言补宽度证据：`[悬浮说明] … 宽度=max-content 上限=min(360px, 64vw)`、`[问号点击] … 宽度=min(360px, 64vw)`；`[悬浮说明·逐个] 悬停=17/17`。词典自检 60 键、无未用/缺键/多余键。宿主 50 项、失效切换 144 项不变。

## 2.3.22

### 侧边栏三个按钮不再有 TIPS

1. 侧边栏那一行里的 **两个分段按钮（国内 / 国际）与「设置」** 去掉悬停提示：删掉 `attachTip` 与 `data-or2-tip-text` 整套接线，`attachTip` 换成 `flashTip`（`data-or2-region="sidebar-flash"`，样式仍取共用的 `TIP_CARD`，`role="alert"`，6 秒后自动移除、再次失败则替换旧的）。
2. **只在「切换失败」时浮一次错误**（`切换失败：{detail}`），避免失败静默——平时划过这三个按钮什么都不出现。
3. 连带删掉只为旧提示存在的词典键 `noScene`（中英各一份）；顺手发现旧的 `t('currentScene')` 根本没有对应词典键（一直回落成字面量），随本次一并消失。词典自检：中英各 61 键、无未用键、无缺键、无多余键。
4. 自测新增 `[形态] 侧边栏无悬停提示=true 失败时浮一次错误=true`；其余 26 项形态检查与全部功能断言保持全绿，宿主 50 项、失效切换 144 项不变。

## 2.3.21

### 所有 TIPS 统一成「？」同款浮层

1. **一张卡**：抽出 `TIP_CARD` 常量（宽 360px / 圆角 8 / 1px 灰描边 / 白底 / 0 8 24 阴影 / 12px 字号 / 1.6 行高 / `pre-wrap`），「？」的说明块（`helpPanel`）与所有悬浮提示（`tipFloat`）都从这里取——以后改外观只改一处，不会再出现两套看着不一样的提示。
2. **不再用浏览器原生气泡**：把弹窗与侧边栏里所有 `title` 全部换成共享浮层（`tipStore` + `showTip(text)` / `hideTip`，浮层 `data-or2-region="tip-float"`、fixed 定位、跟着被悬停元素左下方）。共 19 个按钮（关闭 / 各场景 TAB / 保存 / 应用 / 覆盖 / 删除 / 三个表头 / 顺序行的 ↑↓✕ / 两个动作按钮等）与侧边栏的「设置」「分段按钮」（`attachTip` 直接挂到 `document.body`，避免被侧栏裁掉）。
3. **失效自动切换那一节**的顺序行图标按钮（`↑ 上移` / `↓ 下移` / `✕ 移除`）原本只有原生 `title`，现在也走同一套浮层；`？` 仍然是「悬停即看、点击可钉住」。
4. 自测新增：`[悬浮说明] 带浮层的按钮=19 原生title=无 出现=有 与问号同款=true 定位=fixed`、`[悬浮说明·逐个] 悬停=19/19 最长=22 样例="保存这一份场景表（不影响正在生效的那个场景）"`（逐个悬停确认每条都能装进浮层）、`[悬浮说明·移开] 浮层=已收起`、`[顺序行按钮] 个数=9 带悬浮说明=9`、`[表头双击] … 有悬浮说明=true`。宿主 50 项、失效切换 144 项全绿。

## 2.3.20

### 「覆盖」按钮进 TAB 条 + 覆盖/删除加二次确认

1. **「用当前设置覆盖它们」→「覆盖」**：从正文的会话覆盖提示块里挪到 TAB 条，排在「删除」之前（顺序：保存 / 应用 / 覆盖 / 删除）；没有被钉住的会话时置灰，`title` 说明原因。正文提示块只保留「有 N 个会话被覆盖钉住（ID 前 8 位）」这一句。
2. **二次确认**：点「覆盖」或「删除」都会先弹出确认层（`data-or2-region="confirm-layer"`，铺满弹窗的半透明遮罩 + 居中卡片），文案分别说明「覆盖到 N 个会话」与「删除场景『A/B』不可恢复」。按钮为「取消 / 确定」，确定才真正发请求（`POST /adopt` 或改草稿删除场景）。
3. `STYLE.dialog` 加 `position: relative` 让确认层定位到弹窗；新增 `adoptButton`（蓝描边淡底）、`dangerButton`（红底白字）、`confirmLayer / confirmCard / confirmText / confirmActions`。
4. 词典：新增 `adoptShort / adoptHint / adoptNone / adoptConfirm / deleteConfirm / cancel / confirm`（中英各一份），删除 `overridesAdopt`；`unused-keys` 归零。
5. 自测：`[会话覆盖提示] 按钮=覆盖 在删除之前=true 顺序=保存 / 应用 / 覆盖 / 删除`、`[确认·覆盖] 确认层=有 文案含数量=true 请求数=0`（点了不确认不发请求）、`[确认·取消] 确认层=无 请求数=0`、`[覆盖结果] 请求=1 成功文案=true`、`[确认·删除] 确认层=有 文案含场景名=true`、`[确认·删除取消] 标签数不变=true`、`[按钮统一样式] 个数=8/8 形状=一致`。宿主 50 项、失效切换 144 项全绿。

## 2.3.19

### 主/备表头用实线 vs 虚线区分 + 两个动作按钮上底色

1. **主模型那一侧**：红色**实线**边框胶囊（`2px solid #e11d48`，红字加粗），不再用内描边的 boxShadow。
2. **备模型那一侧**：同样形状同样宽度的**灰色虚线**胶囊（`2px dashed rgba(128,128,128,.55)`）。两个胶囊外框尺寸完全一致，扫一眼就知道哪边是主。
3. 「模拟限流（测试）」换琥珀底色（`rgba(245,158,11,.18)` + 琥珀描边 + 深琥珀字），与侧边栏「设置」按钮同色系，表达「演练、不动真配置」；「重置历史」换灰蓝底色（`rgba(100,116,139,.16)` + 灰蓝描边 + 深灰蓝字），表达中性清理动作。形状仍是统一的 `BTN_BASE`（30px 高 / 8px 圆角）。
4. 自测新增 `[表头边框] 主侧实线=true 备侧虚线=true 同宽=true` 与 `[两个动作按钮] 带底色=true`；`redRing` 判定同时认 `boxShadow` 与 `border`（表头改用真边框后仍能识别）。

## 2.3.18

### 「模拟限流（测试）」「重置历史」移到数字那一行、靠右

1. 两个按钮从「状态条下面单独一行」挪到「整轮冷却（分钟）」「每小时上限」同一行的右端（用户指定位置），容器 `numberActions` 用 `marginLeft: auto` 顶到右边，`alignItems: flex-end` 与输入框底边对齐。
2. 删掉原来那排 `failoverActions` 与其样式，整节少一行高度。
3. 自测新增断言：`[两个动作按钮] 与数字同一行=true 靠右=true`。

## 2.3.17

### 一页放得下：保存进顶栏、模型合并成一个下拉、底栏取消

1. **「保存」挪到「应用」之前**，与「删除」同排在 TAB 条右端（顺序：保存 / 应用 / 删除）；底部那条「取消 / 保存」底栏整块删除（取消的语义由右上角的关闭按钮承担）。数据文件路径仍在正文末尾。
2. **模型选择合并成一个下拉**：原来「提供商」「模型」两行两个框，现在每格只有一个框，按提供商分组（`<optgroup>`），选项文字是模型的显示名，值是 `provider\u0000model`；换分组即换模型，一次点击搞定。目录里没有当前值时，最上面单独列出「当前值」分组，避免选择被吞掉；目录彻底取不到时才回落到两个手填输入框。
3. **压高度**：三个角色从 6 行下拉变 3 行；行距（`roleRow` 7→5px、`headRow` 6→4px、名称行 10→7px）、输入框内距（4→3px）、弹窗内距（18/20/16 → 14/16/12px）、失效卡片外边距（18→10px）一并收紧，`maxHeight` 抬到 94vh——整页一屏可见，不再需要滚动。
4. **说明与 TIPS 对齐新界面**：主说明改成「改完点右上『保存』存下整张场景表，选中某个 TAB 再点『应用』让它立刻生效」；`failoverHelp` 里「与下面『保存』无关」改为「与上面『保存』无关」。
5. 顺带清理：词典键 `cancel` / `noCandidate` 删除（已无引用），两处历史补丁留下的缩进错位（`tabInUseTitle` / `headSwitchHint`）修正。
6. 自测新增 `[模型合并下拉] 路由下拉=6 分组总数=12 值含分隔=6`、`[滚动固定] 钉顶含保存应用删除=true 无底栏=true`、`[TAB 条动作按钮] 文案=保存 / 应用 / 删除 保存在应用之前=true`；三套自测全绿（client 桩测 / 宿主 50 项 / 失效切换 144 项）。

## 2.3.16

### 关闭按钮改成自绘叉（不再被裁）+ 「切换顺序」那段说明并进 TIPS

1. **❌ 显示不全**：🔍 根因是 emoji 字形尺寸不受 `fontSize` 控制，26px 的盒子里再叠 `lineHeight: 24px`，边缘会被切。现在按钮里换成一枚自绘 SVG 叉（`data-or2-icon="close"`，16×16 的 `path`，红色 `#dc2626`、圆头描边），按钮盒 28×28、`inline-flex` 居中、`padding: 0`、`lineHeight: 1`，外加淡红底与描边标识可点区域。任何缩放下都不会被切。
2. **说明段落并进 TIPS**：「当前场景失效就切到下一个；顺序里剩下的场景全都失败过（= 整轮没有一个可用）就当场停手，进入指数冷却，期间不再切换。」不再单独占一行挤在「切换顺序」下面，改成 `failoverHelp` 浮层里的第二句（接着讲指数冷却的倍率、防抖、每小时上限等），弹窗正文恢复整洁；词典键 `failoverOrderHint`（中英）删除。
3. 自测新增 `[关闭按钮] 自绘叉=true 尺寸=16x16 按钮盒=28px`、`[顺序说明并入TIPS] 正文段落=无 TIPS含整轮=true`；三套自测全绿（client 桩测 / 宿主 50 项 / 失效切换 144 项）。

## 2.3.15

### 「？」的悬停 TIPS 与点击 TIPS 统一成同一个浮层

1. 之前两种格式并存：悬停走**原生 `title` 气泡**（浏览器自己画，浅黄小方块、不可滚、字挤），点击走**自绘浮层**（可滚、有边框投影）。现在统一成自绘浮层：`tips()` 去掉 `title` 属性，改成在外层 `span.tipsWrap` 上挂 `onMouseEnter` / `onMouseLeave`（`onHover?.(true|false)`），`FailoverSection` 传入 `setHelp`；点击、键盘 Enter/空格仍可开合并钉住。
2. 移开鼠标即收起；点开的状态不会被悬停覆盖（悬停只负责「进入=开、离开=关」）。
3. `aria-label` 保留整段说明（无障碍与自测都靠它），只是不再触发浏览器气泡。
4. 自测新增 `[问号TIPS] … 原生title=无（统一用浮层）`、`[问号悬停] 浮层=出现 与点击同一个格式=true 文案长度=295`、`[悬停移出] 浮层=已收起`；形态断言「问号点开说明」加严为必须带 `onHover` 且不得出现 `title: text`。三套自测全绿。

## 2.3.14

### 弹窗内「TAB + 应用/删除」钉顶、「取消 / 保存」钉底

1. 长的场景表往下滚时，顶部的场景 TAB 与「应用 / 删除」、底部的「取消 / 保存」都留在视野里：`STYLE.tabRow` 与 `STYLE.footer` 都改成 `position: sticky`（顶 `top: 0`、底 `bottom: 0`，`zIndex: 20`，底色同弹窗 + 一道极淡投影表示边界）。滚动容器仍是 `dialogBody`，标题与说明本来就在它外面，因此视觉上是「标题/说明 + TAB 条」固定在上、「取消/保存」固定在下，只有中间的角色表与失效自动切换滚动。
2. 数据文件路径挪到**底栏之前**（随内容滚），否则它会落到钉底的底栏下面被盖住。
3. 自测新增 `[滚动固定] 钉顶=true 钉顶含应用删除=true 钉底=true 钉底含取消保存=true 路径在底栏之前=true`；三套自测全绿。

## 2.3.13

### 双击主/备表头后红环跟着走 + 关闭按钮不再被挤出弹窗

1. **双击表头后红环不移动**：`onDoubleClick` 只发了 `POST /switch`，宿主把主备翻了、`configStore` 也更新了，但弹窗渲染红环用的是本地草稿 `editing.primary`（打开弹窗时的快照），草稿没翻 → 红环留在旧一侧。现在成功后补一句 `patchScene(target, () => ({ primary: side }))`，草稿与宿主同步；随后保存宿主再设同一侧是幂等的。
2. **关闭按钮 ❌ 显示不全**：标题栏左侧「标题 + 说明」容器缺 `minWidth: 0`，长说明按 min-content 撑宽，把 `flex: 0 0 auto` 的关闭按钮推出弹窗、被 `overflow: hidden` 裁掉一半。新增 `STYLE.dialogHeadText = { flex: '1 1 auto', minWidth: 0 }` 应用到该容器，按钮恢复完整，说明在窄屏自动换行。
3. 自测新增 `[双击后红环] 目标侧=a 红环侧=a 一致=true`、形态断言「标题栏可收缩」「双击翻草稿主槽」；三套自测全绿（client 桩测 / 宿主 50 项 / 失效切换 144 项）。

## 2.3.12

### TAB 不再被压扁 + 主/备表头改成按钮（双击切主备）+ ？改成浮层

1. **第一个场景按钮显示不全**：`STYLE.tab` 原来带 `maxWidth: 220px` + `overflow: hidden` + `textOverflow: ellipsis`，在 flex 行里默认还能被压缩，于是第一个 TAB 被挤窄、文字被裁。现在改成 `flexShrink: 0` + `whiteSpace: nowrap`，并且**去掉自身裁切**；`tabInUse` 的红环从 `boxShadow: 0 0 0 2px`（外阴影会被祖先 `overflow` 裁掉）改成 `inset 0 0 0 2px`（内描边，永远画得出来）；`dialogBody` 左右各留 6px、`tabRow` 顶部留 2px，给描边留位置。
2. **主/备表头改成按钮**：两列表头从 `span` 换成 `button`（`data-or2-region: 'side-head'`、`data-or2-side: 'a'|'b'`），**双击**那一侧就把它设成主模型——走 `POST /switch {side}`，与侧边栏的切换按钮是同一条通路，所以**侧边栏状态同步**；成功后顺手 `refreshFailover()`（宿主会把轮次重置）。只有「使用中且两侧都选全」的场景能双击，否则按钮置灰、`title` 提示先点「应用」并选全模型。`STYLE.headSide` 是它的基础样式，`headPrimary` 的红环同样改内描边。
3. **？改成浮层**：`tips()` 现在渲染 `span.tipsWrap{position:relative}` 包着圆点和说明块，说明块是 `position: absolute; top: 22px; width: min(360px, 64vw); maxHeight: 220px; overflowY: auto` 的浮层（带底色 + 投影 + `zIndex: 30`），**不再内联插进「失效自动切换」一节撑开版面**；点圆点开合，点浮层自身不关闭。
4. 自测：`[表头双击] 目标侧=a 新增请求=1 体={"side":"a"}`、`[红环] 表头红环=true 表头文字=主 · 国际`、`[问号点击] 说明块=出现 文案长度=295`、形态断言新增「问号是浮层（`position: absolute` 且无 `helpBlock`）」；`弹窗只有内容区滚动` 断言改成读整块 `dialogBody`（原来是单行切片，多行写法会误判）。三套自测全绿：client 桩测、宿主 50 项、失效切换 144 项。

## 2.3.11

### 「？」改成点得开的说明块 + 关闭按钮换成 ❌

1. 用户反馈「？点了不弹 TIPS」：原来 `tips()` 只把说明挂在原生 `title` 上，靠悬停才出现，点了没反应。现在 `tips(text, onToggle, open)` 额外给这个圆点 `role: 'button'` / `tabIndex: 0` / `aria-expanded`，点击或按 Enter / 空格就地展开说明块（`data-or2-region: 'failover-help-panel'`，样式 `STYLE.helpPanel` 淡底圆角小块），再点收起；原生 `title` 保留，悬停照样能看。
2. 说明块在「失效自动切换」两个分支（正常态、宿主取不到配置的降级态）都会渲染，位置就在标题行下面、「切换顺序」上面。
3. 关闭按钮字形从 `×` 换成 `❌`（`aria-label` 仍是「关闭」）。
4. 自测：`tools/simulate-client.cjs` 新增 `[问号点击]`（触发 `__onClick` 后重新挂载弹窗，断言说明块出现且文案含「冷却」，实测 295 字）；`[关闭按钮]` 增加字形断言（`字形="❌"`）；源码级断言 `长说明折叠成问号` 换成 `问号点开说明`（要求 `function tips(text, onToggle, open)` + 有 `failover-help-panel` + 两处标题行都接 `toggleHelp`/`helpOpen`）。三套自测：`node tools/simulate-client.cjs` 全绿、`node tools/selftest-host.mjs` 50 项、`node tools/selftest-failover.mjs` 144 项。

## 2.3.10

### 弹窗滚动的只有内容区：标题与说明固定在上方

1. `STYLE.dialog` 从「整窗 `maxHeight: 88vh + overflowY: auto`」改为 **flex 纵向布局 + `overflow: hidden`**：标题行与那段合并说明（`dialogHead`）作为固定头（`flex: 0 0 auto`，加一条淡分隔线），下面 `dialogBody` 才滚。
2. `STYLE.dialogBody` 增加 `flex: 1 1 auto; minHeight: 0; overflowY: auto`——`minHeight: 0` 是关键，缺它 flex 子项不会收缩，内容会把整个弹窗撑出去、又变回整窗滚。
3. 效果：TAB 条、场景表单、失效自动切换、会话覆盖提示都在内容区里滚动；标题「三角色主备模型切换」与说明文字始终可见，鼠标滚轮/触控板滚的是内容区。
4. 自测新增源码级断言 `弹窗只有内容区滚动=true`（`dialog` 有 `flexDirection: column` + `overflow: hidden` 且无 `overflowY: auto`；`dialogBody` 有 `overflowY: auto` + `minHeight: 0`）；其余 23 项形态断言与两套宿主自测（50 / 144 项）不变全绿。

## 2.3.9

### 侧边栏三个按钮字与底色对齐 + 样式能随热更新刷新

1. **字号统一**：两个分段项原来是 `font-size:11px; line-height:1.55`，「设置」是 `12px / 1.5`，看着「设置」大一号。现在三者统一为 **`font-size:12px; line-height:1; font-weight:600`**；分段项内边距 `4px 9px`、「设置」`4px 10px`，高度对齐，圆角各自（胶囊 / 8px）保留以区分功能。
2. **选中态不再靠字重跳变**：两个分段项都是 600，选中只改字色（白），避免同一行里出现「粗/细」两种笔画。
3. **「设置」换底色**：从灰色改成琥珀色系——底色 `rgba(245,158,11,.18)`、描边 `rgba(217,119,6,.42)`、文字 `#b45309`，悬停加深到 `.32`。和左边「灰底 + 品牌蓝滑块」视觉分离，一眼能分清「切换」与「设置」。
4. **样式热更新**：`ensureRowStyle()` 原来「样式元素已存在就直接 return」，HMR 重新求值后页面上的旧 `<style>` 不会更新（改 CSS 必须刷新页面）。现在改成每次都把最新 CSS 写进同一个 `<style>`（`if (!existing) document.head.appendChild(style)`），改样式同样只热加载即可生效。
5. **自测**：新增源码级断言 `三个按钮字号统一=true`（`ensureRowStyle` 里 `font-size:12px` ≥ 2 处且无 `font-size:11px`）、`设置按钮另有底色=true`、`样式能随热更新=true`（`style.textContent = [` 存在且没有「拿到就 return」写法）；既有 22 项形态断言与 `selftest-host` 50 项、`selftest-failover` 144 项不变全绿。

## 2.3.8

### 去掉中间那层只读面板：点「设置」或这一行的空白处，直接打开设置弹窗

1. **删掉主面板（`main` 槽位）**：侧边栏行右侧原来那块空白点进去的只读页面整段移除（`RegionPanel`、`rolesReadonly`、`sideHeadRow` 与 `slot('main', …)` 注册全部删除）。现在整个插件只有 **2 个槽位**：侧边栏一行 + 设置弹窗。
2. **点哪儿都直接开弹窗**：行内滑块之外的任何位置（含原来那块空白）都在 `handler` 里先 `preventDefault/stopPropagation` 再 `openRolesDialog()`；「设置」按钮行为不变。
3. **原来面板上的东西搬进弹窗**：
   - 三角色只读表不再需要（弹窗里就是可编辑的三行）；
   - 会话级覆盖提示 + 「用当前设置覆盖它们」按钮搬进弹窗（在「失效自动切换」上方）；
   - 配置读取失败的 `configError` 提示搬进弹窗标题下方；
   - 切换失败时没有面板可显示错误，改为把原因写进侧边栏那一行的 `title`（悬停可见），effect 依赖补上 `switching.code/detail`。
4. **两段说明合并成一段**（放在弹窗标题下方，即原来弹窗说明的位置）：把原来面板的「侧边栏那一行是使用中的场景…」与弹窗的「场景数量不设上限…」合写为一句连贯说明——先说侧边栏两个按钮的作用与主会话模型归属，再说场景数量、A/B 两侧、应用即刻生效、失效自动切换的顺序轮转，最后说改动直接写 `model-routes.json`。
5. **词典清理**：删除 `title` / `panelScene` / `panelHint` / `incompleteHint` / `switched` / `rolesDescription` 六个死键；`description` 改为合并文案（中英各一份）。`keys: 55 unused: 0`。
6. **自测**（全绿）：
   - `[槽位] 总注册=2 主面板槽位=0`、`[空白处开弹窗] 点前=0 点后=1`
   - `[会话覆盖提示] 提示=true 会话短写=true 按钮=true`、`[覆盖结果] 提示消失=true 成功文案=true`（改在弹窗里断言）
   - `[合并说明] 含聊天窗模型=true 含失效自动切换=true 含旧面板文案=无`
   - 源码级新增 `无主面板槽位=true`、`两段说明已合并=true`
   - `selftest-host` 50 项、`selftest-failover` 144 项仍全 OK（宿主未改）

## 2.3.7

### 修 2.3.6 引入的回归：主面板角色名变成 roleResearcher + 只读表挤成一行

1. **回归根因**：2.3.4 清理死词典键时把 `roleResearcher / roleReviewer / roleDeveloper` 当成没人用了，但代码是 `t(ROLE_LABEL[role])` 动态取——静态扫描扫不到，于是主面板直接显示原始键名 `roleResearcher`。三个键已恢复（zh 研究员/审核员/开发员，en Researcher/Reviewer/Developer）。
2. 自测工具 `.tmp/unused-keys.cjs` 加了动态键白名单（`DYNAMIC = ['roleResearcher','roleReviewer','roleDeveloper']`），并把判定从「只看 `t('key')`」放宽到「`'key'` 至少被引用一次」——同类误删不会再发生。
3. **只读表布局**：表头改成 `主 · 国内` / `备 · 国际`（主槽那侧仍带红环），行里去掉重复的「主」「备」小标签和内层 flex，直接三列 `角色 | 主槽路由 | 备槽路由`，不再挤成一行。
4. 主面板去掉重复文案「使用中：国内/国际」（上面已有小标题「使用中的场景」），只显示场景名；删掉词典键 `currentScene`。
5. 弹窗表头同样改成 `主 · 名称` / `备 · 名称`，并去掉原来重复追加的「（主）」。
6. 自测新增/更新：`[panel] 使用中场景标题=true 主备列头=true 角色名=true 原始键名残留=无`、`[红环] 表头文字=主 · 国际`；`selftest-host` 50 项、`selftest-failover` 144 项、`unused-keys` → `keys: 61 unused: 0`。

## 2.3.6

### 所有按钮统一形状 / 大小 / 风格（用户：这些按钮统一一下）

1. 新增共用底座 `BTN_BASE`：`height: 30px`、`borderRadius: 8px`、`fontSize: 12.5px`、`fontWeight: 600`、`padding: 0 14px`、`border: 1px solid rgba(128,128,128,.35)`、`inline-flex` 居中、`boxSizing: border-box`。
2. 列出的 8 个按钮全部改为 `{ ...BTN_BASE, 只改颜色 }`：场景 TAB、＋ 场景、应用（绿）、删除（红）、模拟限流（测试）、重置历史、取消、保存（品牌蓝）。
3. 顺带统一：顺序行 ↑ ↓ ✕ 图标按钮（26×26 仍保持方形，但圆角/描边/字号走底座）、「＋ 添加场景」、右上角 × 关闭按钮（圆角 6 → 8）、「用当前设置覆盖它们」从蓝色文字链接改成标准次要按钮；删掉不再使用的 `linkButton` 样式。
4. 自测新增 `[按钮统一样式]`：逐个取 8 个按钮比较 `height | borderRadius | fontSize | padding`，输出 `个数=8/8 形状=一致`、样本 `30px | 8px | 12.5px | 0 14px`。
5. 其余断言不变且全绿：`[弹窗结构]`、`[TAB 着色] 对比明显=true`、`[红环]`、`[保存回显]`、`selftest-host` 50 项、`selftest-failover` 144 项。

## 2.3.5

### 选中的 TAB 改成品牌色实心（用户：选中/没选中的对比不明显）

1. **未选中**：灰底 + 1px 描边 + 圆角 8px 的胶囊（`background: rgba(128,128,128,.10)`、`border: 1px solid rgba(128,128,128,.28)`）。
2. **选中**：品牌色实心 + 白字 + 加粗 + 投影（`background: var(--dsw-alias-brand-primary, #4d6bfe)`、`color: #fff`、`boxShadow: 0 1px 3px rgba(77,107,254,.35)`）——对比靠整块底色，不再靠底部一条 2px 细线。
3. 「生效」红环不再改文字颜色（否则会把选中态的白字顶掉），只留 `boxShadow: 0 0 0 2px #e11d48`。
4. TAB 间距 6px → 8px，胶囊之间不再贴在一起。
5. 自测：`[TAB 着色] 选中背景=var(--dsw-alias-brand-primary, #4d6bfe) 未选中背景=rgba(128,128,128,.10) 对比明显=true`、`[TAB 条动作按钮] 选中TAB实心=true`、`[红环] 生效TAB红环=true 表头红环=true`。

## 2.3.4

### TAB 不再写字：生效用红环、主模型列用红环，按钮只叫「应用」（用户：TAB不要加"使用中"这几个字）

1. **TAB 上没有任何状态文字**：选中的 TAB 用底部标识条；**正在生效**的那个整体套一圈红环（`boxShadow: 0 0 0 2px #e11d48`），原来名字后面那个圆点删掉。
2. **表头「主模型」那一列也套同一个红环**（两列名字一样时——比如「国内收费 / 国内收费」——靠这个红环分辨谁是主）。
3. 动作按钮文案「使用」→**「应用」**（生效中也只写「应用」，靠红环表达状态，不再显示「使用中」）。
4. 三件套没变：TAB 条右端只有一套「应用 / 删除」，都作用于当前选中的 TAB，「应用」在「删除」前面，「＋ 场景」在两者左边。
5. 词典清掉 6 个死键（`roleResearcher/roleReviewer/roleDeveloper/sceneUseActive/failoverStatus/failoverHalted`），`node .tmp/unused-keys.cjs` → `keys: 59 unused: 0`。
6. 自测：`[弹窗结构] 应用按钮=1（应用） 删除按钮=1（删除） 绿红配色=true`、`[红环] 生效TAB红环=true 表头红环=true 表头文字=国内/国际 弹窗出现「使用中」=无`、`[应用按钮状态·使用中场景] 文案=应用 禁用=true`、`[不完整场景] 使用按钮禁用=true`；`node tools/selftest-host.mjs` SELF-TEST OK（50 项）、`node tools/selftest-failover.mjs` SELF-TEST OK（144 项）。

## 2.3.3

### 动作按钮收成一套 + 选中的 TAB 用底栏标识（用户：需要这么多使用/删除吗）

1. **每个 TAB 后面不再挂一对按钮**（上一版每个场景各带「使用/删除」，3 个场景就是 6 个按钮，太吵）。TAB 条只放名字（文字 = 两侧名字拼接），后面跟「＋ 场景」。
2. **只保留一套「使用 / 删除」**，摆在 TAB 条右端（`marginLeft: auto`），作用于**当前选中的 TAB**：点「使用」= 用这个标签，点「删除」= 删这个标签（只剩一个场景时禁用）。
3. **选中的 TAB 用底部标识条**（`borderBottom: 2px solid brand-primary` + 品牌色文字），不再用药丸底色；「使用中」的场景在名字后面点一个圆点（选中 ≠ 使用中，两者可以是不同 TAB）。
4. 「使用」按钮在选中项已生效时显示「使用中」并置灰；选中项没选全模型时置灰，title 给原因。
5. 自测：`[弹窗结构] TAB=3 使用按钮=1 删除按钮=1 绿红配色=true`、`[TAB 条动作按钮] 文案=使用中 / 删除 在新增按钮之后=true 选中TAB带底栏=true`、`[使用即生效] POST /select {"id":"scene-2"}`、`[不完整场景] 使用按钮禁用=true`；源码级断言改匹配 `canUseEditing`。宿主未改。

## 2.3.2

### 「使用 / 删除」挪进 TAB 条：每个场景 TAB 后面紧跟一对绿/红小按钮

1. **位置**：原来这两个按钮在选中场景的表单里（一行灰底 `sceneActions`），现在挪到 TAB 条——每个场景渲染成一组 `tabGroup`：`[场景 TAB][使用][删除]`，全部排在「＋ 场景」之前（`…scenes.map` 里从只返回 TAB 改成返回这一组）。
2. **文案与配色**：`使用`（绿 `#16a34a` 底、白字、999px 圆角）/ `删除`（红 `#dc2626` 底、白字）。使用中的那个变浅绿描边+浅绿字、文案仍是「使用中」；不完整场景的「使用」、只剩一个场景时的「删除」都置灰（`opacity .5` + `disabled` + `cursor default`），`title` 给原因。
3. **按钮带场景归属**：两个按钮都加了 `data-or2-scene="<场景id>"`，同一个弹窗里现在有多对同名按钮（`data-or2-region="scene-use" / "scene-delete"`），自测按场景 id 定位。
4. **表单里只剩一条提示**：不完整场景的「三个角色的两侧模型都要选全…」提示挪到 TAB 条下面（`editing === null || sceneComplete(editing) ? null : hint`），表单主体不再有动作按钮。
5. **清理**：删掉 `sceneActions` / `sceneUse` / `sceneUseActive` / `sceneDelete` 四个样式与 `sceneUse` / `sceneDelete` 两个词典键（新增 `useShort`=使用 / `deleteShort`=删除，中英各一份）。
6. **自测**：`[弹窗结构] 使用按钮=3 删除按钮=3 绿红配色=true 旧单选圆点=无`、`[TAB 内动作按钮] 文案=使用中|使用|使用 / 删除|删除|删除 在新增按钮之前=true`、`[使用按钮状态·使用中场景] 禁用=true`、`[未使用场景] 文案=使用`、`[使用即生效] POST /select {"id":"scene-2"}`、`[不完整场景] 使用按钮禁用=true`；源码级断言 `不完整禁用`/`长说明折叠成问号` 跟着改成匹配新写法。宿主未改（50 + 144 项仍全绿）。

## 2.3.1

### 「失效自动切换」一节重排视觉 + ？改 TIPS + 两个动作按钮（用户反馈「丑爆了」）

1. **「？」改成 TIPS**：删除 `helpOpen` 状态与常驻说明块（原 `data-or2-region="failover-help-panel"`），标题旁那个圆形「？」变成 `span` + 原生 `title`，鼠标悬停出气泡（含冷却等全文），点它不再展开任何东西。
2. **整节变成一张卡片**：`STYLE.failoverCard`（圆角 10px、1px 边、`rgba(128,128,128,.06)` 底、内边距 12/14px），标题行 `failoverHead` 里左侧「标题 + ？」、右侧「启用」勾选框，与上面的场景表在视觉上分开。
3. **顺序行改成栅格 + 图标按钮**：`18px | 1fr | auto`（序号 · 场景下拉 · 三个图标按钮）。原来的 `↑ 上移 / ↓ 下移 / ✕ 移除` 文字链接换成 26×26 的方角图标按钮，`title`/`aria-label` 仍给全名；禁用时 `opacity .35`。`＋ 添加场景` 改成虚线小按钮，无可添加场景时同样置灰。
4. **「模拟限流（测试）」与「重置历史」统一成两个按钮**：原来一个是 `buttonBase`、一个是蓝色文字链接。现在两个都是 `STYLE.secondaryButton`（1px 边、圆角 6px、内边距 5/12px、`bg-layer-1` 底），同级并排。
5. **状态行改成状态条**：原来是一句 `messageOk`（绿色成功色，语义也不对）长句；现在是 `STYLE.statRow` 灰底小条，五项「当前场景 · 位置 · 最近翻转 · 滚动 1 小时 · 本轮已失败」各一 `statItem`（标签灰 + 值加粗），暂停时右侧多一个琥珀色 `warnChip`「已暂停至 HH:MM」。新增词典键 `statCurrent/statPosition/statLastFlip/statFlips/statRoundFailed/failoverHaltedChip`（中英各一份）；`failoverStatus`/`failoverHalted` 两个长句模板随之停用。
6. **两个数（整轮冷却 / 每小时上限）**改成上下结构 `numberBox`（标签在上、84px 输入框在下），不再挤在一行里和勾选框混排。
7. **自测**（`tools/simulate-client.cjs`）：`[问号TIPS]`（title 长度 >0、含「冷却」、常驻说明块=无）、`[顺序行按钮] 个数=9 带title=9`、`[两个动作按钮] 个数=2 都是按钮样式=true`、`[状态条] 项=5/5`；`node --check client.js` 0；`node tools/dict-keys.cjs` 无重复键；宿主自测未改（50 项 + 144 项仍全绿）。
8. **热加载已验证**：宿主的 `client-hmr`（`/plugins/events` SSE + 500ms stat 轮询 → `clientModules.rebuilt(id)`）在桌面版组合树里是挂载的；本轮每次保存后 `/api/orchestrator2-region-switch/diag` 都新增一组 `factory-mount` + `apply-enter` + 3× `slot-registered`，说明浏览器半体已自动换成新代码——**改插件不再需要重启 DSH**，最多重开一次设置弹窗。

## 2.3.0

### 「失效自动切换」这一节的开关与文案按操作习惯重排（纯 UI，无行为变化）

1. **删掉场景区上方那行单选**（`场景失效时按顺序自动切换到下一个场景 / 停用 / 使用`）：现在**全弹窗只有一处开关**——「失效自动切换」标题行右侧的「启用」勾选框，点它即存（`POST /failover { enabled }`）。
2. **场景卡里「使用此场景」「删除此场景」改成两个按钮**：原来是「单选圆点 + 文字链接」。使用中的那个变实心蓝底、文案「使用中」且不可再点；没选全模型的场景按钮禁用并给提示；只剩一个场景时「删除此场景」禁用。按钮顺序 = 使用在前、删除在后。
3. **标题去掉「（按场景顺序轮转）」**，改回「失效自动切换」。
4. **长说明折叠成「？」**：标题旁的圆形「？」点一下在标题行下面展开说明块（再点收起）。原来那段六七百字的说明常驻，把整节压得没法看。说明块用**普通块 + 限高滚动**，不用绝对定位浮层——避免被弹窗滚动容器裁掉。
5. 顺手清掉随之失效的死词典键（`switching`/`provider`/`model`/`missingModel`/`invalid`，中英各一份）与死样式（`useRow`/`useLabel`/`helpPanel`）。
6. **新增防回归**：`tools/dict-keys.cjs`（大括号配对扫描 `DICTS`，报同一对象内的重复键）+ 自测断言「词典无重复键」。本次改造中真踩到这个坑：`sceneInUse` 同时被写成「使用中」和「已切换到这个场景。」，后者静默覆盖前者，按钮文案显示成提示语。
7. **自测**（`tools/simulate-client.cjs`）：桩数据扩到**三个场景**（完整 + 完整 + 不完整），新增断言——
   - `[弹窗结构]` 使用按钮=有（使用中） 删除按钮=有（删除此场景） 旧单选圆点=无；
   - `[使用按钮状态·使用中场景]` 文案=使用中 禁用=true；
   - `[未使用场景]` 文案=使用此场景 禁用=null；`[使用即生效]` 点一下即 `POST /select {"id":"scene-2"}`（不等保存）；
   - `[不完整场景]` 使用按钮禁用=true 提示=true；
   - `[失效自动切换节]` 标题/启用勾选框/问号齐全、旧单选圆点=无；`[问号展开]` 说明可见且含「冷却」；`[启用开关]` 勾选即 `POST /failover {"enabled":true}`；
   - 源码级：`两个按钮（使用/删除）`、`不用单选圆点`、`失效自动切换只有一处开关`、`长说明折叠成问号`、`词典无重复键`。
8. 版本 2.3.0；`node --check client.js` 0；`node tools/selftest-host.mjs` → SELF-TEST OK（50 项，宿主未改）。

## 2.2.2

### 整轮失败不再空转一次：N 个场景 N 次失败即进冷却（行为修正）

1. **状态机（`host/failover.js` 的 `decision()`）**：signal 分支在「当前场景未失败 ⇒ 切下一个」之前新增一步判断——算 `nextId = order[(currentIndex + 1) % order.length]`，若 `nextId` **已在** `roundFailed` 里，说明这一轮已经走完（`order` 是环、只有从起点按顺序走过的场景才会进 `roundFailed`，所以「下一个已失败」= 剩余场景全部失败过），就直接走**与原来 `round-failed` 完全相同的副作用**：当前场景并进本轮、`roundCount += 1`、`haltedUntil = now + min(30 × 2^(roundCount−1), 720)` 分钟、`roundFailed = []`、**不切换场景**、`reason` 仍是 `round-failed`；否则照旧切换 + 把当前场景记进 `roundFailed` + `scene-failed`。
   - 修掉的是「多打一次才停」：2 个场景 `order = [scene-1, scene-2]` 时旧逻辑是「切（scene-1→scene-2）→ 切（scene-2→scene-1，**切回了已知失效的场景**）→ halt」共 3 次信号，现在第 2 次就 halt。
   - 判定优先级不变：`enabled` → `haltedUntil` → 滚动 1 小时上限 → `min-dwell` → **新判断** → 切换；`order.length < 2` 的 `no-order` 防御分支原样保留；「当前场景已在 `roundFailed` 里 ⇒ halt」这条旧分支保留为**兜底**（新分支上线后正常流程已走不到，只兜住手改文件写出的旧状态）。
   - `decision()` 的 halt 决策多带一个 `roundFailed` 字段（= 本轮结束时的失败集合，含当前场景；只给日志/审计看，落盘时一律清空）。warn 日志改成「本轮 N 个场景全部失效（s1 → s2 → …），暂停自动切换至 …」。
2. **自测（`tools/selftest-failover.mjs`）**：
   - 「绕回已失败场景才 halt」类断言改成「**N 个场景 N 次信号即 halt**」，N=2 与 N=3 各断言一次（N=3：信号 1 切、2 切、3 halt；N=2：信号 1 切、2 halt）。
   - 原「末尾场景失效 → 回到 order[0]」用例（scene-3 → scene-2）**删除**：按新语义那次信号就是整轮的结尾（下一个场景 scene-2 已失败），已改写为 halt 断言。
   - 新增断言：halt 那一次**不产生 flip**（`flips` 数量不变）、halt 当次 `roundFailed` **被清空**、`roundCount` **正确递增**；另用纯函数直测三条分支——「下一个已失败 ⇒ halt」「下一个未失败 ⇒ 仍 switch-next（反例）」「当前已在 `roundFailed` ⇒ 仍 halt（兜底）」。
   - §15 的指数冷却阶梯仍**锁死** `30 / 60 / 120 / 240 / 480 / 720 / 720`（真实拨钟、跨轮叠加，不注入 `roundCount` 冒充）；每轮的信号次数按 N = 3 调整（一轮 3 次信号），并逐轮断言 halt 不产生 flip、`roundFailed` 清空、`roundCount` 递增。
   - 「不碰真实数据文件」从 1 个扩到 3 个：`model-routes.json` / `failover.json` / `failover-signal.json` 开头取（存在性 + SHA-256）快照、末尾逐项复核一致（真机上 `failover.json` 存在、`failover-signal.json` 可能还没被写过，所以断言的是「与开头一样」而不是写死的哈希）。
   - 现共 **144 项断言全 PASS**，`node tools/selftest-failover.mjs` EXIT=0；`node --check host/failover.js`、`node --check tools/selftest-failover.mjs`、`node --check host/routes.js` 全 EXIT=0。
3. **没有变的东西**：`failover.json` 仍是 `schemaVersion: 2`（字段与含义不变，只是 halt 发生得更早）；v1 迁移、`enabled` 默认 `false`、「未启用时一个字节都不写 `model-routes.json`」、`no-order` 防御、`resume` 只清 `haltedUntil`（`roundCount` 跨轮叠加）、三条手动清零路径、「改顺序 / 手动切场景 / 重置历史从第一档重新起算」、`flips` 上限 200 全部照旧；`region.js` / `index.js` / `client.js` / `cordis.patch.yml` 一个字节都没动。

## 2.2.1

### 两处收尾修正 + 一处界面落点调整

1. **指数冷却跨轮叠加（行为修正）**：2.2.0 的 `resume` 顺手把 `roundCount` 归零，导致每次整轮失败都从 30 分钟重新起算，60 / 120 / 240 / 480 / 720 这几档永远用不到。现在 `resume` **只清 `haltedUntil`**（仍然不回切），`roundCount` 只在三条手动路径清零：`POST /failover {reset:true}`、改切换顺序（`POST /failover {order}`）、手动切换生效场景（`POST /select` 成功后路由层调 `noteManualSceneSwitch()`）。效果：连续第 2 轮整轮失败 ⇒ 冷却 60 分钟、第 3 轮 120 分钟、第 6 轮起 720 分钟封顶。"一轮走完且没有触发失败"理论上也该清零，但本状态机没有"一轮成功结束"这种信号（signal 只代表失效、tick 只代表冷却到点），所以不为它新造信号，只保留上面三个清零点（代码注释里已写明）。
2. **启用开关移到「场景」区**：勾选框从「自动失效切换」小节里**删除**，改成弹窗说明文案（"场景数量不设上限。每个场景是……"）**正下方**、场景 TAB 条上面的一枚**独立单选圆点**，标签「场景失效时按顺序自动切换到下一个场景」。单选只表达"开"；关闭用旁边的「停用」小文字按钮（不依赖"再点一次同一圆点取消选中"）。提交仍走 `POST /failover {enabled}`，一个功能只有一个开关。同时**移除「探针窗口」（`perSceneProbeMin`）数字框**：字段保留在 `failover.json` 里向后兼容（仍可 POST），界面不再暴露、说明文案也不再提它。
3. **i18n**：zh / en 同步——删掉死键 `failoverEnable` / `failoverProbeWindow`，新增 `failoverEnableRadio` / `failoverDisable`，两处 `failoverHint` 按新语义重写（明确"只有连续整轮失败才叠加"、"改顺序 / 手动切场景 / 重置历史从第一档重新起算"）。
4. **自测**：`tools/selftest-failover.mjs` 新增用例——用注入 `nowMs` 真实拨钟连推 7 轮整轮失败，断言冷却依次 30 / 60 / 120 / 240 / 480 / 720 / 720 分钟、`resume` 后 `roundCount` 递增而不清零；并验证"改顺序 / 手动切场景"两条手动路径清零 `roundCount`。

**API 行为变更**：`POST /api/orchestrator2-region-switch/select` 现在会顺带清 `failover.json` 的 `roundCount` / `roundFailed`（不动 `flips` / `lastFlipAt` / `haltedUntil`）；`POST …/failover {order}` 同样清这两项。其余接口形状不变。

**没有变的东西**：`failover.json` 仍是 `schemaVersion: 2`，v1 迁移逻辑、`enabled` 默认 `false`、"未启用时一个字节都不写 `model-routes.json`"全部照旧。

## 2.2.0

### 自动失效切换改为「按场景顺序轮转 + 整轮失败指数冷却」

**行为变更（破坏性）**：2.1.0 的「免费场景 ⇄ 收费场景 两点来回切」整套退场，换成**按顺序前进**：

- 没有「回切」这个概念了：tick **只**负责解除暂停，**从不切场景**；只有「当前场景失效」才会前进。
- 一圈走完又撞上**已经失败过**的场景 = 整轮没有一个可用 ⇒ 停手，进入指数冷却，期间不再轮转（避免无休止切换烧额度）。

**配置**（`<DSH_HOME>/orchestrator2/failover.json`，`schemaVersion` 升到 **2**）：

```json
{ "schemaVersion": 2, "enabled": false,
  "order": ["scene-1", "scene-2"],
  "perSceneProbeMin": 10, "roundCooldownMin": 30, "maxFlipsPerHour": 12,
  "currentIndex": 0, "lastFlipAt": null, "flips": [],
  "roundFailed": [], "haltedUntil": null, "roundCount": 0,
  "lastSignal": null }
```

| 字段 | 含义 | 默认 / 校验 |
| --- | --- | --- |
| `order` | 场景切换顺序（元素是 `model-routes.json` 现有 `scenarios[].id`） | 默认取现有场景顺序；非空、长度 ≥2、去重、每个 id 必须存在，否则 `saveConfig` 抛错（路由 400） |
| `currentIndex` | `order` 里当前生效场景的下标 | 必须与实际 `activeScenario` 一致；`loadConfig` 发现不一致就以 `activeScenario` 校正并回写 |
| `roundCooldownMin` | 整轮失败的**基准**冷却（分钟） | 30，范围 1~720 |
| `maxFlipsPerHour` | 滚动 60 分钟内允许的切换次数 | **12**（2.1.0 是 6），范围 1~60 |
| `perSceneProbeMin` | 探针窗口（分钟） | 10，范围 1~120。**v2 只记录，不参与判定** |
| `roundFailed` | 本轮已经失败过的场景 | 自动维护，切换成功时追加、整轮失败时清空 |
| `haltedUntil` / `roundCount` | 暂停到什么时候 / 本轮是第几轮失败 | 自动维护 |

**状态机**（纯函数 `decision(state, event, nowMs)`，判定顺序：`enabled` 闸 → `haltedUntil` 闸 → 滚动 1 小时上限闸 → `min-dwell` 闸 → 主逻辑）：

| 事件 | 条件 | 结果 | reason |
| --- | --- | --- | --- |
| 任意 | `enabled !== true` | `none` | `disabled` |
| signal | `now < haltedUntil` | `none` | `halted` |
| signal | 滚动 60 分钟 `flips` ≥ `maxFlipsPerHour` | `none` | `limit` |
| signal | 距 `lastFlipAt` < **120000 ms** | `none` | `min-dwell` |
| signal | 当前场景**未**在本轮失败集合里 | **switch-next**：记当前进 `roundFailed`，切到 `order[(i+1) % n]` | `scene-failed` |
| signal | 当前场景**已在**本轮失败集合里（= 一轮走完回到已失败场景） | **halt**：`roundCount += 1`、`haltedUntil = now + min(roundCooldownMin × 2^(roundCount−1), 720)` 分钟、`roundFailed = []`、**不切场景** | `round-failed` |
| tick（30s） | `haltedUntil !== null` 且 `now >= haltedUntil` | **resume**：只清 `haltedUntil`、`roundCount = 0` | `resume` |
| tick | 其它 | `none` | `idle` |

- 冷却阶梯：30 → 60 → 120 → 240 → 480 → **720 封顶**（分钟）。注意 `resume` 会把 `roundCount` 归零，所以按当前规则字面实现，**冷却档位不会跨暂停叠加**（每轮从 30 分钟重新起算）。
- 新增一条规范外的防御分支：`order` 少于 2 个（例如 `model-routes.json` 只剩一个场景）时无处可切 → `none` / `no-order`。`saveConfig` 已经禁止存这种顺序，这里只兜手改文件。
- 切换**仍只走 `region.js` 的 `selectScenario(id)`**（一次写齐 `scenarios` / `activeScenario` / 派生 `roles`）；`selectScenario` 抛错 → 记一条 warn、返回 `none` / `switch-failed`，**一个字节都不写**。
- `flips` 最多留 200 条；`reset: true` 清 `flips` / `lastFlipAt` / `roundFailed` / `haltedUntil` / `roundCount`。

**旧配置迁移（幂等）**：读到 `schemaVersion: 1`（含 `freeScene` / `paidScene`）时自动转成 v2——`order = [paidScene, freeScene]`（去重、丢掉不存在的 id）、`enabled` 保持原值、`cooldownMin` 改名成 `roundCooldownMin`、`flips` 里的 `free`/`paid` 映射成对应场景 id、`currentIndex` 按 `activeScenario` 定位，然后写回文件（v1 字段一律删除，第二次读到已是 v2 就不再改写）。

**API**：

- `GET /api/orchestrator2-region-switch/failover` → `{config, scenes:[{id,label,complete}], activeScenario, state:{currentIndex, currentScene, haltedUntil, roundFailed, roundCount, flips(最近 10)}}`
- `POST …/failover` → 体 `{enabled?, order?, perSceneProbeMin?, roundCooldownMin?, maxFlipsPerHour?, reset?}`；非法值 400；传了 2.1.0 的 `freeScene`/`paidScene` 会**被忽略**并在响应里带 `warning: "freeScene/paidScene 已废弃，请用 order"`。
- `POST …/failover/signal` → 体 `{reason, role?, code?}`，返回 `{ok, decision:{action,reason}, state}`。

**界面**：`设置 → 三角色主备模型切换` 里的「免费场景 / 收费场景」两个下拉换成**「切换顺序」列表**（每行「序号 + 场景下拉 + ↑ 上移 + ↓ 下移 + ✕ 移除」，底部「＋ 添加场景」，顺序变更立即 POST），状态行改为 `当前：<场景名>（第 i/n 个）· 最近翻转 <时间/从未> · 滚动 1 小时 <k> 次 · 本轮已失败 <m> 个`，暂停中追加 `· 已暂停至 <HH:MM>`。

**如何启用**（重启后）：

1. 重启 DSH（本版本首次加载），侧边栏「设置」→ 三角色主备模型切换 → 拉到「自动失效切换」。
2. 在「切换顺序」里排好场景（至少两个，失效时按这个顺序往下走），再勾「启用自动失效切换」。
3. 想验证：点「模拟限流（测试）」，状态行应该看到「当前」跳到下一个场景、「本轮已失败」+1；再点一次会继续往下走，绕回第一个已失败场景时出现「已暂停至 …」。「重置历史」清空这套记录。

**不碰的东西**：`model-routes.json` 的 `schemaVersion` 仍是 2，场景表结构没变；`failover-signal.json` 的 `schemaVersion` 恒为 1（那是预设的写者契约，与本模块状态版本无关，2.2.0 起两者彻底解耦）。

**自测**：`node tools/selftest-failover.mjs` → 91 项断言全 PASS，全程临时 `DSH_HOME` + 注入 `nowMs` 拨钟，末尾复核真实 `model-routes.json` 哈希未变。

## 2.1.0

### 自动失效切换：免费场景撞限流 → 自动切收费场景 → 冷却到点回切免费

不改数据模型（`model-routes.json` 还是 `schemaVersion: 2` 的场景表），新增一台**状态机 + 一个信号文件**：撞限流时它替你切到收费场景，冷却到点自动回切免费，全程不用手动点。

**默认关闭**（`enabled: false`）：没在界面里勾「启用自动失效切换」时，本插件**一个字节都不写** `model-routes.json`。

**两个文件**（都在 `<DSH_HOME>/orchestrator2/`，原子写 = 临时文件 + rename）：

- `failover.json` — 本插件的配置 + 状态（下面这张表就是它的字段）。
  ```json
  { "schemaVersion": 1, "enabled": false,
    "freeScene": "scene-2", "paidScene": "scene-1",
    "cooldownMin": 10, "maxFlipsPerHour": 6, "probeWindowMin": 10,
    "current": "free", "lastFlipAt": null, "backoffMin": 10,
    "flips": [{ "at": "…", "from": "free", "to": "paid", "reason": "rate_limit" }],
    "lastSignal": { "at": "…", "handledAt": "…", "reason": "rate_limit", "code": "RATE_LIMIT", "role": "reviewer" } }
  ```
- `failover-signal.json` — **由预设 `dsh-orchestrator2` 的 `route-fallback.mjs` 写**（真的撞上限流时），本插件 5 秒轮询一次读它：
  ```json
  { "schemaVersion": 1, "at": "<ISO>", "reason": "rate_limit", "code": "RATE_LIMIT", "role": "reviewer" }
  ```
  信号写失败被 `route-fallback` 内部 try/catch 吞掉（信号只是旁路，绝不影响降级主流程）。本插件**不删**信号文件（避免和写者竞态），只在 `failover.json` 的 `lastSignal.handledAt` 记处理时间；启动时先拿 mtime 做基线，重启不重放历史限流。

**状态机规则**（纯函数 `decision(state, event, nowMs)`，`nowMs` 由调用方给，所以自测能把时间拨快）：

| 事件 | 条件 | 动作 | reason |
| --- | --- | --- | --- |
| 任意 | 未启用 | `none` | `disabled` |
| signal | `reason !== 'rate_limit'` | `none` | `ignored` |
| signal | 已在收费场景 | `none` | `already-paid` |
| signal | 免费场景、距上次翻转 ≤ `probeWindowMin` | **切收费** + `backoffMin` 翻倍（上限 120） | `probe-failed` |
| signal | 距上次翻转 ≥ 2 分钟（最小驻留） | **切收费** | `rate_limit` |
| signal | 刚翻过还没过最小驻留 | `none` | `min-dwell` |
| tick（30s） | 不在收费场景 | `none` | `already-free` |
| tick | 距上次翻转 ≥ `backoffMin` | **回切免费** | `cooldown-elapsed` |
| tick | 还没到退避时间 | `none` | `cooling` |
| 任何 `switch-*` | 滚动 60 分钟内翻转数 ≥ `maxFlipsPerHour` | `none` | `limit` |

- 切换**只走 `region.js` 的 `selectScenario(id)`**：它内部 `persist()` 一次写齐 `scenarios` / `activeScenario` / 派生 `roles`，所以下一次派工读到的就是新场景——不重启、不碰会话状态。切失败（场景不存在 / 模型没选全）时 `current` 不动，只记一条 warn。
- `flips` 最多留 200 条；`reset: true` 清 `flips` / `lastFlipAt` / `backoffMin`（退避回到 `cooldownMin`）。
- 校验：`freeScene !== paidScene`、`cooldownMin ∈ [1,240]`、`maxFlipsPerHour ∈ [1,60]`、`probeWindowMin ∈ [1,120]`，越界/非整数直接抛错（界面显示原因，不静默夹断）；文件里的脏值回落默认，不让面板打不开。

**新接口**（全部复用 `isAllowed()` 信任围栏，错误一律 400）：

- `GET  api/orchestrator2-region-switch/failover` → `{ config, scenes: [{id,label,complete}], activeScenario }`
- `POST api/orchestrator2-region-switch/failover` → 体 `{ enabled?, freeScene?, paidScene?, cooldownMin?, maxFlipsPerHour?, probeWindowMin?, current?, reset? }`，返回新快照
- `POST api/orchestrator2-region-switch/failover/signal` → 体 `{ reason, role?, code? }`，按同一状态机裁决（界面「模拟限流（测试）」用它），返回 `{ …快照, decision }`

**界面**（三角色弹窗里新增一节「自动失效切换」）：启用勾选框、免费/收费场景下拉、冷却分钟、每小时上限、探针窗口、一行状态（当前=免费/收费 · 最近翻转时间 · 滚动 1 小时翻转次数）、「模拟限流（测试）」、「重置历史」。**这一节改一项立即存**（下面的「保存」只管场景表）。

**怎么启用**（默认关闭，三步）：

1. 重启 DSH（客户端半体改了，浏览器要重新加载插件）。
2. 侧边栏「设置」→ 三角色弹窗 → 找到「自动失效切换」，勾上「启用自动失效切换」。
3. 选好免费场景 / 收费场景（默认 免费 `scene-2` / 收费 `scene-1`），用「模拟限流（测试）」验一次：状态行应变成「当前：收费」，`<DSH_HOME>/orchestrator2/failover.json` 里 `flips` 多一条。

**版本**：`package.json` → 2.1.0（插件 id / 名字不变，`cordis.patch.yml` 未改）。预设侧的 `route-fallback.mjs` 新增 `emitFailoverSignal()`（三份副本内容一致）。

**自测**：`node tools/selftest-failover.mjs` → **SELF-TEST OK（53 项）**，全程在临时 `DSH_HOME` 里跑、真实 `model-routes.json` 哈希复核未变。

## 2.0.1

### 取消「最多 4 个场景」的限制

- 删掉宿主的 `SCENARIO_MAX = 4` 常量与相关校验（保存时的上限判断、`nextSceneId` 的搜索范围、读文件时的 `slice(0, SCENARIO_MAX)`）：现在场景表存多少就认多少。
- `+ 场景` 按钮不再到顶禁用（原先第 5 个就灰掉）；新场景 id 在 `1..N+64` 里取第一个空位，兜底 `scene-<时间戳36进制>`，连加几十个也不撞名。
- 自测：`node tools/selftest-host.mjs` → **SELF-TEST OK（50 项）**，新增「场景数量不设上限（12 个都存下）」「多场景时生效场景正确（scene-20）」；浏览器侧新增源码断言 `无场景数量上限`（源码里不再出现 `SCENARIO_MAX`）与 `新增场景按钮常开`（不再有 `scenes.length >= …` 的禁用条件）。
- 提示：TAB 多到一行放不下时自动换行（`STYLE.tabRow` 是 `flexWrap: 'wrap'`），不会把 TAB 挤掉；侧边栏始终只有「使用中」的那一行。

## 2.0.0

### 场景化：最多 4 个场景 TAB，每个场景一套三角色主备，单选「使用」

改的是数据模型，不只 UI：`model-routes.json` 从「全局一对主备 + cn/global 语义」升级为「多场景，每个场景 A/B 两侧」。

- **文件形状**（`schemaVersion: 2`）：
  ```json
  {
    "schemaVersion": 2,
    "activeScenario": "scene-1",
    "scenarios": [
      {
        "id": "scene-1",
        "labels": { "a": "国内", "b": "国际" },
        "primary": "a",
        "roles": {
          "researcher": { "a": { "provider": "…", "model": "…" }, "b": { "provider": "…", "model": "…" } },
          "reviewer":   { "a": { … }, "b": { … } },
          "developer":  { "a": { … }, "b": { … } }
        }
      }
    ],
    "roles": { "researcher": { "default": {…}, "fallback": {…} }, … }
  }
  ```
  最后那份派生 `roles` 给 dsh-orchestrator2 原样读（`default` = 当前 `primary` 那一侧、`fallback` = 另一侧），所以预设不用改。
- **TAB 文字自动 = 两侧名字拼`/`**（不再有独立场景名字段）；勾选「使用」是**单选**，被选中的 TAB 变色（品牌蓝底 + 下划线）；**三个角色任一侧没选全模型的场景，单选框禁用**并提示「三个角色的两侧模型都要选全，才能勾「使用」」。
- **侧边栏只显示使用中的那一个场景**的一行两个按钮；点按钮 = 把这套模型的 A/B 互换（`primary` 翻转），不是切 cn/global 前缀——这条也顺带解决了「国内/国际」名不副实的问题。
- **上限 4 个场景**（`SCENARIO_MAX = 4`），`+ 新增场景` 到顶后禁用；场景可删（至少留一个）。
- 宿主新增/改写的接口：`GET /state`（返回场景快照 + 派生 roles + 会话覆盖）、`POST /scenarios`（整份保存：场景表 + `activeScenario`）、`POST /select`（把某个场景设为使用中，未选全则拒）、`POST /switch`（`{side:'a'|'b'}` 设当前场景主槽）、`POST /adopt`（把会话级覆盖改回文件值）、`GET /catalog`、`GET /diag`、`GET /health`。
- **勾「使用」立即生效**（不等保存）：`POST /select {id}` 落盘并刷新侧边栏，模型改动仍走「保存」。宿主校验：三个角色两侧没选全就拒（`「场景一」还没选全模型（缺 researcher.a…），不能设为使用中的场景`），界面上单选框同时禁用。
- **旧文件自动迁移**：v1 的 `{roles, labels:{cn,global}, region}` 读进来即转成一个「场景一」（`labels.a`/`labels.b` 取原来两个名字，`primary` 由原 `default` 落在哪一侧决定），不写盘直到你保存一次。
- 会话级覆盖提示与「用当前设置覆盖它们」保留；修掉其「已覆盖 N 个会话」成功文案不显示的 bug（面板没订阅 `adoptStore`，改为 `useStore(adoptStore)`）。
- 自测：`node tools/selftest-host.mjs` → **SELF-TEST OK（49 项）**（含迁移、4 场景上限、未选全不可选、两侧互换、派生 roles、原子写、会话覆盖 adopt）；`node tools/simulate-client.cjs` → 形态断言全 true（`场景上限 4` / `TAB 文字=两名拼接` / `单选 radio` / `不完整禁用` / `保存整份场景表` / `两侧分列` / `侧边栏仅一行` / `无条件 hook`），行为断言 `[sidebar 点亮]` / `[切换请求] 体={"side":"b"}` / `[弹窗结构] TAB=2 单选=1 下拉=12 名称输入=2` / `[勾选即生效] 请求=POST 体={"id":"scene-1"}` / `[不完整场景] 单选禁用=true` / `[保存请求] 场景数=2 生效=scene-1` / `[覆盖结果] 成功文案=true` 全绿。

## 1.3.2

### 弹窗文案收敛：标题改「三角色主备模型切换」，两条长说明删掉

- `rolesTitle`：`三角色主备模型` → **`三角色主备模型切换`**（弹窗标题）。
- 删除 `swapHint`（「国内 / 国际」只对调带 cn: / global: 前缀的线路…其它分组原样保留）与 `labelsHint`（两个按钮只是名字，语义不变…留空恢复「国内 / 国际」）——两条词典键（zh / en）与两处渲染都删干净，`grep swapHint|labelsHint client.js` = 0 命中。
- 保留：`rolesDescription`（左右两列分别是主模型与备模型）、名称区标题「切换按钮名称」与两个输入框。
- 自测新增断言：`[弹窗结构] … 标题=三角色主备模型切换 … 旧提示残留=false …`（用 `/只对调带|两个按钮只是名字/` 正查残留），其余断言不变。

## 1.3.1

### 弹窗收拾：加关闭按钮、删「统一设置」、名称字段改叫「场景1 / 场景2 模式名称」

- **加关闭按钮**：弹窗标题右侧新增一个 `×`（`data-or2-region="dialog-close"`，`aria-label`/`title` 都是「关闭」），点它关弹窗——原先只有底部「取消」和点遮罩/Esc 两条路，标题区没有明显的关闭入口。
- **删「统一设置」整块**：连带 `unified` 状态、`setUnifiedField`、`unifiedTitle`/`unifiedHint`/`unifiedApply` 词典键一起删干净（`grep unified client.js` = 0 命中）。三个角色仍逐个改；要一次设同一对，先改一个再把值抄到另外两个——这个优化等确认真需要再加回来。
- **名称字段改名**：`labelCnField` → 「场景1模式名称」、`labelGlobalField` → 「场景2模式名称」；`labelsHint` 同步改成「场景 1（左）= 主槽走 cn: 线路，场景 2（右）= 走 global: 线路」，避免只靠「国内/国际」旧称理解。
- 弹窗规模变化：下拉框 16 → **12**（3 角色 × 主备 × 提供商/模型），文本框 2（两个名称输入框）。
- 自测：`[弹窗结构] 关闭按钮=true 关闭文案=× 统一设置区=false 场景1字段=true 场景2字段=true`、`[关闭按钮] 点击后弹窗数=0`、`[主备分列] 主模型表头=2 备模型表头=2 三列行=4`（1 表头 + 3 角色）、`[dialog·目录就绪] 下拉框=12 输入框=2`、`[名称区] 输入框=2 值=省钱模式/强力模式`、`[保存名称] … 角色数=3`，其余 1.3.0 断言不变。

## 1.3.0

### 两个切换按钮可以改名：设置里自定义「国内 / 国际」

- **为什么**：同一对按钮在不同场景下叫法不同（国内/国际、省钱/强力、本地/海外）。名字只是显示层，语义仍是「三角色主槽走 cn: 线路 / 走 global: 线路」。
- **数据层**：`model-routes.json` 新增可选顶层 `labels: { cn?: string, global?: string }`；`regionSnapshot()` 多带一个 `labels` 字段（没配就是 `null`，界面回落内建「国内 / 国际」）。
- **宿主**：新增 `readLabels()` / `writeLabels()`——改名走同一个 `POST /roles`（请求体多一个 `labels`，与三角色一次保存），原子写、只动 `labels` 与 `roles`，其它顶层字段原样保留。校验：只认 `cn` / `global` 两个键、必须是字符串、去空白后最多 16 个字；空串 = 恢复默认名（键直接删掉，不留空值）。
- **界面**：弹窗顶部新增「切换按钮名称」区，两个输入框分别对应原「国内」与原「国际」按钮，改完点「保存」一起写回；侧边栏那一行、主面板的两个按钮、切换成功提示与「当前主槽线路」都按自定义名显示。
- 自测：`tools/selftest-host.mjs` 新增第 8 节 9 条（默认无自定义名 / 改名 / changed 计数 / 读回 / 不动 roles / 空串只清一个 / 全清回默认 / 超长被拒 / 未知区域被拒）；`tools/simulate-client.cjs` 的 `/state` 桩带 `labels: {cn:'省钱模式', global:'强力模式'}`，新增 `[名称区]`（两个输入框回显这两个名）与 `[保存名称]`（保存请求体 `labels` 与界面一致、角色仍是 3 个），并把 `[sidebar 点亮]` 的段文案一起打出来（`文案=省钱模式/强力模式`）。

## 1.2.2

### 会话级覆盖可见化：面板标出「有会话不会跟随」，可一键覆盖

- **为什么需要**：三角色模型实际有两层来源——`<DSH_HOME>/orchestrator2/model-routes.json`（文件层，本插件管）与 `sessions/<会话ID>.json` 里每个角色的 `overrideRoute`（会话层，由调度器 `set_role_model` 写入）。会话层优先于文件层，所以有的会话里点「国内/国际」改了文件也不生效——这是实测过的第二个任务（`reviewer` 被钉在 `cn:step-5-preview`）。
- **新增只读扫描**：`regionSnapshot()` 现在带 `sessionOverrides: [{ sessionId, roles: { <角色>: { provider, model } } }]`，只列**确实有 `overrideRoute`** 的会话与角色（`scanSessionOverrides()` 读 `sessions/*.json`，解析失败的条目跳过、不写盘）。
- **面板多一块提示**：有覆盖时显示「有 N 个会话被会话级覆盖钉住（会话 ID 前 8 位）：它们改文件不会跟随，只有新派工才读文件才生效。」+ 按钮「用当前设置覆盖它们」。
- **新增写路由** `POST /api/orchestrator2-region-switch/adopt`（loopback 守卫同其它写路由）：把每个被钉住的会话的 `overrideRoute` 改成文件里的当前 `default`，`epoch` 递增、`degraded` 归位；文件里**没有**该角色线路时撤掉覆盖（否则它会一直钉在过期线路上）；原子写（`.pid.tmp` + rename），只动 `roles`，`children` 等字段原样保留。
- **口径说明**（界面文案里也写了）：覆盖只影响**后续新派工**；正在跑的子代理保持派工那一刻的快照。
- 自测：`tools/selftest-host.mjs` 新增第 7 节（扫出被钉住的会话 / 只列有覆盖的角色 / adopt 写回 / 文件有则改、无则撤 / epoch 递增 / 无覆盖的角色不动）；`tools/simulate-client.cjs` 的 `/state` 桩带 `sessionOverrides`，新增 `[会话覆盖提示]`、`[覆盖请求]`（POST `/adopt`）、`[覆盖结果]`（提示消失 + 「已覆盖 1 个会话」）三段断言。

## 1.2.1

### 候选目录与聊天窗模型选择器对齐

- **只列真有模型的分组**：`ctx.llm.listProviders()` 里注册了但 `listModels()` 取不到模型的 provider（缺凭据 / 被禁用，实测有 14 个：CodeBuddy、Cline、CodeArts、DeepSeek、Gemini、LobsterAI、Loomy、MiniMax、Qoder、Qoder 中国版、Raccoon、TRAE、WorkBuddy 国际版、ZCode）**不再进候选**——与 `buildModelCatalog` 的 `groups.filter(group => group.models.length > 0)` 完全一致。实测这台机器上剩下 3 组，正是聊天窗里的 `DeepSeek 账号` / `deepseek-official` / `Our Free Model`。被滤掉的写进响应的 `unavailable`（provider / label / message），只做诊断、不进 UI。
- **分组与模型显示的是注册表里的名字**：分组下拉用 `provider.name`（`DeepSeek 账号` 而不是 `deepseek-account`），模型下拉用 `model.name`（`Deepseek-V4.1-Flash(cn)` 而不是 `cn:deepseek-v4.1-flash`），选项 `value` 仍是 id —— 写进 `model-routes.json` 的是 preset 认识的那个 id。
- **没有 cn: / global: 前缀的角色不参与对调**：`swapToRegion` 只在「主槽已在目标区域」「备槽在目标区域」「主槽在另一区域」三种情况下动主备；两边都没有区域前缀（`DeepSeek 账号` 的 `deepseek-flash`、聚合线路的 `z-ai/glm-5.3` 等）时原样保留并计入 `skipped`，顶层 `region` 也不会被谎报成刚点的那个区域。面板在对调后多一行提示：`另有 N 个角色没有 cn: / global: 线路……未参与对调`。
- 自测：`tools/selftest-host.mjs` 新增 4 条（无前缀不 swapped / 计 skipped / 不动主槽 / 不谎报方向）与 3 条目录断言（排除无模型 provider、带展示名、只留可取模型的分组）；`tools/simulate-client.cjs` 新增 `[分组候选]`（分组名 = `DeepSeek 账号|deepseek-official`，模型名 = 显示名，值 = id）与 `[面板结果]` 断言。

## 1.2.0

### 语义纠正：国内 / 国际 = 对调三角色的主备，不再动主会话模型

- **滑块与按钮只改三角色主备**：`POST /switch {region}` 现在调 `swapToRegion`——把研究员 / 审核员 / 开发员的 `default`（主）与 `fallback`（备）对调，使主槽走目标区域的线路（`cn:` ↔ `global:`）。主槽已经是目标区域时幂等（`swapped: 0`，不改文件）；换完顺手写一条顶层 `region` 字段，模型名没有前缀时也能记住方向。**不再调用 `sessionController.selectModel`**，主会话用哪个模型完全由聊天窗的模型选择器决定。
- **不再需要会话身份**：滑块与面板都不再依赖 `useSessions`，「未取到当前会话」这条禁用路径整体消失——没有打开会话也能对调、也能改三角色配置。`/switch` 不再要求 `sessionId`。
- `region` 的语义从「模型名前缀（`cn:` / `global:`）」统一到「哪个区域的线路在主槽」，并新增 `mixed`（三角色主槽不一致）与 `null`（无前缀线路）两种状态，面板分别给出提示。
- **提供商 / 模型下拉改用宿主活体目录**：`GET /catalog` 改由 `ctx.llm.listProviders()` + `listModels(provider)` 提供——就是聊天窗模型选择器看到的那一份；`llm` 服务不可用时才回退到扫描 profile 的 `cordis*.yml`（`providers: { <name>: { models: [...] } }`），两种来源都在响应的 `sources` 里标明。仍会把 `model-routes.json` 里在用的路线补进候选，文件里的手写值不会被静默改掉。
- **弹窗改为主 / 备左右分列**：每行 `角色名 | 主模型列 | 备模型列`，每列是「提供商下拉 + 模型下拉」；「统一设置」区同样是主 / 备两列，一键填三行。换模型时旧的 `effort` 自动清空（交回提供商默认），保存时 `effort` 为空就不写进文件。
- 弹窗宽度 680 → 720px 以容纳两列；`_模板`/面板的「三角色主备只读表」同步改成两列布局。
- 桩测试（`tools/simulate-client.cjs`）随之更新：`/switch` 桩返回对调后的快照、断言 16 个下拉框 0 个输入框、主 / 备左右分列、面板无会话也更可点、侧边栏按 `config.region` 点亮、点击只 POST `{"region":...}`（不带 `sessionId`）。模型列在没选提供商时也渲染成禁用的下拉（提示「先选提供商」），避免一行里一半下拉一半输入框。
- 新增宿主半体离线自测 `tools/selftest-host.mjs`（临时 `DSH_HOME`，不启动 DSH）：`readCatalog` 走 `llm` 与回退扫 YAML 两条路径、`swapToRegion` 对调 / 幂等 / 还原、顶层 `region` 落盘、角色不完整时拒绝写入。顺手修掉扫描回退分支里 `models` 用 `Set` 而合并分支用 `Map` 导致的 `models.set is not a function`（目录为空时必现）。

## 1.1.5

- 修复：三角色弹窗点「设置」无反应。真因是 `RolesDialog` 里 `catalog` 那次 `useStore` 写在 `if (!dialog.open) return null;` **之后**——首次渲染 4 个 hook，打开后 5 个，React 抛 `Minified React error #310`（本轮已从 `/diag` 回流拿回该报文）。现在所有 hook 都在 early return 之前，hook 数恒定。
- 行内「设置」按钮：图标改**文字**、字号 11→12px、内边距 2/8→3/10px、底色 `.20`→`.26`（保留边框与 hover 反色），与左侧分段控件（品牌色）视觉分开；按钮显示短版「设置」，完整说明留在 `title` / `aria-label`（三角色模型设置）。
- 14 个输入框在目录未就绪时先渲染成**禁用的下拉框**（不再闪一下文本框再变下拉），宿主 `/catalog` 真取不到时才回退成手输。
- 自测 harness 新增两条断言：点行内「设置」后弹窗必须出现 16 个下拉框、0 个输入框；源码级 `无条件 hook` 守卫（early return 之后不允许再出现 hook 调用）。
## 1.1.4

### 侧边栏合并为一行：窄滑块 + 同一行的齿轮设置按钮

- 「三角色模型设置」不再占侧边栏单独一行：改成「国内 / 国际」那一行右侧的一枚齿轮按钮（`⚙`，`data-or2-region-gear`），点它直接打开三角色编辑弹窗（不经过中间面板）。
- 分段项收窄以腾出位置：内边距 `1px 10px → 1px 6px`，字号 `12px → 11px`，控件左外边距 `6px → 4px`。滑块块的定位仍按选中项的真实宽度与偏移算，收窄后不会错位。
- 会话未取到时只有两个分段项变灰禁用，齿轮仍可点（没有会话也能改三角色配置）。
- 行点击的接管范围收窄：只有落在滑块/齿轮上的点击才拦下，点这一行其它位置仍然会打开「国内 / 国际」主面板。
- 删掉已不可达的死代码：`SettingsPanel`（原 `<ns>.settings` 主面板）、`SettingsGlyph`、`makeSettingsRowEntry` 与其两条注册。
- 离线桩测试新增「同一行」源码级断言（齿轮属性/节点/开弹窗、分段收窄、`sidebar.panellist` 只剩一条注册），并去掉设置行/设置面板的用例。

## 1.1.3

### 三角色模型的提供商 / 模型改为点选 + 侧边栏两行相邻

- 三角色编辑弹窗里 16 个文本框全部换成下拉框：提供商（provider）下拉来自宿主新增的只读路由 `GET /api/orchestrator2-region-switch/catalog`（扫描 `cordis.patch.yml` + profile 组合树的 `llm-*` 插件 provider 及其 `models`，只读不写），模型（model）下拉按所选提供商联级给出候选；候选里没有的历史手写值仍会显示为第一项，不会被静默改掉。
- 换提供商时，若原模型不在新提供商的候选里，自动落到该提供商的第一个候选。
- 侧边栏「三角色模型设置」那一行的 `order` 由 34 改为 32，与「国内 / 国际」滑块行相同，两行在侧边栏里相邻（中间不再夹着别的行）。滑块行比侧边栏行宽、塞不下齿轮按钮，所以做成相邻两行而不是硬塞一行。
- 离线桩测试新增目录态检查：`.tmp/simulate.cjs` 里桩出 `/catalog` 响应后，弹窗渲染出 16 个下拉框、0 个文本框。

## 1.1.2

### 中文化 + 侧边栏新增「三角色模型设置」入口

- 界面文案固定中文：内置翻译器不再跟随 `document.lang` 猜测语言（`locale` 服务在受限 ctx 下取不到，之前会退成英文），`Provider / Model` 改译「提供商 / 模型」。
- 侧边栏新增第二行「三角色模型设置」（齿轮图标，`order: 34`），点进去是新的设置面板 `main`（key `<ns>.settings`）：显示研究员 / 审核员 / 开发员各自的主、备模型当前值，并有「设置三角色主备模型…」按钮打开同一个编辑弹窗。
- 设置面板与弹窗共用同一份 `model-routes.json` 状态；保存仍是原子写宿主文件。
- 离线桩测试（`.tmp/simulate.cjs`）覆盖：设置行 label/svg/order、设置面板三行 6 个模型值、按钮能打开弹窗（16 个输入框）、全部注册组件零异常。
## 1.1.1

### 修复：重启后侧边栏滑块与主面板都不出现

根因是 `client.js` 里一处解构写错，被 React 的错误边界在 effect 阶段吞掉，症状表现为「插件装了、宿主路由也活着，但界面什么都没有」。

- 出错点：`client.js` 侧边栏行的 effect 里 `for (const [value] of REGION_CHOICES)`。
  `REGION_CHOICES` 的元素是对象 `{ value, labelKey }`，用数组解构取 `[value]` 会抛
  `TypeError: .for is not iterable`（V8 对「解构不可迭代对象」的报文就长这样——对象上没有
  `Symbol.iterator`，报文取到的属性路径显示为 `.for`）。
- 修法：改为对象解构 `for (const { value } of REGION_CHOICES)`。
- 影响链：该行组件在 effect 抛错 → 错误边界降级渲染 `null` → 侧边栏那一行没有图标/控件 →
  滑块看不到；主面板要靠点这一行才能进入 → 面板也打不开。

### 新增：离线深渲染自测 `tools/simulate-client.cjs`

`node tools/simulate-client.cjs`

在假 DOM + 假 React（effect 立即执行）+ 假槽位 ctx 下真正递归渲染三个槽位组件并跑 effect，
覆盖「侧边栏行内控件生成 / 面板文案 / 面板按钮 / 三角色弹窗输入框与按钮」。它能在不重启宿主
的前提下复现本次这类运行时错误（回归验证：把 `for (const [value] …)` 改回去，harness 会打印
`EFFECT THROW [sidebar]: .for is not iterable`）。

### 诊断（保留）

宿主半体新增 `GET/POST /api/orchestrator2-region-switch/diag`：浏览器半体在
`factory-mount` / `apply-enter` / `slot-registered` / `slot-error` / `render-error` 五个位置回报，
进程内环形缓冲 300 条。排查「界面不出现」时可直接读它，无需用户开控制台。
