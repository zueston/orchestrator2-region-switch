/** orchestrator2-region-switch 的浏览器半体。
 *
 * 两件事（v2.0.0 起，语义 = 多场景 TAB）：
 *   1. 侧边栏一行 —— 显示**当前使用中场景**的两个按钮名（例如「国内 | 国际」），
 *      点一下就互换这套模型的主 / 备；右侧「设置」按钮打开三角色编辑弹窗。
 *      直接改写 <DSH_HOME>/orchestrator2/model-routes.json，调度器预设下次派工
 *      立即生效。**不动主会话模型**——主会话用哪个模型由聊天窗的模型选择器决定。
 *   2. 三角色主备模型切换弹窗 —— 场景数量不设上限（TAB），每个场景一套「A 侧 / B 侧」
 *      三角色模型，两侧名字可改（TAB 文字 = 名字1/名字2）；勾「使用」的场景才是
 *      侧边栏那一行，没选全模型的场景不能勾。提供商与模型都从 DSH 当前可用的目录
 *      里点选（宿主 /catalog → ctx.llm）。
 *
 * 注册的三个槽位：
 *   - sidebar.panellist：侧边栏一行，被就地改造成「名字1 | 名字2」分段滑块 + 右侧
 *     「设置」按钮（点它直接开编辑弹窗）；
 *   - main：这一行对应的中间面板页（当前场景 + 两侧按钮 + 三角色主备只读表 + 设置按钮）；
 *   - shell.overlay：编辑弹窗（官方浮层座位，关闭时什么都不渲染，不挡应用）。
 *
 * 不需要任何会话身份：所有动作都只读写 model-routes.json，所以侧边栏滑块在有没
 * 有打开会话时都能用。
 *
 *   GET  api/orchestrator2-region-switch/state      { activeScenario, scenarios, roles, path, … }
 *   GET  api/orchestrator2-region-switch/catalog    { providers: [{ provider, label, models }], … }
 *   POST api/orchestrator2-region-switch/switch     { side?: 'a'|'b' }
 *   POST api/orchestrator2-region-switch/scenarios  { scenarios, activeScenario }
 *   POST api/orchestrator2-region-switch/select     { id }
 *   POST api/orchestrator2-region-switch/adopt      {}
 *
 * 双语：词典内建 zh / en 两套；界面固定中文（locale 服务在受限 ctx 下取不到）。
 */

window.__ModuleLoader__.load({
	id: 'orchestrator2-region-switch',
	factory(require) {
		const React = require('react');
		const h = React.createElement;

		/** 本插件的 locale 命名空间。 */
		const NS = 'orchestrator2-region-switch';

		/** 宿主路由前缀（文档相对：DSH 用 <base href="./"> 提供 GUI）。 */
		const API_BASE = 'api/orchestrator2-region-switch/';

		/** 三层诊断回流：页面侧的真实状态只有它自己知道，经同源 fetch 送回宿主。
		 *  layer：factory（模块已物化）/ apply-enter（插件体开始跑）/
		 *  slot-registered / slot-error（槽位注册结果）/ render-error（组件渲染崩了）。 */
		function report(layer, payload) {
			try {
				const body = JSON.stringify({ layer, payload });
				void fetch(`${API_BASE}diag`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body,
					keepalive: true,
				}).catch(() => {});
			} catch {
				// 诊断本身绝不抛：它的失败不该影响插件。
			}
		}

		/** 渲染护栏：把组件包进错误边界，崩了先回报再降级为空渲染。 */
		function guarded(name, Component) {
			class DiagBoundary extends React.Component {
				constructor(props) {
					super(props);
					this.state = { failed: false };
				}
				static getDerivedStateFromError() {
					return { failed: true };
				}
				componentDidCatch(error, info) {
					report('render-error', {
						name,
						message: String((error && error.message) || error),
						stack: String((error && error.stack) || '').slice(0, 1500),
						componentStack: String((info && info.componentStack) || '').slice(0, 800),
					});
				}
				render() {
					return this.state.failed ? null : this.props.children;
				}
			}
			return function Guarded(props) {
				return h(DiagBoundary, { name }, h(Component, props));
			};
		}

		// 第一层信号：模块工厂被物化（拿到了 react，代码已执行到这里）。
		report('factory-mount', { now: Date.now() });

		/** 调度器预设的三个派工角色（顺序即面板/弹窗行序）。 */
		const ROLE_KEYS = ['researcher', 'reviewer', 'developer'];
		const ROLE_LABEL = {
			researcher: 'roleResearcher',
			reviewer: 'roleReviewer',
			developer: 'roleDeveloper',
		};

		/** 一个场景里的两侧。主槽指向哪一侧由 scenario.primary 记录。 */
		const SIDES = ['a', 'b'];
		/** 名字最长字符数（与宿主一致）。 */
		const LABEL_MAX = 16;

		/** 两侧名字的内建回落值。 */
		const DEFAULT_LABELS = { a: '国内', b: '国际' };

		async function apiRequest(resource, options) {
			try {
				const response = await fetch(`${API_BASE}${resource}`, {
					method: options?.method ?? 'GET',
					headers:
						options?.body === undefined
							? new Headers()
							: new Headers({ 'content-type': 'application/json' }),
					body: options?.body === undefined ? undefined : JSON.stringify(options.body),
				});
				let body;
				try {
					body = await response.json();
				} catch {
					body = undefined;
				}
				if (!response.ok) return { ok: false, status: response.status, value: body };
				return { ok: true, value: body };
			} catch (error) {
				return { ok: false, status: 0, value: { error: String(error?.message ?? error) } };
			}
		}

		const api = {
			get: (resource) => apiRequest(resource),
			post: (resource, body) => apiRequest(resource, { method: 'POST', body }),
		};

		// ------------------------------------------------------------------
		// 词典（zh / en）
		// ------------------------------------------------------------------

		const DICTS = {
			zh: {
				panelLabel: '场景切换',
				description:
					'侧边栏两个按钮＝当前场景两侧模型的名字，点一下互换主 / 备；选中 TAB 点「应用」立即生效，改完点「保存」存整张表。主会话模型归聊天窗选；撞上限流会按「失效自动切换顺序」往下切，改动下一次派工生效。',
				settingsLabel: '三角色主备模型设置',
				settingsShort: '设置',
				roleResearcher: '研究员',
				roleReviewer: '审核员',
				roleDeveloper: '开发员',
				primarySlot: '主',
				fallbackSlot: '备',
				switchFailed: '切换失败：{detail}',
				tabAdd: '＋ 场景',
				applyShort: '应用',
				tabInUseTitle: '正在生效',
				deleteShort: '删除',
				labelsTitle: '切换按钮名称',
				labelPlaceholder: '留空则用默认名',
				tableRole: '角色',
				needComplete: '三个角色的两侧模型都要选全，才能设为使用中的场景。',
				loading: '读取中…',
				manualInput: '（目录取不到，手填）',
				save: '保存',
				currentValue: '当前值',
				saveHint: '保存这一份场景表（不影响正在生效的那个场景）',
				saving: '保存中…',
				saved: '已保存。',
				sceneSwitched: '已切换到这个场景。',
				close: '关闭',
				saveFailed: '保存失败：{detail}',
				configError: '读取配置失败：{detail}',
				path: '数据文件：{path}',
				pathScenarios: '场景表：{path}',
				driftBody:
					'model-routes.json 于 {time} 被外部改动（例如预设自己的「设置角色模型」，或手动编辑），与当前场景派生出的线路不一致：{roles}。',
				driftNoSession:
					'没有会话被单独钉住 —— 这次改动在共享文件里，所有会话的下次派工都会读到它；点右边可把当前场景写回去。',
				driftApply: '应用到该会话',
				driftDismiss: '放弃',
				driftApplied: '已把当前场景应用到该会话（{n} 个角色改动）。',
				driftDismissed: '已记下：该会话放弃跟随；文件再被改动会重新提示。',
				sessionShort: '会话 {id}',
				unknownWorkspace: '未知工作区',
				reapply: '重新应用当前场景',
				reapplied: '已把当前场景重新写回 model-routes.json。',
				guardSection: '模型变更管控',
				guardEnable: '启用',
				guardHelp:
					'勾上这个方框＝只有本插件能改模型表：会话里用「设置角色模型」或手改 model-routes.json，都会在几秒内被写回，并在下面记一条回滚记录。要改模型请用上面的场景表或侧边栏切换；确实要让会话自己改，就取消勾选。',
				guardToggle: '只有本插件能改模型表（回滚外部改动）',
				guardNone: '还没有回滚记录。',
				guardReverted: '已回滚',
				guardSavedOn: '已打开：外部改动会被回滚。',
				guardSavedOff: '已关闭：会话可以自己改模型表。',
				overridesHint:
					'有 {n} 个会话被会话级覆盖钉住（{sessions}）：它们改文件不会跟随，只有新派工才读文件才生效。',
				adopting: '覆盖中…',
				adoptShort: '覆盖',
				adoptHint: '把当前设置覆盖到 {n} 个被钉住的会话',
				adoptNone: '没有被会话级覆盖钉住的会话',
				adoptConfirm: '要把当前设置覆盖到 {n} 个被钉住的会话吗？覆盖后它们改文件就会跟随（下一次派工生效）。',
				deleteConfirm: '确定删除场景「{label}」吗？删掉不可恢复（至少要保留一个场景）。',
				cancel: '取消',
				confirm: '确定',				adopted: '已覆盖 {n} 个会话。',
				failoverSection: '失效自动切换顺序',
				failoverEnable: '启用',
				headSwitchHint: '双击把它设为主模型（侧边栏的切换按钮会同步）',
				headSwitchLocked: '先点「应用」让这个场景生效、并选全两侧模型，才能切主备',
				failoverHelp:
					'启用后：预设 route-fallback 撞上限流会写一个信号，本插件轮询到就把当前场景记进「本轮已失败」并切到顺序里的下一个场景；顺序里剩下的场景全都失败过（= 整轮没有一个可用）就当场停手，进入指数冷却，期间不再切换。' +
					'冷却按「整轮冷却」逐轮翻倍（30 → 60 → 120 → 240 → 480 → 720 分钟封顶；只有连续整轮失败才叠加，改顺序、手动切场景或「重置历史」从第一档重新算）。冷却到点只解除暂停，不会自动切回。' +
					'刚切过 2 分钟内再来的信号忽略（防抖）；滚动 1 小时内切满「每小时上限」就停。未启用时本插件不写 model-routes.json 一个字节。本节各项改动立即保存，与上面的「保存」无关（那个只管场景表）。' +
					'顺序表两列排开、位置就是次序（1、2 读第一行，3、4 读第二行），空着的格子直接跳过。',
				failoverEmpty: '—（空）',
				failoverRemove: '清空这一格',
				failoverOrderNeedTwo: '至少要保留两个场景（宿主会拒绝少于两个的顺序）。',
				failoverRoundCooldown: '整轮冷却（分钟）',
				failoverMaxFlips: '每小时上限',
				failoverNever: '从未',
			statCurrent: '当前场景',
			statPosition: '位置',
			statLastFlip: '最近翻转',
			statFlips: '滚动 1 小时',
			statRoundFailed: '本轮已失败',
			failoverHaltedChip: '已暂停至 {until}',
				failoverSimulate: '模拟限流（测试）',
				failoverReset: '重置历史',
				failoverIncomplete: '（未选全模型）',
				failoverSimulated: '已模拟一次限流：{action}（{reason}）',
				failoverFailed: '失效自动切换读取失败：{detail}',
				failoverSaved: '已保存自动失效切换设置。',
				rolesTitle: '三角色主备模型切换',
			},
			en: {
				panelLabel: 'Scene switch',
				description:
					'The two sidebar buttons are the names of the active scene’s two sides — click one to swap primary / backup; Apply takes effect at once, Save stores the whole table. The main-session model comes from the chat picker; a rate limit rotates down the failover order, and changes apply to the next dispatch.',
				settingsLabel: 'Three-role model settings',
				settingsShort: 'Set up',
				roleResearcher: 'Researcher',
				roleReviewer: 'Reviewer',
				roleDeveloper: 'Developer',
				primarySlot: 'P',
				fallbackSlot: 'F',
				switchFailed: 'Switch failed: {detail}',
				tabAdd: '+ Scene',
				applyShort: 'Apply',
				tabInUseTitle: 'In effect',
				deleteShort: 'Delete',
				labelsTitle: 'Toggle button names',
				labelPlaceholder: 'blank = default name',
				tableRole: 'Role',
				needComplete: 'Fill both sides for all three roles before marking it in use.',
				loading: 'Loading…',
				manualInput: '(catalog unavailable — type it)',
				save: 'Save',
				currentValue: 'Current value',
				saveHint: 'Save this scene list (does not change the active scene)',
				saving: 'Saving…',
				saved: 'Saved.',
				sceneSwitched: 'Switched to this scene.',
				close: 'Close',
				saveFailed: 'Save failed: {detail}',
				configError: 'Failed to read config: {detail}',
				path: 'Data file: {path}',
				pathScenarios: 'Scene table: {path}',
				driftBody:
					'model-routes.json was changed outside this plugin at {time} (e.g. the preset’s own “set role model”, or a manual edit) and no longer matches the active scene: {roles}.',
				driftNoSession:
					'No session is pinned individually — the change lives in the shared file, so every session picks it up on its next dispatch. Use the button to write the active scene back.',
				driftApply: 'Apply to this session',
				driftDismiss: 'Dismiss',
				driftApplied: 'Applied the active scene to this session ({n} role change(s)).',
				driftDismissed: 'Noted: this session stays as it is; you will be asked again if the file changes.',
				sessionShort: 'session {id}',
				unknownWorkspace: 'unknown workspace',
				reapply: 'Re-apply active scene',
				reapplied: 'Wrote the active scene back into model-routes.json.',
				guardSection: 'Model change guard',
				guardEnable: 'Enable',
				guardHelp:
					'Tick this box = only this plugin may write the model table: changing models from a session (the preset’s “set role model”) or editing model-routes.json by hand is written back within seconds and logged below. Use the scene table or the sidebar switch to change models; clear the box if you really want sessions to change it themselves.',
				guardToggle: 'Only this plugin may change the model table (revert external edits)',
				guardNone: 'No reverts yet.',
				guardReverted: 'reverted',
				guardSavedOn: 'Turned on: external edits will be reverted.',
				guardSavedOff: 'Turned off: sessions may change the model table themselves.',
				overridesHint:
					'{n} session(s) are pinned by session-level overrides ({sessions}): they will not follow this file; only new dispatches will.',
				adopting: 'Overwriting…',
				adoptShort: 'Adopt',
				adoptHint: 'Write these settings into {n} pinned session(s)',
				adoptNone: 'No sessions are pinned by a session-level override',
				adoptConfirm: 'Write these settings into {n} pinned session(s)? After that they follow model-routes.json (next dispatch).',
				deleteConfirm: 'Delete the scene "{label}"? This cannot be undone (at least one scene must remain).',
				cancel: 'Cancel',
				confirm: 'Confirm',				adopted: 'Overwrote {n} session(s).',
				failoverSection: 'Automatic failover order',
				failoverEnable: 'Enable',
				headSwitchHint: 'Double-click to make this side the primary (the sidebar switch follows)',
				headSwitchLocked: 'Apply this scene and fill both sides first',
				failoverHelp:
					'When enabled: if the preset route-fallback hits a rate limit it writes a signal; this plugin polls it, records the current scene as failed this round and switches to the next scene in the order.' +
					'Once every remaining scene has failed too (a whole round with no usable scene) it stops right there and enters the exponential cooldown, no further switching until it lifts.' +
					'The cooldown doubles per failed round (30 → 60 → 120 → 240 → 480 → 720 min, capped; it stacks only on consecutive failed rounds — changing the order, switching the scene by hand or "Reset history" restarts at the first step). The cooldown only lifts the pause, it never switches back by itself.' +
					'Signals arriving within 2 minutes of a flip are ignored (debounce); hitting the hourly flip cap stops further switching. While disabled this plugin writes not a single byte of model-routes.json. Every control in this section saves immediately — the Save button below only covers the scene table.' +
					'The order table runs in two columns and its positions are the sequence (1, 2 on the first row; 3, 4 on the second); empty slots are skipped.',
				failoverEmpty: '— (empty)',
				failoverRemove: 'Clear this slot',
				failoverOrderNeedTwo: 'Keep at least two scenes (the host rejects shorter orders).',
				failoverRoundCooldown: 'Round cooldown (min)',
				failoverMaxFlips: 'Flip cap / hour',
				failoverNever: 'never',
			statCurrent: 'Scene',
			statPosition: 'Position',
			statLastFlip: 'Last flip',
			statFlips: 'Flips / hour',
			statRoundFailed: 'Failed this round',
			failoverHaltedChip: 'Paused until {until}',
				failoverSimulate: 'Simulate rate limit (test)',
				failoverReset: 'Reset history',
				failoverIncomplete: ' (incomplete)',
				failoverSimulated: 'Simulated one rate limit: {action} ({reason})',
				failoverFailed: 'Failed to read failover state: {detail}',
				failoverSaved: 'Automatic failover settings saved.',
				rolesTitle: 'Three-role primary / fallback switch',
			},
		};

		/** 内建插值：把 {name} 换成 params.name。 */
		function format(template, params) {
			if (!params) return template;
			return String(template).replace(/\{(\w+)\}/gu, (whole, key) =>
				params[key] === undefined ? whole : String(params[key]),
			);
		}

		/** 取词典条目；缺条目时回落键名（不让界面出现 undefined）。 */
		function makeT(tag) {
			const dict = DICTS[tag] ?? DICTS.zh;
			return (key, params) => {
				const text = dict[key];
				return text === undefined ? key : format(text, params);
			};
		}

		/** 界面语言：固定中文（locale 服务在受限 ctx 下取不到，跟随 document.lang 会掉英文）。 */
		function detectedTag() {
			return 'zh';
		}

		// ------------------------------------------------------------------
		// 极简 store（React.useSyncExternalStore）
		// ------------------------------------------------------------------

		function createStore(initial) {
			let state = initial;
			const listeners = new Set();
			return {
				get: () => state,
				set(next) {
					state = { ...state, ...next };
					for (const listener of listeners) listener();
				},
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
			};
		}

		function useStore(store) {
			return React.useSyncExternalStore(store.subscribe, store.get, store.get);
		}

		// ------------------------------------------------------------------
		// 数据
		// ------------------------------------------------------------------

		const configStore = createStore({ status: 'loading' });

		const parseState = (response) =>
			response.ok && response.value
				? { status: 'ok', ...response.value }
				: {
						status: 'error',
						error: response.value?.error ?? `HTTP ${response.status ?? 0}`,
					};

		async function refreshConfig() {
			configStore.set(parseState(await api.get('state')));
			return configStore.get();
		}

		/** 三角色编辑器的候选目录（宿主 /catalog 只读给出 provider → models）。 */
		const catalogStore = createStore({ status: 'loading', providers: [], error: null });

		async function refreshCatalog() {
			const response = await api.get('catalog');
			const providers =
				response.ok && response.value && Array.isArray(response.value.providers)
					? response.value.providers
							.filter((entry) => entry && typeof entry.provider === 'string' && entry.provider !== '')
							.map((entry) => ({
								provider: entry.provider,
								label:
									typeof entry.label === 'string' && entry.label !== '' ? entry.label : entry.provider,
								models: (Array.isArray(entry.models) ? entry.models : [])
									.map((model) =>
										typeof model === 'string'
											? { id: model, name: model }
											: {
													id: typeof model?.id === 'string' ? model.id : '',
													name:
														typeof model?.name === 'string' && model.name !== ''
															? model.name
															: String(model?.id ?? ''),
												},
									)
									.filter((model) => model.id !== ''),
							}))
					: [];
			catalogStore.set({
				status: providers.length > 0 ? 'ok' : 'error',
				providers,
				error: response.ok
					? (response.value?.error ?? (providers.length === 0 ? '目录为空' : null))
					: (response.value?.error ?? `HTTP ${response.status ?? 0}`),
			});
			return catalogStore.get();
		}

		/** 当前使用中的场景（拿不到就 null）。 */
		function activeSceneOf(config) {
			if (config?.status !== 'ok' || !Array.isArray(config.scenarios)) return null;
			return config.scenarios.find((scene) => scene.id === config.activeScenario) ?? null;
		}

		/** 打开三角色编辑弹窗（侧边栏「设置」与面板按钮共用）。 */
		function openRolesDialog() {
			dialogStore.set({ open: true });
			if (configStore.get().status !== 'ok') void refreshConfig();
			if (catalogStore.get().status !== 'ok') void refreshCatalog();
		}

		/** 切换按钮的状态：busy + 结果 / 错误。 */
		const switchStore = createStore({ busy: false, side: null, code: null, detail: null });

		/**
		 * 把当前场景的主槽翻到某一侧。宿主只改 model-routes.json，不认识会话 ——
		 * 所以这里不需要任何会话身份，也不需要「先打开一个会话」。
		 */
		async function switchSide(side) {
			if (side !== 'a' && side !== 'b') return false;
			switchStore.set({ busy: true, side, code: null, detail: null });
			const response = await api.post('switch', { side });
			if (!response.ok) {
				switchStore.set({
					busy: false,
					side,
					code: 'failed',
					detail: response.value?.error ?? `HTTP ${response.status ?? 0}`,
				});
				return false;
			}
			const value = response.value ?? {};
			if (value.scenarios !== undefined) configStore.set({ status: 'ok', ...value });
			else await refreshConfig();
			switchStore.set({ busy: false, side, code: 'ok', detail: null });
			void refreshFailover();
			return true;
		}

		/**
		 * 「用当前设置覆盖」被会话级 overrideRoute 钉住的会话。
		 * 覆盖之后那些会话的**后续新派工**才跟随 model-routes.json；在跑的 child 保持快照。
		 */
		const adoptStore = createStore({ busy: false, updated: null, error: null });

		async function adoptOverrides() {
			adoptStore.set({ busy: true, updated: null, error: null });
			const response = await api.post('adopt', {});
			if (!response.ok) {
				adoptStore.set({
					busy: false,
					updated: null,
					error: response.value?.error ?? `HTTP ${response.status ?? 0}`,
				});
				return false;
			}
			const value = response.value ?? {};
			if (value.scenarios !== undefined) configStore.set({ status: 'ok', ...value });
			adoptStore.set({
				busy: false,
				updated: typeof value.updated === 'number' ? value.updated : null,
				error: null,
			});
			return true;
		}

		/** 会话 id 的短写（面板里只显示前 8 位字符，避免撑破一行）。 */
		function shortSessionId(sessionId) {
			return String(sessionId)
				.replace(/^session-/u, '')
				.slice(0, 8);
		}

		/** 三角色编辑弹窗的开合。 */
		const dialogStore = createStore({ open: false });

		/**
		 * 通用悬浮说明的共享状态：任何组件（弹窗里的按钮、失效自动切换那一节的图标）
		 * 都能点亮它，浮层由弹窗统一渲染 —— 全插件只有一种 TIPS 外观。
		 */
		const tipStore = createStore({ text: null, left: 0, top: 0 });
		const showTip = (text) => (event) => {
			if (!text) return;
			const rect = event?.currentTarget?.getBoundingClientRect?.();
			const width = (typeof window !== 'undefined' && window.innerWidth) || 1280;
			tipStore.set({
				text,
				left: rect ? Math.max(8, Math.min(Math.round(rect.left), width - 380)) : 8,
				top: rect ? Math.round(rect.bottom + 6) : 8,
			});
		};
		const hideTip = () => tipStore.set({ text: null });

		/** 保存整份场景表（宿主原子写 model-routes.json）。 */
		async function saveScenarios(scenarios, activeScenario) {
			const response = await api.post('scenarios', { scenarios, activeScenario });
			if (!response.ok) {
				return { ok: false, error: response.value?.error ?? `HTTP ${response.status ?? 0}` };
			}
			if (response.value) configStore.set({ status: 'ok', ...response.value });
			else await refreshConfig();
			return { ok: true };
		}

		/** 自动失效切换的快照（GET failover）：{ config, scenes, activeScenario, state }。 */
		const failoverStore = createStore({
			status: 'loading',
			config: null,
			scenes: [],
			activeScenario: null,
			/** 状态摘要（currentIndex / currentScene / haltedUntil / roundFailed / roundCount / flips）。 */
			state: null,
			error: null,
		});

		/** 把 GET/POST failover 的应答灌进 store（两条路由回的形状一样）。 */
		function adoptFailover(detail) {
			const value = detail ?? {};
			failoverStore.set({
				status: 'ok',
				config: value.config ?? null,
				scenes: Array.isArray(value.scenes) ? value.scenes : [],
				activeScenario: value.activeScenario ?? null,
				state: value.state ?? null,
				error: null,
			});
		}

		async function refreshFailover() {
			const response = await api.get('failover');
			if (!response.ok) {
				failoverStore.set({
					status: 'error',
					config: null,
					scenes: [],
					activeScenario: null,
					state: null,
					error: response.value?.error ?? `HTTP ${response.status ?? 0}`,
				});
				return;
			}
			adoptFailover(response.value);
		}

		/**
		 * 「场景区的启用开关」与下面的「自动失效切换」一节共用同一个 store，弹窗一打开
		 * 两边同时挂载：同一时刻只发一次 GET（否则一次打开弹窗打两次宿主）。
		 */
		let failoverInflight = null;
		function ensureFailover() {
			if (failoverStore.get().status !== 'loading') return Promise.resolve();
			if (failoverInflight === null) {
				failoverInflight = refreshFailover().finally(() => {
					failoverInflight = null;
				});
			}
			return failoverInflight;
		}

		// ------------------------------------------------------------------
		// 侧边栏滑块
		// ------------------------------------------------------------------

		/** 滑块 DOM 的标识（全部带 or2-region 前缀，避免与任何宿主/插件冲突）。 */
		const ROW_ATTR = 'data-or2-region-row';
		const ROW_STYLE_ID = 'or2-region-row-style';
		const HIDDEN_ATTR = 'data-or2-region-hidden';
		const CONTROL_ATTR = 'data-or2-region-control';
		const OPT_ATTR = 'data-or2-region-opt';
		const THUMB_ATTR = 'data-or2-region-thumb';
		const GEAR_ATTR = 'data-or2-region-gear';

		/**
		 * 侧边栏是原生 DOM，浮层只能自己建：样式取弹窗里那张共用的卡（TIP_CARD），
		 * 挂到 body 上 fixed 定位，避免被侧栏裁掉。
		 *
		 * 注意：侧边栏这三个按钮（两个分段 + 设置）平时**没有**悬停提示——用户明确要求。
		 * 这里只在「切换失败」时露一次，6 秒后自己消失，免得失败静默。
		 */
		let flashNode = null;
		let flashTimer = null;
		function clearFlash() {
			if (flashTimer !== null) {
				clearTimeout(flashTimer);
				flashTimer = null;
			}
			if (flashNode !== null) {
				flashNode.remove();
				flashNode = null;
			}
		}
		function flashTip(anchor, text) {
			if (!text || typeof document === 'undefined' || !document.body) return;
			clearFlash();
			const node = document.createElement('div');
			node.setAttribute('role', 'alert');
			node.setAttribute('data-or2-region', 'sidebar-flash');
			node.textContent = text;
			for (const key of Object.keys(TIP_CARD)) node.style[key] = TIP_CARD[key];
			node.style.position = 'fixed';
			node.style.zIndex = '9999';
			node.style.width = 'max-content';
			node.style.maxWidth = 'min(320px, 60vw)';
			node.style.pointerEvents = 'none';
			document.body.appendChild(node);
			const rect = anchor.getBoundingClientRect();
			node.style.left = `${Math.max(8, Math.round(rect.left))}px`;
			node.style.top = `${Math.round(rect.bottom + 6)}px`;
			flashNode = node;
			flashTimer = setTimeout(clearFlash, 6000);
		}

		function ensureRowStyle() {
			// 注意：HMR 重新求值后模块变量是新的，但页面上那个 <style> 还是旧的。
			// 所以不能「有就返回」，改成每次都把最新 CSS 写进去（内容一样就跳过）。
			const existing = document.getElementById(ROW_STYLE_ID);
			const style = existing ?? document.createElement('style');
			if (!existing) style.id = ROW_STYLE_ID;
			const rowSel = `button[${ROW_ATTR}]`;
			const root = `${rowSel} > span[${CONTROL_ATTR}]`;
			style.textContent = [
				`button[${ROW_ATTR}]{cursor:pointer;}`,
				`button[${ROW_ATTR}] > [${HIDDEN_ATTR}]{display:none;}`,
				`${root}{`,
				'  position:relative;display:inline-flex;align-items:center;',
				'  margin-left:4px;padding:2px;border-radius:999px;',
				'  background:rgba(128,128,128,.16);',
				'}',
				`${root}[data-busy="true"]{opacity:.6;pointer-events:none;}`,
				`${root} > span[${THUMB_ATTR}]{`,
				'  position:absolute;top:2px;left:0;height:calc(100% - 4px);',
				'  border-radius:999px;background:var(--dsw-alias-brand-primary,#4d6bfe);',
				'  box-shadow:0 1px 2px rgba(0,0,0,.18);',
				'  transition:transform .22s cubic-bezier(.4,0,.2,1),width .22s cubic-bezier(.4,0,.2,1);',
				'}',
				// 三个按钮（两个分段项 + 设置）共用同一套字：12px / 600 / line-height 1，
				// 只是内边距与圆角不同——否则会出现「设置」比两侧明显大一号的观感。
				`${root} > span[${OPT_ATTR}]{`,
				'  position:relative;z-index:1;padding:4px 9px;border-radius:999px;',
				'  font-size:12px;line-height:1;font-weight:600;cursor:pointer;',
				'  color:var(--dsw-alias-label-secondary,#6b7280);',
				'  transition:color .18s;white-space:nowrap;',
				'}',
				`${root} > span[${OPT_ATTR}][data-selected="true"]{`,
				'  color:#fff;',
				'}',
				`${root} > span[${OPT_ATTR}][data-selected="false"]:hover{`,
				'  color:var(--dsw-alias-brand-primary,#4d6bfe);',
				'}',
				`${rowSel} > span[${GEAR_ATTR}]{`,
				'  position:relative;z-index:1;display:inline-flex;align-items:center;',
				'  justify-content:center;margin-left:6px;padding:4px 10px;border-radius:8px;',
				// 底色用琥珀色系，和左边的分段控件（灰底 + 品牌蓝滑块）区分开。
				'  border:1px solid rgba(217,119,6,.42);background:rgba(245,158,11,.18);',
				'  font-size:12px;line-height:1;font-weight:600;white-space:nowrap;cursor:pointer;',
				'  color:#b45309;',
				'  transition:background .18s,border-color .18s,color .18s;',
				'}',
				`${rowSel} > span[${GEAR_ATTR}]:hover{`,
				'  background:rgba(245,158,11,.32);border-color:rgba(180,83,9,.7);color:#92400e;',
				'}',
				`${rowSel} > span[${GEAR_ATTR}]:focus-visible{`,
				'  outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px;',
				'}',
			].join('\n');
			if (!existing) document.head.appendChild(style);
		}

		/** 该行图标：中性地球（选中哪一侧由行内分段控件表示）。 */
		function RegionRowGlyph({ size }) {
			return h(
				'svg',
				{
					viewBox: '0 0 16 16',
					width: size,
					height: size,
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: 1.3,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
					'aria-hidden': true,
				},
				h('circle', { cx: 8, cy: 8, r: 5.4 }),
				h('ellipse', { cx: 8, cy: 8, rx: 2.5, ry: 5.4 }),
				h('path', { d: 'M2.6 8h10.8' }),
			);
		}

		/** 侧边栏一行：把外壳的行按钮改造成分段控件 + 「设置」按钮并接管点击。 */
		function makeRegionRowEntry(t) {
			return function RegionRowEntry({ size }) {
				const config = useStore(configStore);
				const switching = useStore(switchStore);
				const scene = activeSceneOf(config);
				const labels = scene?.labels ?? DEFAULT_LABELS;
				const current = scene?.primary ?? null;
				const busy = switching.busy || (scene !== null && scene.complete === false);
				const ref = React.useRef(null);
				const labelSignature = SIDES.map((side) => labels[side] ?? '').join('|');
				React.useEffect(() => {
					if (configStore.get().status === 'loading') void refreshConfig();
				}, []);
				React.useEffect(() => {
					ensureRowStyle();
					const row = ref.current?.closest('button');
					if (!row) return undefined;
					row.setAttribute(ROW_ATTR, '');
					row.style.overflow = 'visible';
					// 只藏外壳的 label 文字（图标容器保留），位置让给分段控件与设置按钮。
					const direct = [...row.children].filter(
						(child) => !child.hasAttribute(CONTROL_ATTR) && !child.hasAttribute(GEAR_ATTR),
					);
					const glyphHolder = direct.find((child) => child.contains(ref.current));
					for (const child of direct) {
						if (child !== glyphHolder) child.setAttribute(HIDDEN_ATTR, '');
					}
					let control = row.querySelector(`[${CONTROL_ATTR}]`);
					if (!control) {
						control = document.createElement('span');
						control.setAttribute(CONTROL_ATTR, '');
						const thumb = document.createElement('span');
						thumb.setAttribute(THUMB_ATTR, '');
						control.appendChild(thumb);
						for (const side of SIDES) {
							const opt = document.createElement('span');
							opt.setAttribute(OPT_ATTR, side);
							opt.setAttribute('role', 'button');
							control.appendChild(opt);
						}
						row.appendChild(control);
					}
					// 「设置」按钮：独立于滑块的文字按钮（自带边框与底色，视觉上和分段
					// 控件分开），摆在同一行右侧，点了直接开编辑弹窗。
					let settingsBtn = row.querySelector(`[${GEAR_ATTR}]`);
					if (!settingsBtn) {
						settingsBtn = document.createElement('span');
						settingsBtn.setAttribute(GEAR_ATTR, '');
						settingsBtn.setAttribute('role', 'button');
						settingsBtn.setAttribute('tabindex', '0');
						row.appendChild(settingsBtn);
					}
					settingsBtn.textContent = t('settingsShort');
					settingsBtn.setAttribute('aria-label', t('settingsLabel'));
					control.setAttribute('data-busy', busy ? 'true' : 'false');
					// 三个按钮平时没有悬停提示；只有切换失败时浮一次错误（6 秒自动消失）。
					if (switching.code === 'failed') {
						flashTip(control, t('switchFailed', { detail: switching.detail ?? '' }));
					}
					// 侧边栏收窄成窄条时外壳不渲染 label，行里只剩图标：这时藏掉滑块与
					// 设置按钮，点图标改为在两侧之间来回切。
					const hasLabelRow = direct.some((child) => child !== glyphHolder);
					control.style.display = hasLabelRow ? '' : 'none';
					settingsBtn.style.display = hasLabelRow ? '' : 'none';
					for (const opt of control.querySelectorAll(`[${OPT_ATTR}]`)) {
						const side = opt.getAttribute(OPT_ATTR);
						opt.textContent = labels[side] ?? side;
						opt.setAttribute('data-selected', current === side ? 'true' : 'false');
					}
					// 滑动块按「选中标签的真实宽度与偏移」定位——不假设两段等宽。
					const slide = () => {
						const thumb = control.querySelector(`[${THUMB_ATTR}]`);
						if (!thumb) return;
						const active = [...control.querySelectorAll(`[${OPT_ATTR}]`)].find(
							(opt) => opt.getAttribute(OPT_ATTR) === current,
						);
						if (!active || active.offsetWidth === 0) {
							thumb.style.width = '0px';
							return;
						}
						thumb.style.width = `${active.offsetWidth}px`;
						thumb.style.transform = `translateX(${active.offsetLeft}px)`;
					};
					slide();
					const raf = requestAnimationFrame(slide);
					// 外壳重渲染时可能把我们插入的滑块/按钮摘掉：盯着这一行，掉了就补回来。
					const keep = () => {
						let restored = false;
						if (!row.contains(control)) {
							row.appendChild(control);
							restored = true;
						}
						if (!row.contains(settingsBtn)) {
							row.appendChild(settingsBtn);
							restored = true;
						}
						if (restored) slide();
					};
					const observer = new MutationObserver(keep);
					observer.observe(row, { childList: true });
					const handler = (event) => {
						const target = event.target;
						// 「设置」按钮在滑块之外，先判它；点这一行其它位置仍然交给外壳
						// 打开主面板。
						if (target?.closest?.(`[${GEAR_ATTR}]`)) {
							event.preventDefault();
							event.stopPropagation();
							openRolesDialog();
							return;
						}
						// 滑块之外（含行内空白处）都直接开编辑弹窗——中间的只读面板已经去掉。
						if (!target?.closest?.(`[${CONTROL_ATTR}]`)) {
							event.preventDefault();
							event.stopPropagation();
							openRolesDialog();
							return;
						}
						event.preventDefault();
						event.stopPropagation();
						if (busy) return;
						const opt = target.closest(`[${OPT_ATTR}]`);
						const picked = opt?.getAttribute(OPT_ATTR);
						const next = picked ?? (current === 'a' ? 'b' : 'a');
						if (next === current) return;
						void switchSide(next);
					};
					const onKeyDown = (event) => {
						if (event.key !== 'Enter' && event.key !== ' ') return;
						if (!event.target?.closest?.(`[${GEAR_ATTR}]`)) return;
						event.preventDefault();
						event.stopPropagation();
						openRolesDialog();
					};
					row.addEventListener('click', handler, true);
					row.addEventListener('keydown', onKeyDown, true);
					return () => {
						cancelAnimationFrame(raf);
						observer.disconnect();
						row.removeEventListener('click', handler, true);
						row.removeEventListener('keydown', onKeyDown, true);
					};
				}, [current, busy, labelSignature, switching.code, switching.detail]);
				return h(
					'span',
					{ ref, style: { display: 'inline-flex', alignItems: 'center' } },
					h(RegionRowGlyph, { size }),
				);
			};
		}

		// ------------------------------------------------------------------
		// 样式
		// ------------------------------------------------------------------

		/** 全插件共用的按钮底座：形状 / 高度 / 字号 / 圆角 / 描边一律照这个来，只有颜色变体。 */
		const BTN_BASE = {
			font: 'inherit',
			fontFamily: 'inherit',
			fontSize: '12.5px',
			fontWeight: 600,
			lineHeight: 1,
			height: '30px',
			padding: '0 14px',
			borderRadius: '8px',
			border: '1px solid rgba(128,128,128,.35)',
			background: 'transparent',
			color: 'inherit',
			cursor: 'pointer',
			display: 'inline-flex',
			alignItems: 'center',
			justifyContent: 'center',
			gap: '6px',
			whiteSpace: 'nowrap',
			boxSizing: 'border-box',
		};

		/**
		 * 所有 TIPS 共用的一张卡（「？」说明与全部悬浮提示都取这里）：
		 * 改一处，整插件外观一起变——避免出现两套看起来不一样的提示。
		 */
		const TIP_CARD = {
			width: 'min(360px, 64vw)',
			maxHeight: '240px',
			overflowY: 'auto',
			padding: '8px 10px',
			borderRadius: '8px',
			border: '1px solid rgba(128,128,128,.28)',
			background: 'var(--dsw-alias-bg-elevated, #ffffff)',
			boxShadow: '0 8px 24px rgba(0, 0, 0, .18)',
			fontSize: '12px',
			lineHeight: 1.6,
			whiteSpace: 'pre-wrap',
			color: 'var(--dsw-alias-label-primary, #111827)',
		};

		const STYLE = {
			page: {
				minWidth: 0,
				minHeight: 0,
				height: '100%',
				overflowY: 'auto',
				color: 'var(--dsw-alias-label-primary, #111827)',
			},
			inner: {
				minWidth: 0,
				maxWidth: '760px',
				margin: '0 auto',
				padding: '16px 24px',
				boxSizing: 'border-box',
			},
			title: {
				fontSize: '15px',
				fontWeight: 600,
				margin: '0 0 8px',
				color: 'var(--dsw-alias-label-primary, #111827)',
			},
			description: {
				margin: '0 0 12px',
				fontSize: '12.5px',
				lineHeight: '19px',
				color: 'var(--dsw-alias-label-secondary, #6b7280)',
			},
			hint: {
				margin: '0 0 12px',
				fontSize: '12px',
				lineHeight: '18px',
				color: 'var(--dsw-alias-label-secondary, #6b7280)',
			},
			messageError: {
				margin: '4px 0 12px',
				fontSize: '12.5px',
				lineHeight: '19px',
				color: 'var(--dsw-alias-label-danger, #dc2626)',
			},
			messageOk: {
				margin: '4px 0 12px',
				fontSize: '12.5px',
				lineHeight: '19px',
				color: 'var(--dsw-alias-label-secondary, #6b7280)',
			},
			// 「model-routes.json 被外部改动」提示条：不吓人但要显眼，右侧一个修复按钮。
			driftBar: {
				display: 'flex',
				flexDirection: 'column',
				gap: '6px',
				margin: '10px 0 12px',
				padding: '8px 10px',
				borderRadius: '8px',
				border: '1px solid rgba(217,119,6,.45)',
				background: 'rgba(245,158,11,.10)',
			},
			driftHead: { display: 'flex', alignItems: 'center', gap: '10px' },
			driftList: { display: 'flex', flexDirection: 'column', gap: '6px' },
			driftRow: {
				display: 'flex',
				alignItems: 'center',
				gap: '8px',
				paddingTop: '6px',
				borderTop: '1px dashed rgba(217,119,6,.35)',
			},
			driftWho: { flex: '0 1 auto', minWidth: '0', fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, #111827)' },
			driftRoles: { flex: '0 0 auto', fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #6b7280)' },
			driftSpacer: { flex: '1 1 auto' },
			driftHint: { margin: '0', fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary, #6b7280)' },
			driftText: {
				flex: '1 1 auto',
				minWidth: '0',
				fontSize: '12.5px',
				lineHeight: '19px',
				color: 'var(--dsw-alias-label-primary, #111827)',
			},
			group: { display: 'flex', gap: '10px', flexWrap: 'wrap', margin: '4px 0 12px' },
			buttonBase: { ...BTN_BASE },
			buttonActive: {
				borderColor: 'var(--dsw-alias-brand-primary, #4d6bfe)',
				background: 'rgba(77,107,254,.12)',
				color: 'var(--dsw-alias-brand-primary, #4d6bfe)',
				fontWeight: 600,
			},
			sectionTitle: {
				fontSize: '13px',
				fontWeight: 600,
				margin: '16px 0 6px',
				color: 'var(--dsw-alias-label-primary, #111827)',
			},
			/** 「失效自动切换」标题行：标题 + 「？」 + 启用勾选框。 */
			sectionHead: {
				display: 'flex',
				alignItems: 'center',
				gap: '8px',
				margin: '16px 0 6px',
			},
			sectionHeadTitle: {
				fontSize: '13px',
				fontWeight: 600,
				margin: 0,
				color: 'var(--dsw-alias-label-primary, #111827)',
			},
			/** 小小的圆形「？」：悬停出 TIPS（原生 title），不可点、不展开。 */
			tipsWrap: { position: 'relative', display: 'inline-flex', alignItems: 'center' },
			/** 「？」点开的说明：位置跟着问号走（绝对定位），外观取共用卡片。 */
			helpPanel: {
				...TIP_CARD,
				position: 'absolute',
				top: '22px',
				left: '0',
				zIndex: 30,
				maxHeight: '220px',
				pointerEvents: 'auto',
			},
			/** 通用悬浮说明（与「？」同一张卡）：fixed 定位，贴在被悬停元素的左下方。 */
			tipFloat: {
				...TIP_CARD,
				position: 'fixed',
				zIndex: 80,
				pointerEvents: 'none',
				// 自适应：文案短就窄，长了才涨到 TIP_CARD 的宽度上限并自动换行。
				width: 'max-content',
				maxWidth: 'min(360px, 64vw)',
			},
			tipsDot: {
				display: 'inline-flex',
				alignItems: 'center',
				justifyContent: 'center',
				width: '15px',
				height: '15px',
				borderRadius: '50%',
				border: '1px solid rgba(128,128,128,.5)',
				color: 'var(--dsw-alias-label-secondary, #6b7280)',
				fontSize: '10px',
				fontWeight: 700,
				cursor: 'help',
				userSelect: 'none',
			},
			/** 「失效自动切换」整节的卡片底：与上面的场景表分开，不再是一堆裸控件。 */
			failoverCard: {
				marginTop: '10px',
				padding: '10px 12px 12px',
				borderRadius: '10px',
				border: '1px solid rgba(128,128,128,.22)',
				background: 'rgba(128,128,128,.06)',
			},
			failoverHead: { display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 10px' },
			guardCard: {
				marginTop: '10px',
				padding: '10px 12px 12px',
				borderRadius: '10px',
				border: '1px solid rgba(128,128,128,.22)',
				background: 'rgba(128,128,128,.06)',
			},
			guardHead: { display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 8px' },
			guardHint: { margin: '0 0 8px', fontSize: '12px', lineHeight: 1.55, color: 'var(--dsw-alias-label-secondary, #6b7280)' },
			guardLog: { display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px' },
			guardLogRow: {
				fontSize: '12px',
				fontVariantNumeric: 'tabular-nums',
				color: 'var(--dsw-alias-label-secondary, #6b7280)',
			},
			orderGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px 18px' },
			orderRow: { display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr) auto', gap: '8px', alignItems: 'center' },
			orderIndex: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #6b7280)', textAlign: 'right' },
			orderSelect: {
				font: 'inherit',
				fontSize: '12.5px',
				padding: '5px 8px',
				borderRadius: '6px',
				border: '1px solid rgba(128,128,128,.4)',
				background: 'var(--dsw-alias-bg-layer-1, #fff)',
				color: 'var(--dsw-alias-label-primary, #111827)',
				minWidth: 0,
			},
			orderActions: { display: 'flex', alignItems: 'center', gap: '4px' },
			iconButton: {
				...BTN_BASE,
				width: '26px',
				height: '26px',
				padding: 0,
				fontSize: '12px',
				color: 'var(--dsw-alias-label-secondary, #6b7280)',
			},
			numberRow: { display: 'flex', flexWrap: 'wrap', gap: '18px', margin: '12px 0 0' },
			numberBox: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '6px' },
			numberInput: {
				font: 'inherit',
				fontSize: '12.5px',
				width: '84px',
				padding: '5px 8px',
				borderRadius: '6px',
				border: '1px solid rgba(128,128,128,.4)',
				background: 'var(--dsw-alias-bg-layer-1, #fff)',
				color: 'var(--dsw-alias-label-primary, #111827)',
			},
			statRow: {
				display: 'flex',
				flexWrap: 'wrap',
				alignItems: 'center',
				gap: '6px 18px',
				margin: '12px 0 0',
				padding: '8px 10px',
				borderRadius: '8px',
				background: 'rgba(128,128,128,.09)',
				fontSize: '12px',
			},
			statItem: { display: 'inline-flex', alignItems: 'baseline', gap: '5px' },
			statLabel: { color: 'var(--dsw-alias-label-secondary, #6b7280)' },
			statValue: { fontWeight: 600, color: 'var(--dsw-alias-label-primary, #111827)' },
			warnChip: {
				marginLeft: 'auto',
				padding: '2px 8px',
				borderRadius: '999px',
				background: 'rgba(240,160,0,.18)',
				color: '#a16207',
				fontWeight: 600,
			},
			numberActions: { display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' },
			/** 次级按钮：和主按钮（保存）拉开层级，两个动作按钮共用这一套。 */
			secondaryButton: {
				...BTN_BASE,
				borderColor: 'rgba(128,128,128,.42)',
				background: 'var(--dsw-alias-bg-layer-1, #fff)',
				color: 'var(--dsw-alias-label-primary, #111827)',
			},
			/** 模拟限流（测试）：琥珀底——只是演练，不动真配置。 */
			testButton: {
				...BTN_BASE,
				borderColor: 'rgba(217,119,6,.45)',
				background: 'rgba(245,158,11,.18)',
				color: '#b45309',
			},
			/** 覆盖（会话级覆盖）：蓝色描边淡底——写配置，但只是把文件值同步过去。 */
			adoptButton: {
				...BTN_BASE,
				borderColor: 'rgba(77,107,254,.45)',
				background: 'rgba(77,107,254,.14)',
				color: 'var(--dsw-alias-brand-primary, #4d6bfe)',
			},
			/** 危险动作（确认删除）：红底白字。 */
			dangerButton: {
				...BTN_BASE,
				borderColor: '#b91c1c',
				background: '#dc2626',
				color: '#fff',
			},
			/** 二次确认：盖住整个弹窗的半透明层 + 居中的确认卡。 */
			confirmLayer: {
				position: 'absolute',
				inset: 0,
				zIndex: 40,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				background: 'rgba(15,23,42,.32)',
				borderRadius: '12px',
				padding: '16px',
			},
			confirmCard: {
				maxWidth: '460px',
				width: '100%',
				padding: '16px 18px 14px',
				borderRadius: '10px',
				background: 'var(--dsw-alias-surface-strong, #fff)',
				boxShadow: '0 18px 40px rgba(0,0,0,.28)',
			},
			confirmText: { margin: '0 0 14px', fontSize: '13px', lineHeight: 1.65 },
			confirmActions: { display: 'flex', justifyContent: 'flex-end', gap: '8px' },
			/** 重置历史：灰蓝底——清空翻转/轮次记录。 */
			resetButton: {
				...BTN_BASE,
				borderColor: 'rgba(100,116,139,.42)',
				background: 'rgba(100,116,139,.16)',
				color: '#475569',
			},
			/** 标题行右侧的启用勾选框。 */
			enableBox: {
				display: 'inline-flex',
				alignItems: 'center',
				gap: '6px',
				marginLeft: 'auto',
				fontSize: '12.5px',
				color: 'var(--dsw-alias-label-primary, #111827)',
				cursor: 'pointer',
			},
			roleRow: {
				display: 'grid',
				gridTemplateColumns: '76px 1fr 1fr',
				gap: '6px',
				alignItems: 'start',
				padding: '5px 0',
				borderTop: '1px solid rgba(128,128,128,.16)',
			},
			headRow: {
				display: 'grid',
				gridTemplateColumns: '76px 1fr 1fr',
				gap: '8px',
				padding: '0 0 4px',
				fontSize: '12px',
				fontWeight: 600,
				color: 'var(--dsw-alias-label-secondary, #6b7280)',
			},
			roleName: { fontSize: '13px', fontWeight: 600, paddingTop: '6px' },
			slotColumn: { display: 'flex', flexDirection: 'column', gap: '5px', minWidth: 0 },
			slotTag: { fontSize: '11.5px', color: 'var(--dsw-alias-label-secondary, #6b7280)' },
			slotLine: { display: 'flex', alignItems: 'baseline', gap: '6px', minWidth: 0 },
			slotKey: {
				flex: '0 0 34px',
				fontSize: '11.5px',
				color: 'var(--dsw-alias-label-secondary, #6b7280)',
			},
			slotValue: { fontSize: '12.5px', wordBreak: 'break-all' },
			input: {
				font: 'inherit',
				fontSize: '12.5px',
				padding: '3px 6px',
				borderRadius: '5px',
				border: '1px solid rgba(128,128,128,.35)',
				background: 'transparent',
				color: 'inherit',
				minWidth: 0,
				width: '100%',
				boxSizing: 'border-box',
			},
			path: {
				margin: '10px 0 0',
				fontSize: '11.5px',
				lineHeight: '17px',
				color: 'var(--dsw-alias-label-secondary, #6b7280)',
				wordBreak: 'break-all',
			},
			dialogLayer: {
				position: 'fixed',
				inset: 0,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				background: 'rgba(15,23,42,.42)',
				zIndex: 2147483000,
				padding: '24px',
			},
			dialog: {
				width: 'min(760px, 100%)',
				maxHeight: '94vh',
				// 弹窗整体不滚：头（标题 + 说明）固定，只有下面的 dialogBody 滚。
				display: 'flex',
				flexDirection: 'column',
				overflow: 'hidden',
				borderRadius: '12px',
				background: 'var(--dsw-alias-surface-strong, #fff)',
				color: 'var(--dsw-alias-label-primary, #111827)',
				boxShadow: '0 18px 48px rgba(0,0,0,.28)',
				// 确认层是 absolute，需要它做定位父级。
				position: 'relative',
				padding: '14px 16px 12px',
				boxSizing: 'border-box',
			},
			dialogHead: {
				display: 'flex',
				alignItems: 'flex-start',
				justifyContent: 'space-between',
				gap: '12px',
				flex: '0 0 auto',
				paddingBottom: '10px',
				borderBottom: '1px solid rgba(128,128,128,.18)',
			},
			// 标题 + 说明这一栏必须能收缩（minWidth:0），否则长文案会把关闭按钮挤出弹窗右边缘。
			dialogHeadText: { flex: '1 1 auto', minWidth: 0 },
			dialogTitle: { fontSize: '15.5px', fontWeight: 600, margin: '0 0 4px' },
			dialogClose: {
				font: 'inherit',
				cursor: 'pointer',
				// 用自绘 SVG 画叉：emoji「❌」的字形尺寸不受 fontSize 控制，容易在 26px 盒子里被裁。
				display: 'inline-flex',
				alignItems: 'center',
				justifyContent: 'center',
				padding: '0',
				width: '28px',
				height: '28px',
				lineHeight: 1,
				fontSize: '16px',
				borderRadius: '8px',
				border: '1px solid rgba(220,38,38,.38)',
				background: 'rgba(220,38,38,.08)',
				color: '#dc2626',
				flex: '0 0 auto',
				marginLeft: '12px',
			},
			// 只有这一块滚：minHeight:0 让 flex 子项可以收缩，否则内容撑开后整窗滚。
			dialogBody: {
				flex: '1 1 auto',
				minHeight: 0,
				overflowY: 'auto',
				margin: '8px 0 0',
				paddingLeft: '6px',
				paddingRight: '6px',
			},
			tabRow: {
				display: 'flex',
				alignItems: 'center',
				gap: '8px 8px',
				flexWrap: 'wrap',
				margin: '0 0 10px',
				paddingTop: '2px',
				paddingBottom: '8px',
				// 固定在弹窗顶部：往下滚时「场景 TAB + 应用/删除」始终可见。
				position: 'sticky',
				top: 0,
				zIndex: 20,
				background: 'var(--dsw-alias-surface-strong, #fff)',
				boxShadow: '0 6px 8px -8px rgba(15,23,42,.45)',
			},
			/** 场景 TAB：只放名字。未选中=灰底描边；选中=品牌色实心白字（对比靠底色，不靠一条细线）。 */
			tab: {
				...BTN_BASE,
				background: 'rgba(128,128,128,.10)',
				color: 'var(--dsw-alias-label-secondary, #6b7280)',
				flexShrink: 0,
				whiteSpace: 'nowrap',
			},
			/** 选中的 TAB：品牌色实心 + 白字 + 加粗 + 投影（对比度靠底色，不靠一条细线）。 */
			tabSelected: {
				borderColor: 'var(--dsw-alias-brand-primary, #4d6bfe)',
				background: 'var(--dsw-alias-brand-primary, #4d6bfe)',
				color: '#fff',
				fontWeight: 700,
			},
			/** 「正在生效」的场景：整个 TAB 套一圈红环（不写字；选中 ≠ 生效，两者可以是不同 TAB）。 */
			tabInUse: {
				boxShadow: 'inset 0 0 0 2px #e11d48',
				borderRadius: '8px',
				fontWeight: 600,
			},
			/** 表头里「主模型」那一列：同一个红环（两列名字一样时靠它分辨谁是主）。 */
			headSide: {
				justifySelf: 'start',
				padding: '1px 9px',
				borderRadius: '999px',
				// 备模型那一侧：与主模型同形状，但用灰色虚线（不争视觉焦点）。
				border: '2px dashed rgba(128,128,128,.55)',
				background: 'transparent',
				font: 'inherit',
				fontSize: '12px',
				fontWeight: 600,
				color: 'var(--dsw-alias-label-secondary, #6b7280)',
				cursor: 'pointer',
			},
			headPrimary: {
				justifySelf: 'start',
				padding: '1px 9px',
				borderRadius: '999px',
				// 主模型那一侧：红色实线边框（与备的虚线同宽，两个胶囊尺寸完全一致）。
				border: '2px solid #e11d48',
				color: '#e11d48',
				fontWeight: 700,
			},
			tabAdd: {
				...BTN_BASE,
				color: 'var(--dsw-alias-label-secondary, #6b7280)',
			},
			/** TAB 条右端的一套动作按钮（使用 / 删除），作用于当前选中的 TAB。 */
			tabActionRow: { display: 'inline-flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' },
			/** 两个动作按钮（绿=使用 / 红=删除）。 */
			tabActionUse: {
				...BTN_BASE,
				borderColor: '#15803d',
				background: '#16a34a',
				color: '#fff',
			},
			/** 已在使用中的那个：颜色淡下去（不可点）。 */
			tabActionInUse: { border: '1px solid rgba(22,163,74,.5)', background: 'rgba(22,163,74,.18)', color: '#15803d' },
			tabActionDelete: {
				...BTN_BASE,
				borderColor: '#b91c1c',
				background: '#dc2626',
				color: '#fff',
			},
labelsRow: { display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 7px' },
			labelsTitle: { fontSize: '12.5px', flex: '0 0 auto', color: 'var(--dsw-alias-label-secondary, #6b7280)' },
			footer: {
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'flex-end',
				gap: '8px',
				margin: '14px 0 0',
				paddingTop: '12px',
				paddingBottom: '2px',
				borderTop: '1px solid rgba(128,128,128,.18)',
				// 固定在弹窗底部：往下滚时「取消 / 保存」始终可见。
				position: 'sticky',
				bottom: 0,
				zIndex: 20,
				background: 'var(--dsw-alias-surface-strong, #fff)',
				boxShadow: '0 -6px 8px -8px rgba(15,23,42,.45)',
			},
			primaryButton: {
				...BTN_BASE,
				borderColor: 'var(--dsw-alias-brand-primary, #4d6bfe)',
				background: 'var(--dsw-alias-brand-primary, #4d6bfe)',
				color: '#fff',
				fontWeight: 700,
			},
		};

		/** 一个路由（provider + model + effort）的显示文本。 */
		function routeText(t, route) {
			if (route === null || route === undefined) return '—';
			const model = typeof route.model === 'string' && route.model !== '' ? route.model : null;
			return model === null ? String(route.provider ?? '—') : `${route.provider} / ${model}`;
		}

		/** 表头：角色 | 两侧名字（主槽那侧带「主」标记）。 */
		/** 会话级覆盖的提示块（没有覆盖时只在刚覆盖完显一次结果）。 */
		function overridesBlock(t, config, adopt) {
			const adopting = adopt.busy === true;
			const adopted = adopt.updated;
			const overrides = Array.isArray(config?.sessionOverrides) ? config.sessionOverrides : [];
			const done =
				adopted === null || adopted === undefined
					? null
					: h('p', { style: STYLE.messageOk }, t('adopted', { n: adopted }));
			if (overrides.length === 0) return done;
			const sessions = overrides.map((entry) => shortSessionId(entry.sessionId)).join('、');
			// 覆盖动作本身在 TAB 条的「覆盖」按钮上（带确认弹窗），这里只讲清现状。
			return h(
				'div',
				{ style: STYLE.hint },
				h('div', null, t('overridesHint', { n: overrides.length, sessions })),
				adopting ? h('div', null, t('adopting')) : null,
				adopt.error === null || adopt.error === undefined
					? null
					: h('div', { style: STYLE.messageError }, adopt.error),
			);
		}

		// ------------------------------------------------------------------
		// 三角色编辑弹窗（多场景 TAB）
		// ------------------------------------------------------------------

		/** 一个空路由。 */
		const EMPTY_ROUTE = () => ({ provider: '', model: '', effort: '' });

		/** 快照里的场景 → 可编辑草稿（两侧固定 a / b，路由缺项补空）。 */
		function draftOf(scenarios) {
			return (Array.isArray(scenarios) ? scenarios : []).map((scene) => {
				const roles = {};
				for (const role of ROLE_KEYS) {
					roles[role] = {};
					for (const side of SIDES) {
						const route = scene?.roles?.[role]?.[side];
						roles[role][side] = {
							provider: typeof route?.provider === 'string' ? route.provider : '',
							model: typeof route?.model === 'string' ? route.model : '',
							effort: typeof route?.effort === 'string' ? route.effort : '',
						};
					}
				}
				return {
					id: String(scene?.id ?? ''),
					labels: {
						a: typeof scene?.labels?.a === 'string' ? scene.labels.a : '',
						b: typeof scene?.labels?.b === 'string' ? scene.labels.b : '',
					},
					primary: scene?.primary === 'b' ? 'b' : 'a',
					roles,
				};
			});
		}

		/** 草稿里某个场景是否选全（三个角色的两侧都有 provider 与 model）。 */
		function sceneComplete(scene) {
			for (const role of ROLE_KEYS) {
				for (const side of SIDES) {
					const route = scene?.roles?.[role]?.[side];
					if (!route || String(route.provider ?? '') === '' || String(route.model ?? '') === '') return false;
				}
			}
			return true;
		}

		/** 草稿 → 提交给宿主的场景数组（空字段不发，effort 空则省略）。 */
		function toPayload(scenarios) {
			return scenarios.map((scene) => {
				const roles = {};
				for (const role of ROLE_KEYS) {
					roles[role] = {};
					for (const side of SIDES) {
						const route = scene.roles[role][side];
						const provider = String(route.provider ?? '').trim();
						const model = String(route.model ?? '').trim();
						if (provider === '' || model === '') continue;
						const out = { provider, model };
						const effort = String(route.effort ?? '').trim();
						if (effort !== '') out.effort = effort;
						roles[role][side] = out;
					}
				}
				return { id: scene.id, labels: scene.labels, primary: scene.primary, roles };
			});
		}

		/** 目录取值助手：provider 列表 / 某 provider 的模型列表 / 显示名。 */
		const modelIdsOf = (providers, provider) =>
			(providers.find((entry) => entry.provider === provider)?.models ?? []).map((model) => model.id);
		const providerLabelOf = (providers, id) =>
			providers.find((entry) => entry.provider === id)?.label ?? id;
		const modelLabelOf = (providers, provider, id) =>
			(providers.find((entry) => entry.provider === provider)?.models ?? []).find((model) => model.id === id)
				?.name ?? id;
		/** 目录里没有的现值也要能显示（否则用户看不到自己填的东西）。 */
		const withCurrent = (list, current) =>
			current === '' || list.includes(current) ? list : [current, ...list];

		/**
		 * 「失效自动切换」标题旁的「？」按钮。展开状态放在 FailoverSection 里，
		 * 说明文字作为**普通块**渲染在标题行下面——不用绝对定位浮层，免得被弹窗的
		 * 滚动容器裁掉。
		 */
		/**
		 * 标题旁的「？」：悬停、点击都用**同一个浮层**展示说明（不再用原生 title 气泡 ——
		 * 那个由浏览器画，样式和这里的浮层两套，看着像两个东西）。
		 * 键盘 Tab 到它按 Enter / 空格也能开合；浮层自身可滚、点它不关。
		 */
		function tips(text, onToggle, open, onHover) {
			return h(
				'span',
				{
					style: STYLE.tipsWrap,
					onMouseEnter: () => onHover?.(true),
					onMouseLeave: () => onHover?.(false),
				},
				h(
					'span',
					{
						'data-or2-region': 'failover-help',
						// 故意不放 title：原生气泡和下面的浮层格式不一致。
						'aria-label': text,
						'aria-expanded': open ? 'true' : 'false',
						role: 'button',
						tabIndex: 0,
						style: STYLE.tipsDot,
						onClick: (event) => {
							event.stopPropagation();
							onToggle?.();
						},
						onKeyDown: (event) => {
							if (event.key !== 'Enter' && event.key !== ' ') return;
							event.preventDefault();
							onToggle?.();
						},
					},
					'？',
				),
				open
					? h(
							'span',
							{
								'data-or2-region': 'failover-help-panel',
								style: STYLE.helpPanel,
								onClick: (event) => event.stopPropagation(),
							},
							text,
						)
					: null,
			);
		}

		/** 「自动失效切换」一节：本节改一项立即存（不走下面的保存按钮，保存只管场景表）。 */
		function FailoverSection({ t }) {
			const store = useStore(failoverStore);
			const [draft, setDraft] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState(null);
			const [notice, setNotice] = React.useState(null);
			// 「？」的说明浮层：悬停与点击用同一个浮层（点开也能钉住看）。
			const [helpOpen, setHelpOpen] = React.useState(false);

			React.useEffect(() => {
				void ensureFailover();
			}, []);

			const config = store.config;
			const toggleHelp = () => setHelpOpen((value) => !value);
			const setHelp = (value) => setHelpOpen(value === true);

			React.useEffect(() => {
				setDraft(config === null ? null : { ...config });
			}, [config]);

			if (config === null) {
				return h(
					'div',
					{ style: STYLE.failoverCard },
					h(
						'div',
						{ style: STYLE.failoverHead },
						h(
							'div',
							{ style: { display: 'flex', alignItems: 'center', gap: '8px' } },
							h('h4', { style: STYLE.sectionHeadTitle }, t('failoverSection')),
							tips(t('failoverHelp'), toggleHelp, helpOpen, setHelp),
						),
					),
						h(
						'p',
						{ style: STYLE.messageError },
						t('failoverFailed', { detail: store.error ?? `HTTP ${store.status}` }),
					),
				);
			}

			const scenes = store.scenes ?? [];
			const pending = busy ? ' …' : '';

			/** 打一次 POST failover：宿主校验并把新快照回给我们。 */
			const commit = async (body, done) => {
				setBusy(true);
				setError(null);
				setNotice(null);
				const response = await api.post('failover', body);
				setBusy(false);
				if (!response.ok) {
					setError(response.value?.error ?? `HTTP ${response.status ?? 0}`);
					return;
				}
				adoptFailover(response.value);
				setNotice(done ?? t('failoverSaved'));
			};

			/** 「模拟限流」走 signal 路由，宿主按同一状态机裁决并把裁决回给我们。 */
			const simulate = async () => {
				setBusy(true);
				setError(null);
				setNotice(null);
				const response = await api.post('failover/signal', { reason: 'rate_limit', code: 'RATE_LIMIT', role: 'manual' });
				if (!response.ok) {
					setBusy(false);
					setError(response.value?.error ?? `HTTP ${response.status ?? 0}`);
					return;
				}
				// signal 路由只回 { ok, decision, state }：配置与顺序要再 GET 一次才能对上。
				const decision = response.value?.decision ?? {};
				await refreshFailover();
				setBusy(false);
				setNotice(t('failoverSimulated', { action: decision.action ?? '—', reason: decision.reason ?? '—' }));
			};

			const field = (key) => (draft === null ? config[key] : draft[key]);

			const sceneOption = (scene) =>
				h(
					'option',
					{ key: scene.id, value: scene.id },
					`${scene.label}${scene.complete === true ? '' : t('failoverIncomplete')}`,
				);

			/** 顺序的当前值（服务端真理；顺序改动一次提交整份数组）。 */
			const order = Array.isArray(field('order')) ? field('order') : [];
			const sceneLabel = (id) => scenes.find((scene) => scene.id === id)?.label ?? id;

			/**
			 * 顺序 = 一张「槽位表」：两列排开，位置就是次序（1、2 读第一行，3、4 读第二行…）。
			 * 槽位数至少 4 个（2 列 × 2 行），场景更多时按场景数补齐；空槽表示这一档先不排。
			 */
			const SLOT_MIN = 4;
			const slotCount = Math.max(SLOT_MIN, scenes.length, order.length);
			const slots = Array.from({ length: slotCount }, (_, index) => order[index] ?? null);

			/** 提交槽位表：空槽跳过（宿主只认「非空、不重复、≥2 个」的顺序）。 */
			const pushSlots = (next) => {
				const ids = next.filter((id) => typeof id === 'string' && id !== '');
				if (ids.length < 2) {
					setError(t('failoverOrderNeedTwo'));
					return;
				}
				setError(null);
				void commit({ order: ids });
			};

			/** 选某一槽的场景：目标已在别的槽就互换（避免提交出重复 id 被 400）。 */
			const pickSlot = (index, id) => {
				const next = [...slots];
				const other = next.indexOf(id);
				if (other === index) return;
				if (other >= 0) next[other] = next[index];
				next[index] = id === '' ? null : id;
				pushSlots(next);
			};

			/** ✕ 只清空这一格，不删行（行数由场景数决定）。 */
			const clearSlot = (index) => {
				const next = [...slots];
				next[index] = null;
				pushSlots(next);
			};

			/** 一个槽位：序号 + 场景下拉（含空选项）+ 清空按钮。 */
			const slotRow = (index) => {
				const id = slots[index] ?? '';
				return h(
					'div',
					{ key: `slot-${index}`, style: STYLE.orderRow },
					h('span', { style: STYLE.orderIndex }, `${index + 1}`),
					h(
						'select',
						{
							style: STYLE.orderSelect,
							value: id,
							disabled: busy,
							'data-or2-order': 'slot',
							onChange: (event) => pickSlot(index, event.target.value),
						},
						h('option', { key: 'empty', value: '' }, t('failoverEmpty')),
						...scenes.map(sceneOption),
					),
					h(
						'div',
						{ style: STYLE.orderActions },
						h(
							'button',
							{
								type: 'button',
								style: { ...STYLE.iconButton, opacity: busy || id === '' ? 0.35 : 1, cursor: busy || id === '' ? 'default' : 'pointer' },
								'aria-label': t('failoverRemove'),
								disabled: busy || id === '',
								onMouseEnter: showTip(t('failoverRemove')),
								onMouseLeave: hideTip,
								onClick: () => clearSlot(index),
							},
							'✕',
						),
					),
				);
			};

			const numberField = (key, label) =>
				h(
					'span',
					{ style: STYLE.numberBox },
					h('span', { style: STYLE.labelsTitle }, label),
					h('input', {
						type: 'number',
						style: STYLE.numberInput,
						value: field(key),
						disabled: busy,
						onChange: (event) => setDraft({ ...(draft ?? config), [key]: event.target.value }),
						// 失焦才提交：避免每敲一个数字就打一次宿主。
						onBlur: (event) => {
							const raw = String(event.target.value ?? '').trim();
							const next = Number(raw);
							if (raw === '' || !Number.isFinite(next)) {
								setDraft({ ...config });
								return;
							}
							if (next === config[key]) return;
							void commit({ [key]: next });
						},
					}),
				);

			const flips = Array.isArray(config.flips) ? config.flips : [];
			const hourAgo = Date.now() - 3600000;
			const recentFlips = flips.filter((flip) => {
				const at = Date.parse(flip?.at ?? '');
				return Number.isFinite(at) && at >= hourAgo;
			}).length;
			const lastAt =
				typeof config.lastFlipAt === 'string' && config.lastFlipAt !== ''
					? new Date(config.lastFlipAt).toLocaleString()
					: t('failoverNever');

			/** 状态摘要优先用宿主回的 state，缺了就从 config 推（两者同源，不怕缺字段）。 */
			const view = store.state ?? config;
			const currentIndex = Number.isInteger(view.currentIndex) ? view.currentIndex : 0;
			const currentScene =
				typeof view.currentScene === 'string' && view.currentScene !== ''
					? view.currentScene
					: order[currentIndex] ?? null;
			const roundFailed = Array.isArray(view.roundFailed) ? view.roundFailed : [];
			const halted =
				typeof view.haltedUntil === 'string' && view.haltedUntil !== ''
					? new Date(view.haltedUntil).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
					: null;

			/** 一个「标签 + 值」的小格子（状态条用）。 */
			const stat = (key, label, value) =>
				h(
					'span',
					{ key, style: STYLE.statItem },
					h('span', { style: STYLE.statLabel }, label),
					h('span', { style: STYLE.statValue }, value),
				);

			return h(
				'div',
				{ 'data-or2-region-failover': 'section', style: STYLE.failoverCard },
				// 标题行 = 「失效自动切换」 + ？TIPS + 右侧「启用」勾选框（全弹窗唯一的开关）。
				h(
					'div',
					{ style: STYLE.failoverHead },
					h(
						'div',
						{ style: { display: 'flex', alignItems: 'center', gap: '8px' } },
						h('h4', { style: STYLE.sectionHeadTitle }, t('failoverSection')),
						tips(t('failoverHelp'), toggleHelp, helpOpen, setHelp),
					),
					h(
						'label',
						{ style: STYLE.enableBox },
						t('failoverEnable'),
						h('input', {
							type: 'checkbox',
							'data-or2-region': 'failover-enable',
							checked: config.enabled === true,
							disabled: busy,
							onChange: (event) => void commit({ enabled: event.target.checked }),
						}),
					),
				),
				// 顺序（标题里已经写了「顺序」，这里不再单起一行标签）：两列槽位表，位置即次序。
				h(
					'div',
					null,
					h('div', { style: STYLE.orderGrid }, ...slots.map((_, index) => slotRow(index))),
					order.length < 2 ? h('p', { style: STYLE.hint }, t('failoverOrderNeedTwo')) : null,
				),
				// 两个数（整轮冷却 / 每小时上限）+ 两个动作按钮：同一行，按钮靠右。
				h(
					'div',
					{ style: STYLE.numberRow },
					numberField('roundCooldownMin', t('failoverRoundCooldown')),
					numberField('maxFlipsPerHour', t('failoverMaxFlips')),
					// perSceneProbeMin（探针窗口）字段仍在 config 里向后兼容，但界面不再暴露：
					// 它从来没参与判定，露出来只会让人以为调它有作用。
					h(
						'div',
						{ style: STYLE.numberActions },
						h(
							'button',
							{ type: 'button', style: STYLE.testButton, disabled: busy, onClick: () => void simulate() },
							t('failoverSimulate'),
						),
						h(
							'button',
							{ type: 'button', style: STYLE.resetButton, disabled: busy, onClick: () => void commit({ reset: true }) },
							t('failoverReset'),
						),
					),
				),
				// 状态条：当前 / 位置 / 最近翻转 / 滚动 1 小时 / 本轮已失败
				h(
					'div',
					{ style: STYLE.statRow },
					stat('current', t('statCurrent'), currentScene === null ? '—' : sceneLabel(currentScene)),
					stat('position', t('statPosition'), `${order.length === 0 ? 0 : Math.min(currentIndex + 1, order.length)} / ${order.length}`),
					stat('lastFlip', t('statLastFlip'), lastAt),
					stat('flips', t('statFlips'), String(recentFlips)),
					stat('roundFailed', t('statRoundFailed'), String(roundFailed.length)),
					halted === null ? null : h('span', { style: STYLE.warnChip }, t('failoverHaltedChip', { until: halted })),
				),
				error === null ? null : h('p', { style: STYLE.messageError }, error),
				notice === null ? null : h('p', { style: STYLE.messageOk }, notice),
			);
		}

		function RolesDialog({ t }) {
			const dialog = useStore(dialogStore);
			const config = useStore(configStore);
			const catalog = useStore(catalogStore);
			const adopt = useStore(adoptStore);
			// 表头双击切主备要看切换是否在跑（busy 时禁用），所以弹窗也订阅切换状态。
			const switching = useStore(switchStore);
			const [draft, setDraft] = React.useState(null);
			const [editingId, setEditingId] = React.useState(null);
			// 草稿里「勾使用」的那个场景：单选；勾下去立即落盘，模型改动仍走保存。
			const [activeDraft, setActiveDraft] = React.useState(null);
			const [saving, setSaving] = React.useState(false);
			const [notice, setNotice] = React.useState(null);
			const [error, setError] = React.useState(null);
			// 破坏性动作的二次确认：{ kind: 'adopt' | 'delete', id? }（null = 不显示）。
			const [confirming, setConfirming] = React.useState(null);
			// 「模型变更管控」那个 ？ 的说明浮层（悬停与点击同一个浮层）。
			const [guardHelpOpen, setGuardHelpOpen] = React.useState(false);
			// 通用悬浮说明：状态在 tipStore（别的组件也会点亮），这里只负责渲染浮层。
			const tip = useStore(tipStore);

			// 打开弹窗时重新读一次 /state：文件可能刚被预设（或手改）动过，
			// 不重读就看不出 drift（「model-routes.json 已被外部改动」提示条）。
			React.useEffect(() => {
				if (!dialog.open) return;
				void refreshConfig();
			}, [dialog.open]);

			// 弹窗打开时把快照灌进草稿（每次打开都从文件重新取，避免显示过期值）。
			React.useEffect(() => {
				if (!dialog.open) return;
				const next = config.scenarios ?? [];
				const scenes = draftOf(next);
				setDraft(scenes);
				setEditingId((config.activeScenario ?? scenes[0]?.id) ?? null);
				setActiveDraft((config.activeScenario ?? scenes[0]?.id) ?? null);
				setNotice(null);
				setError(null);
			}, [dialog.open, config.status]);
			React.useEffect(() => {
				if (dialog.open && catalogStore.get().status !== 'ok') void refreshCatalog();
			}, [dialog.open]);

			if (!dialog.open) return null;

			const scenes = draft ?? [];
			const editing = scenes.find((scene) => scene.id === editingId) ?? scenes[0] ?? null;
			const providers = catalog.status === 'ok' ? catalog.providers : [];

			// 勾「使用」立即生效（不等保存）：宿主要求该场景三个角色两侧都选全。
			const useScene = async (sceneId) => {
				setActiveDraft(sceneId);
				setError(null);
				const response = await api.post('select', { id: sceneId });
				if (!response.ok) {
					setError(response.value?.error ?? `HTTP ${response.status ?? 0}`);
					return;
				}
				const value = response.value ?? {};
				if (value.scenarios !== undefined) configStore.set({ status: 'ok', ...value });
				setNotice(t('sceneSwitched'));
			};

			const patchScene = (sceneId, patch) =>
				setDraft((prev) =>
					(prev ?? []).map((scene) => (scene.id === sceneId ? { ...scene, ...patch(scene) } : scene)),
				);

			const patchRoute = (sceneId, role, side, patch) =>
				patchScene(sceneId, (scene) => ({
					roles: {
						...scene.roles,
						[role]: {
							...scene.roles[role],
							[side]: { ...scene.roles[role][side], ...patch },
						},
					},
				}));

			/** 换 provider：当前 model 不在候选里就落到第一个候选。 */
			const pickProvider = (sceneId, role, side, provider) => {
				const models = modelIdsOf(providers, provider);
				patchRoute(sceneId, role, side, (route) => {
					const keep = models.includes(route.model) ? route.model : (models[0] ?? '');
					return { provider, model: keep, effort: '' };
				});
			};

			/** 新加一个场景：复制当前编辑场景的模型，名字回到默认。 */
			const addScene = () => {
				const base = editing ?? scenes[0];
				const id = (() => {
					for (let i = 1; i <= scenes.length + 64; i += 1) {
						const candidate = `scene-${i}`;
						if (!scenes.some((scene) => scene.id === candidate)) return candidate;
					}
					return `scene-${Date.now().toString(36)}`;
				})();
				const copy = base
					? draftOf([base])[0]
					: { id, labels: { a: '', b: '' }, primary: 'a', roles: {} };
				const scene = {
					...copy,
					id,
					labels: { a: DEFAULT_LABELS.a, b: DEFAULT_LABELS.b },
					primary: 'a',
				};
				for (const role of ROLE_KEYS) scene.roles[role] ??= { a: EMPTY_ROUTE(), b: EMPTY_ROUTE() };
				setDraft((prev) => [...(prev ?? []), scene]);
				setEditingId(id);
			};

			const removeScene = (sceneId) => {
				if (scenes.length <= 1) return;
				const rest = scenes.filter((scene) => scene.id !== sceneId);
				setDraft(rest);
				if (editingId === sceneId) setEditingId(rest[0].id);
			};

			const onSubmit = async () => {
				setNotice(null);
				setError(null);
				// 勾「使用」的那个场景必须选全模型：没选全就不许当生效场景（#4）。
				const wanted =
					activeDraft ?? (config.status === 'ok' ? config.activeScenario : null) ?? scenes[0]?.id ?? null;
				const chosen = scenes.find((scene) => scene.id === wanted);
				if (chosen === undefined || !sceneComplete(chosen)) {
					setError(t('needComplete'));
					return;
				}
				setSaving(true);
				const result = await saveScenarios(toPayload(scenes), chosen.id);
				setSaving(false);
				if (!result.ok) {
					setError(t('saveFailed', { detail: result.error }));
					return;
				}
				setNotice(t('saved'));
			};

			/**
			 * model-routes.json 被外部改写（预设自己的「设置角色模型」/ 手改）后，把界面上这份
			 * 场景表原样再写一遍：既修好 preset 正在读的 roles，也让 drift 提示消失。
			 */
			const reapplyNow = async () => {
				setNotice(null);
				setError(null);
				const wanted = activeDraft ?? (config.status === 'ok' ? config.activeScenario : null) ?? scenes[0]?.id ?? null;
				const chosen = scenes.find((scene) => scene.id === wanted);
				if (chosen === undefined || !sceneComplete(chosen)) {
					setError(t('needComplete'));
					return;
				}
				setSaving(true);
				const result = await saveScenarios(toPayload(scenes), chosen.id);
				setSaving(false);
				if (!result.ok) {
					setError(t('saveFailed', { detail: result.error }));
					return;
				}
				setNotice(t('reapplied'));
			};

			/**
			 * 漂移的逐会话处置：
			 * - `apply`   把这个会话的 overrideRoute 改成当前场景派生值（它也按场景走）
			 * - `dismiss` 记下该会话「放弃跟随」（文件内容再变会重新提示）
			 */
			const driftAction = async (action, sessionId) => {
				setNotice(null);
				setError(null);
				setSaving(true);
				const result = await api.post('drift', { action, sessionId });
				setSaving(false);
				if (!result.ok) {
					setError(t('saveFailed', { detail: result.value?.error ?? result.status }));
					return;
				}
				if (result.value?.scenarios !== undefined) configStore.set({ status: 'ok', ...result.value });
				if (action === 'apply') setNotice(t('driftApplied', { n: result.value?.changed ?? 0 }));
				else if (action === 'dismiss') setNotice(t('driftDismissed'));
			};

			/**
			 * 模型变更管控（铁律）开关：
			 * - 开：`model-routes.json` 只有本插件能写，会话里改模型（preset 的 set_role_model / 手改文件）
			 *       会在 5 秒内被写回，并记一条回滚记录。
			 * - 关：只观察（界面仍显示漂移提示），不碰文件。
			 */
			const guardAction = async (enabled) => {
				setNotice(null);
				setError(null);
				setSaving(true);
				const result = await api.post('guard', { enabled });
				setSaving(false);
				if (!result.ok) {
					setError(t('saveFailed', { detail: result.value?.error ?? result.status }));
					return;
				}
				if (config !== null && config.status === 'ok') configStore.set({ ...config, guard: result.value });
				setNotice(enabled ? t('guardSavedOn') : t('guardSavedOff'));
			};

			/**
			 * 铁律这一节：标题行（？ + 状态 + 开关方框）+ 回滚状态。
			 * 长说明收进 ？ 的浮层，正文只留「回滚状态」一段，避免卡片被文字淹没。
			 */
			const guardBlock = () => {
				const state = config.guard ?? {};
				const enabled = state.enabled !== false;
				const reverts = (Array.isArray(state.reverts) ? state.reverts : []).slice(-3).reverse();
				const clockOf = (iso) => {
					const when = typeof iso === 'string' ? new Date(iso) : null;
					if (when === null || Number.isNaN(when.getTime())) return '—';
					return `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}:${String(
						when.getSeconds(),
					).padStart(2, '0')}`;
				};
				return h(
					'div',
					{ key: 'guard', style: STYLE.guardCard, 'data-or2-region': 'guard' },
					h(
						'div',
						{ style: STYLE.guardHead },
						h('h4', { style: STYLE.sectionHeadTitle }, t('guardSection')),
						tips(
							t('guardHelp'),
							() => setGuardHelpOpen((value) => !value),
							guardHelpOpen,
							(value) => setGuardHelpOpen(value === true),
						),
						h(
							'label',
							{ style: STYLE.enableBox, 'data-or2-region': 'guard-state' },
							t('guardEnable'),
							h('input', {
								type: 'checkbox',
								checked: enabled,
								disabled: saving,
								'aria-label': t('guardToggle'),
								onChange: (event) => void guardAction(event.target.checked),
								'data-or2-region': 'guard-toggle',
							}),
						),
					),
					reverts.length === 0
						? h('p', { style: STYLE.guardHint, 'data-or2-region': 'guard-none' }, t('guardNone'))
						: h(
								'div',
								{ style: STYLE.guardLog, 'data-or2-region': 'guard-reverts' },
								...reverts.map((item, index) =>
									h(
										'div',
										{ key: `${item.at}-${index}`, style: STYLE.guardLogRow, 'data-or2-region': 'guard-revert' },
										`${clockOf(item.at)} · ${(item.roles ?? []).map((role) => t(ROLE_LABEL[role] ?? role)).join('、')} · ${t(
											'guardReverted',
										)}`,
									),
								),
							),
				);
			};

			/** 漂移提示：说清「什么时候被改、差在哪几个角色」，再逐个会话给「应用 / 放弃」。 */
			const driftBlock = () => {
				const list = Array.isArray(config.driftSessions) ? config.driftSessions : [];
				const when = typeof config.routesMtime === 'string' ? new Date(config.routesMtime) : null;
				const clock =
					when === null || Number.isNaN(when.getTime())
						? '—'
						: `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}:${String(
								when.getSeconds(),
							).padStart(2, '0')}`;
				const roles = (Array.isArray(config.driftRoles) ? config.driftRoles : [])
					.map((role) => t(ROLE_LABEL[role] ?? role))
					.join('、');
				return h(
					'div',
					{ key: 'drift', style: STYLE.driftBar, 'data-or2-region': 'drift' },
					h(
						'div',
						{ style: STYLE.driftHead },
						h('span', { style: STYLE.driftText }, t('driftBody', { time: clock, roles })),
						h(
							'button',
							{
								type: 'button',
								style: { ...BTN_BASE, flexShrink: 0 },
								disabled: saving,
								onClick: reapplyNow,
								'data-or2-region': 'drift-reapply',
							},
							t('reapply'),
						),
					),
					list.length === 0
						? h('p', { style: STYLE.driftHint, 'data-or2-region': 'drift-nosession' }, t('driftNoSession'))
						: h(
								'div',
								{ style: STYLE.driftList, 'data-or2-region': 'drift-sessions' },
								...list.map((entry) =>
									h(
										'div',
										{
											key: entry.sessionId,
											style: STYLE.driftRow,
											'data-or2-region': 'drift-session',
											'data-or2-session': entry.sessionId,
										},
										h(
											'span',
											{ style: STYLE.driftWho, title: entry.workspace ?? '' },
											`${entry.workspace ?? t('unknownWorkspace')} · ${t('sessionShort', { id: entry.shortId })}`,
										),
										h(
											'span',
											{ style: STYLE.driftRoles },
											(entry.roles ?? []).map((role) => t(ROLE_LABEL[role] ?? role)).join('、'),
										),
										h('span', { style: STYLE.driftSpacer }),
										h(
											'button',
											{
												type: 'button',
												style: { ...BTN_BASE, flexShrink: 0 },
												disabled: saving,
												onClick: () => driftAction('apply', entry.sessionId),
												'data-or2-region': 'drift-apply',
												'data-or2-session': entry.sessionId,
											},
											t('driftApply'),
										),
										h(
											'button',
											{
												type: 'button',
												style: { ...BTN_BASE, flexShrink: 0 },
												disabled: saving,
												onClick: () => driftAction('dismiss', entry.sessionId),
												'data-or2-region': 'drift-dismiss',
												'data-or2-session': entry.sessionId,
											},
											t('driftDismiss'),
										),
									),
								),
							),
				);
			};

			/** 一个下拉管「分组 + 具体模型」：optgroup = 提供商，option 值 = provider\u0000model。 */
			const routeField = (sceneId, role, side) => {
				if (editing === null) return null;
				const route = editing.roles[role][side];
				if (catalog.status === 'loading') {
					return h('select', { style: STYLE.input, disabled: true }, h('option', null, t('loading')));
				}
				if (catalog.status !== 'ok') {
					// 目录彻底取不到：回落到两个手填输入框，至少还能写字。
					return [
						h('input', {
							key: 'provider',
							type: 'text',
							style: STYLE.input,
							value: route.provider,
							placeholder: t('manualInput'),
							onChange: (event) => patchRoute(sceneId, role, side, { provider: event.target.value }),
						}),
						h('input', {
							key: 'model',
							type: 'text',
							style: { ...STYLE.input, marginTop: '4px' },
							value: route.model,
							placeholder: t('manualInput'),
							onChange: (event) => patchRoute(sceneId, role, side, { model: event.target.value }),
						}),
					];
				}
				const groups = providers
					.map((entry) => {
						const ids = withCurrent(
							entry.models.map((model) => model.id),
							entry.provider === route.provider ? route.model : null,
						);
						return { provider: entry.provider, label: entry.label ?? entry.provider, ids };
					})
					.filter((group) => group.ids.length > 0);
				const current = `${route.provider}\u0000${route.model}`;
				const known = groups.some((group) => group.provider === route.provider && group.ids.includes(route.model));
				const options = groups.map((group) =>
					h(
						'optgroup',
						{ key: group.provider, label: group.label },
						...group.ids.map((id) =>
							h(
								'option',
								{ key: `${group.provider}\u0000${id}`, value: `${group.provider}\u0000${id}` },
								modelLabelOf(providers, group.provider, id),
							),
						),
					),
				);
				if (!known && route.model !== '') {
					// 目录里已经没有当前值（手填过 / 目录变了）：单独列在最上面，避免选择被吞掉。
					options.unshift(
						h(
							'optgroup',
							{ key: '__current', label: t('currentValue') },
							h('option', { value: current }, `${route.provider} / ${route.model}`),
						),
					);
				}
				return h(
					'select',
					{
						style: STYLE.input,
						value: known || route.model !== '' ? current : '',
						onChange: (event) => {
							const [provider, model] = String(event.target.value).split('\u0000');
							if (!provider || !model) return;
							patchRoute(sceneId, role, side, { provider, model, effort: '' });
						},
					},
					...options,
				);
			};

			const tabText = (scene) => {
				const a = scene.labels.a.trim() === '' ? DEFAULT_LABELS.a : scene.labels.a;
				const b = scene.labels.b.trim() === '' ? DEFAULT_LABELS.b : scene.labels.b;
				return `${a}/${b}`;
			};
			const activeId = activeDraft ?? (config.status === 'ok' ? config.activeScenario : null);
			/** 选中的 TAB 就是「使用中」的那个？ */
			// 表头双击切主备：只对「使用中且两侧都选全」的场景生效。
			const canSwitchHead =
				editing !== null && editing.id === activeId && sceneComplete(editing) && !switching.busy;
			const editingIsActive = editing !== null && editing.id === activeId;
			/** 选中的 TAB 能不能「使用」：不是使用中、且三个角色两侧都选全。 */
			const canUseEditing = editing !== null && !editingIsActive && sceneComplete(editing);
			// 「覆盖」：把当前设置写进被会话级覆盖钉住的会话（有才可点）。
			const overrideCount = Array.isArray(config.sessionOverrides) ? config.sessionOverrides.length : 0;
			const canAdopt = overrideCount > 0 && adopt.busy !== true;

			return h(
				'div',
				{
					'data-or2-region': 'dialog-layer',
					style: STYLE.dialogLayer,
					onMouseDown: (event) => {
						if (event.target === event.currentTarget) dialogStore.set({ open: false });
					},
				},
				h(
					'div',
					{
						role: 'dialog',
						'aria-modal': 'true',
						'aria-label': t('rolesTitle'),
						style: STYLE.dialog,
						onKeyDown: (event) => {
							if (event.key === 'Escape') dialogStore.set({ open: false });
						},
					},
					h(
						'div',
						{ style: STYLE.dialogHead },
						h(
							'div',
							{ style: STYLE.dialogHeadText },
							h('h3', { style: STYLE.dialogTitle }, t('rolesTitle')),
							h('p', { style: STYLE.description }, t('description')),
						config.status === 'ok'
							? null
							: h(
									'p',
									{ style: STYLE.messageError },
									t('configError', { detail: config.error ?? '' }),
								),
						),
						h(
							'button',
							{
								type: 'button',
								'data-or2-region': 'dialog-close',
								style: STYLE.dialogClose,
								'aria-label': t('close'),
								onClick: () => dialogStore.set({ open: false }),
							},
							h(
								'svg',
								{
									width: 16,
									height: 16,
									viewBox: '0 0 16 16',
									'data-or2-icon': 'close',
									'aria-hidden': 'true',
									fill: 'none',
									stroke: '#dc2626',
									strokeWidth: 2.4,
									strokeLinecap: 'round',
								},
								h('path', { d: 'M4.2 4.2 L11.8 11.8' }),
								h('path', { d: 'M11.8 4.2 L4.2 11.8' }),
							),
						),
					),
					h(
						'div',
						{ style: STYLE.dialogBody },
						﻿// 场景 TAB 条：只放名字（文字 = 两侧名字自动拼接）。选中的那个带底部标识条，
						// 「使用中」的那个名字后面点一个圆点；「使用 / 删除」只保留一套，作用于选中的 TAB。
						h(
							'div',
							{ style: STYLE.tabRow },
							...scenes.map((scene) =>
								h(
									'button',
									{
										key: scene.id,
										type: 'button',
										'data-or2-region-tab': scene.id,
										style: {
											...STYLE.tab,
											...(scene.id === editingId ? STYLE.tabSelected : null),
											...(scene.id === activeId ? STYLE.tabInUse : null),
										},
										onMouseEnter: showTip(scene.id === activeId ? t('tabInUseTitle') : tabText(scene)),
										onMouseLeave: hideTip,
										onClick: () => setEditingId(scene.id),
									},
									tabText(scene),
								),
							),
							h('button', { type: 'button', style: STYLE.tabAdd, onClick: addScene }, t('tabAdd')),
							// 一套动作按钮：作用于当前选中的 TAB（不再每个 TAB 各带一套）。
							h(
								'div',
								{ style: STYLE.tabActionRow },
								// 「保存」写在「应用」之前：先存这一份场景表，再决定哪个生效。
								h(
									'button',
									{
										type: 'button',
										'data-or2-region': 'scene-save',
										style: {
											...STYLE.primaryButton,
											opacity: saving ? 0.6 : 1,
											cursor: saving ? 'default' : 'pointer',
										},
										disabled: saving,
										onMouseEnter: showTip(t('saveHint')),
										onMouseLeave: hideTip,
										onClick: () => void onSubmit(),
									},
									saving ? t('saving') : t('save'),
								),
								h(
									'button',
									{
										type: 'button',
										'data-or2-region': 'scene-use',
										'data-or2-scene': editing === null ? '' : editing.id,
										style: {
											...STYLE.tabActionUse,
											...(editingIsActive ? STYLE.tabActionInUse : null),
											opacity: canUseEditing ? 1 : 0.5,
											cursor: canUseEditing ? 'pointer' : 'default',
										},
										disabled: !canUseEditing,
										onMouseEnter: showTip(
											!canUseEditing && editing !== null && !sceneComplete(editing) ? t('needComplete') : t('applyShort'),
										),
										onMouseLeave: hideTip,
										onClick: () => {
											if (editing !== null) void useScene(editing.id);
										},
									},
									t('applyShort'),
								),
								h(
									'button',
									{
										type: 'button',
										'data-or2-region': 'overrides-adopt',
										style: {
											...STYLE.adoptButton,
											opacity: canAdopt ? 1 : 0.5,
											cursor: canAdopt ? 'pointer' : 'default',
										},
										disabled: !canAdopt,
										onMouseEnter: showTip(canAdopt ? t('adoptHint', { n: overrideCount }) : t('adoptNone')),
										onMouseLeave: hideTip,
										onClick: () => setConfirming({ kind: 'adopt' }),
									},
									adopt.busy === true ? t('adopting') : t('adoptShort'),
								),
								h(
									'button',
									{
										type: 'button',
										'data-or2-region': 'scene-delete',
										'data-or2-scene': editing === null ? '' : editing.id,
										style: {
											...STYLE.tabActionDelete,
											opacity: saving || scenes.length <= 1 ? 0.5 : 1,
											cursor: saving || scenes.length <= 1 ? 'default' : 'pointer',
										},
										disabled: saving || scenes.length <= 1,
										onClick: () => {
											if (editing !== null) setConfirming({ kind: 'delete', id: editing.id });
										},
									},
									t('deleteShort'),
								),
							),
						),
						editing === null
							? null
							: [
									editing === null || sceneComplete(editing)
										? null
										: h('p', { style: STYLE.hint }, t('needComplete')),
									// 两侧名字 = 侧边栏那两个按钮的文字。
									h(
										'div',
										{ key: 'labels', style: STYLE.labelsRow },
										h('span', { style: STYLE.labelsTitle }, t('labelsTitle')),
										...SIDES.map((side) =>
											h('input', {
												key: side,
												type: 'text',
												'data-or2-region-label': side,
												maxLength: LABEL_MAX,
												placeholder: `${DEFAULT_LABELS[side]}（${t('labelPlaceholder')}）`,
												style: { ...STYLE.input, flex: '1 1 0' },
												value: editing.labels[side],
												onChange: (event) =>
													patchScene(editing.id, (scene) => ({
														labels: { ...scene.labels, [side]: event.target.value },
													})),
											}),
										),
									),
									// 左右两列 = 这一场景的两侧；主槽那侧的列头带「主」。
									h('div', { key: 'head', style: STYLE.headRow },
										h('span', null, t('tableRole')),
										...SIDES.map((side) =>
											h(
												'button',
												{
													key: side,
													type: 'button',
													'data-or2-region': 'side-head',
													'data-or2-side': side,
													style: {
														...STYLE.headSide,
														...(editing.primary === side ? STYLE.headPrimary : null),
														...(canSwitchHead ? null : { cursor: 'default' }),
													},
													onMouseEnter: showTip(canSwitchHead ? t('headSwitchHint') : t('headSwitchLocked')),
													onMouseLeave: hideTip,
													onDoubleClick: () => {
														if (!canSwitchHead || editing.primary === side) return;
														const target = editing.id;
														// 宿主翻完主备后，弹窗里的草稿也要跟着翻，否则红环还留在旧的一侧。
														void switchSide(side).then((ok) => {
															if (ok) patchScene(target, () => ({ primary: side }));
														});
													},
												},
												`${editing.primary === side ? t('primarySlot') : t('fallbackSlot')} · ${
													editing.labels[side].trim() === '' ? DEFAULT_LABELS[side] : editing.labels[side]
												}`,
											),
										),
									),
									...ROLE_KEYS.map((role) =>
										h(
											'div',
											{ key: role, style: STYLE.roleRow },
											h('span', { style: STYLE.roleName }, t(ROLE_LABEL[role])),
											...SIDES.map((side) =>
												h(
													'div',
													{ key: side, style: STYLE.slotColumn },
													routeField(editing.id, role, side),
												),
											),
										),
									),
								],
						config.drift === true ? driftBlock() : null,
						h(
							'div',
							{ key: 'overrides', style: STYLE.overridesBox },
							overridesBlock(t, config, adopt),
						),
						h(FailoverSection, { key: 'failover', t }),
						guardBlock(),
						error === null ? null : h('p', { style: STYLE.messageError }, error),
						notice === null ? null : h('p', { style: STYLE.messageOk }, notice),
						h('p', { key: 'path', style: STYLE.path }, t('path', { path: config.path ?? '—' })),
						config.scenariosPath === undefined
							? null
							: h('p', { key: 'path2', style: STYLE.path }, t('pathScenarios', { path: config.scenariosPath })),
					),
					// 通用悬浮说明（与「？」同款外观）。
					tip.text === null
						? null
						: h(
								'div',
								{
									key: 'tip',
									role: 'tooltip',
									'data-or2-region': 'tip-float',
									style: { ...STYLE.tipFloat, left: `${tip.left}px`, top: `${tip.top}px` },
								},
								tip.text,
							),
					// 破坏性动作的二次确认：铺满整个弹窗，避免误点「覆盖 / 删除」。
					confirming === null
						? null
						: h(
								'div',
								{ key: 'confirm', style: STYLE.confirmLayer, 'data-or2-region': 'confirm-layer' },
								h(
									'div',
									{ style: STYLE.confirmCard },
									h(
										'p',
										{ style: STYLE.confirmText },
										confirming.kind === 'adopt'
											? t('adoptConfirm', { n: overrideCount })
											: t('deleteConfirm', {
													label: (() => {
														const target = scenes.find((scene) => scene.id === confirming.id);
														return target === undefined ? '' : tabText(target);
													})(),
												}),
									),
									h(
										'div',
										{ style: STYLE.confirmActions },
										h(
											'button',
											{
												type: 'button',
												'data-or2-region': 'confirm-cancel',
												style: STYLE.buttonBase,
												onClick: () => setConfirming(null),
											},
											t('cancel'),
										),
										h(
											'button',
											{
												type: 'button',
												'data-or2-region': 'confirm-ok',
												style: confirming.kind === 'adopt' ? STYLE.primaryButton : STYLE.dangerButton,
												onClick: () => {
													const pending = confirming;
													setConfirming(null);
													if (pending.kind === 'adopt') {
														void adoptOverrides();
													} else if (pending.id !== undefined) {
														removeScene(pending.id);
													}
												},
											},
											t('confirm'),
										),
									),
								),
							),
				),
			);
		}

		/** overlay 槽位要一个「带 id/label 的条目工厂」。 */
		function makeRolesDialogEntry(t) {
			const Component = guarded(`${NS}.roles-dialog`, function RolesDialogEntry(props) {
				return h(RolesDialog, { ...props, t: props?.t ?? t });
			});
			return Component;
		}

		return {
			inject: ['slots'],
			apply(ctx) {
				const t = makeT(detectedTag());
				report('apply-enter', {
					hasSlots: Boolean(ctx?.slots),
					slotKeys: ctx?.slots && typeof ctx.slots.entriesOfSlot === 'function' ? ['entriesOfSlot'] : [],
				});

				/** 注册一个槽位条目；任何失败都回报宿主（页面侧证据的唯一回流通道）。 */
				const slot = (slotName, options, Component) => {
					try {
						const wrapped = guarded(`${slotName}:${String(options?.id ?? options?.key ?? NS)}`, Component);
						ctx.slots.inject(slotName, () => ctx.slots.register(options, wrapped));
						report('slot-registered', { slot: slotName, id: options?.id ?? options?.key ?? null });
					} catch (error) {
						report('slot-error', {
							slot: slotName,
							phase: 'register',
							message: String(error?.message ?? error),
							stack: String(error?.stack ?? '').slice(0, 800),
						});
					}
				};

				slot(
					'sidebar.panellist',
					{ name: 'sidebar.panellist', id: NS, order: 32, label: () => t('panelLabel'), locale: NS },
					makeRegionRowEntry(t),
				);
					slot(
					'shell.overlay',
					{ name: 'shell.overlay', id: `${NS}.roles-dialog`, order: 120, label: () => t('rolesTitle') },
					makeRolesDialogEntry(t),
				);
			},
		};
	},
});
