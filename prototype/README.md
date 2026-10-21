# 原型说明：多场景 TAB · 三角色主备模型切换

原型文件：`prototype/scenario-tabs.html`（纯静态，双击即可在浏览器打开；不联网、不写任何配置）。

## 一句话

把现在「国内 / 国际」这一对全局按钮，改成**任意多个场景 TAB**：每个场景自带一套三角色主 / 备模型、自带两个按钮名，勾「使用」的场景才在侧边栏出现切换按钮；切换 = 该场景内主备对调。

## 交互（原型里都能点）

- **TAB 条**：`+ 新增场景`；TAB 名字直接改；绿点 = 已勾「使用」；当前生效的 TAB 标「生效中」。
- **每个场景**：A / B 两个按钮名 + 主备两列（研究员 / 审核员 / 开发员）+ 「使用」开关 + 「删除此场景」（至少留 1 个）。
- **侧边栏预览**：每个已启用场景一行，一行内两个分段按钮（该场景的两个名字），蓝框 = 当前生效场景；点未亮的一侧＝对调，点已亮的一侧＝只接管生效。
- **保存**：写 `scenarios` + 由当前生效场景派生的 `roles`（老字段保留，orchestrator2 无需改动）。

## 数据形状（`<DSH_HOME>/orchestrator2/model-routes.json`，schemaVersion 2）

```json
{
  "schemaVersion": 2,
  "activeScenario": "scene-1",
  "scenarios": [
    {
      "id": "scene-1",
      "name": "场景一",
      "enabled": true,
      "labels": { "a": "国内", "b": "国际" },
      "primary": "a",
      "roles": {
        "researcher": {
          "a": { "provider": "deepseek-official", "model": "cn:deepseek-v4.1-flash" },
          "b": { "provider": "deepseek-official", "model": "global:deepseek-v4.1-flash" }
        },
        "reviewer": { "a": { "provider": "deepseek-official", "model": "cn:step-5-preview" }, "b": { "provider": "deepseek-official", "model": "global:step-5-preview" } },
        "developer": { "a": { "provider": "deepseek-official", "model": "cn:deepseek-v4.1-flash" }, "b": { "provider": "deepseek-official", "model": "global:deepseek-v4.1-flash" } }
      }
    }
  ],
  "roles": {
    "researcher": { "default": { "provider": "deepseek-official", "model": "cn:deepseek-v4.1-flash" }, "fallback": { "provider": "deepseek-official", "model": "global:deepseek-v4.1-flash" } }
  }
}
```

关键点：

- **`a` / `b` 是两侧固定的模型集合**，`primary` 记录哪一侧现在占主槽。`labels` 挂在侧上，所以对调后名字不会跟错模型（这也是现在「国内 / 国际」能对调却不串线的原理，只是从全局一份变成每场景一份）。
- **`roles` 是派生字段**：`default = roles[primary]`、`fallback = roles[另一侧]`。写它只为兼容 orchestrator2（它只认 `roles`），不额外加新文件。
- 旧文件（schemaVersion 1，只有 `roles` + `region`）自动迁移：生成一个「场景一」，`labels` 取旧 `labels`（没有就用国内 / 国际），`primary` 由 `region` 推断（`cn` → a）。

## 待确认的取舍（原型里也写成 Q1–Q3）

1. **Q1 多个场景同时勾「使用」，谁生效？** 推荐：最后点的那个生效（侧边栏蓝框标出），其余按钮仍可点、点了接管。备选：只允许勾一个。
2. **Q2 主 / 备两列关系？** 推荐：两套独立模型集合，切换＝主槽指向另一侧（切回来还是原来那套）。
3. **Q3 上限与默认？** 推荐：最多 6 个场景；名字与按钮名各 16 字；留空回落「场景 N」「国内 / 国际」。

## 实现落点（确认后按此开发）

- 宿主 `host/region.js`：`scenarios` 读写 + 迁移 + 校验；`swapToScenario(id, side)` 只改 `primary` 再派生 `roles`；`readCatalog` 不变。
- 宿主 `host/routes.js`：`/state` 增 `scenarios`；`POST /scenarios`（全量保存）；`POST /switch` 改为 `{sceneId, side}`。
- `client.js`：弹窗从「一份主备 + 两个名字输入」改成 TAB + 每 TAB 表单；侧边栏行改成「每个已启用场景一行」，渲染方式沿用现有 DOM 注入与样式。
- 自测：`tools/selftest-host.mjs`（迁移、切换幂等、启用 / 停用、上限）＋ `tools/simulate-client.cjs`（TAB 渲染、勾选后侧边栏行数、对调、保存请求体）。
