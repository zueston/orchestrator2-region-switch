/**
 * 宿主半体自测（离线，不启动 DSH）：
 *
 *   node tools/selftest-host.mjs
 *
 * 覆盖 v2.0.0 的场景模型——1..4 个场景、每场景两侧（a / b）三角色模型、
 * 单选「使用」（没选全模型不能勾、不能切）、按钮名可改、v1 文件自动迁移、
 * 以及派生给 preset 读的 roles 表。
 *
 * 用临时 DSH_HOME，绝不碰真实的 <DSH_HOME>/orchestrator2/model-routes.json。
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "or2-region-selftest-"));
process.env.DSH_HOME = home;

const region = await import("../host/region.js");

let failures = 0;
let checks = 0;

function check(name, actual, expected) {
	checks += 1;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok   ${name}`);
		return;
	}
	failures += 1;
	console.log(`  FAIL ${name}\n       actual   = ${a}\n       expected = ${e}`);
}

function checkTrue(name, actual) {
	check(name, Boolean(actual), true);
}

function throws(name, fn, fragment) {
	checks += 1;
	try {
		fn();
		failures += 1;
		console.log(`  FAIL ${name}（没有抛错）`);
	} catch (error) {
		const message = String(error?.message ?? error);
		if (fragment === undefined || message.includes(fragment)) {
			console.log(`  ok   ${name}`);
		} else {
			failures += 1;
			console.log(`  FAIL ${name}\n       message = ${message}\n       wanted  = ${fragment}`);
		}
	}
}

const route = (provider, model) => ({ provider, model });
const primaryOf = (snapshot) => snapshot.scenarios.find((scene) => scene.id === snapshot.activeScenario);
/** 场景表文件（本插件独占）。 */
const scenariosFile = () => JSON.parse(readFileSync(region.scenariosPath(), "utf8"));
/** preset 读的 model-routes.json。 */
const routesFile = () => JSON.parse(readFileSync(region.routesPath(), "utf8"));
/** 直接改 scenarios.json（模拟外部写 / 造异常状态）。 */
const patchScenarios = (patch) => {
	const path = region.scenariosPath();
	writeFileSync(path, JSON.stringify({ ...scenariosFile(), ...patch }, null, 2), "utf8");
};
/** 删掉场景表（模拟只有旧 model-routes.json 的老安装）。 */
const dropScenariosFile = () => rmSync(region.scenariosPath(), { force: true });

// ---------------------------------------------------------------------------
console.log("1) 文件缺席 → 播种一个完整场景（国内 / 国际）");
// ---------------------------------------------------------------------------
const empty = region.stateSnapshot();
check("场景数", empty.scenarios.length, 1);
check("场景名 = 两侧名字拼接", empty.scenarios[0].label, "国内/国际");
check("选全了", empty.scenarios[0].complete, true);
check("主槽在 a", empty.scenarios[0].primary, "a");
check("preset 读的角色表来自 a 侧", empty.roles.researcher?.default, route("deepseek-official", "cn:deepseek-v4.1-flash"));
check("reviewer 单独一条", empty.roles.reviewer?.default, route("deepseek-official", "cn:step-5-preview"));
check("备槽是国际线", empty.roles.developer?.fallback, route("deepseek-official", "global:deepseek-v4.1-flash"));
check("文件还没写", empty.exists, false);

// ---------------------------------------------------------------------------
console.log("2) 保存两个场景（第二个不完整）→ 一个能勾、一个不能");
// ---------------------------------------------------------------------------
const twoScenes = [
	{
		id: "scene-1",
		labels: { a: "国内", b: "国际" },
		primary: "a",
		roles: {
			researcher: {
				a: route("deepseek-official", "cn:deepseek-v4.1-flash"),
				b: route("deepseek-official", "global:deepseek-v4.1-flash"),
			},
			reviewer: {
				a: route("deepseek-official", "cn:step-5-preview"),
				b: route("deepseek-official", "global:step-5-preview"),
			},
			developer: {
				a: route("deepseek-official", "cn:deepseek-v4.1-flash"),
				b: route("deepseek-official", "global:deepseek-v4.1-flash"),
			},
		},
	},
	{
		id: "scene-2",
		labels: { a: "省钱", b: "强力" },
		primary: "a",
		roles: {
			researcher: { a: route("free-provider", "z-ai/glm-5.3-flash") },
			reviewer: { a: route("free-provider", "z-ai/glm-5.3") },
			developer: { a: route("free-provider", "z-ai/glm-5.3-flash") },
		},
	},
];
const saved = region.saveScenarios({ scenarios: twoScenes, activeScenario: "scene-1" });
check("场景数", saved.scenarios.length, 2);
check("生效场景", saved.activeScenario, "scene-1");
check("scene-2 = 场景名拼接", saved.scenarios[1].label, "省钱/强力");
check("scene-2 没选全", saved.scenarios[1].complete, false);
check("scene-2 缺 3 项（三个角色都只填了 a 侧）", saved.scenarios[1].missing.length, 3);
check("派生 roles 仍来自 scene-1", saved.roles.researcher.default.model, "cn:deepseek-v4.1-flash");
check("场景表写进 scenarios.json", scenariosFile().scenarios.length, 2);
check(
	"model-routes.json 保持 preset 原生 v1 形状（只有 schemaVersion + roles）",
	Object.keys(routesFile()).sort(),
	["roles", "schemaVersion"],
);
check("model-routes.json 里 schemaVersion = 1", routesFile().schemaVersion, 1);
check("model-routes.json 里没有 scenarios 字段", "scenarios" in routesFile(), false);
check("两个文件都没漂移", saved.drift, false);

// ---------------------------------------------------------------------------
console.log("3) 刷新后身份不变 + 单选「使用」的校验");
// ---------------------------------------------------------------------------
const reloaded = region.stateSnapshot();
check("重读场景数", reloaded.scenarios.length, 2);
check("重读生效场景", reloaded.activeScenario, "scene-1");
throws("设不完整场景为使用 → 抛错", () => region.selectScenario("scene-2"), "还没选全模型");
throws("保存时把不完整场景设为使用 → 抛错", () => {
	region.saveScenarios({ scenarios: twoScenes, activeScenario: "scene-2" });
}, "不能设为使用中的场景");
throws("切不完整场景 → 抛错", () => {
	// 把生效场景强行改成不完整的 scene-2（直接改场景表，绕开校验），再试切换。
	patchScenarios({ activeScenario: "scene-2" });
	try {
		region.swapActiveScenario("b");
	} finally {
		patchScenarios({ activeScenario: "scene-1" });
	}
}, "不能切换");
const many = Array.from({ length: 12 }, (_, index) => ({ ...twoScenes[0], id: `scene-${index + 20}` }));
const manySaved = region.saveScenarios({ scenarios: many, activeScenario: "scene-20" });
check("场景数量不设上限（12 个都存下）", manySaved.scenarios.length, 12);
check("多场景时生效场景正确", manySaved.activeScenario, "scene-20");
region.saveScenarios({ scenarios: twoScenes, activeScenario: "scene-1" });
throws("场景不存在", () => region.selectScenario("scene-42"), "场景不存在");

// ---------------------------------------------------------------------------
console.log("4) 场景名（两个按钮名）可自定义，TAB 文字自动跟着变");
// ---------------------------------------------------------------------------
const renamedSaved = region.saveScenarios({
	scenarios: [{ ...twoScenes[0], labels: { a: "收费国内", b: "收费国外" } }, twoScenes[1]],
	activeScenario: "scene-1",
});
check("TAB 文字 = 自定义名拼接", renamedSaved.scenarios[0].label, "收费国内/收费国外");
check("名字读回", renamedSaved.scenarios[0].labels, { a: "收费国内", b: "收费国外" });
check("留空回落默认名", region.saveScenarios({ scenarios: [{ ...twoScenes[0], labels: { a: "", b: "" } }] }).scenarios[0].labels, {
	a: "国内",
	b: "国际",
});
check(
	"超长名截到 16 字",
	[...region.saveScenarios({ scenarios: [{ ...twoScenes[0], labels: { a: "超".repeat(20), b: "国际" } }] }).scenarios[0].labels.a].length,
	16,
);

// ---------------------------------------------------------------------------
console.log("5) 侧边栏切换 = 只翻主槽方向（同一份文件，不碰会话）");
// ---------------------------------------------------------------------------
region.saveScenarios({ scenarios: twoScenes, activeScenario: "scene-1" });
const toB = region.swapActiveScenario("b");
check("主槽翻到 b", toB.changed, 1);
check("primary = b", primaryOf(toB).primary, "b");
check("派生 roles 的主槽 = b 侧（国际线）", toB.roles.researcher.default.model, "global:deepseek-v4.1-flash");
check("备槽 = a 侧（国内线）", toB.roles.researcher.fallback.model, "cn:deepseek-v4.1-flash");
check("再点同一侧 = 幂等", region.swapActiveScenario("b").changed, 0);
check("点回 a", region.swapActiveScenario("a").roles.researcher.default.model, "cn:deepseek-v4.1-flash");
check("无参数 = 对调", region.swapActiveScenario().roles.researcher.default.model, "global:deepseek-v4.1-flash");

// ---------------------------------------------------------------------------
console.log("6) 多场景各自的主备互不串线（切到场景二后线路来自它自己）");
// ---------------------------------------------------------------------------
const completeScene2 = {
	...twoScenes[1],
	roles: {
		researcher: {
			a: route("free-provider", "z-ai/glm-5.3-flash"),
			b: route("deepseek-account", "deepseek-flash"),
		},
		reviewer: {
			a: route("free-provider", "z-ai/glm-5.3"),
			b: route("deepseek-account", "deepseek-v4-pro"),
		},
		developer: {
			a: route("free-provider", "z-ai/glm-5.3-flash"),
			b: route("deepseek-account", "deepseek-flash"),
		},
	},
};
const picked = region.saveScenarios({ scenarios: [twoScenes[0], completeScene2], activeScenario: "scene-2" });
check("生效场景 = scene-2", picked.activeScenario, "scene-2");
check("派生 roles 来自 scene-2 的 a 侧", picked.roles.researcher.default.provider, "free-provider");
check("scene-1 的模型没被改", picked.scenarios[0].roles.researcher.a.model, "cn:deepseek-v4.1-flash");
const flipped = region.swapActiveScenario("b");
check("scene-2 翻到 b 侧", flipped.roles.reviewer.default.model, "deepseek-v4-pro");
check("scene-2 的备槽 = 它自己的 a 侧", flipped.roles.reviewer.fallback.model, "z-ai/glm-5.3");

// ---------------------------------------------------------------------------
console.log("7) v1 文件（roles + labels + region）自动迁移成一个场景");
// ---------------------------------------------------------------------------
const routesPath = region.routesPath();
mkdirSync(dirname(routesPath), { recursive: true });
dropScenariosFile();
writeFileSync(
	routesPath,
	JSON.stringify(
		{
			roles: {
				researcher: {
					default: route("deepseek-official", "cn:deepseek-v4.1-flash"),
					fallback: route("deepseek-official", "global:deepseek-v4.1-flash"),
				},
				reviewer: {
					default: route("deepseek-official", "cn:step-5-preview"),
					fallback: route("deepseek-official", "global:step-5-preview"),
				},
				developer: {
					default: route("deepseek-official", "cn:deepseek-v4.1-flash"),
					fallback: route("deepseek-official", "global:deepseek-v4.1-flash"),
				},
			},
			labels: { cn: "省钱模式", global: "强力模式" },
			region: "cn",
		},
		null,
		2,
	),
	"utf8",
);
const migrated = region.stateSnapshot();
check("迁移标记", migrated.migrated, true);
check("场景数", migrated.scenarios.length, 1);
check("旧按钮名保留", migrated.scenarios[0].labels, { a: "省钱模式", b: "强力模式" });
check("主槽在 a（region=cn）", migrated.scenarios[0].primary, "a");
check("角色表不变", migrated.roles.reviewer.default.model, "cn:step-5-preview");
// 迁移在读到老文件的那一刻就落盘：场景表落到 scenarios.json，model-routes.json 收回 v1。
check("迁移即落盘：scenarios.json 已生成", existsSync(region.scenariosPath()), true);
const written = routesFile();
check("model-routes.json 仍是 preset 原生 v1", written.schemaVersion, 1);
check("model-routes.json 里不再有 scenarios", "scenarios" in written, false);
check("model-routes.json 里不再有 activeScenario", "activeScenario" in written, false);
check("写盘后旧 labels 被清掉", "labels" in written, false);
check("写盘后旧 region 被清掉", "region" in written, false);
check("旧文件里的 roles 被派生值接管", written.roles.reviewer.default.model, "cn:step-5-preview");

// ---------------------------------------------------------------------------
console.log("8) v1 且主槽在国际线 → a 侧固定放国内线，primary = b");
// ---------------------------------------------------------------------------
dropScenariosFile();
writeFileSync(
	routesPath,
	JSON.stringify(
		{
			roles: {
				researcher: {
					default: route("deepseek-official", "global:deepseek-v4.1-flash"),
					fallback: route("deepseek-official", "cn:deepseek-v4.1-flash"),
				},
			},
			region: "global",
		},
		null,
		2,
	),
	"utf8",
);
const migratedGlobal = region.stateSnapshot();
check("主槽在 b", migratedGlobal.scenarios[0].primary, "b");
check("a 侧 = 原来 fallback（国内线）", migratedGlobal.scenarios[0].roles.researcher.a.model, "cn:deepseek-v4.1-flash");
check("派生 roles 主槽仍是国际线", migratedGlobal.roles.researcher.default.model, "global:deepseek-v4.1-flash");

// ---------------------------------------------------------------------------
console.log("9) preset 自己重写 model-routes.json（set_role_model）→ 场景表不丢 + 检出漂移");
// ---------------------------------------------------------------------------
region.saveScenarios({ scenarios: [twoScenes[0], completeScene2], activeScenario: "scene-2" });
// 模拟 preset 的 saveRoleRoute：整份改写成 { schemaVersion: 1, roles }（只留它认得的字段）。
writeFileSync(
	routesPath,
	JSON.stringify(
		{
			schemaVersion: 1,
			roles: {
				reviewer: {
					default: route("volcengine", "glm-5.3"),
					fallback: route("volcengine", "glm-5.3-flash"),
				},
			},
		},
		null,
		2,
	),
	"utf8",
);
const afterWipe = region.stateSnapshot();
check("场景表仍在（2 个）", afterWipe.scenarios.length, 2);
check("生效场景仍是 scene-2", afterWipe.activeScenario, "scene-2");
check("场景名仍是自定义的", afterWipe.scenarios.map((scene) => scene.label), ["国内/国际", "省钱/强力"]);
check("检出漂移", afterWipe.drift, true);
check("漂移角色 = 三个都不同", afterWipe.driftRoles, ["researcher", "reviewer", "developer"]);
check("展示用的 roles 仍来自场景（不被外部值带走）", afterWipe.roles.reviewer.default.provider, "free-provider");
const reapplied = region.saveScenarios({ scenarios: afterWipe.scenarios, activeScenario: "scene-2" });
check("重新应用后漂移清掉", reapplied.drift, false);
check("roles 回到场景派生值", reapplied.roles.reviewer.default.model, "z-ai/glm-5.3");
check("preset 文件仍是 v1", routesFile().schemaVersion, 1);

// ---------------------------------------------------------------------------
console.log("10) 模型变更管控（铁律）：外部改写立刻回滚，关掉开关后只观察");
// ---------------------------------------------------------------------------
const guard = await import("../host/guard.js");
region.saveScenarios({ scenarios: [twoScenes[0], completeScene2], activeScenario: "scene-2" });
check("默认就是开的（铁律生效）", guard.guardEnabled(), true);
check("没被改过 = same", guard.checkOnce().action, "same");
// 模拟会话里用 preset 的 set_role_model 整份改写（只留它认得的字段）。
writeFileSync(
	routesPath,
	JSON.stringify(
		{
			schemaVersion: 1,
			roles: { reviewer: { default: route("volcengine", "glm-5.3"), fallback: route("volcengine", "glm-5.3-flash") } },
		},
		null,
		2,
	),
	"utf8",
);
const verdict = guard.checkOnce();
check("检出外部改动并回滚", verdict.action, "reverted");
check("回滚涉及三个角色", verdict.roles, ["researcher", "reviewer", "developer"]);
check("文件被写回本插件内容", routesFile().roles.reviewer.default.model, "z-ai/glm-5.3");
check("回滚记录 1 条", guard.guardSnapshot().reverts.length, 1);
check("快照里带管控状态", region.stateSnapshot().guard.enabled, true);
// 关掉管控 → 只观察、不动文件。
guard.setGuardEnabled(false);
check("开关持久成关", guard.guardEnabled(), false);
writeFileSync(routesPath, JSON.stringify({ schemaVersion: 1, roles: {} }, null, 2), "utf8");
check("关掉后只观察", guard.checkOnce().action, "observed");
check("关掉后不动文件", Object.keys(routesFile().roles).length, 0);
// 再打开 → 以当前文件为基线，不会把用户刚才的改动立刻回滚。
guard.setGuardEnabled(true);
check("打开后同内容 = same", guard.checkOnce().action, "same");
check("打开时以当前内容为基线（不新增回滚记录）", guard.guardSnapshot().reverts.length, 1);

// ---------------------------------------------------------------------------
rmSync(home, { recursive: true, force: true });
if (failures === 0) {
	console.log(`\nSELF-TEST OK（${checks} 项）`);
} else {
	console.log(`\nSELF-TEST FAILED：${failures}/${checks} 项不通过`);
	process.exitCode = 1;
}
