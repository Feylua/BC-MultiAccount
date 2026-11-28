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

test("message rows include MM-DD before local time", () => {
	const html = generateExportHtml(records, { title: "T", source: "当前会话消息" });
	assert.ok(html.includes('grid-template-columns: 100px 110px 150px 64px'));
	assert.ok(html.includes('pad(d.getMonth() + 1) + "-" + pad(d.getDate())'));
	assert.ok(html.includes('pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds())'));
});

test("export HTML renders and can strip WCE original text", () => {
	const withOriginal = [{ ...records[0], original: "WCE_UNIQUE_ORIGINAL" }];
	const included = generateExportHtml(withOriginal, { includeOriginal: true });
	assert.ok(included.includes("WCE_UNIQUE_ORIGINAL"));
	assert.ok(included.includes("text-original"));
	assert.ok(included.includes("原文："));
	assert.ok(included.includes("SHOW_ORIGINAL = true"));
	assert.ok(included.includes("record.original"));

	const excluded = generateExportHtml(withOriginal, { includeOriginal: false });
	assert.ok(!excluded.includes("WCE_UNIQUE_ORIGINAL"));
	assert.ok(excluded.includes("SHOW_ORIGINAL = false"));
});

test("export HTML has date and room dropdown filters defaulting to all", () => {
	const html = generateExportHtml(records, { title: "T", source: "当前会话消息" });
	assert.ok(html.includes('id="dateFilter"'));
	assert.ok(html.includes('id="roomFilter"'));
	assert.ok(html.includes('addOption(dateFilter, "all", "[全部]")'));
	assert.ok(html.includes('addOption(roomFilter, "all", "[全部]")'));
	assert.ok(html.includes('let selectedDate = "all"'));
	assert.ok(html.includes('let selectedRoom = "all"'));
	assert.ok(html.includes('if (selectedDate !== "all"'));
	assert.ok(html.includes('if (selectedRoom !== "all"'));
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
