'use strict';

/**
 * 找对象字面量里的**重复键**：重复键在 JS 里不报错、后者静默覆盖前者，UI 上表现为
 * 「文案对不上代码」这种极难查的 bug（本项目已踩过一次：`sceneInUse` 同时是
 * 「使用中」和「已切换到这个场景。」）。
 *
 * 只做一件小事：给定源码全文，把 `const DICTS = { … };` 里每个对象字面量的顶层键
 * 收集起来，返回每个对象里的重复键。不解析 YAML、不建 AST——够用就好。
 */

/** 从 `{` 开始，按大括号配对找出对象字面量的结束位置（跳过字符串与模板串）。 */
function matchBrace(source, start) {
	let depth = 0;
	for (let i = start; i < source.length; i += 1) {
		const ch = source[i];
		if (ch === "'" || ch === '"' || ch === '`') {
			const quote = ch;
			i += 1;
			while (i < source.length) {
				if (source[i] === '\\') {
					i += 2;
					continue;
				}
				if (source[i] === quote) break;
				i += 1;
			}
			continue;
		}
		if (ch === '/' && source[i + 1] === '/') {
			const nl = source.indexOf('\n', i);
			i = nl < 0 ? source.length : nl;
			continue;
		}
		if (ch === '/' && source[i + 1] === '*') {
			const close = source.indexOf('*/', i + 2);
			i = close < 0 ? source.length : close + 1;
			continue;
		}
		if (ch === '{') depth += 1;
		else if (ch === '}') {
			depth -= 1;
			if (depth === 0) return i;
		}
	}
	return -1;
}

/** 取对象字面量的**顶层**键：只认深度 1 且行首是 `key:` 的那些。 */
function topLevelKeys(source, start, end) {
	const body = source.slice(start + 1, end);
	const keys = [];
	let depth = 0;
	let lineStart = true;
	for (let i = 0; i < body.length; i += 1) {
		const ch = body[i];
		if (ch === "'" || ch === '"' || ch === '`') {
			const quote = ch;
			i += 1;
			while (i < body.length) {
				if (body[i] === '\\') {
					i += 2;
					continue;
				}
				if (body[i] === quote) break;
				i += 1;
			}
			lineStart = false;
			continue;
		}
		if (ch === '\n') {
			lineStart = true;
			continue;
		}
		if (lineStart && /\s/.test(ch)) continue;
		if (lineStart && depth === 0) {
			const rest = body.slice(i);
			const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(rest);
			if (m !== null) {
				keys.push(m[1]);
				lineStart = false;
				i += m[0].length - 1;
				continue;
			}
		}
		lineStart = false;
		if (ch === '{' || ch === '[' || ch === '(') depth += 1;
		else if (ch === '}' || ch === ']' || ch === ')') depth -= 1;
	}
	return keys;
}

/**
 * 返回 `[{ index, duplicates: [key…] }]`：`index` 是 DICTS 里第几个子对象（0 = zh，1 = en…）。
 * 找不到 `const DICTS = {` 时返回 `null`。
 */
function findDictDuplicates(source) {
	const anchor = source.indexOf('const DICTS = ');
	if (anchor < 0) return null;
	const outerStart = source.indexOf('{', anchor);
	const outerEnd = matchBrace(source, outerStart);
	if (outerStart < 0 || outerEnd < 0) return null;

	// 外层对象里逐个取子对象（zh / en），每个子对象单独查重。
	const subs = [];
	const body = source.slice(outerStart + 1, outerEnd);
	let depth = 0;
	for (let i = 0; i < body.length; i += 1) {
		const ch = body[i];
		if (ch === "'" || ch === '"' || ch === '`') {
			const quote = ch;
			i += 1;
			while (i < body.length) {
				if (body[i] === '\\') {
					i += 2;
					continue;
				}
				if (body[i] === quote) break;
				i += 1;
			}
			continue;
		}
		if (ch === '{' && depth === 0) {
			const end = matchBrace(body, i);
			if (end < 0) break;
			subs.push([i, end]);
			i = end;
			continue;
		}
		if (ch === '{' || ch === '[') depth += 1;
		else if (ch === '}' || ch === ']') depth -= 1;
	}

	const report = [];
	subs.forEach(([start, end], index) => {
		const keys = topLevelKeys(body, start, end);
		const seen = new Set();
		const dups = [];
		for (const key of keys) {
			if (seen.has(key)) {
				if (!dups.includes(key)) dups.push(key);
				continue;
			}
			seen.add(key);
		}
		report.push({ index, keys: keys.length, duplicates: dups });
	});
	return report;
}

module.exports = { findDictDuplicates };
