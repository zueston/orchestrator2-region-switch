/** 「场景失效 → 按顺序切下一个场景 → 整轮都失效 → 指数冷却」的自动切换状态机（v2）。
 *
 * 两个文件（都在 `<DSH_HOME>/orchestrator2/`，原子写 temp + rename）：
 *
 *   failover.json         本模块的状态 + 配置（**enabled 默认 false**；未启用时绝不写
 *                         model-routes.json）。`schemaVersion: 2` = 按顺序轮转；
 *                         读到 v1（`freeScene`/`paidScene` 两点来回切）时自动迁移并写回。
 *   failover-signal.json  由 dsh-orchestrator2 预设的 route-fallback 写入（「这次派工
 *                         真的撞上限流了」），本模块轮询读取。不删文件（避免与写者竞态），
 *                         只在 failover.json 的 `lastSignal` 记下处理时间。
 *                         该文件的 `schemaVersion` 恒为 1（写者契约），与本模块的状态
 *                         版本**无关**，不能拿 SCHEMA_VERSION 去校验它。
 *
 * 语义（v2 起没有「回切免费」这个概念）：
 *
 *   - `order` 是切换顺序（元素是 model-routes.json 里 `scenarios[].id`），`currentIndex`
 *     指向当前生效场景，必须与实际 `activeScenario` 一致（loadConfig 时以它为准校正）。
 *   - 信号 = 当前场景失效：把当前场景记进 `roundFailed`，切到 `order` 里的下一个。
 *   - 一轮 = 从某场景失效开始按 order 依次前进；回到**已经失败过**的场景（= 整轮无一
 *     可用）就停手：进指数冷却（`roundCooldownMin × 2^(roundCount-1)`，720 分钟封顶），
 *     期间不切（避免无休止轮转烧额度）。
 *   - **下一场景已失败 ⇒ 整轮结束，直接 halt（不再空转一次）**（2.2.2 修正）：切之前先看
 *     `order[(i+1)%n]` 是否已在 `roundFailed` 里。order 是个环、只有从起点按顺序走过的
 *     场景才会进 `roundFailed`，所以「下一个已失败」等价于「剩余场景全部失败过」——当前
 *     这次失效就是**整轮的最后一次**，当场进冷却，不再切到那个已知失效的场景白跑一趟。
 *     于是一轮 = `order` 里每个场景各失败一次：N 个场景 = **N 次**失败信号即冷却
 *     （2.2.1 及更早要 N+1 次：第 N+1 次才「绕回已失败场景」触发 halt）。
 *   - tick 只负责「冷却到点解除暂停」，不做任何回切。
 *   - `roundCount` **跨轮叠加**（2.2.1 修正）：`resume` 只清 `haltedUntil`、**不清**
 *     `roundCount`，所以连续第 2 轮整轮失败是 60 分钟、第 3 轮 120 分钟、第 6 轮起
 *     720 分钟封顶（2.2.0 里 `resume` 顺手把 `roundCount` 归零，导致每轮都从 30 分钟
 *     重新起算，60/120/240/480/720 这几档永远用不到）。
 *
 *     清零点只有两处：① `POST /failover { reset: true }`（重置历史）；② 用户手动改
 *     路径——改切换顺序（`saveConfig({ order })`）或手动切换生效场景（路由层的
 *     `noteManualSceneSwitch()`，`POST /select` 走到）。第 3 种「一轮走完且没有触发
 *     失败」理论上也该清零，但本状态机没有「一轮成功结束」这种信号（信号只代表失效、
 *     tick 只代表冷却到点），**不为它新造信号**，因此不设这个清零点。
 *
 * 切换执行**只走 region.js 的写入口**（`selectScenario`）：它内部 `persist()` 会同时
 * 重算 `scenarios` / `activeScenario` / 派生 `roles`，所以切完预设下一次派工读到的
 * 就是新场景，不需要重启、不碰任何会话状态。
 *
 * 状态机是纯函数 `decision(state, event, nowMs)`：不读文件、不看时钟（nowMs 由调用方
 * 给），所以自测可以把时间拨到任意点，不用真等半小时。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dshHome, selectScenario, stateSnapshot } from "./region.js";

/** 插件名（日志用）。 */
const NS = "orchestrator2-region-switch";

/** failover.json 的状态版本（v2 = 按顺序轮转；v1 = 免费/收费两点来回切，读到即迁移）。 */
const SCHEMA_VERSION = 2;

/** 信号文件版本：**由预设 route-fallback 写**，与本模块的状态版本无关，恒为 1。 */
const SIGNAL_SCHEMA_VERSION = 1;

/** 最小驻留：刚切过 2 分钟内不再因为信号切下一个（防抖）。 */
export const MIN_DWELL_MS = 120_000;

/** 全轮冷却的封顶（分钟）。 */
export const MAX_COOLDOWN_MIN = 720;

/** flips 历史保留条数（只看最近 1 小时，留 200 条绰绰有余）。 */
const MAX_FLIPS = 200;

/** 滚动窗口 = 1 小时。 */
const HOUR_MS = 3_600_000;

/** 信号轮询 / 决策 tick 周期。 */
const POLL_MS = 5_000;
const TICK_MS = 30_000;

/** 三个可配数字的取值范围（越界抛错，不静默夹断）。 */
const LIMITS = { roundCooldownMin: [1, MAX_COOLDOWN_MIN], maxFlipsPerHour: [1, 60], perSceneProbeMin: [1, 120] };

/** 场景 id 的合法形状（与 region.js 一致）。 */
const SCENE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/u;

/** v1 遗留字段：读到就重写成 v2（写回时一律删掉）。 */
const LEGACY_KEYS = ["freeScene", "paidScene", "cooldownMin", "probeWindowMin", "current", "backoffMin"];

/** 文件缺席 / 坏字段时的兜底（enabled 一律 false：用户必须显式启用）。 */
export const FAILOVER_DEFAULTS = Object.freeze({
	schemaVersion: SCHEMA_VERSION,
	enabled: false,
	order: [],
	perSceneProbeMin: 10,
	roundCooldownMin: 30,
	maxFlipsPerHour: 12,
	currentIndex: 0,
	lastFlipAt: null,
	flips: [],
	roundFailed: [],
	haltedUntil: null,
	roundCount: 0,
	lastSignal: null,
});

/** `<DSH_HOME>/orchestrator2`。 */
function failoverDir() {
	return join(dshHome(), "orchestrator2");
}

/** 状态 + 配置文件。 */
export function failoverPath() {
	return join(failoverDir(), "failover.json");
}

/** 预设写、本插件读的限流信号文件。 */
export function signalPath() {
	return join(failoverDir(), "failover-signal.json");
}

/** 原子写一个 JSON 文件（临时文件 + rename；目录不存在就建）。 */
function writeJsonAtomic(path, data) {
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.${process.pid}.tmp`;
	writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
	renameSync(temp, path);
}

/** 读文件原文（缺文件 / 坏 JSON → null，不抛）。 */
function readRaw(path) {
	if (!existsSync(path)) return null;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/** 数字兜底：非 finite / 越界 → fallback。 */
function numIn(value, fallback, [min, max]) {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return value < min || value > max ? fallback : value;
}

/** ISO 字符串 / 其它 → 毫秒；解析不出 = null。 */
function timeOf(value) {
	if (typeof value !== "string" || value === "") return null;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : null;
}

/** 毫秒 → ISO（invald → null），保证落盘的时间串形态唯一（幂等的前提）。 */
function isoOf(ms) {
	return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** 场景顺序里的一个 id（不合形状 / 不在现有场景里 → 丢掉）。 */
function orderIdOf(value, known) {
	if (typeof value !== "string" || !SCENE_ID.test(value)) return null;
	return known === undefined || known.includes(value) ? value : null;
}

/** 旧记录里的 'free' / 'paid' → 迁移后的场景 id；场景 id 原样；其它 → null。 */
function sceneNameOf(value, legacy) {
	if (typeof value !== "string") return null;
	if (value === "free") return legacy.free;
	if (value === "paid") return legacy.paid;
	return SCENE_ID.test(value) ? value : null;
}

/** flips 归一化：只留认得的四个字段（v1 的 free/paid 映射成场景 id），最多 MAX_FLIPS 条。 */
function cleanFlips(raw, legacy) {
	if (!Array.isArray(raw)) return [];
	const out = [];
	for (const entry of raw) {
		if (entry === null || typeof entry !== "object") continue;
		const at = isoOf(timeOf(entry.at));
		if (at === null) continue;
		out.push({
			at,
			from: sceneNameOf(entry.from, legacy),
			to: sceneNameOf(entry.to, legacy),
			reason: typeof entry.reason === "string" && entry.reason !== "" ? entry.reason : "unknown",
		});
	}
	return out.slice(-MAX_FLIPS);
}

/** lastSignal 归一化（只保留认得的键）。 */
function cleanSignal(raw) {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
	const out = {};
	for (const key of ["at", "handledAt", "reason", "code", "role"]) {
		if (typeof raw[key] === "string" && raw[key] !== "") out[key] = raw[key];
	}
	return Object.keys(out).length === 0 ? null : out;
}

/** model-routes.json 里现有场景的 id 清单 + 当前生效场景（读不到 → 空清单）。 */
function scenarioFacts() {
	try {
		const snapshot = stateSnapshot();
		return {
			ids: snapshot.scenarios.map((scene) => scene.id),
			active: typeof snapshot.activeScenario === "string" ? snapshot.activeScenario : null,
		};
	} catch {
		return { ids: [], active: null };
	}
}

/**
 * 把任意读到的对象归一化成完整 v2 状态（脏值回落默认，不抛——坏文件也不能让面板打不开）。
 *
 * 顺序来源（从强到弱）：`order` → v1 的 `[paidScene, freeScene]` → 现有场景的文件顺序。
 * `currentIndex` 一律以实际 `activeScenario` 为准（spec：两者必须一致），生效场景若不在
 * 顺序里就补到队首（否则无处定位「当前是第几个」）。
 */
function normalizeState(raw) {
	const src = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
	const base = FAILOVER_DEFAULTS;
	const facts = scenarioFacts();
	const known = facts.ids;

	const legacy = {
		free: orderIdOf(src.freeScene, known),
		paid: orderIdOf(src.paidScene, known),
	};

	let order = [];
	if (Array.isArray(src.order)) {
		for (const entry of src.order) {
			const id = orderIdOf(entry, known);
			if (id !== null && !order.includes(id)) order.push(id);
		}
	} else {
		// v1：收费 → 免费（先花钱的、再省钱的，与迁移规则一致）。
		for (const entry of [legacy.paid, legacy.free]) {
			if (entry !== null && !order.includes(entry)) order.push(entry);
		}
	}
	if (order.length === 0) order = known.slice();

	const active = orderIdOf(facts.active, known);
	if (active !== null && !order.includes(active)) order = [active, ...order];

	const activeIndex = active === null ? -1 : order.indexOf(active);
	const storedIndex = Number.isInteger(src.currentIndex) ? src.currentIndex : activeIndex;
	const currentIndex =
		activeIndex >= 0
			? activeIndex
			: Math.max(0, Math.min(Number.isInteger(storedIndex) ? storedIndex : 0, Math.max(order.length - 1, 0)));

	const roundFailed = [];
	if (Array.isArray(src.roundFailed)) {
		for (const entry of src.roundFailed) {
			const id = orderIdOf(entry, known);
			if (id !== null && !roundFailed.includes(id)) roundFailed.push(id);
		}
	}

	const roundCount = Number.isInteger(src.roundCount) && src.roundCount >= 0 ? src.roundCount : 0;
	const roundCooldownMin = numIn(src.roundCooldownMin, numIn(src.cooldownMin, base.roundCooldownMin, LIMITS.roundCooldownMin), LIMITS.roundCooldownMin);

	return {
		schemaVersion: SCHEMA_VERSION,
		enabled: src.enabled === true,
		order,
		perSceneProbeMin: numIn(src.perSceneProbeMin, numIn(src.probeWindowMin, base.perSceneProbeMin, LIMITS.perSceneProbeMin), LIMITS.perSceneProbeMin),
		roundCooldownMin,
		maxFlipsPerHour: numIn(src.maxFlipsPerHour, base.maxFlipsPerHour, LIMITS.maxFlipsPerHour),
		currentIndex,
		lastFlipAt: isoOf(timeOf(src.lastFlipAt)),
		flips: cleanFlips(src.flips, legacy),
		roundFailed,
		haltedUntil: isoOf(timeOf(src.haltedUntil)),
		roundCount,
		lastSignal: cleanSignal(src.lastSignal),
	};
}

/** 读到的文件是否需要按 v2 重写（迁移 / 漏字段 / currentIndex 与实际生效场景不一致）。 */
function needsRewrite(raw, state) {
	if (raw.schemaVersion !== SCHEMA_VERSION) return true;
	for (const key of LEGACY_KEYS) if (Object.hasOwn(raw, key)) return true;
	if (raw.currentIndex !== state.currentIndex) return true;
	if (JSON.stringify(raw.order) !== JSON.stringify(state.order)) return true;
	return false;
}

/**
 * 读当前状态（文件缺席 / 坏形状 → 默认状态；enabled 默认 false）。
 *
 * 顺带做两件事：**迁移 v1 → v2**、**把 currentIndex 校正成实际生效场景**，两种情况都
 * 写回文件（幂等：第二次读到已是 v2 且一致，就不再写）。
 *
 * @returns {object} 完整 v2 状态
 */
export function loadConfig() {
	const path = failoverPath();
	const raw = readRaw(path);
	const state = normalizeState(raw);
	if (raw !== null && needsRewrite(raw, state)) writeJsonAtomic(path, state);
	return state;
}

/** 严格校验一个整数（接受数字或数字字符串）。 */
function requireInt(value, name, [min, max]) {
	const n =
		typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
	if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`${name} 必须是整数`);
	if (n < min || n > max) throw new Error(`${name} 必须在 ${min}~${max} 之间（收到 ${n}）`);
	return n;
}

/** 严格校验一个场景 id。 */
function requireSceneId(value, name) {
	const id = typeof value === "string" ? value.trim() : "";
	if (!SCENE_ID.test(id)) throw new Error(`${name} 不是合法的场景 id（${String(value)}）`);
	return id;
}

/**
 * 严格校验切换顺序：非空数组、长度 ≥2、无重复、每个 id 都必须是**现有场景**。
 *
 * @param {unknown} value
 * @param {string[]} known model-routes.json 里的场景 id
 * @returns {string[]}
 */
function requireOrder(value, known) {
	if (!Array.isArray(value)) throw new Error("order 必须是场景 id 数组");
	if (value.length < 2) throw new Error(`order 至少要两个场景（收到 ${value.length} 个）`);
	const list = [];
	for (const entry of value) {
		const id = requireSceneId(entry, "order");
		if (!known.includes(id)) throw new Error(`order 里的场景不存在：${id}`);
		if (list.includes(id)) throw new Error(`order 里有重复的场景：${id}`);
		list.push(id);
	}
	return list;
}

/**
 * 改配置并落盘（白名单字段；脏值抛错让界面显示原因，不静默夹断）。
 *
 * 认得的字段：`enabled` / `order` / `perSceneProbeMin` / `roundCooldownMin` /
 * `maxFlipsPerHour` / `reset`。其它键忽略（外来的 `flips` / `haltedUntil` /
 * `roundFailed` 一律不认——运行历史只能由本模块自己记；v1 的 `freeScene` /
 * `paidScene` 也不认，由路由层回一条 warning）。
 *
 * `order` 与 `reset` 都是**手动路径**：两者都会把 `roundCount` 清零（见文件头「跨轮
 * 叠加」一节）；`flips` / `lastFlipAt` 只有 `reset` 才清。
 *
 * @param {object} patch
 * @returns {object} 落盘后的完整状态
 */
export function saveConfig(patch) {
	if (patch === null || patch === undefined || typeof patch !== "object" || Array.isArray(patch)) {
		throw new Error("请求体必须是对象");
	}
	const before = loadConfig();
	const next = { ...before };

	if (patch.enabled !== undefined) {
		if (typeof patch.enabled !== "boolean") throw new Error("enabled 必须是布尔值");
		next.enabled = patch.enabled;
	}
	if (patch.order !== undefined) {
		next.order = requireOrder(patch.order, scenarioFacts().ids);
		// 手动改顺序 = 由人接手，开始新的一轮：本轮失败记录与指数冷却的轮次一起清零
		// （否则下一轮会接着上一轮的档位起算）。翻转历史不动——那是审计记录。
		next.roundFailed = [];
		next.roundCount = 0;
	}
	if (patch.roundCooldownMin !== undefined) {
		next.roundCooldownMin = requireInt(patch.roundCooldownMin, "roundCooldownMin", LIMITS.roundCooldownMin);
	}
	if (patch.maxFlipsPerHour !== undefined) {
		next.maxFlipsPerHour = requireInt(patch.maxFlipsPerHour, "maxFlipsPerHour", LIMITS.maxFlipsPerHour);
	}
	if (patch.perSceneProbeMin !== undefined) {
		next.perSceneProbeMin = requireInt(patch.perSceneProbeMin, "perSceneProbeMin", LIMITS.perSceneProbeMin);
	}
	if (patch.reset !== undefined) {
		if (typeof patch.reset !== "boolean") throw new Error("reset 必须是布尔值");
		if (patch.reset) {
			next.flips = [];
			next.lastFlipAt = null;
			next.roundFailed = [];
			next.haltedUntil = null;
			next.roundCount = 0;
		}
	}

	const state = normalizeState(next);
	writeJsonAtomic(failoverPath(), state);
	return state;
}

/**
 * 用户**手动**切换生效场景（`POST /select` 成功后由路由层调用）= 人接手，开始新的一轮：
 * 清掉本轮失败记录与指数冷却的轮次（`roundCount`），但**不动**翻转历史、也不动
 * `haltedUntil`（冷却只是「别再自动切」的闸，人已经手动决定了场景，没必要提前解闸；
 * 到点自然解除）。
 *
 * 与 `saveConfig({ order })` 是同一语义的另一个入口——`roundCount` 的清零点只有
 * 「重置历史」「改顺序」「手动切场景」这三条手动路径，状态机自己从不归零它。
 *
 * @returns {object} 落盘后的完整状态（没有可清的东西时不写盘）
 */
export function noteManualSceneSwitch() {
	const state = loadConfig();
	const failed = Array.isArray(state.roundFailed) ? state.roundFailed : [];
	if (state.roundCount === 0 && failed.length === 0) return state;
	const next = { ...state, roundFailed: [], roundCount: 0 };
	writeJsonAtomic(failoverPath(), next);
	return next;
}

/** `lastFlipAt` → 毫秒；没切过 = -Infinity（= 驻留无限久）。 */
function lastFlipMs(state) {
	const t = timeOf(state?.lastFlipAt);
	return t === null ? Number.NEGATIVE_INFINITY : t;
}

/** 滚动 1 小时内的切换次数。 */
function recentFlips(state, nowMs) {
	const list = Array.isArray(state?.flips) ? state.flips : [];
	let count = 0;
	for (const entry of list) {
		const t = timeOf(entry?.at);
		if (t === null) continue;
		const age = nowMs - t;
		if (age >= 0 && age < HOUR_MS) count += 1;
	}
	return count;
}

/** 归一化后的顺序（防御：文件被手改成脏数组时也不炸）。 */
function orderOf(state) {
	const list = Array.isArray(state?.order) ? state.order : [];
	return list.filter((id) => typeof id === "string" && SCENE_ID.test(id));
}

/** 当前场景在顺序里的下标（越界 → 0）。 */
function indexOf(state, order) {
	const index = Number.isInteger(state?.currentIndex) ? state.currentIndex : 0;
	return index >= 0 && index < order.length ? index : 0;
}

/**
 * 整轮结束的 halt 决策（两个入口共用：`order[(i+1)%n]` 已失败 / 当前场景已失败）。
 *
 * `roundFailed` 是**本轮结束时的失败集合**（含当前场景，去重），只用于日志与审计；
 * `applyDecision` 落盘时一律清空（下一轮重新记）。冷却阶梯照旧
 * `min(max(roundCooldownMin,1) × 2^(roundCount−1), 720)` 分钟，`roundCount` 跨轮叠加。
 */
function roundFailedVerdict(state, nowMs, currentScene, failed) {
	const roundCount = (Number.isInteger(state.roundCount) && state.roundCount >= 0 ? state.roundCount : 0) + 1;
	const baseMin = Number.isFinite(state.roundCooldownMin) ? state.roundCooldownMin : FAILOVER_DEFAULTS.roundCooldownMin;
	const cooldownMin = Math.min(Math.max(baseMin, 1) * 2 ** (roundCount - 1), MAX_COOLDOWN_MIN);
	return {
		action: "halt",
		reason: "round-failed",
		fromScene: currentScene,
		roundFailed: failed.includes(currentScene) ? failed.slice() : [...failed, currentScene],
		roundCount,
		haltedUntil: isoOf(nowMs + cooldownMin * 60_000),
	};
}

/**
 * 状态机（**纯函数**：不读文件、不看系统时钟）。
 *
 * 判定顺序：`enabled` 闸 → `haltedUntil` 闸 → 滚动 1 小时上限闸 → `min-dwell` 闸 → 主逻辑。
 *
 * | 事件 | 条件 | 结果 | reason |
 * | --- | --- | --- | --- |
 * | 任意 | `enabled !== true` | none | disabled |
 * | signal | `now < haltedUntil` | none | halted |
 * | signal | 滚动 60 分钟 flips ≥ maxFlipsPerHour | none | limit |
 * | signal | 距 lastFlipAt < 120000 ms | none | min-dwell |
 * | signal | 当前场景**未**失败、且 `order[(i+1)%n]` **也**未失败 | switch-next：记当前进 roundFailed，切后者 | scene-failed |
 * | signal | 当前场景**未**失败、但 `order[(i+1)%n]` **已**失败（= 一轮走完，2.2.2） | halt：当前场景并进本轮、roundCount+1、haltedUntil 按指数算、清空 roundFailed、不切 | round-failed |
 * | signal | 当前场景**已在**本轮失败集合里（兜底：手改文件的旧状态；正常流程走不到） | halt：同上 | round-failed |
 * | tick | `haltedUntil !== null` 且 `now >= haltedUntil` | resume：**只**清 haltedUntil（`roundCount` 保留 = 冷却跨轮叠加） | resume |
 * | tick | 其它 | none | idle |
 *
 * 另有一条**规范外的防御分支**：`order` 少于 2 个（例如 model-routes.json 只有一个场景）
 * 时无处可切 → none / `no-order`。saveConfig 已经禁止存这种顺序，这里只兜住手改文件。
 *
 * @param {object} state loadConfig() 的形状
 * @param {{kind: 'signal'|'tick', reason?: string}} event
 * @param {number} [nowMs]
 * @returns {{action: 'switch-next'|'halt'|'resume'|'none', reason: string, fromScene?: string, toScene?: string, toIndex?: number, roundFailed?: string[], roundCount?: number, haltedUntil?: string}}
 */
export function decision(state, event, nowMs = Date.now()) {
	if (state?.enabled !== true) return { action: "none", reason: "disabled" };

	const kind = event?.kind === "tick" ? "tick" : "signal";
	const haltedMs = timeOf(state?.haltedUntil);

	if (kind === "tick") {
		if (haltedMs !== null && nowMs >= haltedMs) return { action: "resume", reason: "resume" };
		return { action: "none", reason: "idle" };
	}

	// ---- signal：当前场景失效 ----
	if (haltedMs !== null && nowMs < haltedMs) return { action: "none", reason: "halted" };

	const limit = Number.isFinite(state.maxFlipsPerHour) ? state.maxFlipsPerHour : FAILOVER_DEFAULTS.maxFlipsPerHour;
	if (recentFlips(state, nowMs) >= limit) return { action: "none", reason: "limit" };

	if (nowMs - lastFlipMs(state) < MIN_DWELL_MS) return { action: "none", reason: "min-dwell" };

	const order = orderOf(state);
	if (order.length < 2) return { action: "none", reason: "no-order" };

	const index = indexOf(state, order);
	const currentScene = order[index];
	const failed = Array.isArray(state.roundFailed) ? state.roundFailed : [];

	if (!failed.includes(currentScene)) {
		const toIndex = (index + 1) % order.length;
		const nextScene = order[toIndex];
		// 2.2.2：下一个场景已经失败过 ⇒ 剩余场景全部失败过（order 是环，只有从起点按顺序
		// 走过的场景才会进 roundFailed）⇒ 当前这次失效就是整轮的最后一次，直接 halt，
		// 不再切到那个已知失效的场景空转一轮（2.2.1 及更早要等下一次信号才停）。
		if (failed.includes(nextScene)) return roundFailedVerdict(state, nowMs, currentScene, failed);
		return { action: "switch-next", reason: "scene-failed", fromScene: currentScene, toScene: nextScene, toIndex };
	}

	// 一圈走回来又撞上已失效的场景 = 整轮无一可用 ⇒ 停手，指数冷却。
	// （新分支上线后正常流程已走不到这里，留着兜住手改文件写出的旧状态。）
	return roundFailedVerdict(state, nowMs, currentScene, failed);
}

/** 事件 → 写进 lastSignal 的形状（signal 才有）。 */
function signalRecord(event, nowMs) {
	const at = new Date(nowMs).toISOString();
	const record = {
		at: typeof event?.at === "string" && Number.isFinite(Date.parse(event.at)) ? event.at : at,
		handledAt: at,
	};
	if (typeof event?.reason === "string" && event.reason !== "") record.reason = event.reason;
	if (typeof event?.code === "string" && event.code !== "") record.code = event.code;
	if (typeof event?.role === "string" && event.role !== "") record.role = event.role;
	return record;
}

/**
 * 跑一次决策并按结果执行（副作用都在这里：写 model-routes.json + failover.json）。
 *
 * 切换**只走 `selectScenario`**：它校验场景完整、并由 region.js 的 `persist()` 一次
 * 写齐 `scenarios` / `activeScenario` / 派生 `roles`。切失败（场景不存在 / 没选全模型 /
 * 文件不可写）时**一个字节都不写**，只记一条 warn 并返回 action 'none' / reason
 * 'switch-failed'（spec：切失败不写状态）。
 *
 * @param {object} [ctx] cordis 上下文（只用 logger，可缺）
 * @param {object} event { kind: 'signal'|'tick', reason?, code?, role? }
 * @param {number} [nowMs]
 * @returns {{action: string, reason: string, state: object, scene?: string, error?: string}}
 */
export function applyDecision(ctx, event, nowMs = Date.now()) {
	const state = loadConfig();
	const verdict = decision(state, event, nowMs);
	const at = new Date(nowMs).toISOString();
	const next = { ...state };
	if (event?.kind === "signal") next.lastSignal = signalRecord(event, nowMs);

	if (verdict.action === "none") {
		// tick 的 idle 不写盘（30s 一次，别拿空转刷文件）；signal 要留痕，让面板看得见。
		if (event?.kind === "signal") writeJsonAtomic(failoverPath(), next);
		return { ...verdict, state: next };
	}

	if (verdict.action === "halt") {
		next.roundFailed = [];
		next.roundCount = verdict.roundCount;
		next.haltedUntil = verdict.haltedUntil;
		writeJsonAtomic(failoverPath(), next);
		const round = Array.isArray(verdict.roundFailed) && verdict.roundFailed.length > 0 ? verdict.roundFailed : [verdict.fromScene];
		ctx?.logger?.warn?.(`${NS}: 本轮 ${round.length} 个场景全部失效（${round.join(" → ")}），暂停自动切换至 ${verdict.haltedUntil}`);
		return { ...verdict, state: next };
	}

	if (verdict.action === "resume") {
		// 只解除暂停：`roundCount` **不清**（2.2.1 起冷却跨轮叠加——连续整轮失败才会
		// 30 → 60 → 120 → … 逐档翻倍；清掉它就等于每轮都从 30 分钟重新起算）。
		next.haltedUntil = null;
		writeJsonAtomic(failoverPath(), next);
		ctx?.logger?.info?.(`${NS}: 冷却结束，恢复自动切换（当前 ${state.order?.[state.currentIndex] ?? "—"}）`);
		return { ...verdict, state: next };
	}

	// ---- switch-next ----
	const scene = verdict.toScene;
	try {
		selectScenario(scene);
	} catch (error) {
		const message = String(error?.message ?? error);
		ctx?.logger?.warn?.(`${NS}: 自动失效切换失败（场景 ${scene}）：${message}`);
		return { action: "none", reason: "switch-failed", error: message, state };
	}

	next.currentIndex = verdict.toIndex;
	next.lastFlipAt = at;
	next.roundFailed = [...(Array.isArray(state.roundFailed) ? state.roundFailed : []), verdict.fromScene];
	next.flips = [...(Array.isArray(next.flips) ? next.flips : []), { at, from: verdict.fromScene, to: scene, reason: verdict.reason }].slice(
		-MAX_FLIPS,
	);
	writeJsonAtomic(failoverPath(), next);
	ctx?.logger?.info?.(`${NS}: 自动失效切换 ${verdict.fromScene} → ${scene}（${verdict.reason}）`);
	return { ...verdict, state: next, scene };
}

/** 面板 / 路由要的只读快照：配置 + 可选场景清单 + 生效场景 + 状态摘要。 */
export function failoverSnapshot() {
	const snapshot = stateSnapshot();
	const config = loadConfig();
	const order = Array.isArray(config.order) ? config.order : [];
	const index = Number.isInteger(config.currentIndex) ? config.currentIndex : 0;
	return {
		config,
		scenes: snapshot.scenarios.map((scene) => ({
			id: scene.id,
			label: scene.label,
			complete: scene.complete === true,
		})),
		activeScenario: snapshot.activeScenario,
		state: {
			currentIndex: index,
			currentScene: order[index] ?? null,
			haltedUntil: config.haltedUntil,
			roundFailed: config.roundFailed,
			roundCount: config.roundCount,
			flips: (Array.isArray(config.flips) ? config.flips : []).slice(-10),
		},
	};
}

// ---------------------------------------------------------------------------
// 轮询循环（5s 看信号文件 / 30s 跑一次 tick 决策）
// ---------------------------------------------------------------------------

let pollTimer = null;
let tickTimer = null;
/** 上次看到的信号文件 mtime；null = 还没播种基线（启动时先记一次，不处理历史信号）。 */
let seenSignalMtimeMs = null;

/** 信号文件 mtime（没有文件 → null）。 */
function readSignalMtimeMs() {
	try {
		return statSync(signalPath()).mtimeMs;
	} catch {
		return null;
	}
}

/**
 * 检查一次信号文件：有**新**内容才交给状态机（文件不删，只靠 mtime 去重）。
 * 导出是为了自测能直接驱动一轮，不用真等 5 秒。
 *
 * @param {object} [ctx]
 * @returns {{processed: boolean, action?: string, reason?: string}}
 */
export function pollSignalOnce(ctx) {
	const mtimeMs = readSignalMtimeMs();
	if (mtimeMs === null) return { processed: false };
	if (seenSignalMtimeMs === null) {
		// 启动基线：已有的老信号不补处理（否则重启就等于重放历史限流）。
		seenSignalMtimeMs = mtimeMs;
		return { processed: false };
	}
	if (mtimeMs === seenSignalMtimeMs) return { processed: false };
	seenSignalMtimeMs = mtimeMs;

	let payload;
	try {
		payload = JSON.parse(readFileSync(signalPath(), "utf8"));
	} catch (error) {
		ctx?.logger?.warn?.(`${NS}: 信号文件读不动（${String(error?.message ?? error)}）`);
		return { processed: false };
	}
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return { processed: false };
	// 信号文件的版本是**写者契约**（预设恒写 1），与本模块状态版本无关。
	if (payload.schemaVersion !== undefined && payload.schemaVersion !== SIGNAL_SCHEMA_VERSION) {
		ctx?.logger?.warn?.(`${NS}: 信号文件版本 ${String(payload.schemaVersion)} 不认识，忽略`);
		return { processed: false };
	}
	const verdict = applyDecision(ctx, {
		kind: "signal",
		reason: typeof payload.reason === "string" && payload.reason !== "" ? payload.reason : "rate_limit",
		code: payload.code,
		role: payload.role,
		at: payload.at,
	});
	return { processed: true, action: verdict.action, reason: verdict.reason };
}

/** 起两个 interval（幂等：先停旧的）。返回 disposer。 */
function startTimers(ctx) {
	stopFailoverLoop();
	seenSignalMtimeMs = readSignalMtimeMs();
	const guard = (fn) => () => {
		try {
			fn();
		} catch (error) {
			// 循环里的异常绝不能让插件停摆。
			ctx?.logger?.warn?.(`${NS}: failover loop error: ${String(error?.message ?? error)}`);
		}
	};
	pollTimer = setInterval(guard(() => pollSignalOnce(ctx)), POLL_MS);
	tickTimer = setInterval(guard(() => applyDecision(ctx, { kind: "tick" })), TICK_MS);
	// 不因为这两个定时器把宿主进程钉住（不影响正常退出）。
	pollTimer.unref?.();
	tickTimer.unref?.();
	return () => stopFailoverLoop();
}

/**
 * 启动失效切换循环（通过 `ctx.effect` 挂到插件生命周期，卸载即清理）。
 * @param {object} ctx cordis 上下文
 * @returns {() => void} disposer
 */
export function startFailoverLoop(ctx) {
	if (typeof ctx?.effect === "function") {
		ctx.effect(() => startTimers(ctx), `${NS}: failover loop`);
		return () => stopFailoverLoop();
	}
	return startTimers(ctx);
}

/** 停循环并清 mtime 缓存（幂等）。 */
export function stopFailoverLoop() {
	if (pollTimer !== null) {
		clearInterval(pollTimer);
		pollTimer = null;
	}
	if (tickTimer !== null) {
		clearInterval(tickTimer);
		tickTimer = null;
	}
	seenSignalMtimeMs = null;
}
