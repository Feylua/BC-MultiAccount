// ==UserScript==
// @name         BC Multi-Account Switcher (Loader)
// @namespace    bc-multi-account-loader
// @version      1.1.0
// @description  动态加载 GitHub 上最新的 BC-MultiAccount.user.js（dist/ 构建产物）
// @author       Feylua
// @match        https://*.bondageprojects.elementfx.com/R*/*
// @match        https://*.bondage-europe.com/R*/*
// @match        https://*.bondageprojects.com/R*/*
// @match        https://*.bondage-asia.com/club/R*
// @match        http://localhost:*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
	"use strict";

	// ============================================================
	// 仓库当前结构：
	//   Feylua/BC-MultiAccount
	//   └─ dist/BC-MultiAccount.user.js
	//
	// 只需要安装这个 Loader，每次打开 BC 都会拉取最新构建。
	// 如果仓库、分支或构建路径变化，改下面三行即可。
	// ============================================================
	const REPO = "Feylua/BC-MultiAccount";
	const BRANCH = "main";
	const PLUGIN_PATH = "dist/BC-MultiAccount.user.js";

	// 优先使用明确返回 JavaScript MIME 的 CDN，最后回退到 GitHub Raw。
	const CDNS = [
		(path) => `https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}/${path}`,
		(path) => `https://fastly.jsdelivr.net/gh/${REPO}@${BRANCH}/${path}`,
		(path) => `https://cdn.statically.io/gh/${REPO}/${BRANCH}/${path}`,
		(path) => `https://raw.githack.com/${REPO}/${BRANCH}/${path}`,
		(path) => `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${path}`,
	];

	const FLAG = "__BCMA_LOADER_STARTED__";
	if (window[FLAG]) return;
	window[FLAG] = true;

	const urls = CDNS.map((makeUrl) => makeUrl(PLUGIN_PATH));
	let index = 0;

	function loadNext() {
		if (index >= urls.length) {
			console.warn(
				"[BC Multi Loader] 所有下载地址均失败。请确认仓库公开、分支为 " +
				BRANCH + "，并且存在 " + PLUGIN_PATH + "。",
			);
			return;
		}

		const url = urls[index++];
		const separator = url.includes("?") ? "&" : "?";
		const cacheBusted = url + separator + "_=" + Date.now();
		const script = document.createElement("script");
		script.async = true;
		script.dataset.bcmaLoader = "1";
		script.src = cacheBusted;

		script.onload = () => {
			console.info("[BC Multi Loader] loaded:", url);
			script.remove();
		};
		script.onerror = () => {
			console.warn("[BC Multi Loader] failed, trying next:", url);
			script.remove();
			loadNext();
		};

		const parent = document.head || document.documentElement;
		if (!parent) {
			// document-start 极早期，极少数情况下还没有可挂载节点。
			setTimeout(() => {
				index--;
				loadNext();
			}, 10);
			return;
		}
		parent.appendChild(script);
	}

	loadNext();
})();
