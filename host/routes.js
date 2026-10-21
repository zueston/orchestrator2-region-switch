/** orchestrator2-region-switch 的宿主侧 HTTP 路由（给浏览器半体用）。
 *
 * 浏览器半体跑在受限的动态模块运行时里：没有 configForms / remote 服务、也没有
 * 直接网络，唯一合法的桥是**同源 fetch** 打宿主注册在 ctx.webServer 上的路由
 * （与 dsh-alarm / dsh-switchman 用的同一套模式）。
 *
 *   GET  /api/orchestrator2-region-switch/health    — 存活探针（含数据文件路径）。
 *   GET  /api/orchestrator2-region-switch/state     — model-routes.json 快照
 *                                        { activeScenario, scenarios: [{ id, label, labels,
 *                                          primary, roles, complete, missing }], roles,
 *                                          exists, seeded, migrated, path, warning, error,
 *                                          sessionOverrides }
 *                                        sessionOverrides = 被会话级 overrideRoute 钉住、
 *                                        **不会跟随本文件**的会话（面板据此提示并提供「覆盖」）。
 *   GET  /api/orchestrator2-region-switch/catalog   — DSH 当前可用的 provider / model 目录
 *                                        { providers: [{ provider, label, models: [{id,name}] }],
 *                                          unavailable, sources, error }
 *   POST /api/orchestrator2-region-switch/switch    — { side?: "a"|"b" }
 *                                        侧边栏的切换按钮：把当前场景的主槽翻到该侧
 *                                        （不给 side 就两侧对调），原子写回 model-routes.json。
 *   POST /api/orchestrator2-region-switch/scenarios — { scenarios: [...], activeScenario }
 *                                        保存整份场景表（弹窗的「保存」）。activeScenario
 *                                        必须选全模型，否则 400。
 *   POST /api/orchestrator2-region-switch/select    — { id }
 *                                        勾「使用」：把某个场景设为当前生效场景（必须选全模型）。
 *                                        另顺手清自动失效切换的本轮计数（手动切场景 = 新的一轮，
 *                                        指数冷却从第一档重新起算；只写 failover.json）。
 *   POST /api/orchestrator2-region-switch/adopt     — 用 model-routes.json 的当前 default
 *                                        覆盖各会话的 overrideRoute（会话跟随文件），
 *                                        应答 { updated, ...快照 }。
 *   POST /api/orchestrator2-region-switch/drift     — { action: "apply"|"dismiss"|"reapply",
 *                                        sessionId? }
 *                                        apply   = 把当前场景写进该会话的 overrideRoute
 *                                        dismiss = 记下该会话「放弃跟随」（文件再变会重新提示）
 *                                        reapply = 把当前场景重新写回 model-routes.json
 *                                        三者都应答最新快照。
 *   GET  /api/orchestrator2-region-switch/guard     — 模型变更管控（铁律）快照
 *                                        { enabled, path, lastAt, reverts: [{at, roles}] }
 *   POST /api/orchestrator2-region-switch/guard     — { enabled: true|false }
 *                                        开 = 非本插件写入的 model-routes.json 立刻回滚；
 *                                        关 = 只观察（界面仍显示漂移提示）。
 *   GET/POST /api/orchestrator2-region-switch/diag  — 浏览器半体的诊断回流。
 *   GET  /api/orchestrator2-region-switch/failover  — 自动失效切换快照
 *                                        { config, scenes: [{id,label,complete}], activeScenario,
 *                                          state: { currentIndex, currentScene, haltedUntil,
 *                                                   roundFailed, roundCount, flips(最近 10) } }
 *   POST /api/orchestrator2-region-switch/failover  — { enabled?, order?, perSceneProbeMin?,
 *                                        roundCooldownMin?, maxFlipsPerHour?, reset? }
 *                                        → 写 failover.json 并回新快照；非法值 400。
 *                                        v1 的 freeScene / paidScene 已废弃：传了也忽略，
 *                                        响应里带一条 warning 提示改用 order。
 *                                        **不碰 model-routes.json**（只有 enabled=true 时状态机
 *                                        才会切场景）。
 *   POST /api/orchestrator2-region-switch/failover/signal — { reason, role?, code? }
 *                                        → { ok, decision: { action, reason }, state }
 *                                        走同一条状态机（界面「模拟限流」与人工测试用）。
 *
 * 写路由都只改 model-routes.json：调度器预设每次派工都现读它，所以写一次就对下一次
 * 派工生效，不需要重启、也不碰宿主进程里的任何会话状态。
 *
 * 信任边界：loopback（Host 头 + Origin/Sec-Fetch-Site 校验）或已配对的远程 UI
 * 设备；所有 POST 都会改真实运行期数据，未配对的局域网客户端一律拒绝。
 */

import { applyDecision, failoverSnapshot, noteManualSceneSwitch, saveConfig } from "./failover.js";
import { guardSnapshot, setGuardEnabled } from "./guard.js";
import {
	adoptSessionOverrides,
	applyScenarioToSession,
	dismissSessionDrift,
	readCatalog,
	reapplyActiveScenario,
	routesPath,
	saveScenarios,
	selectScenario,
	stateSnapshot,
	swapActiveScenario,
} from "./region.js";

/** 插件名（写进 health 的 ns 字段）。 */
const NS = "orchestrator2-region-switch";

/** 路由路径（client.js 里镜像了同样的字面量）。 */
const ROUTES = {
	health: `/api/${NS}/health`,
	state: `/api/${NS}/state`,
	switch: `/api/${NS}/switch`,
	scenarios: `/api/${NS}/scenarios`,
	select: `/api/${NS}/select`,
	adopt: `/api/${NS}/adopt`,
	drift: `/api/${NS}/drift`,
	guard: `/api/${NS}/guard`,
	diag: `/api/${NS}/diag`,
	catalog: `/api/${NS}/catalog`,
	failover: `/api/${NS}/failover`,
	failoverSignal: `/api/${NS}/failover/signal`,
};

/** 浏览器半体的诊断事件（进程内环形缓冲，重启即清空）。 */
const DIAG_EVENTS = [];
const DIAG_LIMIT = 300;

/** JSON 响应助手。 */
function writeJson(res, status, payload) {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	res.end(body);
}

/** 读取并解析一个 JSON 请求体（1 MiB 上限）。 */
function readJsonBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 1024 * 1024) {
				reject(new Error("body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch (error) {
				reject(new Error(`invalid JSON body: ${error?.message ?? error}`));
			}
		});
		req.on("error", reject);
	});
}

/** Host 头里的主机名是否是本机 loopback。 */
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	if (!hostname || hostname.startsWith("[")) return false;
	const parts = hostname.split(".");
	return parts.length === 4 && parts.every((p) => /^\d+$/u.test(p)) && parts[0] === "127";
}

/** 请求是否来自本机自己的页面。 */
function isLoopbackRequest(request) {
	const host = request.headers?.host;
	if (typeof host !== "string" || host === "") return false;
	let hostUrl;
	try {
		hostUrl = new URL(`http://${host}`);
	} catch {
		return false;
	}
	if (!isLoopbackHostname(hostUrl.hostname)) return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === undefined) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}

/** loopback，或（remote-web-ui 存在时）已配对设备。 */
function isAllowed(ctx, request) {
	if (isLoopbackRequest(request)) return true;
	const pairing = typeof ctx.get === "function" ? ctx.get("remoteWebUiPairing", false) : undefined;
	return (
		pairing !== undefined &&
		pairing !== null &&
		typeof pairing.isPairedDevice === "function" &&
		pairing.isPairedDevice(request) === true
	);
}

/** 构造 /api/orchestrator2-region-switch 路由族（精确路径）。 */
export function makeRoutes(ctx) {
	/** 围栏：信任边界 + 方法。 */
	const guard = (req, res, method) => {
		if (!isAllowed(ctx, req)) {
			writeJson(res, 403, { error: "forbidden: loopback-only" });
			return false;
		}
		if (req.method !== method) {
			writeJson(res, 405, { error: `method not allowed: ${req.method}` });
			return false;
		}
		return true;
	};

	/** 读 POST body（信任 + 方法校验之后才读）。 */
	const readBody = async (req, res) => {
		try {
			return await readJsonBody(req);
		} catch (error) {
			writeJson(res, 400, { error: error?.message ?? String(error) });
			return undefined;
		}
	};

	return [
		{
			kind: "exact",
			path: ROUTES.health,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				writeJson(res, 200, {
					ok: true,
					ns: NS,
					path: routesPath(),
				});
			},
		},
		{
			kind: "exact",
			path: ROUTES.state,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				// preset 每次派工现读 model-routes.json，所以 GET 就是一次纯文件读。
				try {
					writeJson(res, 200, stateSnapshot());
				} catch (error) {
					ctx.logger?.warn?.(`${NS}: state read failed: ${error?.message ?? error}`);
					writeJson(res, 500, { error: error?.message ?? String(error) });
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.catalog,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				// 只读：给三角色编辑器的下拉框喂「DSH 当前可用的 provider / model」。
				try {
					writeJson(res, 200, await readCatalog(ctx));
				} catch (error) {
					ctx.logger?.warn?.(`${NS}: catalog read failed: ${error?.message ?? error}`);
					writeJson(res, 500, { error: error?.message ?? String(error) });
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.diag,
			handler: async (req, res) => {
				if (req.method === "GET") {
					if (!guard(req, res, "GET")) return;
					writeJson(res, 200, { count: DIAG_EVENTS.length, events: DIAG_EVENTS });
					return;
				}
				if (!isAllowed(ctx, req)) {
					writeJson(res, 403, { error: "forbidden: loopback-only" });
					return;
				}
				if (req.method !== "POST") {
					writeJson(res, 405, { error: `method not allowed: ${req.method}` });
					return;
				}
				const body = await readBody(req, res);
				if (body === undefined) return;
				// 浏览器半体自报：哪个层次跑到了、失败了什么——页面侧证据的唯一回流通道。
				DIAG_EVENTS.push({ at: new Date().toISOString(), ...body });
				if (DIAG_EVENTS.length > DIAG_LIMIT) DIAG_EVENTS.splice(0, DIAG_EVENTS.length - DIAG_LIMIT);
				writeJson(res, 200, { ok: true, count: DIAG_EVENTS.length });
			},
		},
		{
			kind: "exact",
			path: ROUTES.switch,
			handler: async (req, res) => {
				// 会改真实配置，方法校验放在信任校验之后（与 dsh-alarm 一致）。
				if (!isAllowed(ctx, req)) {
					writeJson(res, 403, { error: "forbidden: loopback-only" });
					return;
				}
				if (req.method !== "POST") {
					writeJson(res, 405, { error: `method not allowed: ${req.method}` });
					return;
				}
				const body = await readBody(req, res);
				if (body === undefined) return;
				try {
					// 只翻当前场景的主备：不碰任何会话、不需要 sessionId。
					const side = body?.side === "a" || body?.side === "b" ? body.side : undefined;
					writeJson(res, 200, { ok: true, ...swapActiveScenario(side) });
				} catch (error) {
					ctx.logger?.warn?.(`${NS}: switch failed: ${error?.message ?? error}`);
					writeJson(res, 400, { error: error?.message ?? String(error) });
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.adopt,
			handler: async (req, res) => {
				if (!isAllowed(ctx, req)) {
					writeJson(res, 403, { error: "forbidden: loopback-only" });
					return;
				}
				if (req.method !== "POST") {
					writeJson(res, 405, { error: `method not allowed: ${req.method}` });
					return;
				}
				try {
					// 用 model-routes.json 的当前 default 覆盖各会话的 overrideRoute。
					const result = adoptSessionOverrides();
					writeJson(res, 200, { ok: true, updated: result.updated, ...stateSnapshot() });
				} catch (error) {
					ctx.logger?.warn?.(`${NS}: adopt failed: ${error?.message ?? error}`);
					writeJson(res, 400, { error: error?.message ?? String(error) });
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.drift,
			handler: async (req, res) => {
				if (!isAllowed(ctx, req)) {
					writeJson(res, 403, { error: "forbidden: loopback-only" });
					return;
				}
				if (req.method !== "POST") {
					writeJson(res, 405, { error: `method not allowed: ${req.method}` });
					return;
				}
				const body = await readBody(req, res);
				if (body === undefined) return;
				const action = typeof body?.action === "string" ? body.action : "";
				try {
					// 三条动作都只碰「本插件自己的数据」：
					//  - apply   把当前场景写进某个会话的 overrideRoute（该会话也按场景走）
					//  - dismiss 记下「这个会话放弃跟随」（文件内容再变会重新提示）
					//  - reapply 把当前场景重新写回 model-routes.json（消掉漂移）
					if (action === "apply") {
						const result = applyScenarioToSession(body?.sessionId);
						writeJson(res, 200, { ok: true, changed: result.changed, ...stateSnapshot() });
						return;
					}
					if (action === "dismiss") {
						dismissSessionDrift(body?.sessionId);
						writeJson(res, 200, { ok: true, ...stateSnapshot() });
						return;
					}
					if (action === "reapply") {
						writeJson(res, 200, { ok: true, ...reapplyActiveScenario() });
						return;
					}
					writeJson(res, 400, { error: `unknown action: ${action}` });
				} catch (error) {
					ctx.logger?.warn?.(`${NS}: drift action failed: ${error?.message ?? error}`);
					writeJson(res, 400, { error: error?.message ?? String(error) });
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.guard,
			handler: async (req, res) => {
				if (!isAllowed(ctx, req)) {
					writeJson(res, 403, { error: "forbidden: loopback-only" });
					return;
				}
				if (req.method === "GET") {
					writeJson(res, 200, { ok: true, ...guardSnapshot() });
					return;
				}
				if (req.method !== "POST") {
					writeJson(res, 405, { error: `method not allowed: ${req.method}` });
					return;
				}
				const body = await readBody(req, res);
				if (body === undefined) return;
				try {
					// 只改开关：enabled=true 立刻以当前文件为基线，之后非本插件的写入会被回滚。
					if (typeof body?.enabled !== "boolean") {
						writeJson(res, 400, { error: "需要 { enabled: true|false }" });
						return;
					}
					writeJson(res, 200, { ok: true, ...setGuardEnabled(body.enabled) });
				} catch (error) {
					ctx.logger?.warn?.(`${NS}: guard write failed: ${error?.message ?? error}`);
					writeJson(res, 400, { error: error?.message ?? String(error) });
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.scenarios,
			handler: async (req, res) => {
				if (!isAllowed(ctx, req)) {
					writeJson(res, 403, { error: "forbidden: loopback-only" });
					return;
				}
				if (req.method !== "POST") {
					writeJson(res, 405, { error: `method not allowed: ${req.method}` });
					return;
				}
				const body = await readBody(req, res);
				if (body === undefined) return;
				try {
					// 整份场景表 + 当前生效场景，一次请求 = 一次「保存」。
					writeJson(res, 200, { ok: true, ...saveScenarios(body) });
				} catch (error) {
					ctx.logger?.warn?.(`${NS}: scenarios write failed: ${error?.message ?? error}`);
					writeJson(res, 400, { error: error?.message ?? String(error) });
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.select,
			handler: async (req, res) => {
				if (!isAllowed(ctx, req)) {
					writeJson(res, 403, { error: "forbidden: loopback-only" });
					return;
				}
				if (req.method !== "POST") {
					writeJson(res, 405, { error: `method not allowed: ${req.method}` });
					return;
				}
				const body = await readBody(req, res);
				if (body === undefined) return;
				try {
					// 勾「使用」：切换当前生效的场景（没选全模型的场景会被拒）。
					const snapshot = selectScenario(body?.id);
					// 手动切场景 = 开始新的一轮：清本轮失败记录与指数冷却的轮次
					// （否则下一轮接着上一轮的档位起算）。只写 failover.json，不碰场景表。
					noteManualSceneSwitch();
					writeJson(res, 200, { ok: true, ...snapshot });
				} catch (error) {
					ctx.logger?.warn?.(`${NS}: select failed: ${error?.message ?? error}`);
					writeJson(res, 400, { error: error?.message ?? String(error) });
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.failover,
			handler: async (req, res) => {
				// GET = 只读快照；POST = 改配置。两条都改不了 model-routes.json。
				if (!isAllowed(ctx, req)) {
					writeJson(res, 403, { error: "forbidden: loopback-only" });
					return;
				}
				if (req.method === "GET") {
					try {
						writeJson(res, 200, failoverSnapshot());
					} catch (error) {
						ctx.logger?.warn?.(`${NS}: failover read failed: ${error?.message ?? error}`);
						writeJson(res, 500, { error: error?.message ?? String(error) });
					}
					return;
				}
				if (req.method !== "POST") {
					writeJson(res, 405, { error: `method not allowed: ${req.method}` });
					return;
				}
				const body = await readBody(req, res);
				if (body === undefined) return;
				try {
					// 白名单字段 + 严格校验（脏值 400 让界面显示原因，不静默夹断）。
					saveConfig(body);
					// v1 的两点字段已废弃：忽略，但把话说明白，别让老界面以为改成功了。
					const legacy = body?.freeScene !== undefined || body?.paidScene !== undefined;
					writeJson(res, 200, {
						ok: true,
						...failoverSnapshot(),
						...(legacy ? { warning: "freeScene/paidScene 已废弃，请用 order" } : {}),
					});
				} catch (error) {
					ctx.logger?.warn?.(`${NS}: failover write failed: ${error?.message ?? error}`);
					writeJson(res, 400, { error: error?.message ?? String(error) });
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.failoverSignal,
			handler: async (req, res) => {
				if (!isAllowed(ctx, req)) {
					writeJson(res, 403, { error: "forbidden: loopback-only" });
					return;
				}
				if (req.method !== "POST") {
					writeJson(res, 405, { error: `method not allowed: ${req.method}` });
					return;
				}
				const body = await readBody(req, res);
				if (body === undefined) return;
				try {
					// 与预设写进 failover-signal.json 的内容走同一个状态机：
					// 界面的「模拟限流」和人工测试都不需要真的把免费额度用光。
					const verdict = applyDecision(ctx, {
						kind: "signal",
						reason: typeof body?.reason === "string" && body.reason !== "" ? body.reason : "rate_limit",
						code: typeof body?.code === "string" ? body.code : "RATE_LIMIT",
						role: typeof body?.role === "string" ? body.role : "manual",
					});
					writeJson(res, 200, {
						ok: true,
						decision: { action: verdict.action, reason: verdict.reason },
						state: failoverSnapshot().state,
					});
				} catch (error) {
					ctx.logger?.warn?.(`${NS}: failover signal failed: ${error?.message ?? error}`);
					writeJson(res, 400, { error: error?.message ?? String(error) });
				}
			},
		},
	];
}

/** 挂载路由族（通过 ctx.effect 可随插件卸载）。 */
export function applyRoutes(ctx) {
	const routes = makeRoutes(ctx);
	ctx.effect(() => {
		const disposers = routes.map((route) => ctx.webServer.register(route));
		return () => {
			for (const dispose of disposers) dispose();
		};
	}, `${NS}: client routes`);
}
