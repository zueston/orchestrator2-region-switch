/** 本插件用到的路径（唯一出处）。
 *
 * 单独成文件是为了让 `guard.js`（模型变更管控）与 `region.js`（数据层）都能读路径
 * 而不互相 import —— 否则两个模块会形成循环依赖。
 *
 * 目录布局（与 dsh-orchestrator2 preset 共用 <DSH_HOME>/orchestrator2/）：
 *
 *   model-routes.json   共享的角色线路表（preset 每次派工现读）——本插件是唯一写者
 *   scenarios.json      本插件独占的场景表（preset 不读不写）
 *   drift.json          「漂移放弃」记录
 *   guard.json          「模型变更管控（铁律）」开关 + 最近一次本插件写入的内容 + 回滚记录
 *   sessions/<id>.json  会话级覆盖（preset 写）
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** <DSH_HOME> 推导：显式环境变量优先（支持 ~ 展开），否则 ~/.dsh。
 *  与宿主自身的 dsh-home-paths 解析顺序一致，保证插件读写的目录就是宿主
 *  与 preset 读写的目录。 */
export function dshHome() {
	const env = process.env.DSH_HOME;
	if (typeof env === "string" && env.trim() !== "") {
		const expanded = env.startsWith("~") ? join(homedir(), env.slice(1)) : env;
		return resolve(expanded);
	}
	return join(homedir(), ".dsh");
}

/** <DSH_HOME>/orchestrator2/model-routes.json —— preset 每次派工现读的文件。 */
export function routesPath() {
	return join(dshHome(), "orchestrator2", "model-routes.json");
}

/** <DSH_HOME>/orchestrator2/scenarios.json —— 本插件**独占**的场景表（preset 不读不写）。 */
export function scenariosPath() {
	return join(dshHome(), "orchestrator2", "scenarios.json");
}

/** <DSH_HOME>/orchestrator2/drift.json —— 「哪个会话已放弃跟随」的记录。 */
export function driftPath() {
	return join(dshHome(), "orchestrator2", "drift.json");
}

/** <DSH_HOME>/orchestrator2/guard.json —— 模型变更管控（铁律）的状态。 */
export function guardPath() {
	return join(dshHome(), "orchestrator2", "guard.json");
}

/** 会话路由状态目录 `<DSH_HOME>/orchestrator2/sessions`。 */
export function sessionStatesDir() {
	return join(dshHome(), "orchestrator2", "sessions");
}
