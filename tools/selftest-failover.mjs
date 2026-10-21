/**
 * 自动失效切换自测（离线，不启动 DSH）：
 *
 *   node tools/selftest-failover.mjs
 *
 * 覆盖 v2 语义：「场景失效 → 按 `order` 切下一个 → `order` 里每个场景各失败一次（下一个
 * 场景已经失败过 = 一轮走完）→ 进指数冷却 → 冷却到点只解除暂停（**不回切**）」的状态机、
 * 配置校验、v1 迁移、信号文件契约（预设 route-fallback 写 v1、本插件读 v1），以及「未启用
 * 时一个字节都不写 model-routes.json」。2.2.2 起一轮 = N 个场景 N 次失败信号（不再空转
 * 一次），§6 / §7 / §15 三处按这条语义断言（N=2 与 N=3 各一次）。
 *
 * 三条硬纪律：
 * - 全程用**临时 DSH_HOME**（mkdtemp），真实 <DSH_HOME>/orchestrator2/*.json 一个字节
 *   都不改（末尾用哈希复核）。
 * - 时间一律用注入的 `nowMs` 拨快，不真等冷却（否则要跑半小时以上）。
 * - 断言逐条 PASS/FAIL；EXIT=0 = 全过。
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const region = await import("../host/region.js");

/** 真实 DSH_HOME 的 model-routes.json 哈希（覆盖前先取，末尾复核「没碰过」）。 */
const realRoutesPath = region.routesPath();
const realRoutesHash = hashFile(realRoutesPath);

/**
 * 三个真实数据文件**改动前**的（存在性 + SHA-256）快照。
 *
 * 真机上 `model-routes.json` / `failover.json` 现在确实存在、`failover-signal.json` 可能
 * 还没被写过，所以不写死期望值：开头取快照、末尾复核「与开头逐字节一致」，缺文件也算
 * 一种状态（哈希占位串一致 = 仍然缺）。自测全程只在临时 DSH_HOME 里写。
 */
const realDataFiles = ["model-routes.json", "failover.json", "failover-signal.json"].map((name) => {
	const path = join(region.dshHome(), "orchestrator2", name);
	return { name, path, before: hashFile(path) };
});

const home = mkdtempSync(join(tmpdir(), "or2-failover-selftest-"));
process.env.DSH_HOME = home;

const failover = await import("../host/failover.js");

let checks = 0;
let failures = 0;

function check(name, actual, expected) {
	checks += 1;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  PASS ${name}`);
		return;
	}
	failures += 1;
	console.log(`  FAIL ${name}\n       actual   = ${a}\n       expected = ${e}`);
}

function checkTrue(name, actual, detail) {
	checks += 1;
	if (actual) {
		console.log(`  PASS ${name}`);
		return;
	}
	failures += 1;
	console.log(`  FAIL ${name}${detail === undefined ? "" : `（${detail}）`}`);
}

/** 断言 fn 抛错（可指定 message 必含的片段）。 */
function checkThrows(name, fn, needle) {
	checks += 1;
	try {
		fn();
	} catch (error) {
		const message = String(error?.message ?? error);
		if (needle === undefined || message.includes(needle)) {
			console.log(`  PASS ${name}（抛错：${message}）`);
			return;
		}
		failures += 1;
		console.log(`  FAIL ${name}\n       message = ${message}\n       期望包含 = ${needle}`);
		return;
	}
	failures += 1;
	console.log(`  FAIL ${name}\n       没有抛错（预期抛错）`);
}

function hashFile(path) {
	return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : "(文件不存在)";
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function iso(ms) {
	return new Date(ms).toISOString();
}

/** 只比 action / reason（决策对象还带 fromScene 之类的辅助字段）。 */
function act(verdict) {
	return [verdict.action, verdict.reason];
}

/** 宿主上下文的最小替身：只收集日志，便于断言「记了一行」。 */
const logs = [];
const ctx = {
	logger: {
		info: (message) => logs.push(`info ${message}`),
		warn: (message) => logs.push(`warn ${message}`),
	},
};

/** 三条路线（两侧前缀不同，切场景后 roles 派生会明显变化）。 */
const FREE_A = { provider: "deepseek-official", model: "cn:glm-5.3-flash" };
const FREE_B = { provider: "deepseek-official", model: "global:minimax-m3.1-flash" };
const PAID_A = { provider: "deepseek-official", model: "cn:deepseek-v4.1-flash" };
const PAID_B = { provider: "deepseek-official", model: "global:deepseek-v4.1-flash" };
const SPARE_A = { provider: "deepseek-official", model: "cn:kimi-k3" };
const SPARE_B = { provider: "deepseek-official", model: "global:kimi-k3" };

/** 造一个完整场景（三角色两侧都选全，否则 selectScenario 会拒绝）。 */
function scene(id, label, left, right) {
	const roles = {};
	for (const role of region.ROLES) roles[role] = { a: left, b: right };
	return { id, labels: { a: `${label}·国内`, b: `${label}·国际` }, primary: "a", roles };
}

/** 合成状态（纯函数 decision 用，不落盘）。 */
function synthetic(overrides) {
	return { ...failover.FAILOVER_DEFAULTS, enabled: true, ...overrides };
}

const ORDER = ["scene-2", "scene-1", "scene-3"];

/** 2 分钟最小驻留（每次信号之间要拨过它，否则只会得到 none/min-dwell）。 */
const DWELL = failover.MIN_DWELL_MS;

console.log("== 0. 环境与路径 ==");
checkTrue("dshHome() 解析到临时目录", region.dshHome().toLowerCase() === home.toLowerCase(), region.dshHome());
checkTrue("failover.json 落在临时 DSH_HOME 下", failover.failoverPath().toLowerCase().startsWith(home.toLowerCase()), failover.failoverPath());
checkTrue(
	"failover-signal.json 落在临时 DSH_HOME 下",
	failover.signalPath().toLowerCase().startsWith(home.toLowerCase()),
	failover.signalPath(),
);
checkTrue("临时 DSH_HOME 与真实 model-routes.json 不同", failover.failoverPath() !== realRoutesPath);

console.log("== 1. 播种三个场景 + 初始配置 ==");
region.saveScenarios({
	scenarios: [scene("scene-1", "收费", PAID_A, PAID_B), scene("scene-2", "免费", FREE_A, FREE_B), scene("scene-3", "备选", SPARE_A, SPARE_B)],
	activeScenario: "scene-2",
});
check("三个场景就位、当前使用中 = scene-2", region.stateSnapshot().activeScenario, "scene-2");

const seed = failover.loadConfig();
check("默认配置：未启用、上限 12、整轮冷却 30、无暂停", [seed.enabled, seed.maxFlipsPerHour, seed.roundCooldownMin, seed.haltedUntil], [
	false,
	12,
	30,
	null,
]);
check("默认 order = model-routes.json 的场景顺序", seed.order, ["scene-1", "scene-2", "scene-3"]);
check("currentIndex 跟随 activeScenario（scene-2 → 1）", seed.currentIndex, 1);

const ordered = failover.saveConfig({ order: ORDER });
check("显式设顺序后 currentIndex 跟着生效场景走（scene-2 → 0）", ordered.currentIndex, 0);

console.log("== 2. ① 未启用：信号来了也一个字都不写 model-routes.json ==");
const routesBefore = hashFile(region.routesPath());
const disabled = failover.applyDecision(ctx, { kind: "signal", reason: "rate_limit", code: "RATE_LIMIT", role: "reviewer" });
check("未启用 → signal = none/disabled", act(disabled), ["none", "disabled"]);
check("未启用 → tick 也 = none/disabled", act(failover.decision(failover.loadConfig(), { kind: "tick" }, Date.now())), ["none", "disabled"]);
check("未启用 → model-routes.json 字节不变", hashFile(region.routesPath()), routesBefore);
check("未启用 → activeScenario 仍是 scene-2", region.stateSnapshot().activeScenario, "scene-2");

console.log("== 3. ② 启用 + 信号 → 切到 order[1] 且 roles 派生同步 ==");
failover.saveConfig({ enabled: true });
const rolesBefore = readJson(region.routesPath()).roles;
check("启用后 roles.reviewer.default.model = 免费线", rolesBefore.reviewer.default.model, FREE_A.model);

const t0 = Date.now();
const flip1 = failover.applyDecision(ctx, { kind: "signal", reason: "rate_limit", code: "RATE_LIMIT", role: "reviewer" }, t0);
check("决策 = switch-next / scene-failed", act(flip1), ["switch-next", "scene-failed"]);
check("from → to = scene-2 → scene-1（order[1]）", [flip1.fromScene, flip1.toScene], ["scene-2", "scene-1"]);
check("落盘 currentIndex = 1", flip1.state.currentIndex, 1);
check("lastFlipAt 记下翻转时刻", flip1.state.lastFlipAt, iso(t0));
check("roundFailed 记下失败过的场景", flip1.state.roundFailed, ["scene-2"]);
check(
	"flips 追加 1 条（scene-2 → scene-1 / scene-failed）",
	flip1.state.flips.map((f) => [f.from, f.to, f.reason]),
	[["scene-2", "scene-1", "scene-failed"]],
);
check("model-routes.json 的 activeScenario = scene-1", readJson(region.scenariosPath()).activeScenario, "scene-1");
check("roles 派生随场景变化（reviewer 换成收费线）", readJson(region.routesPath()).roles.reviewer.default.model, PAID_A.model);
checkTrue("roles 整表确实变了", JSON.stringify(readJson(region.routesPath()).roles) !== JSON.stringify(rolesBefore));
checkTrue("切场景记了一行 info 日志", logs.some((line) => line.startsWith("info ") && line.includes("自动失效切换")));

console.log("== 4. ③ 刚切 60s 内再信号 → none/min-dwell（最小驻留 120s）==");
const flip2 = failover.applyDecision(ctx, { kind: "signal", reason: "rate_limit", code: "RATE_LIMIT", role: "developer" }, t0 + 60_000);
check("60s 内再信号 → none/min-dwell", act(flip2), ["none", "min-dwell"]);
check("flips 没有追加", flip2.state.flips.length, 1);
check("activeScenario 没动", region.stateSnapshot().activeScenario, "scene-1");

console.log("== 5. ④ 超过 120s 再信号 → 切到 order[2]（三场景）==");
const t4 = t0 + 130_000;
const flip3 = failover.applyDecision(ctx, { kind: "signal", reason: "rate_limit", code: "RATE_LIMIT", role: "researcher" }, t4);
check("决策 = switch-next / scene-failed", act(flip3), ["switch-next", "scene-failed"]);
check("scene-1 → scene-3（order[2]）", [flip3.fromScene, flip3.toScene], ["scene-1", "scene-3"]);
check("roundFailed 累计两个", flip3.state.roundFailed, ["scene-2", "scene-1"]);
check("activeScenario = scene-3", readJson(region.scenariosPath()).activeScenario, "scene-3");

console.log("== 6. ⑤ 一轮走完 = order 里每个场景各失败一次 → 第 3 次（= 场景数）信号直接 halt ==");
const flipsBeforeHalt = failover.loadConfig().flips.length;
const routesBeforeHalt = hashFile(region.routesPath());
const t5 = t4 + 130_000;
const halted = failover.applyDecision(ctx, { kind: "signal", reason: "rate_limit", code: "RATE_LIMIT", role: "reviewer" }, t5);
check("决策 = halt / round-failed（第 3 次信号 = 场景数 3）", act(halted), ["halt", "round-failed"]);
check("halt 发生在末尾场景 scene-3（不再切回已失败的 scene-2 空转一次）", halted.fromScene, "scene-3");
check("本轮失败集合 = 三个场景全（当前场景也记进本轮）", halted.roundFailed, ["scene-2", "scene-1", "scene-3"]);
check("roundCount = 1", halted.state.roundCount, 1);
check("haltedUntil = now + 30 分钟（第一档）", halted.state.haltedUntil, iso(t5 + 30 * 60_000));
check("roundFailed 清空（下一轮重新记）", halted.state.roundFailed, []);
check("halt 那一次不产生 flip（flips 数量不变）", halted.state.flips.length, flipsBeforeHalt);
check("暂停这一刻不切场景：model-routes.json 字节不变", hashFile(region.routesPath()), routesBeforeHalt);
check("currentIndex 不动（仍指向 scene-3 → 2）", halted.state.currentIndex, 2);
check("activeScenario 仍 scene-3（没有切回已失败的 scene-2）", readJson(region.scenariosPath()).activeScenario, "scene-3");
checkTrue("暂停记了一行 warn 日志", logs.some((line) => line.startsWith("warn ") && line.includes("暂停自动切换")));

console.log("== 7. ⑥ 一轮 = N 次失败信号（N=2 / N=3 各断言一次）==");

/** 从 `startMs` 连打信号，返回 [action, reason] 轨迹（每次之间拨过最小驻留）。 */
function signalTrace(startMs, maxSteps) {
	const trace = [];
	let now = startMs;
	for (let step = 0; step < maxSteps; step += 1) {
		const verdict = failover.applyDecision(ctx, { kind: "signal", reason: "rate_limit", code: "RATE_LIMIT", role: "reviewer" }, now);
		trace.push(act(verdict));
		if (verdict.action === "halt") break;
		now += DWELL + 1_000;
	}
	return trace;
}

// N=3：三场景顺序 → 1 切、2 切、3 halt（2.2.1 及更早是 1 切、2 切、3 切、4 halt）。
const tN3 = t5 + 24 * 60 * 60_000;
failover.saveConfig({ enabled: true, reset: true, order: ORDER, roundCooldownMin: 30, maxFlipsPerHour: 60 });
check("N=3：3 个场景 3 次信号即 halt", signalTrace(tN3, 5), [
	["switch-next", "scene-failed"],
	["switch-next", "scene-failed"],
	["halt", "round-failed"],
]);

// N=2：只留两个场景的顺序（saveConfig 允许长度 ≥2）→ 1 切、2 halt。
const tN2 = tN3 + 24 * 60 * 60_000;
const TWO_SCENE_ORDER = ["scene-1", "scene-3"];
failover.saveConfig({ enabled: true, reset: true, order: TWO_SCENE_ORDER, roundCooldownMin: 30, maxFlipsPerHour: 60 });
check("N=2：两场景顺序就位、当前 = scene-1", [failover.loadConfig().order, failover.loadConfig().currentIndex], [TWO_SCENE_ORDER, 0]);
check("N=2：2 个场景 2 次信号即 halt", signalTrace(tN2, 4), [
	["switch-next", "scene-failed"],
	["halt", "round-failed"],
]);
const n2AfterHalt = failover.loadConfig();
check("N=2：整轮只有 1 条 flip（halt 那一次不产生 flip）", n2AfterHalt.flips.length, 1);
check("N=2：halt 后 roundFailed 清空", n2AfterHalt.roundFailed, []);
check("N=2：roundCount 递增到 1", n2AfterHalt.roundCount, 1);
check("N=2：halt 那一刻没切场景（currentIndex 停在 order[1] = scene-3）", n2AfterHalt.currentIndex, 1);
check("N=2：halt 后 activeScenario 仍 scene-3", readJson(region.scenariosPath()).activeScenario, "scene-3");

console.log("== 8. ⑦ 冷却未到再信号 → none/halted ==");
const n2HaltAt = tN2 + DWELL + 1_000; // N=2 的第 2 次信号（= halt 那一次）
const t6 = Date.parse(n2AfterHalt.haltedUntil);
check("N=2 那次的冷却 = 30 分钟（第一档）", (t6 - n2HaltAt) / 60_000, 30);
const early = failover.applyDecision(ctx, { kind: "signal", reason: "rate_limit", code: "RATE_LIMIT", role: "reviewer" }, t6 - 20 * 60_000);
check("冷却中再信号 → none/halted", act(early), ["none", "halted"]);
check("冷却中 flips 仍然不增", early.state.flips.length, 1);
check("冷却中 tick 也不动 scene", act(failover.decision(failover.loadConfig(), { kind: "tick" }, t6 - 60_000)), ["none", "idle"]);

console.log("== 9. ⑧ 冷却到点 tick → 只解除暂停（roundCount 保留 = 跨轮叠加），再信号可切 ==");
const resumed = failover.applyDecision(ctx, { kind: "tick" }, t6);
check("tick 到点 → resume", act(resumed), ["resume", "resume"]);
check("haltedUntil 清空", resumed.state.haltedUntil, null);
check("roundCount 保留 1（2.2.1 起 resume 不再清零，冷却跨轮叠加）", resumed.state.roundCount, 1);
check("resume 不切场景（activeScenario 仍 scene-3）", readJson(region.scenariosPath()).activeScenario, "scene-3");
const afterResume = failover.applyDecision(ctx, { kind: "signal", reason: "rate_limit", code: "RATE_LIMIT", role: "reviewer" }, t6 + 1_000);
check("解除暂停后信号又能切 → switch-next / scene-failed", act(afterResume), ["switch-next", "scene-failed"]);
check("scene-3 → scene-1（两场景顺序 [scene-1, scene-3] 的下一个）", [afterResume.fromScene, afterResume.toScene], [
	"scene-3",
	"scene-1",
]);
check("拨回三场景顺序（后面的校验 / 迁移 / 冷却阶梯都按 ORDER 走）", failover.saveConfig({ enabled: true, order: ORDER }).order, ORDER);

console.log("== 10. ⑨ 滚动 1 小时上限 + 指数冷却阶梯（纯函数）==");
const now10 = t0 + 40 * 60_000;
const capped = synthetic({
	order: ORDER,
	currentIndex: 0,
	lastFlipAt: iso(now10 - 60 * 60_000),
	maxFlipsPerHour: 12,
	flips: Array.from({ length: 12 }, (_unused, index) => ({
		at: iso(now10 - index * 60_000 - 1_000),
		from: "scene-2",
		to: "scene-1",
		reason: "scene-failed",
	})),
});
check("12 条滚动翻转 → signal = none/limit", act(failover.decision(capped, { kind: "signal", reason: "rate_limit" }, now10)), [
	"none",
	"limit",
]);
check(
	"只留 11 条（< 上限 12）→ 放行 switch-next",
	failover.decision({ ...capped, flips: capped.flips.slice(1) }, { kind: "signal", reason: "rate_limit" }, now10).action,
	"switch-next",
);
check("tick 不撞上限（只要没 halt 就 idle）", act(failover.decision(capped, { kind: "tick" }, now10)), ["none", "idle"]);

// 冷却阶梯不再用「注入 roundCount」冒充：改由 §15 用真实拨钟连推多轮验证。
check("顺序不足两个场景 → none/no-order（防御）", act(failover.decision(synthetic({ order: ["scene-2"] }), { kind: "signal" }, now10)), [
	"none",
	"no-order",
]);

// 2.2.2 的两条 halt 入口（纯函数直测，不依赖文件）：
// ① 当前场景未失败、但下一个已失败 = 一轮走完 → 直接 halt（新分支）
check(
	"下一个场景已失败（一轮走完）→ halt/round-failed（不再空转一次）",
	act(failover.decision(synthetic({ order: ORDER, currentIndex: 2, roundFailed: ["scene-2"] }), { kind: "signal" }, now10)),
	["halt", "round-failed"],
);
check(
	"新分支也把当前场景记进本轮（roundFailed 含 scene-3）",
	failover.decision(synthetic({ order: ORDER, currentIndex: 2, roundFailed: ["scene-2"] }), { kind: "signal" }, now10).roundFailed,
	["scene-2", "scene-3"],
);
// ② 下一个场景未失败 → 照旧 switch-next（别把闸关得太宽）
check(
	"下一个场景未失败 → 仍 switch-next/scene-failed",
	act(failover.decision(synthetic({ order: ORDER, currentIndex: 2, roundFailed: ["scene-1"] }), { kind: "signal" }, now10)),
	["switch-next", "scene-failed"],
);
// ③ 兜底分支保留：当前场景已在 roundFailed 里（手改文件的旧状态）→ 仍 halt
check(
	"兜底：当前场景已在 roundFailed 里 → 仍 halt/round-failed",
	act(failover.decision(synthetic({ order: ORDER, currentIndex: 1, roundFailed: ["scene-1"] }), { kind: "signal" }, now10)),
	["halt", "round-failed"],
);

console.log("== 11. ⑩ order 校验（saveConfig 抛错 → 路由层 400）==");
checkThrows("重复 id → 抛错", () => failover.saveConfig({ order: ["scene-1", "scene-1"] }), "重复");
checkThrows("含不存在的 id → 抛错", () => failover.saveConfig({ order: ["scene-1", "scene-9"] }), "不存在");
checkThrows("长度 1 → 抛错", () => failover.saveConfig({ order: ["scene-1"] }), "至少要两个");
checkThrows("非数组 → 抛错", () => failover.saveConfig({ order: "scene-1,scene-2" }), "数组");
checkThrows("roundCooldownMin 越界（0）→ 抛错", () => failover.saveConfig({ roundCooldownMin: 0 }), "roundCooldownMin");
checkThrows("maxFlipsPerHour 越界（61）→ 抛错", () => failover.saveConfig({ maxFlipsPerHour: 61 }), "maxFlipsPerHour");
checkThrows("enabled 非布尔 → 抛错", () => failover.saveConfig({ enabled: "yes" }), "enabled");
checkThrows("非整数 → 抛错", () => failover.saveConfig({ perSceneProbeMin: 2.5 }), "整数");
const edged = failover.saveConfig({ roundCooldownMin: 1, maxFlipsPerHour: 60, perSceneProbeMin: 120 });
check("合法边界值落盘", [edged.roundCooldownMin, edged.maxFlipsPerHour, edged.perSceneProbeMin], [1, 60, 120]);
check("非法请求不改盘（顺序仍是三场景）", failover.loadConfig().order, ORDER);

console.log("== 12. ⑪ 旧 schemaVersion:1 迁移成 v2（幂等）==");
mkdirSync(join(home, "orchestrator2"), { recursive: true });
const v1Body = {
	schemaVersion: 1,
	enabled: true,
	freeScene: "scene-2",
	paidScene: "scene-1",
	cooldownMin: 10,
	probeWindowMin: 10,
	maxFlipsPerHour: 6,
	current: "paid",
	lastFlipAt: iso(t0),
	flips: [{ at: iso(t0), from: "free", to: "paid", reason: "rate_limit" }],
	backoffMin: 10,
	lastSignal: null,
};
writeFileSync(failover.failoverPath(), `${JSON.stringify(v1Body, null, 2)}\n`, "utf8");
const migrated = failover.loadConfig();
check("schemaVersion 升到 2", migrated.schemaVersion, 2);
check("order = [paidScene, freeScene]", migrated.order, ["scene-1", "scene-2"]);
check("enabled 保持原值", migrated.enabled, true);
check("currentIndex 按 activeScenario 定位（scene-1 在 order[0]）", migrated.currentIndex, 0);
check("旧冷却字段是改名不是丢值（cooldownMin 10 → roundCooldownMin 10）", migrated.roundCooldownMin, 10);
check("旧 flips 记录里的 free/paid 映射成场景 id", migrated.flips.map((f) => [f.from, f.to]), [["scene-2", "scene-1"]]);
const migratedRaw = readJson(failover.failoverPath());
checkTrue(
	"迁移后文件里不再有 v1 字段",
	["freeScene", "paidScene", "cooldownMin", "probeWindowMin", "current", "backoffMin"].every((key) => !Object.hasOwn(migratedRaw, key)),
	Object.keys(migratedRaw).join(","),
);
const migratedBytes = readFileSync(failover.failoverPath(), "utf8");
const secondLoad = failover.loadConfig();
check("迁移幂等：再读一次不变（不重复改写）", readFileSync(failover.failoverPath(), "utf8"), migratedBytes);
check("迁移幂等：第二次读出的状态一致", [secondLoad.schemaVersion, secondLoad.order, secondLoad.currentIndex], [2, ["scene-1", "scene-2"], 0]);

console.log("== 13. currentIndex 必须与实际 activeScenario 一致（loadConfig 校正并回写）==");
writeFileSync(
	failover.failoverPath(),
	`${JSON.stringify({ ...failover.loadConfig(), order: ORDER, currentIndex: 2, enabled: true }, null, 2)}\n`,
	"utf8",
);
const corrected = failover.loadConfig();
check("文件里写的 currentIndex 2 与生效场景 scene-1 不符 → 校正成 1", corrected.currentIndex, 1);
check("校正结果已回写文件", readJson(failover.failoverPath()).currentIndex, 1);

console.log("== 14. 信号文件契约（预设写 schemaVersion:1 → 本插件读并处理）==");
failover.saveConfig({ enabled: true, reset: true, order: ORDER });
check("reset 清空历史", [failover.loadConfig().flips.length, failover.loadConfig().lastFlipAt, failover.loadConfig().roundFailed], [0, null, []]);
const signalBody = { schemaVersion: 1, at: iso(t0), reason: "rate_limit", code: "RATE_LIMIT", role: "reviewer" };
writeFileSync(failover.signalPath(), `${JSON.stringify(signalBody, null, 2)}\n`, "utf8");
check("启动基线：老信号不补处理", failover.pollSignalOnce(ctx).processed, false);
check("基线不翻转（activeScenario 仍 scene-1）", readJson(region.scenariosPath()).activeScenario, "scene-1");
await new Promise((resolve) => setTimeout(resolve, 25));
writeFileSync(failover.signalPath(), `${JSON.stringify({ ...signalBody, at: iso(t0 + 60_000) }, null, 2)}\n`, "utf8");
const polled = failover.pollSignalOnce(ctx);
check("信号版本 1 仍被接受（与本模块状态版本解耦）并切到下一个", [polled.processed, polled.action, polled.reason], [
	true,
	"switch-next",
	"scene-failed",
]);
check("activeScenario = scene-3（scene-1 的下一个）", readJson(region.scenariosPath()).activeScenario, "scene-3");
const afterPoll = failover.loadConfig();
check("lastSignal 记下 handledAt（文件不删）", [typeof afterPoll.lastSignal?.handledAt, existsSync(failover.signalPath())], ["string", true]);
check("lastSignal 带着信号里的 reason/role", [afterPoll.lastSignal?.reason, afterPoll.lastSignal?.role], ["rate_limit", "reviewer"]);
check("同一 mtime 不重复处理", failover.pollSignalOnce(ctx).processed, false);

console.log("== 15. ⑬ 指数冷却跨轮叠加（真实拨钟驱动整轮，不注入 roundCount）==");
// 清历史 + 把基准冷却拨回 30（§11 的边界测试把它改成过 1）+ 把滚动上限抬到 60
// （默认 12 会先撞「每小时上限」闸，把冷却阶梯遮住）。
failover.saveConfig({ enabled: true, reset: true, order: ORDER, roundCooldownMin: 30, maxFlipsPerHour: 60 });
check("跨轮起点：基准冷却 = 30、roundCount = 0", [failover.loadConfig().roundCooldownMin, failover.loadConfig().roundCount], [30, 0]);

/**
 * 从 `startMs` 开始连打信号驱动**一整轮**。
 *
 * 2.2.2 起「一轮 = order 里每个场景各失败一次」⇒ **n 个场景 = n 次信号**（第 1~n−1 次
 * 是 switch-next、第 n 次直接 halt）；2.2.1 及更早要 n+1 次（第 n+1 次才绕回已失败场景）。
 * 返回该轮 halt 决策 + 取证数据（halt 前后 flips 条数、落盘的 roundFailed / roundCount）。
 */
function driveRound(startMs) {
	let now = startMs;
	let switches = 0;
	const roundCountBeforeHalt = failover.loadConfig().roundCount;
	for (let step = 1; step <= ORDER.length; step += 1) {
		const isLast = step === ORDER.length;
		const flipsBeforeThis = failover.loadConfig().flips.length;
		const verdict = failover.applyDecision(ctx, { kind: "signal", reason: "rate_limit", code: "RATE_LIMIT", role: "reviewer" }, now);
		if (!isLast) {
			if (verdict.action !== "switch-next") {
				throw new Error(`第 ${step}/${ORDER.length} 次信号应为 switch-next，实得 ${verdict.action}/${verdict.reason}（起点 ${startMs}）`);
			}
			switches += 1;
			now += DWELL + 1_000;
			continue;
		}
		if (verdict.action !== "halt") {
			throw new Error(`第 ${step} 次信号（= 场景数 ${ORDER.length}）应为 halt，实得 ${verdict.action}/${verdict.reason}（起点 ${startMs}）`);
		}
		const after = failover.loadConfig();
		return {
			verdict,
			now,
			switches,
			flipsBeforeHalt: flipsBeforeThis,
			flipsAtHalt: after.flips.length,
			roundFailedAtHalt: after.roundFailed,
			roundCountBeforeHalt,
			roundCountAtHalt: after.roundCount,
		};
	}
	throw new Error(`一整轮没有走到 halt（顺序 ${ORDER.length} 个场景，起点 ${startMs}）`);
}

/** 冷却到点后继续下一轮；返回该轮的 halt 决策。 */
function resumeAndDrive(prev) {
	const at = Date.parse(prev.verdict.haltedUntil);
	const resume = failover.applyDecision(ctx, { kind: "tick" }, at);
	if (resume.action !== "resume") throw new Error(`期望 resume，实得 ${resume.action}/${resume.reason}`);
	if (resume.state.roundCount !== prev.verdict.roundCount) {
		throw new Error(`resume 把 roundCount 从 ${prev.verdict.roundCount} 改成了 ${resume.state.roundCount}`);
	}
	return driveRound(at);
}

/** 一轮的冷却分钟数（haltedUntil - 当时的 now）。 */
const cooldownOf = (round) => (Date.parse(round.verdict.haltedUntil) - round.now) / 60_000;

const round1 = driveRound(t0 + 24 * 60 * 60_000); // 拨到远离上面几节的钟点，互不干扰
check("第 1 轮整轮失败 → roundCount = 1", round1.verdict.roundCount, 1);
check("第 1 轮 = 3 个场景 3 次信号（前 2 次 switch-next）", round1.switches, ORDER.length - 1);
check("第 1 轮冷却 = 30 分钟", cooldownOf(round1), 30);
check("第 1 轮 halt 那一次不产生 flip（flips 数量不变）", round1.flipsAtHalt, round1.flipsBeforeHalt);
check("第 1 轮 halt 当次 roundFailed 被清空", round1.roundFailedAtHalt, []);
check("第 1 轮 roundCount 正确递增（0 → 1）", [round1.roundCountBeforeHalt, round1.roundCountAtHalt], [0, 1]);

const round2 = resumeAndDrive(round1);
check("第 2 轮整轮失败 → roundCount = 2", round2.verdict.roundCount, 2);
check("第 2 轮冷却 = 60 分钟（跨轮叠加，2.2.0 这里是 30）", cooldownOf(round2), 60);
check("第 2 轮 halt 那一次不产生 flip", round2.flipsAtHalt, round2.flipsBeforeHalt);

const round3 = resumeAndDrive(round2);
check("第 3 轮整轮失败 → roundCount = 3", round3.verdict.roundCount, 3);
check("第 3 轮冷却 = 120 分钟", cooldownOf(round3), 120);
check("第 3 轮 halt 那一次不产生 flip", round3.flipsAtHalt, round3.flipsBeforeHalt);

const ladderMinutes = [round1, round2, round3].map(cooldownOf);
let lastRound = round3;
for (let nth = 4; nth <= 7; nth += 1) {
	lastRound = resumeAndDrive(lastRound);
	ladderMinutes.push(cooldownOf(lastRound));
	check(`第 ${nth} 轮冷却（连续整轮失败）`, cooldownOf(lastRound), Math.min(30 * 2 ** (nth - 1), 720));
	check(`第 ${nth} 轮 halt 不产生 flip`, lastRound.flipsAtHalt, lastRound.flipsBeforeHalt);
	check(`第 ${nth} 轮 halt 后 roundFailed 清空`, lastRound.roundFailedAtHalt, []);
	check(`第 ${nth} 轮 roundCount 递增 ${nth - 1} → ${nth}`, [lastRound.roundCountBeforeHalt, lastRound.roundCountAtHalt], [nth - 1, nth]);
}
check("冷却阶梯（真实拨钟、跨轮叠加）= 30 / 60 / 120 / 240 / 480 / 720 / 720", ladderMinutes, [30, 60, 120, 240, 480, 720, 720]);
check("连推 7 轮后 roundCount = 7（证明 resume 一次都没清零）", lastRound.verdict.roundCount, 7);
const afterSeven = failover.loadConfig();
check("落盘的 roundCount 也是 7", afterSeven.roundCount, 7);
check("每轮 halt 都清空本轮失败记录", afterSeven.roundFailed, []);

console.log("== 16. ⑭ 手动路径（改顺序 / 手动切场景）才清零 roundCount ==");
const beforeOrder = failover.loadConfig();
const reordered = failover.saveConfig({ order: ORDER });
check("手动改顺序 → roundCount 清零", reordered.roundCount, 0);
check("手动改顺序 → 本轮失败记录清空", reordered.roundFailed, []);
check("手动改顺序不动翻转历史", reordered.flips.length, beforeOrder.flips.length);
// 直接把 roundCount 播种回 3（模拟「又失败了几轮」），验证「手动切场景」这条路同样清零。
writeFileSync(
	failover.failoverPath(),
	`${JSON.stringify({ ...failover.loadConfig(), roundCount: 3, roundFailed: [ORDER[0]] }, null, 2)}\n`,
	"utf8",
);
const seeded = failover.loadConfig();
check("播种 roundCount = 3 准备下一步", [seeded.roundCount, seeded.roundFailed], [3, [ORDER[0]]]);
const switched = failover.noteManualSceneSwitch();
check("手动切场景 → roundCount 清零 + 本轮记录清空", [switched.roundCount, switched.roundFailed], [0, []]);
check("手动切场景不动翻转历史", switched.flips.length, seeded.flips.length);
check("没有可清的东西时手动路径不写盘（幂等）", failover.noteManualSceneSwitch().roundCount, 0);

console.log("== 17. ⑮ 落盘位置与不碰真实数据文件 ==");
checkTrue("failover.json 已写进临时目录", existsSync(failover.failoverPath()));
checkTrue(
	"所有 failover 文件都在临时 DSH_HOME 下",
	[failover.failoverPath(), failover.signalPath(), region.routesPath()].every((path) => path.toLowerCase().startsWith(home.toLowerCase())),
);
check("真实 model-routes.json 哈希未变", hashFile(realRoutesPath), realRoutesHash);
// 三个真实数据文件逐个复核「存在性 + 哈希」与开头快照一致（真机上 failover.json 存在、
// failover-signal.json 可能还没被写过，所以断言的是「与开头一样」，不是写死的哈希）。
for (const file of realDataFiles) {
	const after = hashFile(file.path);
	const label = after === "(文件不存在)" ? "仍不存在" : after;
	check(`真实 ${file.name} 存在性/哈希未变（现值：${label}）`, after, file.before);
}

rmSync(home, { recursive: true, force: true });

const summary = `SELF-TEST ${failures === 0 ? "OK" : "FAILED"}（${checks} 项，失败 ${failures} 项）`;
console.log(`\n${summary}`);
if (failures > 0) process.exitCode = 1;
