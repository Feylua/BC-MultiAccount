import { MAX_ACCOUNTS } from "../constants.js";
import styles from "./styles.css";

export function createToolbar({ state, feed, handlers }) {
	function injectStyles() {
		if (document.getElementById("bcma-style")) return;
		const style = document.createElement("style");
		style.id = "bcma-style";
		style.textContent = styles;
		(document.head || document.documentElement).appendChild(style);
	}

	function setupDrag(bar) {
		const handle = bar.querySelector("#bcma-drag");
		let drag = null;
		handle.addEventListener("pointerdown", (event) => {
			event.preventDefault();
			const rect = bar.getBoundingClientRect();
			drag = {
				dx: event.clientX - rect.left,
				dy: event.clientY - rect.top,
				pointerId: event.pointerId,
			};
			handle.setPointerCapture(event.pointerId);
		});
		handle.addEventListener("pointermove", (event) => {
			if (!drag) return;
			const maxLeft = Math.max(0, window.innerWidth - bar.offsetWidth);
			const maxTop = Math.max(0, window.innerHeight - bar.offsetHeight);
			const left = Math.max(0, Math.min(maxLeft, event.clientX - drag.dx));
			const top = Math.max(0, Math.min(maxTop, event.clientY - drag.dy));
			bar.style.left = `${left}px`;
			bar.style.top = `${top}px`;
			bar.style.transform = "none";
		});
		handle.addEventListener("pointercancel", () => {
			drag = null;
		});
		handle.addEventListener("pointerup", (event) => {
			if (!drag) return;
			drag = null;
			try {
				handle.releasePointerCapture(event.pointerId);
			} catch {
				/* ignore */
			}
			try {
				localStorage.setItem("bcma.pos", JSON.stringify({ left: bar.style.left, top: bar.style.top }));
			} catch {
				/* ignore */
			}
		});
	}

	function mount() {
		injectStyles();
		const old = document.getElementById("bcma-bar");
		if (old) old.remove();

		const bar = document.createElement("div");
		bar.id = "bcma-bar";
		bar.innerHTML = '<div id="bcma-drag" title="拖动工具栏">⠿</div><div id="bcma-list"></div>' +
			'<button id="bcma-feed-toggle" type="button" title="后台消息" aria-controls="bcma-feed" aria-expanded="false">▸</button>' +
			'<div id="bcma-feed" hidden></div>' +
			'<button id="bcma-settings" type="button" title="设置">⚙</button>';
		document.body.appendChild(bar);
		state.toolbar = bar;

		feed.bind(bar.querySelector("#bcma-feed"), bar.querySelector("#bcma-feed-toggle"));
		bar.querySelector("#bcma-settings").addEventListener("click", handlers.onSettings);

		try {
			const saved = JSON.parse(localStorage.getItem("bcma.pos") || "null");
			if (saved && saved.left && saved.top) {
				bar.style.left = saved.left;
				bar.style.top = saved.top;
				bar.style.transform = "none";
				const rect = bar.getBoundingClientRect();
				bar.style.left = `${Math.max(0, Math.min(rect.left, window.innerWidth - rect.width))}px`;
				bar.style.top = `${Math.max(0, Math.min(rect.top, window.innerHeight - rect.height))}px`;
			}
		} catch {
			/* ignore */
		}

		setupDrag(bar);
	}

	function accountLabel(acc, index) {
		return acc.name || `账号 ${index + 1}`;
	}

	function badgeOf(acc) {
		const { whisper, chat, action, activity } = acc.unread;
		const total = whisper + chat + action + activity;
		let cls = "muted";
		if (whisper > 0) cls = "whisper";
		else if (chat > 0) cls = "chat";
		return {
			total,
			cls,
			title: `私聊/Beep ${whisper} · 聊天 ${chat} · 动作 ${action} · 互动 ${activity}`,
		};
	}

	function buildAccountEntry(acc, index) {
		const wrap = document.createElement("div");
		wrap.className = "bcma-account " + (acc.online ? "online" : "offline");

		const label = accountLabel(acc, index);
		const close = document.createElement("button");
		close.type = "button";
		close.className = "bcma-close" + (acc.top ? " disabled" : "");
		close.textContent = "×";
		close.title = acc.top
			? "主账号是当前页面，无法单独关闭"
			: `关闭 ${label} 窗格`;
		close.addEventListener("click", (event) => {
			event.stopPropagation();
			if (acc.top) {
				window.alert("主账号是当前页面，无法单独关闭。请关闭整个标签页。");
				return;
			}
			handlers.onRemove(acc.key);
		});
		wrap.appendChild(close);

		const icon = document.createElement("div");
		icon.className = "bcma-icon";

		const button = document.createElement("button");
		button.type = "button";
		button.className = "bcma-acc " + (acc.online ? "online" : "offline") +
			(acc.key === state.activeKey ? " active" : "");
		const status = acc.online ? "在线" : (acc.loggedIn ? "连接断开" : "未登录");
		button.title = `${label}${acc.member ? ` (#${acc.member})` : ""}\n${status}` +
			(acc.room ? `\n房间：${acc.room}` : "") +
			`\n左键切换`;
		const avatar = document.createElement("span");
		avatar.className = "bcma-avatar";
		avatar.textContent = String(index + 1);
		button.appendChild(avatar);
		button.addEventListener("click", () => handlers.onSwitch(acc.key));
		icon.appendChild(button);

		const badge = badgeOf(acc);
		const unread = document.createElement("span");
		unread.className = `bcma-unread ${badge.total > 0 ? badge.cls : "empty"}`;
		unread.textContent = badge.total > 99 ? "99+" : String(badge.total);
		unread.title = badge.title;
		icon.appendChild(unread);
		wrap.appendChild(icon);

		const name = document.createElement("span");
		name.className = "bcma-name";
		name.textContent = acc.loggedIn && acc.name ? acc.name : "Empty";
		wrap.appendChild(name);

		if (acc.loggedIn && acc.name && acc.room) {
			const room = document.createElement("span");
			room.className = "bcma-room";
			room.textContent = acc.room;
			wrap.appendChild(room);
		}

		return wrap;
	}

	function buildAddButton() {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "bcma-add";
		button.textContent = "+";
		button.title = `添加账号（最多 ${MAX_ACCOUNTS} 个）`;
		button.addEventListener("click", handlers.onAdd);
		return button;
	}

	function render() {
		if (!state.toolbar) return;
		const list = state.toolbar.querySelector("#bcma-list");
		if (!list) return;
		const frag = document.createDocumentFragment();
		state.accounts.forEach((acc, index) => frag.appendChild(buildAccountEntry(acc, index)));
		frag.appendChild(buildAddButton());
		list.replaceChildren(frag);
	}

	return { mount, render };
}
