import test from "node:test";
import assert from "node:assert/strict";

globalThis.__VERSION__ = "test";
const { createFeed } = await import("../src/parent/feed.js");

function makeState() {
	return {
		feed: null,
		feedToggle: null,
		feedMessages: [],
		feedSeen: new Set(),
		feedOpen: false,
		accounts: [],
		activeKey: 1,
	};
}

test("the same message is written to the feed only once", () => {
	const state = makeState();
	const feed = createFeed(state);
	assert.equal(feed.push("Room A", "hello", { kind: "chat", accountKey: 2, id: "msg-1" }), true);
	assert.equal(feed.push("Room A", "hello", { kind: "chat", accountKey: 3, id: "msg-1" }), false);
	assert.equal(state.feedMessages.length, 1);
});

test("different message ids are both written", () => {
	const state = makeState();
	const feed = createFeed(state);
	feed.push("Room A", "one", { kind: "chat", accountKey: 2, id: "msg-1" });
	feed.push("Room A", "two", { kind: "chat", accountKey: 2, id: "msg-2" });
	assert.equal(state.feedMessages.length, 2);
});

test("clearRoom removes historical entries from that room", () => {
	const state = makeState();
	const feed = createFeed(state);
	feed.push("Room A", "one", { kind: "chat", accountKey: 2, id: "msg-1" });
	feed.push("Room B", "two", { kind: "chat", accountKey: 2, id: "msg-2" });
	feed.clearRoom("Room A");
	assert.equal(state.feedMessages.length, 1);
	assert.equal(state.feedMessages[0].room, "Room B");
});
