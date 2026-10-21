// 离线模拟：在假 DOM 下真正跑组件函数 + effect 回调，抓出「形状不匹配」类运行时错误。
// 目的：不再依赖重启宿主才能暴露 render/effect 期异常。
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const file = path.resolve(__dirname, '..', 'client.js');
const src = fs.readFileSync(file, 'utf8');

// ---------- 极简 DOM ----------
const SELECTORS = /^\[(data-[a-z0-9-]+)\]$/;

class El {
	constructor(tag) {
		this.tagName = String(tag).toUpperCase();
		this.attrs = new Map();
		this.children = [];
		this.style = {};
		this.styleText = '';
		this.parent = null;
		this.listeners = new Map();
		this.textContent = '';
		this.offsetWidth = 40;
		this.offsetLeft = 0;
		this.title = '';
	}
	setAttribute(name, value) { this.attrs.set(name, String(value)); if (name === 'style') this.styleText = String(value); }
	getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
	// select 的当前值在真实 DOM 里是属性而非特性，这里映射到 attrs，便于断言「值回显」。
	get value() { const v = this.attrs.get('value'); return v === undefined ? '' : v; }
	set value(next) { this.setAttribute('value', next); }
	hasAttribute(name) { return this.attrs.has(name); }
	removeAttribute(name) { this.attrs.delete(name); }
	appendChild(child) { child.parent = this; this.children.push(child); return child; }
	removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parent = null; }
	contains(node) { if (!node) return false; if (node === this) return true; return this.children.some((c) => c.contains(node)); }
	closest(sel) {
		const m = SELECTORS.exec(sel);
		let node = this;
		while (node) {
			if (m) { if (node.getAttribute(m[1]) !== null) return node; }
			else if (node.tagName === sel.toUpperCase()) return node;
			node = node.parent;
		}
		return null;
	}
	matches(sel) {
		const m = SELECTORS.exec(sel);
		if (m) return this.getAttribute(m[1]) !== null;
		return this.tagName === sel.toUpperCase();
	}
	_collect(sel, out) {
		for (const child of this.children) { if (child.matches(sel)) out.push(child); child._collect(sel, out); }
		return out;
	}
	querySelector(sel) {
		// 支持复合：`[a][b]`
		const parts = sel.match(/\[[^\]]+\]/g) || [sel];
		const first = this._collect(parts[0], []);
		return first.find((el) => parts.every((p) => el.matches(p))) || null;
	}
	querySelectorAll(sel) {
		const parts = sel.match(/\[[^\]]+\]/g) || [sel];
		const all = this._collect(parts[0], []);
		return all.filter((el) => parts.every((p) => el.matches(p)));
	}
	addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
	removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
	dispatch(type, event) { for (const fn of this.listeners.get(type) ?? []) fn(event); }
}

const styleEls = new Map();
const document = {
	documentElement: { lang: 'zh-CN' },
	head: new El('head'),
	body: new El('body'),
	createElement: (tag) => new El(tag),
	getElementById: (id) => styleEls.get(id) ?? null,
};
document.head.appendChild = function appendChild(child) {
	if (child.getAttribute('id')) styleEls.set(child.getAttribute('id'), child);
	El.prototype.appendChild.call(this, child);
	return child;
};

const rafQueue = [];
const windowStub = {
	__ModuleLoader__: { load(reg) { windowStub.__captured = reg; } },
	addEventListener() {}, removeEventListener() {},
	location: { href: 'http://127.0.0.1/app/' },
};
class Headers { constructor(init) { this.map = { ...(init || {}) }; } get(k) { return this.map[k] ?? null; } }
class MutationObserver { observe() {} disconnect() {} }

const ROUTE = (provider, model) => ({ provider, model });

/** 场景一：三角色都选全了两侧（可勾「使用」）。 */
const sceneOneRoles = {
	researcher: {
		a: ROUTE('deepseek-official', 'cn:deepseek-v4.1-flash'),
		b: ROUTE('deepseek-official', 'global:deepseek-v4.1-flash'),
	},
	reviewer: {
		a: ROUTE('deepseek-official', 'cn:step-5-preview'),
		b: ROUTE('deepseek-official', 'global:step-5-preview'),
	},
	developer: {
		a: ROUTE('deepseek-official', 'cn:deepseek-v4.1-flash'),
		b: ROUTE('deepseek-official', 'global:deepseek-v4.1-flash'),
	},
};

/** 场景二：两侧都选全（用来测「使用此场景」可以点、点了发 POST /select）。 */
const sceneTwoRoles = {
	researcher: {
		a: ROUTE('free-provider', 'z-ai/glm-5.3-flash'),
		b: ROUTE('deepseek-account', 'deepseek-v4-pro'),
	},
	reviewer: {
		a: ROUTE('free-provider', 'z-ai/glm-5.3'),
		b: ROUTE('deepseek-account', 'deepseek-flash'),
	},
	developer: {
		a: ROUTE('free-provider', 'z-ai/glm-5.3-flash'),
		b: ROUTE('deepseek-account', 'deepseek-v4-pro'),
	},
};

/** 场景三：只填了 a 侧（不完整 → 「使用此场景」必须禁用并给提示）。 */
const sceneThreeRoles = {
	researcher: { a: ROUTE('free-provider', 'z-ai/glm-5.3-flash') },
	reviewer: { a: ROUTE('free-provider', 'z-ai/glm-5.3') },
	developer: { a: ROUTE('free-provider', 'z-ai/glm-5.3-flash') },
};

const sceneOne = {
	id: 'scene-1',
	labels: { a: '国内', b: '国际' },
	label: '国内/国际',
	primary: 'a',
	complete: true,
	missing: [],
	roles: sceneOneRoles,
};
const sceneTwo = {
	id: 'scene-2',
	labels: { a: '省钱', b: '强力' },
	label: '省钱/强力',
	primary: 'a',
	complete: true,
	missing: [],
	roles: sceneTwoRoles,
};
const sceneThree = {
	id: 'scene-3',
	labels: { a: '付费', b: '免费' },
	label: '付费/免费',
	primary: 'a',
	complete: false,
	missing: [
		{ role: 'researcher', side: 'b' },
		{ role: 'reviewer', side: 'b' },
		{ role: 'developer', side: 'b' },
	],
	roles: sceneThreeRoles,
};

/** 与宿主 stateSnapshot() 的真实形状一致（派生 roles 来自使用中场景的主槽）。 */
const statePayload = {
	path: 'C:\\Users\\demo\\.dsh\\orchestrator2\\model-routes.json',
	scenariosPath: 'C:\\Users\\demo\\.dsh\\orchestrator2\\scenarios.json',
	exists: true,
	seeded: false,
	migrated: false,
	drift: false,
	driftRoles: [],
	activeScenario: 'scene-1',
	scenarios: [sceneOne, sceneTwo, sceneThree],
	roles: {
		researcher: { default: sceneOneRoles.researcher.a, fallback: sceneOneRoles.researcher.b },
		reviewer: { default: sceneOneRoles.reviewer.a, fallback: sceneOneRoles.reviewer.b },
		developer: { default: sceneOneRoles.developer.a, fallback: sceneOneRoles.developer.b },
	},
	warning: null,
	error: null,
	// 模型变更管控（铁律）快照：默认开着，带一条回滚记录。
	guard: {
		enabled: true,
		path: 'C:\\Users\\demo\\.dsh\\orchestrator2\\guard.json',
		lastAt: '2026-01-01T09:15:05.000Z',
		reverts: [{ at: '2026-01-01T09:15:05.000Z', roles: ['reviewer'] }],
	},
	// 与宿主 scanSessionOverrides() 的真实形状一致：只列被 overrideRoute 钉住的会话。
	sessionOverrides: [
		{
			sessionId: 'session-bdbdbdf6-65d7-4396-b18e-12f44eea4350',
			roles: { reviewer: { provider: 'deepseek-official', model: 'cn:step-5-preview' } },
		},
	],
};

/** /adopt 的桩应答：覆盖成功后覆盖列表清空。 */
const adoptedPayload = {
	...statePayload,
	sessionOverrides: [],
	ok: true,
	updated: 1,
};

/** /scenarios 的桩应答：宿主保存后回同一份快照。 */
const savedPayload = {
	...statePayload,
	ok: true,
	changed: 2,
	activeComplete: true,
};

// 与宿主 /catalog 的真实形状一致：models 是 [{ id, name }]，取不到模型的分组已被宿主滤掉。
const catalogPayload = {
	providers: [
		{
			provider: 'deepseek-account',
			label: 'DeepSeek 账号',
			models: [
				{ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' },
				{ id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
			],
		},
		{
			provider: 'deepseek-official',
			label: 'deepseek-official',
			models: [
				{ id: 'cn:deepseek-v4.1-flash', name: 'Deepseek-V4.1-Flash(cn)' },
				{ id: 'cn:step-5-preview', name: 'Step-5-Preview(cn)' },
				{ id: 'global:deepseek-v4.1-flash', name: 'Deepseek-V4.1-Flash' },
				{ id: 'global:step-5-preview', name: 'Step-5-Preview' },
			],
		},
	],
	unavailable: [{ provider: 'buddy', label: 'CodeBuddy (腾讯)', message: 'no credential' }],
	sources: ['llm'],
	error: null,
};

/** /failover 的桩应答：与宿主 failoverSnapshot() 同形（关闭状态，顺序 = 三个场景）。 */
const failoverPayload = {
	config: {
		schemaVersion: 2,
		enabled: false,
		order: ['scene-1', 'scene-2', 'scene-3'],
		perSceneProbeMin: 30,
		roundCooldownMin: 180,
		maxFlipsPerHour: 12,
		currentIndex: 0,
		lastFlipAt: null,
		flips: [],
		roundFailed: [],
		haltedUntil: null,
		roundCount: 0,
		lastSignal: null,
	},
	scenes: [
		{ id: 'scene-1', label: '国内/国际', complete: true },
		{ id: 'scene-2', label: '省钱/强力', complete: true },
		{ id: 'scene-3', label: '付费/免费', complete: false },
	],
	activeScenario: 'scene-1',
	state: { currentIndex: 0, currentScene: 'scene-1', haltedUntil: null, roundFailed: [], roundCount: 0, flips: [] },
};

/** 记录发往宿主的请求：用来断言「点分段控件真的打了 /switch」。 */
const calls = [];
/** 漂移测试用：临时替换 /state 的应答（null = 用默认 statePayload）。 */
let stateOverride = null;
/** 宿主当前的真源快照：/switch /adopt /scenarios 会就地更新它，模拟宿主落盘后 /state 跟着变。 */
let stateNow = statePayload;
/** 模型变更管控（铁律）的桩应答：POST /guard 只回 { enabled, ... }。 */
let guardNow = { ...statePayload.guard };

/** /switch 的桩应答：使用中场景的主槽翻到 b 侧。 */const switchedPayload = {
	...statePayload,
	activeScenario: 'scene-1',
	scenarios: [{ ...sceneOne, primary: 'b' }, sceneTwo, sceneThree],
	roles: {
		researcher: { default: sceneOneRoles.researcher.b, fallback: sceneOneRoles.researcher.a },
		reviewer: { default: sceneOneRoles.reviewer.b, fallback: sceneOneRoles.reviewer.a },
		developer: { default: sceneOneRoles.developer.b, fallback: sceneOneRoles.developer.a },
	},
	ok: true,
	changed: 1,
	primary: 'b',
};

const sandbox = {
	window: windowStub,
	document,
	navigator: { language: 'zh-CN' },
	console,
	setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
	requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
	cancelAnimationFrame: () => {},
	MutationObserver,
	Headers,
	fetch: async (url, init) => {
		calls.push({ url: String(url), method: (init && init.method) || 'GET', body: (init && init.body) || null });
		const body = /\/state$/.test(url)
			? stateNow
			: /\/catalog$/.test(url)
				? catalogPayload
				: /\/switch$/.test(url)
					? ((stateNow = switchedPayload), switchedPayload)
					: /\/adopt$/.test(url)
						? ((stateNow = adoptedPayload), adoptedPayload)
						: /\/scenarios$/.test(url)
							? ((stateNow = savedPayload), savedPayload)
							: /\/select$/.test(url)
								? ((stateNow = savedPayload), savedPayload)
								: /\/failover\/signal$/.test(url)
									? { ...failoverPayload, decision: { action: 'switch', reason: 'rate_limit' } }
									: /\/failover$/.test(url)
										? failoverPayload
										: /\/guard$/.test(url)
											? ((guardNow = { ...guardNow, enabled: JSON.parse(String((init && init.body) || '{}')).enabled !== false }), guardNow)
											: { ok: true };
		return { ok: true, status: 200, json: async () => body, text: async () => '' };
	},
	Promise, URL, URLSearchParams, JSON, Math, Date, Object, Array, String, Number, Boolean, Error, TypeError, RegExp, Map, Set, Symbol, Reflect, Proxy,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'client.js' });

const captured = windowStub.__captured;
if (!captured) { console.log('FAIL: 未捕获 __ModuleLoader__ 注册'); process.exit(1); }
console.log('captured id =', captured.id);

// ---------- 假 React：effect 立即执行，state 按「组件 + hook 序号」落地 ----------
const renderLog = [];
let effectDepth = 0;
const pendingEffects = [];
// useState 要真的能改：否则 setDraft 是 no-op，弹窗永远停在空草稿上，测不出「值回显」。
const hookState = new Map();
let frame = null;
let hookIndex = 0;
const ReactStub = {
	createElement: (type, props, ...kids) => ({ type, props: props ?? {}, kids }),
	Fragment: 'Fragment',
	useState: (init) => {
		const fallback = typeof init === 'function' ? init() : init;
		if (frame === null) return [fallback, () => {}];
		const slots = hookState.get(frame) ?? [];
		const index = hookIndex;
		hookIndex += 1;
		if (!(index in slots)) slots[index] = fallback;
		hookState.set(frame, slots);
		const set = (next) => {
			slots[index] = typeof next === 'function' ? next(slots[index]) : next;
		};
		return [slots[index], set];
	},
	useEffect: (fn) => { pendingEffects.push(fn); },
	useLayoutEffect: (fn) => { pendingEffects.push(fn); },
	useMemo: (fn) => fn(),
	useCallback: (fn) => fn,
	useRef: (init) => ({ current: init ?? null }),
	useContext: () => undefined,
	useSyncExternalStore: (subscribe, get) => get(),
	memo: (c) => c,
	createContext: (v) => ({ Provider: 'Provider', _v: v }),
	Component: class { constructor(props) { this.props = props; this.state = {}; } setState(next) { Object.assign(this.state, next); } },
};

const plugin = captured.factory((name) => {
	if (name === 'react') return ReactStub;
	throw new Error('unexpected require: ' + name);
});
console.log('plugin.inject =', JSON.stringify(plugin.inject));

// ---------- 假 ctx ----------
const registrations = [];
const ctx = {
	slots: {
		inject(name, cb) { cb(); return () => {}; },
		register(options, Component) { registrations.push({ options, Component }); return () => {}; },
		listSubTree() { return []; },
		entriesOfSlot() { return []; },
		subscribe() { return () => {}; },
	},
	effect(fn) { fn(); },
	on() { return () => {}; },
	logger: { warn: (...a) => console.log('[warn]', ...a), error: (...a) => console.log('[error]', ...a), info: (...a) => console.log('[info]', ...a) },
};
plugin.apply(ctx);
console.log('apply OK；注册数 =', registrations.length);

// 假的标准 props：useSessions 按 selector 求值
const fakeList = {
	byId: { 'sid-1': { id: 'sid-1', retainedBy: { mainView: 1 } } },
	projectionsBySession: { 'sid-1': { values: { modelSelection: { next: { provider: 'deepseek-official', model: 'cn:deepseek-v4.1-flash' }, lastUsed: null } } } },
};
const useSessions = (selector) => selector(fakeList);
const usePanelInfo = () => ({ isActive: true });

// 侧边栏外壳结构：<button><span class=glyph>{我们}</span><span class=label/></button>
function mountInRow(componentOut, props) {
	const button = new El('button');
	const glyphHolder = new El('span');
	button.appendChild(glyphHolder);
	const labelHolder = new El('span');
	button.appendChild(labelHolder);
	// 渲染出的 <span ref> 塞进 glyphHolder，并回填 ref
	const host = new El('span');
	glyphHolder.appendChild(host);
	return { button, host };
}

function runPendingEffects(label) {
	let guard = 0;
	while (pendingEffects.length > 0 && guard < 12) {
		const fn = pendingEffects.shift();
		guard += 1;
		effectDepth += 1;
		try {
			const cleanup = fn();
			if (typeof cleanup === 'function') cleanup();
		} catch (e) {
			console.log(`EFFECT THROW [${label}]:`, e && e.message);
			console.log(e && e.stack && e.stack.split('\n').slice(1, 5).join('\n'));
			return false;
		} finally { effectDepth -= 1; }
	}
	return true;
}

// 逐个渲染并跑 effect
for (const reg of registrations) {
	const name = reg.options?.id ?? reg.options?.key ?? reg.options?.name;
	const injectedProps = typeof reg.options?.inject === 'function' ? reg.options.inject() : {};
	const props = { size: 16, active: false, useSessions, usePanelInfo, ...injectedProps };
	try {
		const out = reg.Component(props);
		renderLog.push(`${name}: render ok (${out === null ? 'null' : out?.type})`);
		// 让 ref 指向一个真实行内 span，便于 effect 走「插入分段控件」分支
		if (name === 'orchestrator2-region-switch') {
			const { button } = mountInRow(out, props);
			const ref = out?.props?.ref;
			if (ref && typeof ref === 'object') ref.current = new El('span');
			if (ref?.current) button.appendChild(ref.current);
			runPendingEffects(name);
			const control = button.querySelector('[data-or2-region-control]');
			const opts = control ? control.querySelectorAll('[data-or2-region-opt]') : [];
			renderLog.push(`  ↳ 行内控件：control=${control ? '有' : '无'}，选项数=${opts.length}，文案=${opts.map((o) => o.textContent).join('/')}`);
		} else {
			runPendingEffects(name);
		}
	} catch (e) {
		renderLog.push(`${name}: RENDER THROW ${e && e.message}`);
		console.log(`RENDER THROW [${name}]:`, e && e.stack);
	}
}

for (const line of renderLog) console.log(line);
console.log('rafQueue =', rafQueue.length);
console.log('DONE');

// ---------- 真正的树渲染：递归展开函数/类组件，再把 effect 全部跑一遍 ----------
function applyProps(dom, props) {
	for (const [key, value] of Object.entries(props)) {
		if (key === 'children' || key === 'key') continue;
		if (key === 'ref') { if (value && typeof value === 'object') value.current = dom; continue; }
		if (key === 'style') { dom.style = { ...(value || {}) }; continue; }
		if (key === 'className') { dom.setAttribute('class', String(value)); continue; }
		if (/^on[A-Z]/.test(key)) { dom['__' + key] = value; continue; }
		if (value === undefined || value === null || value === false) continue;
		dom.setAttribute(key, typeof value === 'string' ? value : String(value));
	}
}
function renderTree(el, parent) {
	if (el === null || el === undefined || el === false || el === true) { renderLog.push(`  (empty ${String(el)})`); return; }
	if (typeof el === 'string' || typeof el === 'number') { parent.appendChild(document.createElement('#text')).textContent = String(el); return; }
	if (Array.isArray(el)) { for (const item of el) renderTree(item, parent); return; }
	const { type, props, kids } = el;
	if (typeof type === 'function') {
		const effective = { ...(props || {}), children: (kids && kids.length ? kids : (props || {}).children) };
		let out;
		const previousFrame = frame;
		const previousIndex = hookIndex;
		frame = type;
		hookIndex = 0;
		try {
			if (type.prototype && type.prototype.render) { const inst = new type(effective); out = inst.render(); }
			else out = type(effective);
		} finally {
			frame = previousFrame;
			hookIndex = previousIndex;
		}
		renderTree(out, parent);
		return;
	}
	const dom = document.createElement(type);
	applyProps(dom, props || {});
	parent.appendChild(dom);
	const children = [].concat(props?.children ?? [], kids ?? []);
	for (const child of children) renderTree(child, dom);
}
function drainEffects(label) {
	let guard = 0;
	while (pendingEffects.length > 0 && guard < 20) {
		guard += 1;
		const fn = pendingEffects.shift();
		try { fn(); } catch (e) {
			console.log(`EFFECT THROW [${label}]:`, e && e.message);
			console.log(String(e && e.stack).split('\n').slice(1, 4).join('\n'));
		}
	}
}

function walk(dom, out) { out.push(dom); for (const c of dom.children) walk(c, out); return out; }
function textOf(dom) { let s = dom.textContent || ''; for (const c of dom.children) s += textOf(c); return s; }
function mountRow(component, props) {
	const row = new El('button');
	const glyph = new El('span');
	row.appendChild(glyph);
	row.appendChild(new El('span')); // 外壳的 label 容器（会被 HIDDEN_ATTR 藏掉）
	renderTree(component(props), glyph);
	return { row, glyph };
}

const sidebarReg = registrations.find((r) => r.options.id === 'orchestrator2-region-switch');
const panelReg = registrations.find((r) => r.options.key === 'orchestrator2-region-switch');
const dialogReg = registrations.find((r) => String(r.options.id).endsWith('.roles-dialog'));
const panelProps = () => (typeof panelReg.options.inject === 'function' ? panelReg.options.inject() : {});
const mountDialog = () => {
	const host = new El('div');
	renderTree(dialogReg.Component(typeof dialogReg.options.inject === 'function' ? dialogReg.options.inject() : {}), host);
	return host;
};

// ---------- 第一遍（config 还在 loading）：结构必须已经能挂上 ----------
try {
	const { row } = mountRow(sidebarReg.Component, { size: 16, active: false });
	drainEffects('sidebar');
	const control = row.querySelector('[data-or2-region-control]');
	const gear = row.querySelector('[data-or2-region-gear]');
	console.log(`[sidebar 第一遍] 行内控件=${control ? '有' : '无'} 设置按钮=${gear ? '有' : '无'}`);
} catch (e) {
	console.log('SIDEBAR THROW:', e && e.stack);
}

console.log('SIM-DONE');

// ---------- 第二遍（state 到位）：滑块点名 → 点它 → 打 /switch ----------
setTimeout(async () => {
	try {
		const { row } = mountRow(sidebarReg.Component, { size: 16, active: false });
		drainEffects('sidebar-2');
		const control = row.querySelector('[data-or2-region-control]');
		const segs = control ? control.querySelectorAll('[data-or2-region-opt]') : [];
		console.log(
			`[sidebar 点亮] 段数=${segs.length} 文案=${segs.map((d) => d.textContent).join('/')} 选中=${segs
				.map((d) => d.getAttribute('data-selected'))
				.join(',')}`,
		);
		const gear = row.querySelector('[data-or2-region-gear]');
		console.log(`[设置按钮] 存在=${gear !== null} 文案=${gear ? gear.textContent : ''}`);
		// 点未点亮的那一侧 → POST /switch {side:'b'}
		if (segs.length === 2) {
			row.dispatch('click', { preventDefault() {}, stopPropagation() {}, target: segs[1] });
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		const switchCalls = calls.filter((c) => /\/switch$/.test(c.url));
		console.log(
			`[切换请求] 次数=${switchCalls.length} 方法=${switchCalls.map((c) => c.method).join(',')} 体=${switchCalls
				.map((c) => String(c.body))
				.join(',')} 含sessionId=${switchCalls.some((c) => String(c.body).includes('sessionId'))}`,
		);
		// 中间的只读面板已经删掉：点行内空白处（外壳 label 那块）就该直接开弹窗。
		const dialogCount = () =>
			walk(mountDialog(), []).filter((d) => d.getAttribute && d.getAttribute('role') === 'dialog').length;
		const beforeBlank = dialogCount();
		const blankTarget = row.children[1] ?? row;
		row.dispatch('click', { preventDefault() {}, stopPropagation() {}, target: blankTarget });
		const afterBlank = dialogCount();
		console.log(`[空白处开弹窗] 点前=${beforeBlank} 点后=${afterBlank}`);

		if (gear) {
			row.dispatch('click', { preventDefault() {}, stopPropagation() {}, target: gear });
		}

		// ---------- 弹窗：TAB 条 + 「使用此场景 / 删除此场景」两个按钮 + 每场景一套左右两列 ----------
		mountDialog();
		drainEffects('dialog-1');
		await new Promise((resolve) => setTimeout(resolve, 30));
		const host = mountDialog();
		drainEffects('dialog-2');
		const find = (node, value) =>
			walk(node, []).find((d) => d.getAttribute && d.getAttribute('data-or2-region') === value);
		const nodes = walk(host, []);
		const tabs = nodes.filter((d) => d.getAttribute && d.getAttribute('data-or2-region-tab'));
		const selects = nodes.filter((d) => d.tagName === 'SELECT');
		const labelInputs = nodes.filter((d) => d.getAttribute && d.getAttribute('data-or2-region-label'));
		const closeBtn = find(host, 'dialog-close');
		// 每个场景 TAB 后面各有一对「使用 / 删除」，用 data-or2-scene 定位到具体场景。
		const sceneButtons = (node, kind, sceneId) =>
			walk(node, []).filter(
				(d) =>
					d.getAttribute &&
					d.getAttribute('data-or2-region') === kind &&
					(sceneId === undefined || d.getAttribute('data-or2-scene') === sceneId),
			);
		const useButtons = sceneButtons(host, 'scene-use');
		const delButtons = sceneButtons(host, 'scene-delete');
		const saveButtons = sceneButtons(host, 'scene-save');
		const useBtn = useButtons[0];
		const delBtn = delButtons[0];
		const greenRed =
			useBtn && delBtn
				? /22,163,74|#16a34a/u.test(String((useBtn.style || {}).background ?? '')) &&
					/#dc2626|220,38,38/u.test(String((delBtn.style || {}).background ?? ''))
				: false;
		const buttons = nodes.filter((d) => d.tagName === 'BUTTON');
		console.log(
			`[弹窗结构] TAB=${tabs.length}（${tabs.map((d) => textOf(d).trim()).join(' | ')}） ` +
				`应用按钮=${useButtons.length}（${useButtons.map((b) => textOf(b).trim()).join('|')}） 删除按钮=${
					delButtons.length
				}（${delButtons.map((b) => textOf(b).trim()).join('|')}） 绿红配色=${greenRed ? 'true' : 'false'} ` +
				`下拉=${selects.length} 名称输入=${labelInputs.length}（${labelInputs.map((d) => d.value).join('/')}） ` +
				`保存按钮=${saveButtons.length}（${saveButtons.map((b) => textOf(b).trim()).join('|')}） 取消按钮=${
					buttons.some((b) => /^取消$/u.test(textOf(b).trim())) ? '有' : '无'
				} 关闭按钮=${closeBtn !== undefined} 新增按钮=${buttons.some((b) => /＋/.test(textOf(b)))} 旧单选圆点=${
					nodes.some((d) => d.tagName === 'INPUT' && d.getAttribute('type') === 'radio') ? '有' : '无'
				}`,
		);
		// TAB 条钉顶；底栏（取消 / 保存）已删，保存挪进了 TAB 条。
		console.log(
			`[滚动固定] ${(() => {
				const all = walk(host, []);
				const sticky = all.filter((d) => String((d.style || {}).position ?? '') === 'sticky');
				const top = sticky.find((d) => String((d.style || {}).top ?? '') === '0');
				const bottom = sticky.find((d) => String((d.style || {}).bottom ?? '') === '0');
				const topText = top ? textOf(top) : '';
				return `钉顶=${top ? 'true' : 'false'} 钉顶含保存应用删除=${
					/保存/u.test(topText) && /应用/u.test(topText) && /删除/u.test(topText) ? 'true' : 'false'
				} 无底栏=${bottom ? 'false' : 'true'}`;
			})()}`,
		);

		// ---------- 模型下拉：分组（提供商）+ 具体模型合并成一个框（optgroup） ----------
		const routeSelects = selects.filter((d) =>
			d.children.some((child) => String(child.tagName || '').toUpperCase() === 'OPTGROUP'),
		);
		const optgroups = routeSelects.reduce(
			(sum, d) => sum + d.children.filter((c) => String(c.tagName || '').toUpperCase() === 'OPTGROUP').length,
			0,
		);
		const groupedValues = routeSelects.filter((d) => String(d.value || '').includes('\u0000')).length;
		console.log(
			`[模型合并下拉] 路由下拉=${routeSelects.length}（应为 6） 分组总数=${optgroups} 值含分隔=${groupedValues}`,
		);

		// TAB 条里的顺序：… TAB ×N, ＋ 场景, 使用, 删除（只有一套动作按钮，作用于选中的 TAB）。
		console.log(
			`[TAB 条动作按钮] 文案=${saveButtons.map((b) => textOf(b).trim()).join('|')} / ${useButtons.map((b) => textOf(b).trim()).join('|')} / 覆盖 / ${delButtons
				.map((b) => textOf(b).trim())
				.join('|')} 在新增按钮之后=${
				(() => {
					const all = walk(host, []);
					const addIdx = all.findIndex((d) => d.tagName === 'BUTTON' && /＋/.test(textOf(d)));
					const firstUse = all.indexOf(useButtons[0]);
					return addIdx >= 0 && firstUse > addIdx ? 'true' : 'false';
				})()
			} 保存在应用之前=${(() => {
					const all = walk(host, []);
					const saveIdx = all.indexOf(saveButtons[0]);
					const useIdx = all.indexOf(useButtons[0]);
					return saveIdx >= 0 && useIdx >= 0 && saveIdx < useIdx ? 'true' : 'false';
				})()} 选中TAB实心=${
				tabs.some((d) => /brand-primary|#4d6bfe/u.test(String((d.style || {}).background ?? ''))) ? 'true' : 'false'
			}`,
		);
		console.log(
			`[应用按钮状态·使用中场景] 文案=${useBtn ? textOf(useBtn).trim() : '无'} 禁用=${
					useBtn ? useBtn.getAttribute('disabled') : '无'
				}`,
		);
		// ---------- 按钮形状统一：高度 / 圆角 / 字号 / 内边距 必须一致（颜色可以不同） ----------
		const wantedLabels = ['保存', '＋ 场景', '应用', '覆盖', '删除', '模拟限流（测试）', '重置历史'];
		const pickButton = (label) =>
			walk(host, []).find((d) => d.tagName === 'BUTTON' && textOf(d).trim() === label);
		const shapedButtons = [tabs[0], ...wantedLabels.map(pickButton)].filter(Boolean);
		const shapeOf = (b) => {
			const s = b.style || {};
			return `${s.height} | ${s.borderRadius} | ${s.fontSize} | ${s.padding}`;
		};
		const shapes = shapedButtons.map(shapeOf);
		console.log(
			`[按钮统一样式] 个数=${shapedButtons.length}/8 形状=${
				new Set(shapes).size === 1 ? '一致' : [...new Set(shapes)].join(' / ')
			} 文案=${shapedButtons.map((b) => textOf(b).trim()).join('|')}`,
		);
		console.log(`[按钮统一样式·样本] ${shapes[0] ?? '无'}`);

		// ---------- 失效自动切换：标题 + ？TIPS + 启用勾选框（只有一个开关） ----------
		const enableBox = find(host, 'failover-enable');
		const tipsDot = find(host, 'failover-help');
		const hostText = textOf(host);
		const hasRadio = walk(host, []).some((d) => d.tagName === 'INPUT' && d.getAttribute('type') === 'radio');
		const tipsText = tipsDot ? String(tipsDot.getAttribute('aria-label') ?? '') : '';
		const tipsNativeTitle = tipsDot ? tipsDot.getAttribute('title') : null;
		const helpPanel = find(host, 'failover-help-panel');
		console.log(
			`[失效自动切换节] 标题=${/失效自动切换/u.test(hostText) ? 'true' : 'false'} 启用勾选框=${
				enableBox ? '有' : '无'
			} 勾选=${enableBox ? String(enableBox.getAttribute('checked')) : '无'} 问号=${tipsDot ? '有' : '无'} 旧单选圆点=${
				hasRadio ? '有' : '无'
			}`,
		);
		console.log(
			`[问号TIPS] 文案长度=${tipsText.length} 含冷却=${/冷却/u.test(tipsText) ? 'true' : 'false'} 含下一场景=${
				/下一个场景/u.test(tipsText) ? 'true' : 'false'
			} 原生title=${tipsNativeTitle === null ? '无（统一用浮层）' : '有'} 常驻说明块=${helpPanel ? '有' : '无'}`,
		);
		// 悬停与点击必须是同一个浮层（用户：两种 TIPS 要一个格式）。
		const orderHintParagraphs = walk(host, []).filter(
			(d) => d.tagName === 'P' && /整轮没有一个可用/u.test(textOf(d)),
		);
		console.log(
			`[顺序说明并入TIPS] 正文段落=${orderHintParagraphs.length === 0 ? '无' : `有(${orderHintParagraphs.length})`} TIPS含整轮=${
				/整轮没有一个可用/u.test(tipsText) ? 'true' : 'false'
			}`,
		);
		const tipsWrap = tipsDot?.parent ?? null;
		if (tipsWrap && typeof tipsWrap.__onMouseEnter === 'function') tipsWrap.__onMouseEnter();
		const hostHover = mountDialog();
		drainEffects('dialog-help-hover');
		const hoverPanel = find(hostHover, 'failover-help-panel');
		console.log(
			`[问号悬停] 浮层=${hoverPanel ? '出现' : '无'} 与点击同一个格式=${
				hoverPanel && String((hoverPanel.style || {}).position ?? '') === 'absolute' ? 'true' : 'false'
			} 文案长度=${hoverPanel ? textOf(hoverPanel).trim().length : 0}`,
		);
		if (tipsWrap && typeof tipsWrap.__onMouseLeave === 'function') tipsWrap.__onMouseLeave();
		const hostLeave = mountDialog();
		drainEffects('dialog-help-leave');
		console.log(`[悬停移出] 浮层=${find(hostLeave, 'failover-help-panel') ? '仍在' : '已收起'}`);
		// 点「？」应当就地展开说明块（用户反馈：点了没反应）。
		const tipsClick = { stopPropagation() {}, preventDefault() {}, target: tipsDot };
		if (typeof tipsDot?.__onClick === 'function') tipsDot.__onClick(tipsClick);
		const hostHelp = mountDialog();
		drainEffects('dialog-help-open');
		const helpOpenPanel = find(hostHelp, 'failover-help-panel');
		console.log(
			`[问号点击] 说明块=${helpOpenPanel ? '出现' : '无'} 文案长度=${
				helpOpenPanel ? textOf(helpOpenPanel).trim().length : 0
			} 含冷却=${helpOpenPanel ? (/冷却/u.test(textOf(helpOpenPanel)) ? 'true' : 'false') : '无'} 宽度=${String(helpOpenPanel?.style?.width ?? '')}`,
		);
		// 再点一次收起，保持后续断言在同一状态。
		const tipsAgain = find(hostHelp, 'failover-help');
		if (typeof tipsAgain?.__onClick === 'function') tipsAgain.__onClick({ ...tipsClick, target: tipsAgain });
		// 顺序表：两列槽位，每格一个 ✕（清空这一格），不再有 ↑ ↓。
		const glyphButtons = walk(host, []).filter(
			(d) => d.tagName === 'BUTTON' && ['↑', '↓', '✕'].includes(textOf(d).trim()),
		);
		const glyphTitled = glyphButtons.filter((b) => typeof b.__onMouseEnter === 'function');
		const orderSelects = walk(host, []).filter(
			(d) => d.tagName === 'SELECT' && d.getAttribute && d.getAttribute('data-or2-order') === 'slot',
		);
		console.log(
			`[顺序槽位] 格数=${orderSelects.length} 清空按钮=${glyphButtons.length} 带悬浮说明=${glyphTitled.length} 首个=${
				glyphButtons[0] ? textOf(glyphButtons[0]).trim() : '无'
			} 有↑↓=${glyphButtons.some((b) => ['↑', '↓'].includes(textOf(b).trim())) ? 'true' : 'false'}`,
		);
		// 每个槽位下拉的第一个选项是「空」，所以清空之后还能再选回来。
		const firstOptionEmpty = orderSelects.every((select) => {
			const options = (select.children ?? []).filter((child) => child && child.tagName === 'OPTION');
			return options.length > 0 && options[0].getAttribute('value') === '';
		});
		// 清空第一格：提交的 order 里不应再有原来那一格选中的场景。
		const beforeClear = calls.length;
		const slot0Value = orderSelects[0]?.getAttribute('value') ?? '';
		if (typeof glyphButtons[0]?.__onClick === 'function') {
			glyphButtons[0].__onClick({ preventDefault() {}, stopPropagation() {} });
			await new Promise((resolve) => setTimeout(resolve, 40));
		}
		const clearCalls = calls.slice(beforeClear).filter((c) => /\/failover$/u.test(c.url));
		const clearBody = clearCalls[0] ? clearCalls[0].body : '';
		console.log(
			`[顺序槽位·清空] 空选项=${firstOptionEmpty ? 'true' : 'false'} 第一格原值=${slot0Value || '空'} 提交体=${clearBody || '无'} 已清掉=${
				clearBody !== '' && slot0Value !== '' && !clearBody.includes(slot0Value) ? 'true' : 'false'
			}`,
		);
		// 两个动作按钮：同款按钮样式（有边框底色、圆角、内边距），不是文字链接。
		const actionButtons = walk(host, []).filter((d) => d.tagName === 'BUTTON' && /模拟限流|重置历史/u.test(textOf(d)));
		const looksLikeButton = (b) => {
			const s = b.style || {};
			return typeof s.borderRadius === 'string' && typeof s.padding === 'string' && /rgba|#/u.test(String(s.border ?? ''));
		};
		console.log(
			`[两个动作按钮] 个数=${actionButtons.length} 都是按钮样式=${
				actionButtons.length === 2 && actionButtons.every(looksLikeButton) ? 'true' : 'false'
			} 与数字同一行=${(() => {
				const row = actionButtons[0]?.parent?.parent;
				if (!row) return 'false';
				const hasNumberInput = Boolean(row.children?.some((c) => c.tagName === 'INPUT' || (c.children ?? []).some((g) => g.tagName === 'INPUT')));
				return hasNumberInput ? 'true' : 'false';
			})()} 靠右=${String((actionButtons[0]?.parent?.style || {}).marginLeft ?? '') === 'auto' ? 'true' : 'false'} 带底色=${
				actionButtons.every((b) => /rgba\(/u.test(String((b.style || {}).background ?? ''))) ? 'true' : 'false'
			} 文案=${actionButtons.map((b) => textOf(b).trim()).join(' / ')}`,
		);
		// 状态条：五项（当前场景 / 位置 / 最近翻转 / 滚动 1 小时 / 本轮已失败）
		const statLabels = ['当前场景', '位置', '最近翻转', '滚动 1 小时', '本轮已失败'].filter((label) => hostText.includes(label));
		console.log(`[状态条] 项=${statLabels.length}/5`);
		if (enableBox && typeof enableBox.__onChange === 'function') {
			const beforeEnable = calls.length;
			enableBox.__onChange({ target: { checked: true } });
			await new Promise((resolve) => setTimeout(resolve, 20));
			const enableCall = calls.slice(beforeEnable).find((entry) => /\/failover$/.test(entry.url));
			console.log(`[启用开关] 请求=${enableCall ? enableCall.method : '无'} 体=${enableCall ? enableCall.body : '无'}`);
		}

		const redRing = (node) => {
			const s = node.style || {};
			return /225,\s*29,\s*72|#e11d48/u.test(`${String(s.boxShadow ?? '')} ${String(s.border ?? '')}`);
		};
		const activeTab = tabs.find(redRing);
		const filled = (node) => /brand-primary|#4d6bfe/u.test(String((node.style || {}).background ?? ''));
		const selectedTab = tabs.find(filled);
		const plainTab = tabs.find((d) => !filled(d) && !redRing(d));
		// 表头两侧现在是按钮（双击切主备），「主」那侧带内描边红环。
		const ringHeads = walk(host, []).filter(
			(d) => d.tagName === 'BUTTON' && redRing(d) && d.getAttribute('data-or2-side') !== null,
		);
		console.log(
			`[TAB 着色] 生效TAB=${activeTab ? textOf(activeTab).trim() : '无'} 选中TAB=${
				selectedTab ? textOf(selectedTab).trim() : '无'
			} 个数=${tabs.length} 选中背景=${String((selectedTab?.style || {}).background ?? '无')} 未选中背景=${
				String((plainTab?.style || {}).background ?? '无')
			} 对比明显=${selectedTab && plainTab && filled(selectedTab) && !filled(plainTab) ? 'true' : 'false'}`,
		);
		console.log(
			`[红环] 生效TAB红环=${activeTab ? 'true' : 'false'} 表头红环=${ringHeads.length === 1 ? 'true' : `false(${ringHeads.length})`} 主侧实线=${ringHeads.every((d) => /2px solid/u.test(String((d.style || {}).border ?? ''))) ? 'true' : 'false'} 表头文字=${
				ringHeads.map((d) => textOf(d).trim()).join('|') || '无'
			} 弹窗出现「使用中」=${/使用中/u.test(textOf(host)) ? '有' : '无'}`,
		);

		// 双击「备」那一侧的表头 = 把那一侧设成主模型（走 POST /switch，侧边栏同步）。
		const otherHead = walk(host, []).find(
			(d) => d.tagName === 'BUTTON' && d.getAttribute('data-or2-side') !== null && !redRing(d),
		);
		console.log(
			`[表头边框] 主侧实线=${ringHeads.every((d) => /2px solid/u.test(String((d.style || {}).border ?? ''))) ? 'true' : 'false'} 备侧虚线=${
				otherHead && /2px dashed/u.test(String((otherHead.style || {}).border ?? '')) ? 'true' : 'false'
			} 同宽=${
				ringHeads.length === 1 && otherHead
					? String((ringHeads[0].style || {}).border ?? '').startsWith('2px') &&
					  String((otherHead.style || {}).border ?? '').startsWith('2px')
						? 'true'
						: 'false'
					: 'false'
			}`,
		);
		const switchBefore = calls.filter((c) => /\/switch$/u.test(c.url)).length;
		if (otherHead && typeof otherHead.__onDoubleClick === 'function') otherHead.__onDoubleClick({});
		const switchAfter = calls.filter((c) => /\/switch$/u.test(c.url));
		console.log(
			`[表头双击] 目标侧=${otherHead ? otherHead.getAttribute('data-or2-side') : '无'} 新增请求=${
				switchAfter.length - switchBefore
			} 体=${switchAfter.length === 0 ? '无' : String(switchAfter[switchAfter.length - 1].body ?? '')} 有悬浮说明=${
				otherHead && typeof otherHead.__onMouseEnter === 'function' ? 'true' : 'false'
			}`,
		);

		// 双击后草稿主槽也要跟着翻，红环才会移到刚双击的那一侧。
		await new Promise((resolve) => setTimeout(resolve, 20));
		drainEffects('dialog-after-switch');
		const host2 = mountDialog();
		drainEffects('dialog-after-switch-2');
		const ringAfter = walk(host2, []).find(
			(d) => d.tagName === 'BUTTON' && redRing(d) && d.getAttribute('data-or2-side') !== null,
		);
		console.log(
			`[双击后红环] 目标侧=${otherHead ? otherHead.getAttribute('data-or2-side') : '无'} 红环侧=${
				ringAfter ? ringAfter.getAttribute('data-or2-side') : '无'
			} 一致=${
				otherHead && ringAfter && otherHead.getAttribute('data-or2-side') === ringAfter.getAttribute('data-or2-side')
					? 'true'
					: 'false'
			}`,
		);

		// 切到「完整的另一个场景」：按钮应可点，点一下立即发 POST /select（不等保存）。
		if (tabs[1]) {
			tabs[1].__onClick();
			const host1b = mountDialog();
			drainEffects('dialog-scene2');
			const useBtn2 = sceneButtons(host1b, 'scene-use', tabs[1].getAttribute('data-or2-region-tab'))[0];
			console.log(
				`[未使用场景] 文案=${useBtn2 ? textOf(useBtn2).trim() : '无'} 禁用=${useBtn2 ? useBtn2.getAttribute('disabled') : '无'}`,
			);
			if (useBtn2 && typeof useBtn2.__onClick === 'function') {
				const beforeSelect = calls.length;
				useBtn2.__onClick();
				await new Promise((resolve) => setTimeout(resolve, 20));
				const call = calls.slice(beforeSelect).find((entry) => /\/select$/.test(entry.url));
				console.log(`[使用即生效] 请求=${call ? call.method : '无'} 体=${call ? call.body : '无'}`);
			}
		}

		// 切到不完整的场景三：按钮必须禁用 + 给提示
		if (tabs[2]) {
			tabs[2].__onClick();
			const host2 = mountDialog();
			drainEffects('dialog-scene3');
			const nodes2 = walk(host2, []);
			const selects2 = nodes2.filter((d) => d.tagName === 'SELECT');
			const useBtn3 = sceneButtons(host2, 'scene-use', tabs[2].getAttribute('data-or2-region-tab'))[0];
			const text2 = textOf(host2);
			console.log(
				`[不完整场景] 使用按钮禁用=${useBtn3 ? useBtn3.getAttribute('disabled') : '无'} 提示=${
					/都要选全/.test(text2) ? 'true' : 'false'
				} 下拉=${selects2.length} 名称=${(nodes2.find((d) => d.getAttribute && d.getAttribute('data-or2-region-label')) || {}).value ?? '无'}`,
			);
			// 保存：生效场景仍是完整的那一个，请求体带两个场景
			const saveBtn = nodes2.find((d) => d.tagName === 'BUTTON' && textOf(d).trim() === '保存');
			if (saveBtn) {
				saveBtn.__onClick();
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
			const saveCall = calls.filter((c) => /\/scenarios$/.test(c.url)).pop();
			const body = saveCall ? JSON.parse(String(saveCall.body)) : {};
			console.log(
				`[保存请求] 次数=${calls.filter((c) => /\/scenarios$/.test(c.url)).length} 方法=${saveCall ? saveCall.method : '无'} ` +
					`场景数=${Array.isArray(body.scenarios) ? body.scenarios.length : '无'} 生效=${body.activeScenario ?? '无'} ` +
					`第一场景名=${JSON.stringify(body.scenarios?.[0]?.labels ?? null)}`,
			);
			const host3 = mountDialog();
			drainEffects('dialog-saved');
			console.log(`[保存回显] 已保存=${/已保存/u.test(textOf(host3))}`);
		}
		// 关闭按钮真的能关
		if (closeBtn) {
			const closeIcon = closeBtn ? walk(closeBtn, []).filter((d) => d.tagName === 'SVG' && d.getAttribute('data-or2-icon') === 'close') : [];
			closeBtn.__onClick();
			const after = walk(mountDialog(), []).filter((d) => d.getAttribute && d.getAttribute('role') === 'dialog');
			console.log(
				`[关闭按钮] 自绘叉=${closeIcon.length === 1 ? 'true' : `false(${closeIcon.length})`} 尺寸=${
					closeIcon[0] ? `${closeIcon[0].getAttribute('width')}x${closeIcon[0].getAttribute('height')}` : '无'
				} 按钮盒=${String((closeBtn.style || {}).width)} 点击后弹窗数=${after.length}`,
			);
		}

		// ---------- 主面板已删除：只剩侧边栏一行 + 设置弹窗两个槽位 ----------
		const mainRegs = registrations.filter((r) => r.options.name === 'main');
		console.log(`[槽位] 总注册=${registrations.length} 主面板槽位=${mainRegs.length}`);

		// 上一步刚点了关闭按钮，这里把弹窗重新打开再断言（打开后弹窗才会渲染内容）。
		if (gear) {
			row.dispatch('click', { preventDefault() {}, stopPropagation() {}, target: gear });
		}

		// ---------- 悬浮说明：全部改成和「？」同款的浮层（不用浏览器原生气泡） ----------
		const tipHost0 = mountDialog();
		drainEffects('dialog-tip');
		const tipTargets = walk(tipHost0, []).filter(
			(d) => d.tagName === 'BUTTON' && typeof d.__onMouseEnter === 'function',
		);
		const nativeTitles = walk(tipHost0, []).filter(
			(d) => typeof d.getAttribute === 'function' && String(d.getAttribute('title') ?? '') !== '',
		);
		// 逐个悬停，取最长的那条文案（第一个是关闭按钮，只有两个字，不足以证明浮层能装长文）。
		let longest = 0;
		let longestSample = '';
		let hovered = 0;
		for (const target of tipTargets.slice(0, 24)) {
			target.__onMouseEnter?.({ currentTarget: { getBoundingClientRect: () => ({ left: 120, bottom: 220 }) } });
			const probe = walk(mountDialog(), []).find((d) => d.getAttribute && d.getAttribute('data-or2-region') === 'tip-float');
			const text = probe ? textOf(probe).trim() : '';
			if (text.length > longest) {
				longest = text.length;
				longestSample = text;
			}
			if (text !== '') hovered += 1;
			target.__onMouseLeave?.({});
		}
		console.log(`[悬浮说明·逐个] 悬停=${hovered}/${tipTargets.length} 最长=${longest} 样例=${JSON.stringify(longestSample.slice(0, 24))}`);
		const hoverFirst = tipTargets[0];
		hoverFirst?.__onMouseEnter?.({ currentTarget: { getBoundingClientRect: () => ({ left: 120, bottom: 220 }) } });
		const tipHost1 = mountDialog();
		drainEffects('dialog-tip-open');
		const tipFloat = walk(tipHost1, []).find((d) => d.getAttribute && d.getAttribute('data-or2-region') === 'tip-float');
		const tipStyle = tipFloat?.style ?? {};
		console.log(
			`[悬浮说明] 带浮层的按钮=${tipTargets.length} 原生title=${nativeTitles.length === 0 ? '无' : nativeTitles.length} 出现=${
				tipFloat ? '有' : '无'
			} 文案长度=${tipFloat ? textOf(tipFloat).trim().length : 0} 与问号同款=${
				tipFloat && /rgba|#/u.test(String(tipStyle.border ?? '')) && String(tipStyle.whiteSpace ?? '') === 'pre-wrap' ? 'true' : 'false'
			} 定位=${String(tipStyle.position ?? '')} 宽度=${String(tipStyle.width ?? '')} 上限=${String(tipStyle.maxWidth ?? '')}`,
		);
		hoverFirst?.__onMouseLeave?.({});
		const tipHost2 = mountDialog();
		drainEffects('dialog-tip-close');
		const stillOpen = walk(tipHost2, []).some((d) => d.getAttribute && d.getAttribute('data-or2-region') === 'tip-float');
		console.log(`[悬浮说明·移开] 浮层=${stillOpen ? '还在' : '已收起'}`);

		// ---------- 会话级覆盖：提示在正文，「覆盖」按钮在 TAB 条（带二次确认） ----------
		const adoptHost = mountDialog();
		drainEffects('dialog-overrides');
		const adoptNodes = walk(adoptHost, []);
		const adoptText = textOf(adoptHost);
		const adoptBtn = adoptNodes.find((d) => d.getAttribute && d.getAttribute('data-or2-region') === 'overrides-adopt');
		const delBtn0 = adoptNodes.find((d) => d.getAttribute && d.getAttribute('data-or2-region') === 'scene-delete');
		const order = walk(adoptHost, []).filter(
			(d) =>
				d.getAttribute &&
				['scene-save', 'scene-use', 'overrides-adopt', 'scene-delete'].includes(d.getAttribute('data-or2-region')),
		);
		console.log(
			`[会话覆盖提示] 提示=${adoptText.includes('被会话级覆盖钉住') ? 'true' : 'false'} 会话短写=${
				adoptText.includes('bdbdbdf6') ? 'true' : 'false'
			} 按钮=${adoptBtn ? 'true' : 'false'} 文案=${adoptBtn ? textOf(adoptBtn).trim() : '无'} 在删除之前=${
				adoptBtn && delBtn0 && order.indexOf(adoptBtn) < order.indexOf(delBtn0) ? 'true' : 'false'
			} 顺序=${order.map((d) => textOf(d).trim()).join(' / ')}`,
		);

		// 点「覆盖」先出确认层，取消后不请求、确定后才请求。
		const confirmOf = (node) =>
			walk(node, []).find((d) => d.getAttribute && d.getAttribute('data-or2-region') === 'confirm-layer');
		const clickOf = (node, value) => {
			const target = walk(node, []).find(
				(d) => d.getAttribute && d.getAttribute('data-or2-region') === value && typeof d.__onClick === 'function',
			);
			if (target) target.__onClick({ preventDefault() {}, stopPropagation() {} });
			return Boolean(target);
		};
		const adoptCalls = () => calls.filter((c) => /\/adopt$/.test(c.url)).length;

		const beforeAdoptCalls = adoptCalls();
		adoptBtn?.__onClick?.({ preventDefault() {}, stopPropagation() {} });
		let confirmHost = mountDialog();
		drainEffects('dialog-confirm-adopt');
		const adoptConfirmText = textOf(confirmHost);
		console.log(
			`[确认·覆盖] 确认层=${confirmOf(confirmHost) ? '有' : '无'} 文案含数量=${/覆盖到 1 个/u.test(adoptConfirmText) ? 'true' : 'false'} 请求数=${adoptCalls() - beforeAdoptCalls}`,
		);

		clickOf(confirmHost, 'confirm-cancel');
		confirmHost = mountDialog();
		drainEffects('dialog-confirm-cancel');
		console.log(
			`[确认·取消] 确认层=${confirmOf(confirmHost) ? '有' : '无'} 请求数=${adoptCalls() - beforeAdoptCalls}`,
		);

		adoptBtn?.__onClick?.({ preventDefault() {}, stopPropagation() {} });
		confirmHost = mountDialog();
		drainEffects('dialog-confirm-adopt-2');
		clickOf(confirmHost, 'confirm-ok');
		await new Promise((resolve) => setTimeout(resolve, 20));
		const host4 = mountDialog();
		drainEffects('dialog-after-adopt');
		const t4 = textOf(host4);
		console.log(
			`[覆盖结果] 请求=${adoptCalls() - beforeAdoptCalls} 确认层=${confirmOf(host4) ? '有' : '无'} 提示消失=${
				t4.includes('被会话级覆盖钉住') ? 'false' : 'true'
			} 成功文案=${t4.includes('已覆盖 1 个会话') ? 'true' : 'false'}`,
		);

		// 删除也要确认：点取消就什么都不发生。
		const preHost = mountDialog();
		drainEffects('dialog-before-delete');
		const preScenes = walk(preHost, []).filter((d) => d.getAttribute && d.getAttribute('data-or2-region-tab')).length;
		const delButton = walk(preHost, []).find(
			(d) => d.getAttribute && d.getAttribute('data-or2-region') === 'scene-delete' && typeof d.__onClick === 'function',
		);
		const scenesBefore = JSON.parse(JSON.stringify(calls.filter((c) => /\/scenarios$/.test(c.url)).length));
		delButton?.__onClick?.({ preventDefault() {}, stopPropagation() {} });
		let delHost = mountDialog();
		drainEffects('dialog-confirm-delete');
		const delText = textOf(delHost);
		console.log(
			`[确认·删除] 确认层=${confirmOf(delHost) ? '有' : '无'} 文案含场景名=${/删除场景/u.test(delText) ? 'true' : 'false'} 标签数=${preScenes}`,
		);
		clickOf(delHost, 'confirm-cancel');
		delHost = mountDialog();
		drainEffects('dialog-confirm-delete-cancel');
		const scenesAfterCancel = walk(delHost, []).filter((d) => d.getAttribute && d.getAttribute('data-or2-region-tab')).length;
		console.log(
			`[确认·删除取消] 确认层=${confirmOf(delHost) ? '有' : '无'} 标签数不变=${scenesAfterCancel === preScenes ? 'true' : 'false'}`,
		);

		// ---------- model-routes.json 被外部改动（drift）→ 提示条 + 「重新应用当前场景」 ----------
		// 走真实路径：弹窗每次打开都重读 /state，所以宿主那边一变，打开就能看到提示条。
		stateNow = { ...statePayload, drift: true, driftRoles: ['reviewer'] };
		mountDialog();
		drainEffects('drift-open');
		await new Promise((resolve) => setTimeout(resolve, 40));
		const driftHost = mountDialog();
		drainEffects('drift-dialog');
		const driftBar = find(driftHost, 'drift');
		const reapplyBtn = find(driftHost, 'drift-reapply');
		const driftText = driftBar ? textOf(driftBar) : '';
		const postsBeforeReapply = calls.filter((c) => /\/scenarios$/.test(c.url)).length;
		if (reapplyBtn && typeof reapplyBtn.__onClick === 'function') {
			reapplyBtn.__onClick({ preventDefault() {}, stopPropagation() {} });
			await new Promise((resolve) => setTimeout(resolve, 40));
		}
		const postsAfterReapply = calls.filter((c) => /\/scenarios$/.test(c.url)).length;
		const driftText2 = textOf(mountDialog());
		console.log(
			`[漂移提示] 提示条=${driftBar ? '有' : '无'} 按钮=${reapplyBtn ? textOf(reapplyBtn).trim() : '无'} 文案含角色名=${
				/审核员/u.test(driftText) ? 'true' : 'false'
			} 点按钮发保存=${postsAfterReapply - postsBeforeReapply} 成功文案=${/已把当前场景重新写回/u.test(driftText2) ? 'true' : 'false'}`,
		);
		stateNow = statePayload;

		// ---------- 漂移的会话归属：哪个工作区哪个会话 + 逐会话「应用 / 放弃」 ----------
		stateNow = {
			...statePayload,
			drift: true,
			driftRoles: ['reviewer'],
			routesMtime: '2025-10-22T03:14:15.000Z',
			driftSessions: [
				{
					sessionId: 'session-abc12345-0000-4000-8000-000000000000',
					shortId: 'abc12345',
					workspace: 'C:\\Users\\demo\\.dsh\\plugin-src\\demo',
					roles: ['reviewer'],
					overrides: { reviewer: { provider: 'deepseek-official', model: 'cn:step-5-preview' } },
					dismissed: false,
				},
			],
		};
		mountDialog();
		drainEffects('drift2-open');
		await new Promise((resolve) => setTimeout(resolve, 40));
		const driftHost2 = mountDialog();
		drainEffects('drift2-dialog');
		const driftRows = walk(driftHost2, []).filter(
			(d) => d.getAttribute && d.getAttribute('data-or2-region') === 'drift-session',
		);
		const applyBtn = find(driftHost2, 'drift-apply');
		const dismissBtn = find(driftHost2, 'drift-dismiss');
		const rowText = driftRows[0] ? textOf(driftRows[0]) : '';
		const beforeDrift = calls.length;
		if (applyBtn && typeof applyBtn.__onClick === 'function') {
			applyBtn.__onClick({ preventDefault() {}, stopPropagation() {} });
			await new Promise((resolve) => setTimeout(resolve, 40));
		}
		const applyCall = calls.slice(beforeDrift).find((c) => /\/drift$/.test(c.url));
		const appliedText = textOf(mountDialog());
		const beforeDismiss = calls.length;
		const dismissBtn2 = find(mountDialog(), 'drift-dismiss');
		if (dismissBtn2 && typeof dismissBtn2.__onClick === 'function') {
			dismissBtn2.__onClick({ preventDefault() {}, stopPropagation() {} });
			await new Promise((resolve) => setTimeout(resolve, 40));
		}
		const dismissCall = calls.slice(beforeDismiss).find((c) => /\/drift$/.test(c.url));
		console.log(
			`[漂移·会话] 行数=${driftRows.length} 含工作区=${/plugin-src\\demo/u.test(rowText) ? 'true' : 'false'} 含会话号=${
				/abc12345/u.test(rowText) ? 'true' : 'false'
			} 两个按钮=${applyBtn ? '有' : '无'}/${dismissBtn ? '有' : '无'} 应用体=${applyCall ? applyCall.body : '无'} 放弃体=${
				dismissCall ? dismissCall.body : '无'
			} 应用后文案=${/已把当前场景应用到该会话/u.test(appliedText) ? 'true' : 'false'}`,
		);
		stateNow = statePayload;

		// ---------- 模型变更管控（铁律）：卡片 + 开关 + 回滚记录 ----------
		const guardHost = mountDialog();
		const guardText = textOf(guardHost);
		const guardToggle = walk(guardHost, []).find(
			(d) => d.getAttribute && d.getAttribute('data-or2-region') === 'guard-toggle',
		);
		const guardState = walk(guardHost, []).find(
			(d) => d.getAttribute && d.getAttribute('data-or2-region') === 'guard-state',
		);
		const revertRows = walk(guardHost, []).filter(
			(d) => d.getAttribute && d.getAttribute('data-or2-region') === 'guard-revert',
		);
		console.log(
			`[铁律] 卡片=${/模型变更管控/.test(guardText) ? '有' : '无'} 状态=${textOf(guardState) || '无'} 勾选=${
				guardToggle ? String(guardToggle.getAttribute('checked')) : '无'
			} 回滚记录=${revertRows.length} 记录含角色名=${/审核员/.test(textOf(revertRows[0])) ? 'true' : 'false'}`,
		);
		const beforeGuard = calls.length;
		if (guardToggle && typeof guardToggle.__onChange === 'function') {
			guardToggle.__onChange({ target: { checked: false } });
			await new Promise((resolve) => setTimeout(resolve, 40));
		}
		const guardCall = calls.slice(beforeGuard).find((c) => /\/guard$/.test(c.url));
		const afterToggleHost = mountDialog();
		const afterToggleText = textOf(afterToggleHost);
		const afterToggleBox = walk(afterToggleHost, []).find(
			(d) => d.getAttribute && d.getAttribute('data-or2-region') === 'guard-toggle',
		);
		console.log(
			`[铁律·关] 请求体=${guardCall ? guardCall.body : '无'} 状态=${
				/启用/.test(textOf(walk(afterToggleHost, []).find((d) => d.getAttribute && d.getAttribute('data-or2-region') === 'guard-state')))
					? '启用'
					: '无'
			} 勾选=${
				afterToggleBox ? String(afterToggleBox.getAttribute('checked') === true || afterToggleBox.getAttribute('checked') === 'true') : '无'
			} 文案=${
				/会话可以自己改模型表/u.test(afterToggleText) ? 'true' : 'false'
			}`,
		);
		guardNow = { ...statePayload.guard };

		// ---------- 铁律那个 ？：点开浮层，长说明藏在里面，正文只留「回滚状态」 ----------
		const guardDotHost = mountDialog();
		const guardCard = find(guardDotHost, 'guard');
		const guardDot = walk(guardCard ?? guardDotHost, []).find(
			(d) =>
				d.getAttribute &&
				d.getAttribute('data-or2-region') === 'failover-help' &&
				typeof d.__onClick === 'function',
		);
		guardDot?.__onClick?.({ preventDefault() {}, stopPropagation() {} });
		await new Promise((resolve) => setTimeout(resolve, 20));
		const guardDotPanel = walk(mountDialog(), []).find(
			(d) => d.getAttribute && d.getAttribute('data-or2-region') === 'failover-help-panel',
		);
		const guardDotText = guardDotPanel ? textOf(guardDotPanel) : '';
		const guardBodyText = guardText;
		console.log(
			`[铁律·问号] 浮层=${
				guardDotPanel ? '有' : '无'
			} 含回滚记录说明=${guardDotText.includes('回滚记录') ? 'true' : 'false'} 含勾选说明=${
				guardDotText.includes('勾上这个方框') ? 'true' : 'false'
			} 正文无长说明=${guardBodyText.includes('勾上这个方框') ? 'false' : 'true'} 无回滚小标题=${
				guardBodyText.includes('回滚状态') ? 'false' : 'true'
			}`,
		);

		// ---------- 说明文案：原来面板一段 + 弹窗一段，已合并成一段 ----------
		const descText = textOf(mountDialog());
		console.log(
			`[合并说明] 含聊天窗模型=${/主会话模型由聊天窗/.test(descText) ? 'true' : 'false'} 含失效自动切换=${
				/撞上限流会按/.test(descText) ? 'true' : 'false'
			} 含旧面板文案=${/使用中的场景/.test(descText) ? '有' : '无'}`,
		);
	} catch (e) {
		console.log('SIM-TAIL THROW:', e && e.stack);
	}
}, 60);

// ---------- 源码级断言：形态契约（几秒内不依赖运行时的部分） ----------
setTimeout(() => {
	try {
		const source = fs.readFileSync(file, 'utf8');
		const checks = {
			'无会话身份依赖': !/useSessions|sessionController|selectModel|no-session/u.test(source),
			'无场景数量上限': !/SCENARIO_MAX/u.test(source) && /onClick: addScene/u.test(source),
			'新增场景按钮常开': !/scenes\.length >= /u.test(source),
			'TAB 文字=两名拼接': /return `\$\{a\}\/\$\{b\}`/u.test(source),
			'两个按钮（使用/删除）':
				/'data-or2-region': 'scene-use'/u.test(source) && /'data-or2-region': 'scene-delete'/u.test(source),
			'不用单选圆点': !/type: 'radio'/u.test(source),
			// 动作按钮只剩一套：禁用条件收敛成 canUseEditing（选中且未生效且两侧选全）。
			'不完整禁用': /const canUseEditing = editing !== null && !editingIsActive && sceneComplete\(editing\);/u.test(source),
			'词典无重复键': (() => {
				const { findDictDuplicates } = require('./dict-keys.cjs');
				const report = findDictDuplicates(source);
				return report !== null && report.every((entry) => entry.duplicates.length === 0);
			})(),
			// 侧边栏三个按钮（两个分段 + 设置）不要悬停提示，只在切换失败时浮一次错误。
			// 关闭（×）与删除按钮也不要提示；浮层宽度自适应，「？」除外。
			'关闭与删除无提示': !/showTip\(t\('close'\)\)/u.test(source) && !/showTip\(scenes\.length/u.test(source),
			'TIPS 宽度自适应': /width: 'max-content'/u.test(source) && /maxWidth: 'min\(360px, 64vw\)'/u.test(source),
			'侧边栏无悬停提示': !/attachTip|data-or2-tip-text/u.test(source),
			'失败时浮一次错误':
				/function flashTip\(anchor, text\)/u.test(source) && /flashTip\(control, t\('switchFailed'/u.test(source),
			'失效自动切换只有一处开关': (source.match(/'data-or2-region': 'failover-enable'/gu) || []).length === 1,
			// ？点了能开合说明块（原生 title 只悬停，点不出来），说明块只由 helpOpen 控制。
			'问号点开说明':
				/function tips\(text, onToggle, open, onHover\)/u.test(source) &&
				/onClick: \(event\) => \{/u.test(source) &&
				/'data-or2-region': 'failover-help-panel'/u.test(source) &&
				/React\.useState\(false\)/u.test(source) &&
				(source.match(/tips\(t\('failoverHelp'\), toggleHelp, helpOpen, setHelp\)/gu) || []).length === 2 &&
				// 浮层：说明块绝对定位，不再内联撑开一节。
				/position: 'absolute'/u.test(source) &&
				// 悬停与点击同一个浮层；不再挂原生 title（浏览器气泡 = 另一种格式）。
				/onMouseEnter: \(\) => onHover\?\.\(true\)/u.test(source) &&
				!/title: text,/u.test(source) &&
				!/helpBlock/u.test(source),
			'保存整份场景表': /api\.post\('scenarios'/u.test(source),
			'两侧分列': /gridTemplateColumns: '76px 1fr 1fr'/u.test(source),
			'设置按钮是文字': /settingsBtn\.textContent = t\('settingsShort'\)/u.test(source),
			'点设置开弹窗': /openRolesDialog\(\);\r?\n\t+return;/u.test(source),
			'侧边栏仅一行': (source.match(/name: 'sidebar\.panellist'/gu) || []).length === 1,
			'无主面板槽位': !/slot\('main'/u.test(source) && !/RegionPanel/u.test(source),
			'三个按钮字号统一': (() => {
				const at = source.indexOf('function ensureRowStyle()');
				const css = at < 0 ? '' : source.slice(at, source.indexOf('document.head.appendChild', at));
				return (css.match(/font-size:12px/gu) || []).length >= 2 && !/font-size:11px/u.test(css);
			})(),
			'设置按钮另有底色': /background:rgba\(245,158,11/u.test(source),
			'弹窗只有内容区滚动': (() => {
				const at = source.indexOf('dialogBody:');
				if (at < 0) return false;
				const head = source.slice(source.indexOf('dialog: {'), source.indexOf('dialogHead:'));
				const body = source.slice(at, source.indexOf('tabRow:', at));
				return (
					/flexDirection: 'column'/u.test(head) &&
					/overflow: 'hidden'/u.test(head) &&
					!/overflowY: 'auto'/u.test(head) &&
					/overflowY: 'auto'/u.test(body) &&
					/minHeight: 0/u.test(body)
				);
			})(),
			'样式能随热更新': (() => {
				const at = source.indexOf('function ensureRowStyle()');
				const body = at < 0 ? '' : source.slice(at, source.indexOf('if (!existing) document.head', at));
				return /style\.textContent = \[/u.test(body) && !/if \(document\.getElementById\(ROW_STYLE_ID\)\) return;/u.test(body);
			})(),
			'两段说明已合并': (source.match(/^\t{4}description:$/gmu) || []).length === 2 && !/rolesDescription/u.test(source),
			// 弹窗顶部说明压到两行：一条 description 字符串不超过 110 字。
			'说明压到两行': (() => {
				const matched = source.match(/description:\s*\n\s*'([^']+)'/u);
				return matched !== null && matched[1].length <= 110;
			})(),
			// 标题自带「顺序」，不再单起「切换顺序」标签行；回滚记录前也不再有「回滚状态」小标题。
			'顺序标签行已去掉': !/failoverOrder:/u.test(source) && !/STYLE\.blockLabel/u.test(source),
			'回滚小标题已去掉': !/guardRollback/u.test(source),
			// 「整轮冷却 / 每小时上限」标签与输入框同一行。
			'两个数字同行': /numberBox: \{ display: 'flex', flexDirection: 'row'/u.test(source),
			'失效标题含顺序': /failoverSection: '失效自动切换顺序'/u.test(source),
			// 顺序表改成两列槽位（至少 4 格），上下移按钮退场。
			'顺序表两列': /orderGrid: \{ display: 'grid', gridTemplateColumns: 'repeat\(2,/u.test(source) && /SLOT_MIN = 4/u.test(source),
			'去掉了上下移': !/failoverUp/u.test(source) && !/failoverDown/u.test(source),
			// 两张卡片的「启用」都靠右：同一个 enableBox（marginLeft:auto），两处引用。
			'启用都靠右': (source.match(/STYLE\.enableBox/gu) || []).length === 2 && /enableBox: \{[\s\S]{0,240}?marginLeft: 'auto'/u.test(source),
			// 关闭按钮被挤出右边缘的老问题：标题栏必须能收缩（minWidth:0），且关闭按钮不许被压缩。
			'标题栏可收缩': /dialogHeadText: \{ flex: '1 1 auto', minWidth: 0 \}/u.test(source) &&
				/dialogClose: \{[\s\S]{0,900}?flex: '0 0 auto'/u.test(source),
			// 双击表头后草稿也要翻主槽，否则红环留在旧一侧。
			'双击翻草稿主槽': /patchScene\(target, \(\) => \(\{ primary: side \}\)\)/u.test(source),
			// 模型变更管控（铁律）：开关 + 回滚记录都要在弹窗里。
			'铁律开关在弹窗': /'data-or2-region': 'guard-toggle'/u.test(source) && /guardAction\(/u.test(source),
			'回滚记录有落点': /'data-or2-region': 'guard-revert'/u.test(source),
		};
		// hook 顺序守卫：early return 之后不允许再出现 hook 调用（否则 open 翻转即 React #310）
		const early = source.indexOf('if (!dialog.open) return null;');
		const tailAfterEarly = early < 0 ? '' : source.slice(early, early + 4000);
		checks['无条件 hook'] = !/\buse(Store|State|Effect|Ref|Memo|Callback)\s*\(/u.test(tailAfterEarly);
		console.log('[形态] ' + Object.entries(checks).map(([k, v]) => `${k}=${v ? 'true' : 'false'}`).join(' '));
	} catch (e) {
		console.log('SHAPE THROW:', e && e.stack);
	}
}, 40);
