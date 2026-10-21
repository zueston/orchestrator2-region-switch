/** 「自动开发调度器 2.0」(dsh-orchestrator2) 的模型数据层（orchestrator2-region-switch）。
 *
 * 该 preset 的唯一权威模型表是 <DSH_HOME>/orchestrator2/model-routes.json。v2.0.0
 * 起文件里存的是**场景**（TAB），每个场景一套「A 侧 / B 侧」三角色模型：
 *
 *   { schemaVersion: 2,
 *     activeScenario: "scene-1",
 *     scenarios: [
 *       { id: "scene-1",
 *         labels: { a: "国内", b: "国际" },      // 两个切换按钮的名字（可改）
 *         primary: "a",                          // 现在是哪一侧占主槽
 *         roles: { researcher: { a: Route, b: Route }, reviewer: …, developer: … } } ],
 *     roles: { <role>: { default: Route, fallback: Route } } }    // ← 派生，给 preset 读
 *   Route = { provider, model, effort? }
 *
 * - preset 只读 `roles`（default / fallback），所以每次改场景都要重新派生它；
 *   本模块是唯一写者，derived roles 永远由 activeScenario + primary 推出。
 * - 侧边栏的切换按钮 = 把 active 场景的 primary 在 a / b 之间翻面（主备对调），
 *   不碰主会话模型（主会话模型由聊天窗的模型选择器决定，与本插件无关）。
 * - 一个场景只有三个角色的两侧都选全了才能被勾「使用」（不能激活不完整的场景）。
 * - v1 文件（roles + labels + region）读入时自动迁移成一个「场景一」，写入时落成 v2。
 *
 * 写入都是原子的（临时文件 + rename），并保留文件里本模块不认识的顶层字段。
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** preset 里被派工的角色；文件里出现的其它角色原样保留。 */
export const ROLES = ["researcher", "reviewer", "developer"];
/** 两个可选区域（= 模型名前缀）。 */
export const REGIONS = ["cn", "global"];
/** 场景里的两侧；主槽指向哪一侧由 primary 记录。 */
export const SIDES = ["a", "b"];
/** 两侧的默认名字（留空时回落）。 */
const DEFAULT_LABELS = { a: "国内", b: "国际" };
const CN_PREFIX = "cn:";
const GLOBAL_PREFIX = "global:";

/** 文件缺席时的兜底播种路线（国内主、国际备），保证面板始终有内容。 */
const FALLBACK_MAIN = { provider: "deepseek-official", model: "cn:deepseek-v4.1-flash" };
const FALLBACK_REVIEW = { provider: "deepseek-official", model: "cn:step-5-preview" };

import { dshHome, driftPath, routesPath, scenariosPath, sessionStatesDir } from "./paths.js";
import { guardSnapshot, rememberRoutesWrite } from "./guard.js";

export { dshHome, driftPath, routesPath, scenariosPath, sessionStatesDir };

/** 模型名前缀 → 区域；其它线路（含无前缀）→ null。 */
export function regionOfModel(model) {
	if (typeof model !== "string") return null;
	if (model.startsWith(CN_PREFIX)) return "cn";
	if (model.startsWith(GLOBAL_PREFIX)) return "global";
	return null;
}

/** 只保留 { provider, model, effort? }；effort 省略 = 不传 reasoningEffort。 */
function cleanRoute(entry) {
	if (entry === null || typeof entry !== "object") return null;
	const provider = typeof entry.provider === "string" ? entry.provider.trim() : "";
	const model = typeof entry.model === "string" ? entry.model.trim() : "";
	if (provider === "" || model === "") return null;
	const route = { provider, model };
	const effort = typeof entry.effort === "string" ? entry.effort.trim() : "";
	if (effort !== "") route.effort = effort;
	return route;
}

/** 同一 provider 上把模型名换到另一区（cn:↔global:）；无前缀时 null。 */
function counterpartOf(route) {
	if (route === null) return null;
	const region = regionOfModel(route.model);
	if (region === null) return null;
	const rest = route.model.slice(region === "cn" ? CN_PREFIX.length : GLOBAL_PREFIX.length);
	return { ...route, model: (region === "cn" ? GLOBAL_PREFIX : CN_PREFIX) + rest };
}

/** 原始读取（保留整份对象，供写入时合并其它字段）。 */
function readRaw() {
	const path = routesPath();
	if (!existsSync(path)) {
		return { path, exists: false, data: null, error: null };
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
			return { path, exists: true, data: null, error: "model-routes.json 的顶层不是对象" };
		}
		return { path, exists: true, data: parsed, error: null };
	} catch (error) {
		return { path, exists: true, data: null, error: `unreadable model-routes.json: ${error?.message ?? error}` };
	}
}

/** 读场景表文件（不存在 / 顶层不是对象 / 坏 JSON → data=null，不抛）。 */
function readScenariosRaw() {
	const path = scenariosPath();
	if (!existsSync(path)) return { path, exists: false, data: null, error: null };
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
			return { path, exists: true, data: null, error: "scenarios.json 的顶层不是对象" };
		}
		return { path, exists: true, data: parsed, error: null };
	} catch (error) {
		return { path, exists: true, data: null, error: `unreadable scenarios.json: ${error?.message ?? error}` };
	}
}

/** 原子写 JSON（临时文件 + rename）。 */
function writeJsonAtomic(path, data) {
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.${process.pid}.tmp`;
	writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
	renameSync(temp, path);
}

/**
 * 读「场景表（我们独占）+ model-routes.json 的 roles（preset 的地盘）」两处并归一化。
 *
 * 场景表缺席时按顺序迁移，并把结果立刻落盘：
 *   ① 旧单文件 v2（顶层带 `scenarios`）→ 摘出场景表；
 *   ② v1（roles + labels + region）→ 迁成一个「场景一」；
 *   ③ 两个文件都没有 → 播种一份默认场景。
 * 迁移完 model-routes.json 会被改写成 preset 原生的 v1 形状（只留 roles）。
 *
 * @returns {{scenarios: Array<object>, activeId: string, migrated: boolean, seeded: boolean,
 *            rolesInFile: object, routes: object, scene: object, error: string|null}}
 */
function loadState() {
	const routes = readRaw();
	const scene = readScenariosRaw();
	const rolesInFile = normalizeRoles(routes.data?.roles);
	const error = routes.error ?? scene.error;

	if (scene.data !== null) {
		const { scenarios } = scenariosOf(scene.data);
		const wanted = typeof scene.data.activeScenario === "string" ? scene.data.activeScenario : null;
		const activeId = scenarios.some((entry) => entry.id === wanted) ? wanted : scenarios[0].id;
		return { scenarios, activeId, migrated: false, seeded: false, rolesInFile, routes, scene, error };
	}

	const hasRoutes = routes.exists && routes.data !== null;
	const scenarios = scenariosOf(hasRoutes ? routes.data : null).scenarios;
	const seeded = !hasRoutes;
	const migrated = hasRoutes;
	const wanted = typeof routes.data?.activeScenario === "string" ? routes.data.activeScenario : null;
	const activeId = scenarios.some((entry) => entry.id === wanted) ? wanted : scenarios[0].id;
	try {
		persist(scenarios, activeId);
	} catch {
		// 落盘失败不影响读：本次按内存结果返回，下次再迁移一次。
	}
	return { scenarios, activeId, migrated, seeded, rolesInFile, routes, scene, error };
}

/** 派生 roles 与文件里 roles 的差异角色清单（外部改过 model-routes.json 时非空）。 */
function driftOf(derived, inFile) {
	const out = [];
	for (const role of ROLES) {
		const want = derived[role];
		const have = inFile[role];
		if (want === undefined || have === undefined) {
			if (want !== undefined || have !== undefined) out.push(role);
			continue;
		}
		const same =
			want.default.provider === have.default.provider &&
			want.default.model === have.default.model &&
			(want.default.effort ?? null) === (have.default.effort ?? null) &&
			want.fallback.provider === have.fallback.provider &&
			want.fallback.model === have.fallback.model &&
			(want.fallback.effort ?? null) === (have.fallback.effort ?? null);
		if (!same) out.push(role);
	}
	return out;
}

/** 只把成对完整的角色暴露给客户端 / 写入文件。 */
function normalizeRoles(roles) {
	const out = {};
	for (const role of Object.keys(roles ?? {})) {
		const primary = cleanRoute(roles[role]?.default);
		const fallback = cleanRoute(roles[role]?.fallback);
		if (primary !== null && fallback !== null) out[role] = { default: primary, fallback };
	}
	return out;
}

/**
 * 当前快照（客户端唯一的读入口）：
 * { path, exists, seeded, migrated, activeScenario, scenarios, roles, warning, error, sessionOverrides }
 * - `scenarios[i]` 额外带 `label`（TAB 文字 = "A名/B名"）、`complete`、`missing`
 * - `roles` 是**给 preset 读的派生表**：active 场景完整时由它推出；不完整时沿用
 *   文件现值（不静默改线），并在 `warning` 里报 `active-incomplete`。
 *
 * @returns {object} plain JSON snapshot for the client half.
 */
export function stateSnapshot() {
	const state = loadState();
	const active = state.scenarios.find((scene) => scene.id === state.activeId) ?? state.scenarios[0];
	const status = scenarioStatus(active);
	const derived = derivedRoles(active);
	const roles = status.complete || Object.keys(state.rolesInFile).length === 0 ? derived : state.rolesInFile;
	const driftRoles = status.complete ? driftOf(derived, state.rolesInFile) : [];
	// 漂移的「会话归属」：只有被 overrideRoute 钉住、且与场景派生值不一致的会话才会列出来。
	const driftList = driftRoles.length === 0 ? [] : driftSessions(derived, state.rolesInFile);
	let routesMtime = null;
	try {
		routesMtime = statSync(routesPath()).mtime.toISOString();
	} catch {
		routesMtime = null;
	}
	return {
		path: routesPath(),
		scenariosPath: scenariosPath(),
		driftPath: driftPath(),
		routesMtime,
		exists: state.routes.exists,
		scenariosExists: state.scene.exists,
		seeded: state.seeded,
		migrated: state.migrated,
		activeScenario: active.id,
		scenarios: state.scenarios.map((scene) => ({ ...scene, label: tabLabel(scene), ...scenarioStatus(scene) })),
		roles,
		drift: driftRoles.length > 0,
		driftRoles,
		driftSignature: driftSignature(state.rolesInFile),
		driftSessions: driftList,
		// 模型变更管控（铁律）：开关状态 + 最近回滚记录（界面里那一节用它）。
		guard: guardSnapshot(),
		warning: status.complete ? null : "active-incomplete",
		error: state.error,
		sessionOverrides: scanSessionOverrides(),
	};
}

// ---------------------------------------------------------------------------
// 会话级覆盖的可见性（dsh-orchestrator2 的 sessions/<主会话>.json）
// ---------------------------------------------------------------------------

/**
 * 扫出「被会话级覆盖钉住」的会话。dsh-orchestrator2 的解析顺序是
 * `degraded → fallback`、`overrideRoute → 覆盖`、否则 `model-routes.json 的 default`，
 * 所以**有 overrideRoute 的会话不会跟随本文件**——这里把这种会话列出来给面板提示。
 *
 * @returns {Array<{sessionId: string, roles: object}>} 只含有覆盖的会话
 */
export function scanSessionOverrides() {
	const dir = sessionStatesDir();
	let names;
	try {
		names = readdirSync(dir);
	} catch {
		return [];
	}
	const out = [];
	for (const name of names) {
		if (!name.endsWith(".json") || name.includes(".bak-")) continue;
		let data;
		try {
			data = JSON.parse(readFileSync(join(dir, name), "utf8"));
		} catch {
			continue;
		}
		const roles = data?.roles;
		if (roles === null || typeof roles !== "object") continue;
		const overridden = {};
		for (const role of ROLES) {
			const route = cleanRoute(roles[role]?.overrideRoute);
			if (route !== null) overridden[role] = route;
		}
		if (Object.keys(overridden).length === 0) continue;
		out.push({
			sessionId: typeof data.sessionId === "string" && data.sessionId !== "" ? data.sessionId : name.replace(/\.json$/u, ""),
			roles: overridden,
		});
	}
	return out;
}

/**
 * 用 model-routes.json 的当前 default 覆盖掉各会话的 overrideRoute
 * （语义对齐 dsh-orchestrator2 的 `set_role_model scope=session`：epoch+1、degraded 清掉）。
 *
 * @returns {{updated: number, sessions: Array<object>}} 写成功的会话数与最新快照
 */
export function adoptSessionOverrides() {
	const defaults = normalizeRoles(stateSnapshot().roles);
	let updated = 0;
	for (const entry of scanSessionOverrides()) {
		const path = join(sessionStatesDir(), `${entry.sessionId}.json`);
		let data;
		try {
			data = JSON.parse(readFileSync(path, "utf8"));
		} catch {
			continue;
		}
		if (data?.roles === null || typeof data.roles !== "object") continue;
		for (const role of Object.keys(entry.roles)) {
			const route = defaults[role]?.default;
			const epoch = Number.isInteger(data.roles[role]?.epoch) ? data.roles[role].epoch + 1 : 1;
			if (route === undefined) {
				// 文件里没有这个角色的线路（例如只配了审核员）——留着旧覆盖只会让它
				// 继续钉在过期线路上，所以撤掉覆盖，让它回落到正常解析。
				delete data.roles[role].overrideRoute;
				data.roles[role].epoch = epoch;
				continue;
			}
			data.roles[role] = { epoch, degraded: false, overrideRoute: { provider: route.provider, model: route.model } };
		}
		const tmp = `${path}.${process.pid}.tmp`;
		writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
		renameSync(tmp, path);
		updated += 1;
	}
	return { updated, sessions: scanSessionOverrides() };
}

// ---------------------------------------------------------------------------
// 漂移（model-routes.json 被外部改动）的会话归属与处置
// ---------------------------------------------------------------------------

/** 读「已放弃」名单（坏文件当空表，不抛）。 */
function readDismissed() {
	try {
		const data = JSON.parse(readFileSync(driftPath(), "utf8"));
		const dismissed = data?.dismissed;
		return dismissed !== null && typeof dismissed === "object" ? dismissed : {};
	} catch {
		return {};
	}
}

/** 写「已放弃」名单（原子写）。 */
function writeDismissed(map) {
	writeJsonAtomic(driftPath(), { schemaVersion: 1, dismissed: map });
}

/** model-routes.json 里 roles 的内容指纹：文件一变，旧的「放弃」就失效（要重新问一次）。 */
function driftSignature(rolesInFile) {
	return createHash("sha256").update(JSON.stringify(rolesInFile ?? {})).digest("hex").slice(0, 12);
}

/** 目录名里的 `~XXXX~` 是 UTF-16 码元的十六进制（`~6587~` → 「文」）。 */
function decodeWorkspaceName(raw) {
	const trimmed = raw.replace(/^--/u, "").replace(/--$/u, "");
	return trimmed.replace(/~([0-9A-Fa-f]{4})~/gu, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * 把 `--C-Users-demo-plugin--` 还原成可读路径。
 * 目录名用 `-` 当分隔符，而真实目录名里也可能有 `-`，所以按「最长可存在的组合」
 * 贪心拼接；拼不出来（工作区已删）就退化成朴素拼接，至少能看出是哪个盘哪个目录。
 */
function readableWorkspace(raw) {
	const decoded = decodeWorkspaceName(raw);
	const tokens = decoded.split("-");
	if (tokens.length < 2 || !/^[A-Za-z]$/u.test(tokens[0])) return decoded;
	let current = `${tokens[0]}:`;
	let index = 1;
	while (index < tokens.length) {
		let matched = false;
		for (let end = tokens.length; end > index; end -= 1) {
			const candidate = join(current, tokens.slice(index, end).join("-"));
			if (existsSync(candidate)) {
				current = candidate;
				index = end;
				matched = true;
				break;
			}
		}
		if (!matched) {
			current = join(current, tokens[index]);
			index += 1;
		}
	}
	return current;
}

/**
 * 会话 → 工作区映射。DSH 把会话存在 `<DSH_HOME>/sessions/--<工作区>--/<会话>/`，
 * 目录名就是唯一的工作区线索（会话目录里只有压缩后的会话流）。
 *
 * @returns {Map<string, {workspace: string, raw: string}>} key 去掉 `session-` 前缀的会话 id
 */
export function sessionWorkspaces() {
	const out = new Map();
	let names;
	try {
		names = readdirSync(join(dshHome(), "sessions"));
	} catch {
		return out;
	}
	for (const workspaceDir of names) {
		if (!workspaceDir.startsWith("--")) continue;
		let sessions;
		try {
			sessions = readdirSync(join(dshHome(), "sessions", workspaceDir));
		} catch {
			continue;
		}
		const readable = readableWorkspace(workspaceDir);
		for (const sessionDir of sessions) {
			const id = sessionDir.replace(/^session-/u, "");
			out.set(id, { workspace: readable, raw: workspaceDir });
		}
	}
	return out;
}

/** 两个线路是否同一条（provider + model + effort）。 */
function sameRoute(left, right) {
	return (
		left !== null &&
		right !== null &&
		left.provider === right.provider &&
		left.model === right.model &&
		(left.effort ?? null) === (right.effort ?? null)
	);
}

/**
 * 漂移的「会话归属」：哪些会话因为**自己的 overrideRoute** 与当前场景派生值不一致，
 * 行为会和场景表不同。已经「放弃」过（且文件内容没再变）的会话不再列出。
 *
 * @param {object} derived 当前生效场景派生的 roles
 * @param {object} rolesInFile model-routes.json 里的 roles（决定「放弃」是否还有效）
 * @returns {Array<{sessionId: string, shortId: string, workspace: string, roles: string[],
 *                  overrides: object, dismissed: boolean}>}
 */
export function driftSessions(derived, rolesInFile) {
	const signature = driftSignature(rolesInFile);
	const dismissed = readDismissed();
	const workspaces = sessionWorkspaces();
	const out = [];
	for (const entry of scanSessionOverrides()) {
		const differs = [];
		for (const role of Object.keys(entry.roles)) {
			const want = derived?.[role]?.default ?? null;
			if (!sameRoute(entry.roles[role], want)) differs.push(role);
		}
		if (differs.length === 0) continue;
		const key = entry.sessionId.replace(/^session-/u, "");
		const meta = workspaces.get(key);
		out.push({
			sessionId: entry.sessionId,
			shortId: key.slice(0, 8),
			workspace: meta?.workspace ?? null,
			workspaceRaw: meta?.raw ?? null,
			roles: differs,
			overrides: entry.roles,
			dismissed: dismissed[entry.sessionId] === signature,
		});
	}
	return out;
}

/** 把当前场景派生值写进某个会话的 overrideRoute（= 该会话也按场景走），epoch+1。 */
export function applyScenarioToSession(sessionId) {
	if (typeof sessionId !== "string" || sessionId === "") throw new Error("缺少 sessionId");
	const safe = sessionId.replace(/^session-/u, "");
	const path = join(sessionStatesDir(), `session-${safe}.json`);
	if (!existsSync(path)) throw new Error(`会话状态文件不存在：${path}`);
	const data = JSON.parse(readFileSync(path, "utf8"));
	if (data?.roles === null || typeof data.roles !== "object") throw new Error("会话状态里没有 roles");
	const derived = normalizeRoles(stateSnapshot().roles);
	let changed = 0;
	for (const role of ROLES) {
		const slot = data.roles[role];
		if (slot === null || typeof slot !== "object") continue;
		if (slot.overrideRoute === undefined) continue;
		const want = derived[role]?.default;
		const epoch = Number.isInteger(slot.epoch) ? slot.epoch + 1 : 1;
		if (want === undefined) {
			delete slot.overrideRoute;
			slot.epoch = epoch;
			changed += 1;
			continue;
		}
		if (sameRoute(cleanRoute(slot.overrideRoute), want)) continue;
		slot.overrideRoute = { provider: want.provider, model: want.model, ...(want.effort ? { effort: want.effort } : {}) };
		slot.epoch = epoch;
		slot.degraded = false;
		changed += 1;
	}
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
	renameSync(tmp, path);
	return { sessionId: sessionId.startsWith("session-") ? sessionId : `session-${safe}`, changed };
}

/** 记下「这个会话放弃跟随」（对当前文件内容有效；文件再变会重新提示）。 */
export function dismissSessionDrift(sessionId) {
	if (typeof sessionId !== "string" || sessionId === "") throw new Error("缺少 sessionId");
	const rolesInFile = normalizeRoles(readRaw().data?.roles);
	const map = readDismissed();
	map[sessionId] = driftSignature(rolesInFile);
	writeDismissed(map);
	return { sessionId, dismissed: true };
}

/** 把当前生效场景原样再写一遍（修好 model-routes.json，drift 消失）。 */
export function reapplyActiveScenario() {
	const state = loadState();
	persist(state.scenarios, state.activeId);
	return stateSnapshot();
}

// ---------------------------------------------------------------------------
// 场景（TAB）：一套「A 侧 / B 侧」三角色模型 + 两个可改名的切换按钮
// ---------------------------------------------------------------------------

/** 名称最长字符数：够表达场景，又不至于把侧边栏那一行撑爆。 */
const LABEL_MAX = 16;
/** 场景 id 的合法形状（要写进文件，别让脏键进来）。 */
const SCENE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/u;
/** 角色名的合法形状（避免往 preset 的文件里写进垃圾键）。 */
const ROLE_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/u;

/** 规整一个名称：去空白 + 限长；非字符串 / 空串返回 null。 */
function cleanLabel(value) {
	if (typeof value !== "string") return null;
	const text = value.trim();
	return text === "" ? null : [...text].slice(0, LABEL_MAX).join("");
}

/**
 * 读 v1 文件里的自定义按钮名（只在迁移时用）。缺失 / 坏形状 / 全空 → null。
 *
 * @param {object|null} [data] 已读出的文件对象
 * @returns {{cn?: string, global?: string} | null}
 */
function readLabels(data) {
	const source = data !== null && typeof data === "object" ? data.labels : null;
	if (source === null || typeof source !== "object" || Array.isArray(source)) return null;
	const out = {};
	for (const region of REGIONS) {
		const value = cleanLabel(source[region]);
		if (value !== null) out[region] = value;
	}
	return Object.keys(out).length > 0 ? out : null;
}

/** 一侧的线路表归一化：缺失项留 null（由 scenarioStatus 判定，不在这里猜）。 */
function cleanSides(source) {
	const out = {};
	const src = source !== null && typeof source === "object" && !Array.isArray(source) ? source : {};
	for (const role of new Set([...ROLES, ...Object.keys(src)])) {
		if (!ROLE_NAME.test(role)) continue;
		const pair = src[role] !== null && typeof src[role] === "object" ? src[role] : {};
		out[role] = { a: cleanRoute(pair.a), b: cleanRoute(pair.b) };
	}
	for (const role of ROLES) out[role] ??= { a: null, b: null };
	return out;
}

/** 归一化一个场景（坏形状不抛：界面要能显示它、让用户自己修）。 */
function cleanScenario(raw, index) {
	const src = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
	const id = typeof src.id === "string" && SCENE_ID.test(src.id) ? src.id : `scene-${index + 1}`;
	const labels = {};
	for (const side of SIDES) labels[side] = cleanLabel(src?.labels?.[side]) ?? DEFAULT_LABELS[side];
	return { id, labels, primary: src.primary === "b" ? "b" : "a", roles: cleanSides(src.roles) };
}

/** 缺失的（角色 / 侧）清单；`complete` = 三个角色的两侧都选全了（勾「使用」的前提）。 */
function scenarioStatus(scene) {
	const missing = [];
	for (const role of ROLES) {
		for (const side of SIDES) {
			const route = scene?.roles?.[role]?.[side];
			if (route === null || route === undefined) missing.push({ role, side });
		}
	}
	return { complete: missing.length === 0, missing };
}

/** TAB 文字 = 两侧名字用 `/` 连起来（场景名不是另填的，而是自动显示两个模式名）。 */
function tabLabel(scene) {
	return `${scene.labels.a}/${scene.labels.b}`;
}

/** 场景 → preset 读的 roles 表（primary 那一侧占主槽）；不完整的角色不进表。 */
function derivedRoles(scene) {
	const other = scene.primary === "a" ? "b" : "a";
	const roles = {};
	for (const [role, pair] of Object.entries(scene.roles ?? {})) {
		const primary = cleanRoute(pair?.[scene.primary]);
		const fallback = cleanRoute(pair?.[other]);
		if (primary !== null && fallback !== null) roles[role] = { default: primary, fallback };
	}
	return roles;
}

/** 文件缺席时的播种场景：国内线占 a、国际线占 b，主槽在 a。 */
function seededScene() {
	const roles = {};
	for (const role of ROLES) {
		const primary = role === "reviewer" ? FALLBACK_REVIEW : FALLBACK_MAIN;
		roles[role] = { a: primary, b: counterpartOf(primary) ?? primary };
	}
	return { id: "scene-1", labels: { ...DEFAULT_LABELS }, primary: "a", roles };
}

/**
 * v1 文件（roles + labels + region）→ 单个场景。
 * a 侧固定放 cn 线（与默认名「国内」一致）：主槽是 global: 时把两侧对调后入库。
 */
function migrateV1(data) {
	const source = normalizeRoles(data?.roles);
	const legacy = readLabels(data) ?? {};
	const primaries = ROLES.map((role) => source[role]?.default).filter((route) => route !== undefined);
	const cnHoldsDefault = primaries.length === 0 || primaries.some((route) => regionOfModel(route.model) !== "global");
	const roles = {};
	for (const [role, pair] of Object.entries(source)) {
		roles[role] = cnHoldsDefault ? { a: pair.default, b: pair.fallback } : { a: pair.fallback, b: pair.default };
	}
	for (const role of ROLES) roles[role] ??= { a: null, b: null };
	return {
		id: "scene-1",
		labels: { a: legacy.cn ?? DEFAULT_LABELS.a, b: legacy.global ?? DEFAULT_LABELS.b },
		primary: cnHoldsDefault ? "a" : "b",
		roles,
	};
}

/** 生成一个没被占用的场景 id（场景数量不设上限）。 */
function nextSceneId(taken) {
	for (let i = 1; i <= taken.size + 64; i += 1) {
		const id = `scene-${i}`;
		if (!taken.has(id)) return id;
	}
	return `scene-${Date.now().toString(36)}`;
}

/** 读文件里的场景列表（必要时从 v1 迁移，必要时播种）。 */
function scenariosOf(data) {
	const raw = data?.scenarios;
	if (Array.isArray(raw) && raw.length > 0) {
		const seen = new Set();
		const scenarios = raw.map((entry, index) => {
			const scene = cleanScenario(entry, index);
			while (seen.has(scene.id)) scene.id = nextSceneId(seen);
			seen.add(scene.id);
			return scene;
		});
		return { scenarios, migrated: false };
	}
	if (data === null || data === undefined) return { scenarios: [seededScene()], migrated: false };
	return { scenarios: [cleanScenario(migrateV1(data), 0)], migrated: true };
}

/**
 * 落盘一份场景表 + 当前激活场景（原子写）：重新派生 roles（active 不完整时沿用
 * 旧 roles，不静默改线），并清掉 v1 遗留的 labels / region 字段。
 */
/**
 * 落盘：① 我们独占的 scenarios.json（整份场景表 + 生效场景）；
 * ② model-routes.json 保持 preset **原生的 v1 形状**（只放派生 roles），并清掉本插件
 * 早期版本塞进它里面的 scenarios / activeScenario / labels / region。
 *
 * 这样 preset 自己的 `set_role_model` 无论怎么重写 model-routes.json，都只会动 `roles`，
 * **不会冲掉场景表**；同时文件永远是 preset 认得的格式，不再依赖本地补丁。
 */
function persist(scenarios, activeId) {
	const sceneRaw = readScenariosRaw();
	if (sceneRaw.error !== null) throw new Error(sceneRaw.error);
	const routes = readRaw();
	if (routes.error !== null) throw new Error(routes.error);
	const active = scenarios.find((scene) => scene.id === activeId) ?? scenarios[0];
	const status = scenarioStatus(active);

	writeJsonAtomic(scenariosPath(), { schemaVersion: 1, activeScenario: active.id, scenarios });

	const base = routes.data !== null ? { ...routes.data } : {};
	const previous = normalizeRoles(base.roles);
	base.schemaVersion = 1;
	if (status.complete || Object.keys(previous).length === 0) base.roles = derivedRoles(active);
	delete base.scenarios;
	delete base.activeScenario;
	delete base.labels;
	delete base.region;
	writeJsonAtomic(routesPath(), base);
	// 这份内容就是「本插件认可的权威内容」：之后文件只要不一样，就是外部改动。
	rememberRoutesWrite();
	return { activeComplete: status.complete, primary: active.primary };
}

/**
 * 保存整份场景表（弹窗的「保存」）：至少 1 个场景（数量不设上限），各自带两个按钮名、
 * 主槽方向与三角色两侧模型；`activeScenario` 指定勾「使用」的那个。
 *
 * 允许保存不完整的场景（草稿状态）：这类场景不能被勾「使用」也不能切换，
 * 也不会改到 preset 正在读的 roles。
 *
 * @param {{scenarios: Array<object>, activeScenario?: string}} input
 * @returns {object} fresh snapshot + changed / activeComplete
 */
export function saveScenarios(input) {
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		throw new Error("请求体必须是 { scenarios: [...], activeScenario?: string }");
	}
	const list = input.scenarios;
	if (!Array.isArray(list) || list.length === 0) throw new Error("至少要保留一个场景");

	const seen = new Set();
	const scenarios = list.map((entry, index) => {
		const scene = cleanScenario(entry, index);
		while (seen.has(scene.id)) scene.id = nextSceneId(seen);
		seen.add(scene.id);
		return scene;
	});
	const wanted = typeof input.activeScenario === "string" ? input.activeScenario : "";
	const activeId = seen.has(wanted) ? wanted : scenarios[0].id;
	// 勾「使用」的那个场景必须选全模型（用户规则：没选模型不能勾选）。
	const active = scenarios.find((scene) => scene.id === activeId);
	const status = scenarioStatus(active);
	if (!status.complete) {
		const roles = [...new Set(status.missing.map((item) => item.role))].join("、");
		throw new Error(`「${tabLabel(active)}」还没选全模型（缺 ${roles}），不能设为使用中的场景`);
	}
	const result = persist(scenarios, activeId);
	return { ...stateSnapshot(), changed: scenarios.length, ...result };
}

/**
 * 勾「使用」：把某个场景设为 active。前提是它选全了模型（用户规则：没选模型
 * 的场景不能勾选），否则抛错让界面提示。
 *
 * @param {string} id
 * @returns {object} fresh snapshot + changed
 */
export function selectScenario(id) {
	const state = loadState();
	if (state.error !== null) throw new Error(state.error);
	const target = state.scenarios.find((scene) => scene.id === id);
	if (target === undefined) throw new Error(`场景不存在：${String(id)}`);
	const status = scenarioStatus(target);
	if (!status.complete) {
		const roles = [...new Set(status.missing.map((item) => item.role))].join("、");
		throw new Error(`这个场景还没选全模型（缺 ${roles}），不能使用`);
	}
	persist(state.scenarios, target.id);
	return { ...stateSnapshot(), changed: 1 };
}

/**
 * 侧边栏的切换按钮：把 active 场景的主槽翻到指定的一侧（不给 side 就在 a / b
 * 之间对调）。点已经占主槽的那一侧是幂等的（changed=0）。
 *
 * @param {"a"|"b"} [side]
 * @returns {object} fresh snapshot + changed / primary
 */
export function swapActiveScenario(side) {
	const state = loadState();
	if (state.error !== null) throw new Error(state.error);
	const active = state.scenarios.find((scene) => scene.id === state.activeId) ?? state.scenarios[0];
	const status = scenarioStatus(active);
	if (!status.complete) {
		const roles = [...new Set(status.missing.map((item) => item.role))].join("、");
		throw new Error(`当前场景还没选全模型（缺 ${roles}），不能切换`);
	}
	if (side === "a" || side === "b") {
		if (active.primary === side) return { ...stateSnapshot(), changed: 0 };
		active.primary = side;
	} else {
		active.primary = active.primary === "a" ? "b" : "a";
	}
	persist(state.scenarios, active.id);
	return { ...stateSnapshot(), changed: 1 };
}

// ---------------------------------------------------------------------------
// 模型目录：给三角色编辑器提供「可点选」的 provider / model 列表
// ---------------------------------------------------------------------------

/** 宿主的 LLM 注册表（ctx.llm）；取不到返回 null。 */
function llmOf(ctx) {
	if (typeof ctx?.get !== "function") return null;
	try {
		const service = ctx.get("llm");
		if (service !== null && service !== undefined && typeof service.listProviders === "function") return service;
	} catch {
		// 未注册的服务在个别 cordis 版本会抛：当作取不到。
	}
	return null;
}

/** 去掉引号、`id:` 前缀与注释，留下模型 id。 */
function cleanModelToken(token) {
	let value = token.trim();
	if (value.startsWith("-")) value = value.slice(1).trim();
	value = value.replace(/#.*$/u, "").trim();
	const withKey = /^id:\s*(.+)$/u.exec(value);
	if (withKey !== null) value = withKey[1].trim();
	value = value.replace(/^["']/u, "").replace(/["']$/u, "");
	return value.trim();
}

/** 极简 YAML 扫描：只认 `providers: { <name>: { models: [...] } }` 形状。 */
function scanProviders(text, into) {
	const lines = text.split(/\r?\n/u);
	for (let i = 0; i < lines.length; i += 1) {
		const header = /^(\s*)providers:\s*$/u.exec(lines[i]);
		if (header === null) continue;
		const base = header[1].length;
		let provider = null;
		for (let j = i + 1; j < lines.length; j += 1) {
			const raw = lines[j];
			const trimmed = raw.trim();
			if (trimmed === "" || trimmed.startsWith("#")) continue;
			const indent = raw.length - raw.trimStart().length;
			if (indent <= base) break;
			const name = /^([A-Za-z0-9_@.\-/]+):\s*$/u.exec(trimmed);
			if (indent === base + 2 && name !== null && name[1] !== "models") {
				provider = name[1];
				if (!into.has(provider)) into.set(provider, { label: provider, models: new Map() });
				continue;
			}
			if (provider === null) continue;
			const models = /^models:\s*(.*)$/u.exec(trimmed);
			if (models === null) continue;
			const inline = models[1].trim();
			if (inline.startsWith("[") && inline.endsWith("]")) {
				for (const part of inline.slice(1, -1).split(",")) {
					const id = cleanModelToken(part);
					if (id !== "") into.get(provider).models.set(id, id);
				}
				continue;
			}
			for (let k = j + 1; k < lines.length; k += 1) {
				const itemRaw = lines[k];
				const item = itemRaw.trim();
				if (item === "" || item.startsWith("#")) continue;
				const itemIndent = itemRaw.length - itemRaw.trimStart().length;
				if (itemIndent <= indent || !item.startsWith("-")) break;
				const id = cleanModelToken(item);
				if (id !== "") into.get(provider).models.set(id, id);
			}
		}
	}
}

/** profile 的 cordis*.yml 里声明的 provider / models（llm 服务不可用时的兜底）。 */
function scanProfileProviders(into) {
	const sources = [];
	let error = null;
	const dir = join(dshHome(), "profiles");
	if (!existsSync(dir)) return { sources, error: `找不到 profiles 目录：${dir}` };
	let found = 0;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const profileDir = join(dir, entry.name);
		for (const file of readdirSync(profileDir)) {
			if (!/^cordis.*\.ya?ml$/u.test(file)) continue;
			try {
				scanProviders(readFileSync(join(profileDir, file), "utf8"), into);
				found += 1;
			} catch (cause) {
				error = String(cause?.message ?? cause);
			}
		}
	}
	if (found > 0) sources.push("profile");
	return { sources, error };
}

/**
 * 可用模型目录：[{ provider, label, models: [{ id, name }] }]。
 *
 * 首选宿主活体注册表（ctx.llm.listProviders + listModels）——就是聊天窗模型
 * 选择器看到的那一份，因此 provider / 模型及其显示名永远与 DSH 同步；llm
 * 服务不可用时回退到 profile 的 cordis*.yml 扫描。最后把 model-routes.json
 * 里当前在用的路线补进来，保证下拉框至少能显示现值。
 *
 * @returns {Promise<{providers: Array<{provider: string, label: string, models: Array<{id: string, name: string}>}>, sources: string[], error: string|null}>}
 */
export async function readCatalog(ctx) {
	/** provider → { label, models: Map<id, name> } */
	const table = new Map();
	const sources = [];
	let error = null;

	const ensure = (provider, label) => {
		if (!table.has(provider)) table.set(provider, { label, models: new Map() });
		return table.get(provider);
	};
	const add = (provider, model, name) => {
		if (typeof provider !== "string" || provider === "") return;
		if (typeof model !== "string" || model === "") return;
		ensure(provider, provider).models.set(model, name ?? model);
	};

	const llm = llmOf(ctx);
	/** 宿主注册了但当前拿不到模型的 provider（缺凭据 / 被禁用）——不进候选，只做诊断。 */
	const unavailable = [];
	if (llm !== null) {
		let live = 0;
		try {
			for (const provider of llm.listProviders()) {
				const id = typeof provider?.id === "string" ? provider.id : "";
				if (id === "") continue;
				const label = typeof provider?.name === "string" && provider.name !== "" ? provider.name : id;
				try {
					const models = await llm.listModels(id);
					let count = 0;
					for (const model of models ?? []) {
						if (typeof model?.id !== "string" || model.id === "") continue;
						add(id, model.id, typeof model.name === "string" && model.name !== "" ? model.name : model.id);
						count += 1;
					}
					if (count === 0) {
						// 与浏览器模型选择器一致：没有模型的 provider 不成为一组。
						unavailable.push({ provider: id, label, message: "该 provider 当前没有可用模型" });
						continue;
					}
					ensure(id, label);
					live += 1;
				} catch (cause) {
					// 单个 provider 目录失败不影响其它 provider。
					unavailable.push({ provider: id, label, message: String(cause?.message ?? cause) });
					error ??= `${id}: ${cause?.message ?? cause}`;
				}
			}
			if (live > 0) sources.push("llm");
		} catch (cause) {
			error = `llm.listProviders: ${cause?.message ?? cause}`;
		}
	}

	if (sources.length === 0) {
		const scanned = scanProfileProviders(table);
		sources.push(...scanned.sources);
		error ??= scanned.error;
	}

	// 当前在用的路线无论如何都要在下拉框里能看到（文件不存在时不要凭空造候选）。
	const snapshot = stateSnapshot();
	if (snapshot.exists) {
		for (const pair of Object.values(snapshot.roles ?? {})) {
			for (const route of Object.values(pair ?? {})) add(route?.provider, route?.model, route?.model);
		}
		sources.push("model-routes.json");
	}

	const providers = [...table.entries()]
		.map(([provider, entry]) => ({
			provider,
			label: entry.label,
			models: [...entry.models.entries()]
				.map(([id, name]) => ({ id, name }))
				.sort((a, b) => a.id.localeCompare(b.id)),
		}))
		// 与浏览器模型选择器（buildModelCatalog）一致：没有模型的分组不出现。
		.filter((group) => group.models.length > 0)
		.sort((a, b) => a.provider.localeCompare(b.provider));
	return { providers, unavailable, sources, error };
}
