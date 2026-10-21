/**
 * 契约核对（**只读**）：一条命令核对本插件依赖 `dsh-orchestrator2` 的 5 处契约。
 *
 *   node tools/check-contract.mjs
 *
 * 为什么要有它：本插件是纯注入式（不改预设任何文件），但和预设共用
 * `<DSH_HOME>/orchestrator2/` 下的几个数据文件。预设升级后若改了路径或形状，
 * 本插件会「静默失效」（漂移条一直亮 / 失效切换不触发 / 覆盖列表读不到）。
 * 这个脚本把那些隐含契约变成可执行的断言，升级后跑一次就知道要不要适配。
 *
 * 做法：直接 import 预设自己的模块（都是纯函数 + node 内置依赖，import 无副作用，
 * 不会调 apply()），拿它的导出与本插件的 `host/paths.js` 对比 —— 比 grep 源码稳。
 *
 * 退出码：全部 PASS = 0；任一项 FAIL = 1（并指出要改哪个文件）。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import * as ourPaths from "../host/paths.js";
import { guardSnapshot } from "../host/guard.js";

let failures = 0;

/** 打印一条结果；FAIL 计数并给出「改哪里」。 */
function report(index, title, ok, detail, fixAt) {
	const tag = ok ? "PASS" : "FAIL";
	if (!ok) failures += 1;
	console.log(`[${index}] ${title}  ${tag}  ${detail}`);
	if (!ok && fixAt !== undefined) console.log(`      → 要适配：${fixAt}`);
}

/** <DSH_HOME> 推导（与 host/paths.js 同一口径，但这里自己算，避免互相依赖）。 */
function dshHome() {
	const env = process.env.DSH_HOME;
	if (typeof env === "string" && env.trim() !== "") {
		return resolve(env.startsWith("~") ? join(homedir(), env.slice(1)) : env);
	}
	return join(homedir(), ".dsh");
}

/** 找预设安装目录：环境变量 → 各 profile 的 node_modules → plugin-src。 */
function findPresetDir() {
	const explicit = process.env.OR2_PRESET_DIR;
	if (typeof explicit === "string" && explicit.trim() !== "") {
		const dir = resolve(explicit);
		if (existsSync(join(dir, "presets", "orchestrator2", "model-routes.mjs"))) return dir;
	}
	const home = dshHome();
	const profiles = join(home, "profiles");
	if (existsSync(profiles)) {
		for (const name of readdirSync(profiles)) {
			const dir = join(profiles, name, "node_modules", "dsh-orchestrator2");
			if (existsSync(join(dir, "presets", "orchestrator2", "model-routes.mjs"))) return dir;
		}
	}
	const src = join(home, "plugin-src", "dsh-orchestrator2");
	if (existsSync(join(src, "presets", "orchestrator2", "model-routes.mjs"))) return src;
	return null;
}

/** 动态 import 一个预设模块（file URL，避免 ESM 解析歧义）。 */
async function importPreset(dir, name) {
	return import(pathToFileURL(join(dir, "presets", "orchestrator2", name)).href);
}

const presetDir = findPresetDir();
if (presetDir === null) {
	console.log("找不到 dsh-orchestrator2 预设安装目录。");
	console.log("可用环境变量指定：OR2_PRESET_DIR=<预设包根目录>（应含 presets/orchestrator2/model-routes.mjs）");
	process.exit(2);
}

const pkg = JSON.parse(readFileSync(join(presetDir, "package.json"), "utf8"));
console.log(`预设：${pkg.name} v${pkg.version} @ ${presetDir}`);
console.log(`DSH_HOME：${dshHome()}`);
console.log("");

let modelRoutes;
let sessionRoutes;
let routeFallback;
try {
	modelRoutes = await importPreset(presetDir, "model-routes.mjs");
	sessionRoutes = await importPreset(presetDir, "session-routes.mjs");
	routeFallback = await importPreset(presetDir, "route-fallback.mjs");
} catch (error) {
	console.log(`[0] 载入预设模块  FAIL  ${error?.message ?? error}`);
	console.log("      → 预设可能改了模块文件名或导出面；先看 presets/orchestrator2/ 下的文件名。");
	process.exit(1);
}

// ---------------------------------------------------------------------------
// 1) 路径一致：预设写的地方 = 我们读的地方
// ---------------------------------------------------------------------------
{
	const pairs = [
		["model-routes.json", () => modelRoutes.routesPath(), () => ourPaths.routesPath()],
		["sessions 目录", () => sessionRoutes.sessionsDir(), () => ourPaths.sessionStatesDir()],
		["failover-signal.json", () => routeFallback.failoverSignalPath(), () => ourPaths.routesPath().replace(/model-routes\.json$/u, "failover-signal.json")],
	];
	const bad = [];
	for (const [label, theirs, ours] of pairs) {
		let a;
		let b;
		try {
			a = theirs();
			b = ours();
		} catch (error) {
			bad.push(`${label}（取路径抛错：${error?.message ?? error}）`);
			continue;
		}
		if (resolve(a) !== resolve(b)) bad.push(`${label}（预设 ${a} ≠ 本插件 ${b}）`);
	}
	report(
		1,
		"路径一致",
		bad.length === 0,
		bad.length === 0 ? `${pairs.length}/${pairs.length} 条路径逐字相同` : bad.join("；"),
		"host/paths.js 的 routesPath / sessionStatesDir 等函数",
	);
}

// ---------------------------------------------------------------------------
// 2) 路由表形状：schemaVersion + 三角色 + default/fallback 两槽
// ---------------------------------------------------------------------------
{
	const problems = [];
	if (modelRoutes.SCHEMA_VERSION !== 1) problems.push(`SCHEMA_VERSION=${modelRoutes.SCHEMA_VERSION}（本插件按 1 派生）`);
	const roles = Array.isArray(modelRoutes.ROLES) ? [...modelRoutes.ROLES] : [];
	for (const role of ["researcher", "reviewer", "developer"]) {
		if (!roles.includes(role)) problems.push(`ROLES 缺 ${role}`);
	}
	const slots = Array.isArray(modelRoutes.ROUTE_SLOTS) ? [...modelRoutes.ROUTE_SLOTS] : [];
	if (slots.join(",") !== "default,fallback") problems.push(`ROUTE_SLOTS=${slots.join(",") || "（空）"}`);
	// 实读：真实文件能不能被预设自己解析（只读，不落盘）
	let live = "无 model-routes.json（首次运行）";
	try {
		const loaded = modelRoutes.peekRoleRoutes();
		if (loaded === undefined) {
			live = "无 model-routes.json（首次运行）";
		} else {
			const missing = ["researcher", "reviewer", "developer"].filter((role) => loaded?.roles?.[role]?.default === undefined);
			if (missing.length > 0) problems.push(`实际文件缺 default：${missing.join("、")}`);
			live = `实读通过（${Object.keys(loaded?.roles ?? {}).length} 个角色）`;
		}
	} catch (error) {
		problems.push(`实际文件预设解析失败：${error?.message ?? error}`);
	}
	report(2, "路由表形状", problems.length === 0, problems.length === 0 ? `SCHEMA_VERSION=1 ROLES=${roles.length} ROUTE_SLOTS=default,fallback；${live}` : problems.join("；"), "host/region.js 的派生逻辑（writeDerivedRoutes）");
}

// ---------------------------------------------------------------------------
// 3) 会话表形状：roles[*].epoch / overrideRoute、children[*].appliedRoute
// ---------------------------------------------------------------------------
{
	const problems = [];
	let shape = "—";
	try {
		const empty = sessionRoutes.emptySessionState("contract-check-probe");
		if (empty === null || typeof empty !== "object") problems.push("emptySessionState 没返回对象");
		else {
			if (empty.roles === undefined) problems.push("emptySessionState 缺 roles");
			if (empty.children === undefined) problems.push("emptySessionState 缺 children");
			shape = `roles=${Array.isArray(empty.roles) ? "数组" : typeof empty.roles} children=${
				Array.isArray(empty.children) ? "数组" : typeof empty.children
			}`;
		}
	} catch (error) {
		problems.push(`emptySessionState 抛错：${error?.message ?? error}`);
	}
	// 实读现有会话文件：能被预设 normalize 通过 = 形状还对得上（只读）
	const dir = sessionRoutes.sessionsDir();
	let live = "无会话文件";
	if (existsSync(dir)) {
		const files = readdirSync(dir).filter((file) => file.endsWith(".json"));
		let ok = 0;
		const failed = [];
		for (const file of files.slice(0, 20)) {
			const sessionId = file.slice(0, -5);
			try {
				sessionRoutes.loadSessionState(sessionId);
				ok += 1;
			} catch (error) {
				failed.push(`${file}: ${error?.message ?? error}`);
			}
		}
		live = failed.length === 0 ? `${ok}/${files.length} 个会话文件实读通过` : `${ok}/${files.length} 通过；失败：${failed.slice(0, 3).join(" | ")}`;
		if (failed.length > 0) problems.push("有会话文件预设读不通（形状可能变了）");
	}
	report(3, "会话表形状", problems.length === 0, problems.length === 0 ? `emptySessionState 含 roles/children（${shape}）；${live}` : problems.join("；"), "host/region.js 的 scanSessionOverrides / adopt 写回逻辑");
}

// ---------------------------------------------------------------------------
// 4) 失效信号形状：reason / code / role / at
// ---------------------------------------------------------------------------
{
	const problems = [];
	const codes = Array.isArray(routeFallback.DEGRADABLE_CODES) ? [...routeFallback.DEGRADABLE_CODES] : [];
	for (const code of ["RATE_LIMIT", "ACCOUNT_QUOTA"]) {
		if (!codes.includes(code)) problems.push(`DEGRADABLE_CODES 缺 ${code}`);
	}
	const signalPath = routeFallback.failoverSignalPath();
	let live = "无 failover-signal.json（还没被限流过）";
	if (existsSync(signalPath)) {
		try {
			const data = JSON.parse(readFileSync(signalPath, "utf8"));
			const want = ["at", "reason"];
			const missing = want.filter((key) => data?.[key] === undefined);
			if (missing.length > 0) problems.push(`信号文件缺字段：${missing.join("、")}`);
			live = `实读键=${Object.keys(data ?? {}).join(",")}`;
		} catch (error) {
			problems.push(`信号文件解析失败：${error?.message ?? error}`);
		}
	}
	report(4, "失效信号形状", problems.length === 0, problems.length === 0 ? `DEGRADABLE_CODES=${codes.join(",")}；${live}` : problems.join("；"), "host/failover.js 的 readSignal / tick 决策");
}

// ---------------------------------------------------------------------------
// 5) 预设仍然会写 model-routes.json（否则铁律没有存在意义）
// ---------------------------------------------------------------------------
{
	const problems = [];
	const roleTools = join(presetDir, "presets", "orchestrator2", "role-tools.mjs");
	let detail = "";
	try {
		const text = readFileSync(roleTools, "utf8");
		const callsSave = /saveRoleRoute\s*\(/u.test(text);
		const mentionsFile = /model-routes\.json/u.test(text);
		detail = `role-tools.mjs ${callsSave ? "调 saveRoleRoute" : "**不再**调 saveRoleRoute"}${mentionsFile ? "、提到 model-routes.json" : ""}`;
		if (!callsSave && !mentionsFile) problems.push("role-tools.mjs 里找不到写 model-routes.json 的痕迹");
	} catch (error) {
		problems.push(`读 role-tools.mjs 失败：${error?.message ?? error}`);
	}
	report(5, "预设仍写路由表", problems.length === 0, problems.length === 0 ? `${detail} → 铁律仍有意义` : problems.join("；"), "无需适配；若预设已不写路由表，可在弹窗里关掉铁律");
}

// ---------------------------------------------------------------------------
// 附：本插件自己的状态（不算契约，只提示）
// ---------------------------------------------------------------------------
try {
	const guard = guardSnapshot();
	console.log("");
	console.log(
		`铁律：${guard.enabled ? "开" : "关"}；回滚记录 ${guard.reverts.length} 条；状态文件 ${guard.path}`,
	);
} catch {
	// guard 读不出来不影响契约结论
}

console.log("");
if (failures === 0) {
	console.log("结论：5/5 契约成立，无需适配。");
} else {
	console.log(`结论：${failures} 处契约不成立 —— 按上面每条的「要适配」去改，改完重跑本脚本。`);
	process.exitCode = 1;
}
