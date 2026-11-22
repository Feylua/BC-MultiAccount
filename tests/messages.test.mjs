import test from "node:test";
import assert from "node:assert/strict";
import {
	classifyMessage,
	formatDisplayMessage,
	isIncoming,
	stripFeedNoise,
} from "../src/core/messages.js";
import { beepPreviewText, isChatBeep, isReactionBeep, isRecordableBeep } from "../src/core/beep.js";
import { makeBeepRecord, makeOutgoingBeepRecord, makeRecord } from "../src/core/log-record.js";
import { isSameRoomChatOrAction } from "../src/core/room.js";

globalThis.window = {
	FriendListBeepParseMessage(raw) {
		const text = String(raw ?? "");
		const separator = "\uf124";
		const index = text.lastIndexOf(separator);
		if (index < 0) return { text, metadata: null };
		try {
			return {
				text: text.slice(0, index).trimEnd(),
				metadata: JSON.parse(text.slice(index + separator.length)),
			};
		} catch {
			return { text, metadata: null };
		}
	},
};

test("stripFeedNoise removes combined leading metadata", () => {
	assert.equal(stripFeedNoise("#123 12:34 hello"), "hello");
	assert.equal(stripFeedNoise("[2026-11-22 12:34:56] hello"), "hello");
	assert.equal(stripFeedNoise("(12345) hello"), "hello");
});

test("stripFeedNoise preserves body numbers", () => {
	assert.equal(stripFeedNoise("hello 123"), "hello 123");
	assert.equal(stripFeedNoise("(hello)"), "(hello)");
});

test("stripFeedNoise is idempotent", () => {
	const once = stripFeedNoise("#123 12:34 hello");
	assert.equal(stripFeedNoise(once), once);
});

test("formatDisplayMessage wraps actions", () => {
	assert.equal(formatDisplayMessage("action", "hello"), "(hello)");
	assert.equal(formatDisplayMessage("chat", "hello"), "hello");
});

test("classifyMessage classifies supported message types", () => {
	assert.equal(classifyMessage({ Type: "Chat" }), "chat");
	assert.equal(classifyMessage({ Type: "Whisper" }), "whisper");
	assert.equal(classifyMessage({ Type: "ServerMessage" }), "system");
	assert.equal(classifyMessage({ Type: "Emote" }), null);
});

test("beep preview includes its speaker", () => {
	assert.equal(
		beepPreviewText({ MemberName: "Alice", MemberNumber: 42, Message: "hello" }),
		"Alice #42: hello",
	);
});

test("isIncoming ignores self messages", () => {
	assert.equal(isIncoming({ Sender: 5, Type: "Chat" }, { MemberNumber: 5 }), false);
	assert.equal(isIncoming({ Sender: 6, Type: "Chat" }, { MemberNumber: 5 }), true);
});

test("message records carry receiving PlayerID and whisper room", () => {
	const record = makeRecord({
		data: { Type: "Whisper", Target: 9, Sender: 1 },
		sender: { MemberNumber: 1, Name: "Sender" },
		msg: "hi",
		metadata: { MsgId: "w1" },
		room: "Room A",
		player: { MemberNumber: 9, Name: "Receiver" },
	});
	assert.equal(record.playerId, 9);
	assert.equal(record.playerName, "Receiver");
	assert.equal(record.room, "Room A");
	assert.equal(record.kind, "whisper");
});

test("outgoing private beep is filed under the sending player", () => {
	const record = makeOutgoingBeepRecord({
		target: 5,
		msg: "yo",
		player: {
			MemberNumber: 9,
			Name: "Receiver",
			FriendNames: new Map([[5, "Friend"]]),
		},
	});
	assert.equal(record.kind, "beep");
	assert.equal(record.playerId, 9);
	assert.equal(record.member, 5);
	assert.equal(record.name, "Friend");
	assert.equal(record.self, true);
	assert.equal(record.direction, "out");
});

test("incoming beep carries receiving PlayerID", () => {
	const record = makeBeepRecord({
		data: { MemberNumber: 5, MemberName: "Friend", BeepType: "", Message: "yo" },
		player: { MemberNumber: 9, Name: "Receiver" },
	});
	assert.equal(record.kind, "beep");
	assert.equal(record.playerId, 9);
	assert.equal(record.playerName, "Receiver");
	assert.equal(record.direction, "in");
});

test("isChatBeep matches LianChat's outgoing rule", () => {
	// 好友列表默认附带房间：IsSecret false，仍应记录
	assert.equal(isChatBeep({ MemberNumber: 5, BeepType: "", IsSecret: false, Message: "hi" }), true);
	// 取消附带房间 / 第三方 mod 未传 IsSecret
	assert.equal(isChatBeep({ MemberNumber: 5, BeepType: "", IsSecret: true, Message: "hi" }), true);
	assert.equal(isChatBeep({ MemberNumber: 5, BeepType: "", Message: "hi" }), true);
	// BeepType "Message" 不放行
	assert.equal(isChatBeep({ MemberNumber: 5, BeepType: "Message", Message: "hi" }), false);
	// 控制类 Beep 不放行
	assert.equal(isChatBeep({ MemberNumber: 5, BeepType: "LCPlayerInfo", Message: "{}" }), false);
	assert.equal(isChatBeep({ MemberNumber: 5, BeepType: "LCTypingStatus", Message: "{}" }), false);
	assert.equal(isChatBeep({ MemberNumber: 5, BeepType: "Leash" }), false);
	// 空正文不放行
	assert.equal(isChatBeep({ MemberNumber: 5, BeepType: "", Message: "" }), false);
	assert.equal(isChatBeep({ MemberNumber: 5, BeepType: "", Message: "   " }), false);
});

test("Reaction beeps are excluded from records and unread", () => {
	const reaction = `👍\n\uf124${JSON.stringify({
		messageType: "Reaction",
		reactionTo: "message-1",
		reactionEmoji: "👍",
	})}`;
	const data = { MemberNumber: 5, MemberName: "Friend", BeepType: "", Message: reaction };
	assert.equal(isChatBeep(data), true);
	assert.equal(isReactionBeep(data), true);
	assert.equal(isRecordableBeep(data), false);
});

test("type-less JSON beeps are recorded", () => {
	const payload = JSON.stringify({ foo: 1 });
	const data = { MemberNumber: 5, MemberName: "Friend", BeepType: "", Message: payload };
	assert.equal(isRecordableBeep(data), true);
	assert.ok(makeBeepRecord({ data, player: { MemberNumber: 9, Name: "Receiver" } }));
	assert.ok(makeOutgoingBeepRecord({
		target: 5,
		msg: payload,
		player: { MemberNumber: 9, Name: "Sender" },
	}));
});

test("LianChat profile beeps are excluded by BeepType", () => {
	const payload = JSON.stringify({
		Name: "Feylua",
		Nickname: "菲露亚",
		Avatar: "",
		Signature: "",
		EnableLianChat: true,
	});
	assert.equal(isRecordableBeep({
		MemberNumber: 5,
		BeepType: "LCPlayerInfo",
		Message: payload,
	}), false);
});

test("makeOutgoingBeepRecord rejects empty message", () => {
	assert.equal(makeOutgoingBeepRecord({
		target: 5,
		msg: "",
		player: { MemberNumber: 9, Name: "Sender" },
	}), null);
});

test("same-room chat/action unread suppression only applies to chat/action", () => {
	assert.equal(isSameRoomChatOrAction("chat", "Room A", "Room A"), true);
	assert.equal(isSameRoomChatOrAction("action", "Room A", "Room A"), true);
	assert.equal(isSameRoomChatOrAction("activity", "Room A", "Room A"), false);
	assert.equal(isSameRoomChatOrAction("whisper", "Room A", "Room A"), false);
	assert.equal(isSameRoomChatOrAction("chat", "Room A", "Room B"), false);
	assert.equal(isSameRoomChatOrAction("chat", "", ""), false);
});

test("same message is stored separately for each receiving PlayerID", () => {
	const common = {
		data: { Type: "Chat", Sender: 1 },
		sender: { MemberNumber: 1, Name: "Alice" },
		msg: "hello",
		metadata: { MsgId: "same-msg" },
		room: "Room A",
	};
	const first = makeRecord({ ...common, player: { MemberNumber: 9, Name: "A" } });
	const second = makeRecord({ ...common, player: { MemberNumber: 10, Name: "B" } });
	assert.notEqual(first.uid, second.uid);
	assert.equal(first.uid, "9|1|same-msg");
	assert.equal(second.uid, "10|1|same-msg");
});
