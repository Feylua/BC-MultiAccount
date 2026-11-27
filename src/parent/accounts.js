import { CHANNEL, HASH_KEY, MAX_ACCOUNTS } from "../constants.js";
import { MSG } from "../protocol.js";
import { leaveFullscreen } from "../core/fullscreen.js";
import { scrollChatToBottom } from "../core/chat.js";
import { emptyUnread } from "./state.js";

export function createAccounts({ state, render, configureAccount, afterSwitch }) {
	function createFrame(key) {
		const url = new URL(location.href);
		// Keep relative asset paths working if the page was opened without a trailing slash
		// (e.g. .../R134 or .../club_game, but not .../index.html).
		if (!url.pathname.endsWith("/") && !/\.[^/]+$/.test(url.pathname)) url.pathname += "/";
		url.hash = `${HASH_KEY}=${key}`;
		const frame = document.createElement("iframe");
		frame.className = "bcma-frame";
		frame.title = `BC account ${key}`;
		frame.src = url.href;
		frame.allow = "clipboard-read; clipboard-write; fullscreen";
		frame.setAttribute("allowfullscreen", "");
		frame.style.display = "none";
		document.body.appendChild(frame);
		return frame;
	}

	function postTo(acc, message) {
		if (!acc || !acc.frame) return;
		try {
			acc.frame.contentWindow.postMessage({ channel: CHANNEL, ...message }, "*");
		} catch (err) {
			console.warn("[BC Multi] postTo failed", err);
		}
	}

	function accountLabel(acc, index) {
		return acc.name || `账号 ${index + 1}`;
	}

	function applyInfo(acc, info) {
		if (!acc || !info || typeof info !== "object") return;
		if (typeof info.loggedIn === "boolean") acc.loggedIn = info.loggedIn;
		if (typeof info.online === "boolean") acc.online = info.online;
		if (typeof info.name === "string") acc.name = info.name;
		if (typeof info.account === "string") acc.account = info.account;
		if (typeof info.memberNumber === "number") acc.member = info.memberNumber;
		else if (info.memberNumber === null) acc.member = null;
		if (typeof info.inRoom === "boolean") acc.inRoom = info.inRoom;
		if (typeof info.room === "string") acc.room = info.room;
		if (typeof info.roomSpace === "string") acc.roomSpace = info.roomSpace;
		if (typeof info.roomMemberCount === "number") acc.roomMemberCount = info.roomMemberCount;
	}

	function clearUnread(acc) {
		if (!acc) return;
		acc.unread = emptyUnread();
	}

	function focus(acc) {
		if (!acc) return;
		if (acc.top) {
			const canvas = document.getElementById("MainCanvas");
			if (canvas) canvas.focus();
		} else {
			const win = acc.frame && acc.frame.contentWindow;
			if (win) {
				setTimeout(() => {
					try {
						win.focus();
					} catch {
						/* ignore */
					}
				}, 0);
			}
		}
	}

	function requestScrollBottom(acc) {
		if (!acc) return;
		setTimeout(() => {
			if (acc.top) {
				scrollChatToBottom();
			} else {
				postTo(acc, { type: MSG.SCROLL_BOTTOM });
			}
		}, 120);
	}

	function switchTo(key) {
		const acc = state.accounts.find((a) => a.key === key);
		if (!acc) return;
		if (state.activeKey === key) {
			clearUnread(acc);
			render();
			focus(acc);
			requestScrollBottom(acc);
			afterSwitch?.();
			return;
		}

		// A fullscreen canvas in the top window would cover the iframe.
		if (!acc.top && document.fullscreenElement) {
			leaveFullscreen();
		}

		state.activeKey = key;
		state.topActive = !!acc.top;

		for (const other of state.accounts) {
			if (other.top) continue;
			other.frame.style.display = other.key === key ? "block" : "none";
			postTo(other, { type: MSG.SET_ACTIVE, active: other.key === key });
		}
		for (const other of state.accounts) configureAccount?.(other);

		clearUnread(acc);
		render();
		focus(acc);
		requestScrollBottom(acc);
		afterSwitch?.();
	}

	function add() {
		if (state.accounts.length >= MAX_ACCOUNTS) {
			window.alert(`最多同时打开 ${MAX_ACCOUNTS} 个账号。`);
			return;
		}
		const key = state.nextKey++;
		const frame = createFrame(key);
		const acc = {
			key,
			top: false,
			frame,
			name: "",
			account: "",
			auth: null,
			member: null,
			loggedIn: false,
			online: false,
			inRoom: false,
			room: "",
			roomSpace: "",
			roomMemberCount: 0,
			ready: false,
			unread: emptyUnread(),
		};
		state.accounts.push(acc);
		render();
		switchTo(key);

		setTimeout(() => {
			if (!acc.ready && state.accounts.includes(acc)) {
				console.warn(
					`[BC Multi] ${accountLabel(acc, state.accounts.indexOf(acc))} did not report ready after 20s. ` +
					"Check whether the game is blocked from being framed (X-Frame-Options / CSP frame-ancestors).",
				);
			}
		}, 20000);
	}

	function remove(key) {
		const index = state.accounts.findIndex((a) => a.key === key);
		if (index < 0) return;
		const acc = state.accounts[index];
		if (acc.top) return;
		if (!window.confirm(`确认关闭「${accountLabel(acc, index)}」窗格？`)) return;
		// Ask the child to flush its last log batch before the iframe is torn down.
		postTo(acc, { type: MSG.LOG_FLUSH });
		setTimeout(() => {
			try {
				acc.frame.remove();
			} catch {
				/* ignore */
			}
			state.accounts.splice(index, 1);
			if (state.activeKey === key) {
				switchTo(state.accounts[0].key);
			} else {
				render();
			}
		}, 150);
	}

	function addTop() {
		state.accounts.push({
			key: 1,
			top: true,
			frame: null,
			name: "",
			account: "",
			auth: null,
			member: null,
			loggedIn: false,
			online: false,
			inRoom: false,
			room: "",
			roomSpace: "",
			roomMemberCount: 0,
			ready: true,
			unread: emptyUnread(),
		});
	}

	return {
		createFrame,
		postTo,
		applyInfo,
		clearUnread,
		focus,
		requestScrollBottom,
		switchTo,
		add,
		remove,
		addTop,
	};
}
