import test from "node:test";
import assert from "node:assert/strict";
import { canFollowRooms, canSwapRooms } from "../src/core/room-rules.js";

const active = {
	key: 1,
	top: true,
	loggedIn: true,
	online: true,
	inRoom: true,
	room: "Room A",
	roomMemberCount: 3,
};
const background = {
	key: 2,
	top: false,
	loggedIn: true,
	online: true,
	inRoom: true,
	room: "Room B",
	roomMemberCount: 1,
};

test("room follow requires two different occupied rooms", () => {
	assert.equal(canFollowRooms(active, background), true);
	assert.equal(canFollowRooms(active, { ...background, room: "Room A" }), false);
	assert.equal(canFollowRooms(active, { ...background, room: "" }), false);
	assert.equal(canFollowRooms(active, { ...background, inRoom: false }), false);
	assert.equal(canFollowRooms(active, { ...background, online: false }), false);
	const childActive = { ...active, key: 2, top: false };
	const topBackground = { ...background, key: 1, top: true };
	assert.equal(canFollowRooms(childActive, topBackground), true);
	assert.equal(canFollowRooms(active, background, true), false);
});

test("swap is hidden when the foreground room has only one person", () => {
	assert.equal(canSwapRooms({ ...active, roomMemberCount: 1 }, background), false);
	assert.equal(canSwapRooms({ ...active, roomMemberCount: 2 }, background), true);
	assert.equal(canSwapRooms(active, { ...background, room: "Room A" }), false);
});

test("lobby foreground can follow and can use swap", () => {
	const lobby = { ...active, inRoom: false, room: "", roomMemberCount: 0 };
	assert.equal(canFollowRooms(lobby, background), true);
	assert.equal(canSwapRooms(lobby, background), true);
});
