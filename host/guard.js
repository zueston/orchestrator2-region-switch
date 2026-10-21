/** 模型变更管控（铁律）：`model-routes.json` 只允许**本插件**写。
 *
 * 为什么需要：这个文件是全 DSH 共享的角色线路表，会话里用 preset 自带的
 * 「设置角色模型」工具（`set_role_model`）或手改文件，都会把它改成和界面上的场景
 * 不一致，于是派工出来的模型跟界面上看到的不是一回事。本模块把「本插件最后一次写入
 * 的内容」记成权威内容，之后文件只要不一样就判定为外部改动：
 *
 * - 管控开（默认）：立刻把权威内容写回去，并记一条回滚记录（时间 + 差在哪几个角色）。
 * - 管控关：只观察，不改文件（界面上仍会显示漂移提示，由用户自己决定怎么处理）。
 *
 * 想改模型就走本插件（场景表 / 侧边栏切换）；确实要让会话自己改，就到本插件里把
 * 这个开关关掉 —— 这就是「铁律 + 逃生门」。
 *
 * 注意：本模块**只管 model-routes.json**。preset 写 `sessions/<id>.json` 的会话级覆盖
 * 与自动降级（degraded / fallbackRoute）属于运行期韧性，不在管控范围内。
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { guardPath, routesPath } from "./paths.js";

const NS = "orchestrator2-region-switch";
const GUARD_SCHEMA_VERSION = 1;
/** 轮询间隔：4s 够快（下一次派工前基本都能拦住），又不至于把磁盘吵醒。 */
const POLL_MS = 4000;
/** 回滚记录只留最近这么多条（文件要能随手打开看）。 */
const REVERT_LIMIT = 20;

let pollTimer = null;

/** 内容指纹（只看内容，不看 mtime —— 复制粘贴同内容不该算改动）。 */
function hashOf(text) {
	return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** 读 guard.json（坏文件当空对象，不抛）。 */
function readGuardRaw() {
	try {
		const data = JSON.parse(readFileSync(guardPath(), "utf8"));
		if (data === null || typeof data !== "object" || Array.isArray(data)) return {};
		return data;
	} catch {
		return {};
	}
}

/** 原子写 guard.json。 */
function writeGuardRaw(data) {
	const path = guardPath();
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
	renameSync(tmp, path);
}

/** 管控是否开着（缺字段 = 开，铁律默认生效）。 */
export function guardEnabled() {
	const data = readGuardRaw();
	return data.enabled === undefined ? true : data.enabled === true;
}

/** 把 model-routes.json 的**当前内容**记成权威内容（本插件自己写完就调用它）。 */
export function rememberRoutesWrite() {
	let content;
	try {
		content = readFileSync(routesPath(), "utf8");
	} catch {
		// 文件还不存在（例如首次播种失败）：等下一次写入再记。
		return;
	}
	const data = readGuardRaw();
	data.schemaVersion = GUARD_SCHEMA_VERSION;
	if (data.enabled === undefined) data.enabled = true;
	data.last = { hash: hashOf(content), content, at: new Date().toISOString() };
	writeGuardRaw(data);
}

/** 给界面看的快照。 */
export function guardSnapshot() {
	const data = readGuardRaw();
	return {
		enabled: data.enabled === undefined ? true : data.enabled === true,
		path: guardPath(),
		lastAt: typeof data.last?.at === "string" ? data.last.at : null,
		reverts: Array.isArray(data.reverts) ? data.reverts.slice(-REVERT_LIMIT) : [],
	};
}

/** 开关管控。打开时以「当前文件」为基线（否则会立刻把用户刚才的改动回滚掉）。 */
export function setGuardEnabled(enabled) {
	const data = readGuardRaw();
	data.schemaVersion = GUARD_SCHEMA_VERSION;
	data.enabled = enabled === true;
	if (data.enabled) {
		try {
			const content = readFileSync(routesPath(), "utf8");
			data.last = { hash: hashOf(content), content, at: new Date().toISOString() };
		} catch {
			delete data.last;
		}
	}
	writeGuardRaw(data);
	return guardSnapshot();
}

/** 从文件内容里取 roles（坏 JSON 当空表）。 */
function rolesOf(text) {
	try {
		const data = JSON.parse(text);
		const roles = data?.roles;
		return roles !== null && typeof roles === "object" && !Array.isArray(roles) ? roles : {};
	} catch {
		return {};
	}
}

/** 一条线路的可比较形态。 */
function routeLine(entry) {
	const primary = entry?.default ?? entry;
	const fallback = entry?.fallback;
	const line = (route) => (route === undefined ? "" : `${route?.provider ?? ""}/${route?.model ?? ""}`);
	return `${line(primary)}|${line(fallback)}`;
}

/** 两份 roles 差在哪些角色上。 */
function diffRoles(before, after) {
	const out = [];
	for (const role of new Set([...Object.keys(before), ...Object.keys(after)])) {
		if (routeLine(before[role]) !== routeLine(after[role])) out.push(role);
	}
	return out;
}

/**
 * 一次巡检：文件内容与本插件上次写入的不一样就是外部改动。
 *
 * @param {object} [ctx] cordis 上下文（只用于打日志）
 * @returns {{action: "absent"|"baseline"|"same"|"observed"|"reverted", roles?: string[]}}
 */
export function checkOnce(ctx) {
	const data = readGuardRaw();
	const enabled = data.enabled === undefined ? true : data.enabled === true;
	let content;
	try {
		content = readFileSync(routesPath(), "utf8");
	} catch {
		return { action: "absent" };
	}
	const hash = hashOf(content);
	if (typeof data.last?.hash !== "string" || typeof data.last?.content !== "string") {
		// 还没有基线（插件刚装上 / 文件刚被删了重建）：把当前内容当基线，不算外部改动。
		data.schemaVersion = GUARD_SCHEMA_VERSION;
		if (data.enabled === undefined) data.enabled = true;
		data.last = { hash, content, at: new Date().toISOString() };
		writeGuardRaw(data);
		return { action: "baseline" };
	}
	if (hash === data.last.hash) return { action: "same" };

	const roles = diffRoles(rolesOf(data.last.content), rolesOf(content));
	if (!enabled) {
		// 管控关着：不动文件、也不更新基线（否则下次就认不出这份改动了）。
		return { action: "observed", roles };
	}
	const path = routesPath();
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, data.last.content, "utf8");
	renameSync(tmp, path);
	const at = new Date().toISOString();
	data.reverts = [...(Array.isArray(data.reverts) ? data.reverts : []), { at, roles, foreignHash: hash }].slice(-REVERT_LIMIT);
	writeGuardRaw(data);
	ctx?.logger?.warn?.(
		`${NS}: 外部改写了 model-routes.json（角色：${roles.length === 0 ? "未知" : roles.join("、")}），已按铁律回滚`,
	);
	return { action: "reverted", roles };
}

/** 停掉巡检（幂等）。 */
export function stopGuardLoop() {
	if (pollTimer !== null) {
		clearInterval(pollTimer);
		pollTimer = null;
	}
}

/**
 * 起巡检循环（通过 `ctx.effect` 挂到插件生命周期，卸载即清理）。
 *
 * @param {object} ctx cordis 上下文
 * @returns {() => void} disposer
 */
export function startGuardLoop(ctx) {
	const start = () => {
		stopGuardLoop();
		// 先跑一次：插件热重载后立刻把「插件不在时被改的文件」也校正过来。
		try {
			checkOnce(ctx);
		} catch (error) {
			ctx?.logger?.warn?.(`${NS}: guard bootstrap error: ${String(error?.message ?? error)}`);
		}
		pollTimer = setInterval(() => {
			try {
				checkOnce(ctx);
			} catch (error) {
				// 巡检异常绝不能让插件停摆。
				ctx?.logger?.warn?.(`${NS}: guard loop error: ${String(error?.message ?? error)}`);
			}
		}, POLL_MS);
		pollTimer.unref?.();
		return () => stopGuardLoop();
	};
	if (typeof ctx?.effect === "function") {
		ctx.effect(start, `${NS}: guard loop`);
		return () => stopGuardLoop();
	}
	return start();
}
