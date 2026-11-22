import { FEED_MAX_LINES } from "../constants.js";
import { isSameRoomChatOrAction } from "../core/room.js";

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
		const active = state.accounts.find((a) => a.key === state.activeKey);
		return state.feedMessages.filter((entry) => {
			if (!entry || typeof entry === "string") return true;
			// Once an account becomes active its old background history is redundant.
			if (entry.accountKey === state.activeKey) return false;
			return !isSameRoomChatOrAction(entry.kind, entry.room, active?.room);
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
