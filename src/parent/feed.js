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

	function render() {
		if (!feedElement) return;
		const frag = document.createDocumentFragment();
		for (const line of state.feedMessages) {
			const elem = document.createElement("div");
			elem.className = "bcma-feed-line";
			elem.textContent = line;
			elem.title = line;
			frag.appendChild(elem);
		}
		feedElement.replaceChildren(frag);
	}

	function push(room, text) {
		const cleanRoom = String(room || "大厅").trim() || "大厅";
		const cleanText = String(text || "(空消息)").replace(/\s+/g, " ").trim() || "(空消息)";
		state.feedMessages.push(`[${cleanRoom}] ${cleanText}`);
		if (state.feedMessages.length > FEED_MAX_LINES) {
			state.feedMessages.splice(0, state.feedMessages.length - FEED_MAX_LINES);
		}
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

	return { bind, setOpen, render, push };
}
