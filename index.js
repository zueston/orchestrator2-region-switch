/** orchestrator2-region-switch 的宿主半体：国内 / 国际主会话模型 + 三角色主备表。
 *
 * 从同名旧插件（更早来自 dsh-switchman v1.7.0 的 host/orchestrator-region.js）
 * 演进而来。改名后职责是两件事：
 *
 *   1. 国内 / 国际 → 改**当前主会话的模型**（不再改三套角色路由）：浏览器半体送来
 *      { region, sessionId }，宿主用 sessionController.selectModel 完成「本会话下一轮
 *      生效 + 后台记住进程缺省」——宿主侧这一次调用同时做这两件事，没有只改会话不
 *      写缺省的独立入口。
 *   2. 三角色主备模型 → 只读展示 + 弹窗保存：读写
 *      <DSH_HOME>/orchestrator2/model-routes.json（preset 的权威模型表）。
 *
 * 不依赖 dsh-switchman 的任何模块，也不引入 schemastery Config：本插件没有用户
 * 可配项（配置面留给 preset 的数据文件本身）。
 *
 * 注入：webServer（注册 /api/orchestrator2-region-switch/*）。sessionController 用
 * ctx.get() 运行时按需取——取不到只让 /switch 回 503，不让整个插件因缺服务停摆。
 */

import { startFailoverLoop } from "./host/failover.js";
import { startGuardLoop } from "./host/guard.js";
import { applyRoutes } from "./host/routes.js";

/** 插件名（loader 侧的名字，与 package.json 的 name 一致）。 */
const name = "orchestrator2-region-switch";

/** 依赖的宿主服务：只需要 HTTP 注册面。 */
const inject = ["webServer"];

/** 插件入口。 */
function apply(ctx) {
	applyRoutes(ctx);
	// 自动失效切换：5s 轮询预设写的 failover-signal.json、30s 跑一次 tick 决策。
	// 状态文件里 enabled 默认 false，所以没启用时它什么都不写。
	startFailoverLoop(ctx);
	// 模型变更管控（铁律）：4s 巡检 model-routes.json，非本插件写入的内容立刻回滚。
	// 开关在 guard.json（默认开），界面里可以关掉。
	startGuardLoop(ctx);
}

export { apply, inject, name };
