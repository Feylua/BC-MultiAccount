import { FEED_MAX_LINES } from "../constants.js";

export function createFeed(state) {
	let feedElement = null;
	let toggleElement = null;

	function setOpen(open) {
		state.feedOpen = !!open;
		if (feedElement) feedElement.hidden = !state.feedOpen;
		if (toggleElement) {
			toggleElement.textContent = state.feedOpen ? "▾" : "▸";
			toggleElement.title = state.feedOpen ? "收起后台消息" : "展开后台消息";
			toggleElement.setAttribute("aria-expanded", state.feedOpen ? "true" : "false");
		}
		try {
			localStorage.setItem("bcma.feedOpen", state.feedOpen ? "1" : "0");
		} catch {
			/* ignore */
		}
	}

	function visibleEntries() {
		return state.feedMessages.filter((entry) => {
			if (!entry || typeof entry === "string") return true;
			// Switching rooms must not hide old messages: the foreground account did
			// not actually read them. Only the account that is currently active hides
			// its own old background history.
			if (entry.accountKey === state.activeKey) return false;
			return true;
		});
	}

	function render() {
		if (!feedElement) return;
		const frag = document.createDocumentFragment();
		for (const entry of visibleEntries()) {
			const line = typeof entry === "string" ? entry : entry.line;
			const elem = document.createElement("div");
			elem.className = "bcma-feed-line";
			elem.textContent = line;
			elem.title = line;
			frag.appendChild(elem);
		}
		feedElement.replaceChildren(frag);
	}

	function push(room, text, meta = {}) {
		const id = typeof meta.id === "string" && meta.id ? meta.id : "";
		if (id) {
			const key = `${meta.kind || ""}|${id}`;
			if (state.feedSeen.has(key)) return false;
			state.feedSeen.add(key);
			if (state.feedSeen.size > 2000) state.feedSeen.clear();
		}
		const cleanRoom = String(room || "大厅").trim() || "大厅";
		const cleanText = String(text || "(空消息)").replace(/\s+/g, " ").trim() || "(空消息)";
		const kind = typeof meta.kind === "string" ? meta.kind : "";
		// Only records without a MsgId need the content fallback. A present but
		// different MsgId means a different message and must not be merged.
		if (!id && (kind === "chat" || kind === "action" || kind === "activity")) {
			const sender = Number(meta.sender) || 0;
			const recentKey = `${kind}|${cleanRoom}|${sender}|${cleanText}`;
			const now = Date.now();
			const last = state.feedRecent.get(recentKey);
			if (last !== undefined && now - last <= 2000) return false;
			state.feedRecent.set(recentKey, now);
			if (state.feedRecent.size > 1000) {
				const oldest = state.feedRecent.keys().next().value;
				if (oldest !== undefined) state.feedRecent.delete(oldest);
			}
		}
		state.feedMessages.push({
			line: `[${cleanRoom}] ${cleanText}`,
			kind: typeof meta.kind === "string" ? meta.kind : "",
			accountKey: Number.isInteger(meta.accountKey) ? meta.accountKey : null,
			room: cleanRoom,
		});
		if (state.feedMessages.length > FEED_MAX_LINES) {
			state.feedMessages.splice(0, state.feedMessages.length - FEED_MAX_LINES);
		}
		render();
		return true;
	}

	function clearRoom(room) {
		const cleanRoom = String(room || "").trim();
		if (!cleanRoom) return;
		state.feedMessages = state.feedMessages.filter((entry) => {
			if (typeof entry === "string") return true;
			return entry.room !== cleanRoom;
		});
		render();
	}

	function bind(feed, toggle) {
		feedElement = feed;
		toggleElement = toggle;
		state.feed = feed;
		state.feedToggle = toggle;
		toggleElement.addEventListener("click", (event) => {
			event.stopPropagation();
			setOpen(!state.feedOpen);
		});
		try {
			state.feedOpen = localStorage.getItem("bcma.feedOpen") === "1";
		} catch {
			state.feedOpen = false;
		}
		setOpen(state.feedOpen);
	}

	return { bind, setOpen, render, push, clearRoom };
}
