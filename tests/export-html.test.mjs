import test from "node:test";
import assert from "node:assert/strict";
import { generateExportHtml } from "../src/parent/export-html.js";

const records = [
	{ uid: "a", playerId: 9, playerName: "Me", member: 1, name: "Alice", kind: "chat", room: "R", text: "one", ts: 1 },
	{ uid: "b", playerId: 9, playerName: "Me", member: 2, name: "Bob", kind: "beep", room: "", text: "two", ts: 2 },
];

test("export HTML has independent kind filters under search", () => {
	const html = generateExportHtml(records, { title: "T", source: "当前会话消息" });
	for (const kind of ["chat", "action", "whisper", "beep", "system"]) {
		assert.ok(html.includes(`id: "${kind}"`), `missing filter ${kind}`);
	}
	assert.ok(html.indexOf('id="search"') < html.indexOf('id="kindFilters"'));
	assert.ok(html.indexOf('id="kindFilters"') < html.indexOf('id="tabs"'));
});

test("export HTML has a player proportion bar and timestamp", () => {
	const html = generateExportHtml(records, { title: "T", source: "当前会话消息" });
	assert.ok(html.includes('class="player-bars"'));
	assert.ok(html.includes("flex:0 0 100.0000%"));
	assert.ok(html.includes("Me #9"));
	assert.match(html, /生成于 \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} · 2 条/);
});

test("player bar segment widths follow message counts", () => {
	const many = Array.from({ length: 9 }, (_, index) => ({
		uid: String(index),
		playerId: index < 5 ? 1 : 2,
		playerName: index < 5 ? "A" : "B",
		member: 1,
		name: "X",
		kind: "chat",
		room: "R",
		text: "x",
		ts: index,
	}));
	const html = generateExportHtml(many, { title: "T", source: "当前会话消息" });
	assert.ok(html.includes("flex:0 0 55.5556%"));
	assert.ok(html.includes("flex:0 0 44.4444%"));
});
