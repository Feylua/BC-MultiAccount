import { classifyMessage, displayNameOf, extractOriginalMessage, formatDisplayMessage, messageId } from "./messages.js";
import { parseBeepMessage, beepText } from "./beep.js";

export function dayKey(ts) {
	const d = new Date(ts);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function fnv1a(str) {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(36);
}

export function makeRecord({ data, sender, msg, metadata, room, player, maxChars = 8000, now = Date.now() }) {
	const kind = classifyMessage(data);
	if (!kind) return null;

	const text = formatDisplayMessage(kind, msg);
	if (!text) return null;

	const member = Number(sender?.MemberNumber) || 0;
	const playerId = Number(player?.MemberNumber) || 0;
	const self = playerId === member && member !== 0;
	const msgid = metadata?.MsgId || messageId(data);
	const body = text.slice(0, maxChars);
	const original = extractOriginalMessage(data, metadata, kind, msg, sender);

	return {
		// Include the receiving PlayerID so the same room message is stored once
		// per account instead of being overwritten by another recipient.
		uid: msgid ? `${playerId}|${member}|${msgid}` : `${playerId}|${member}|${fnv1a(body)}|${Math.floor(now / 1000)}`,
		member,
		name: displayNameOf(sender),
		self,
		account: "",
		playerId,
		playerName: typeof player?.Name === "string" ? player.Name : "",
		color: typeof sender?.LabelColor === "string" ? sender.LabelColor : "",
		kind,
		// New in v1.1.3: whispers keep the room the receiving player was in.
		room: room || "",
		target: typeof data?.Target === "number" ? data.Target : null,
		text: body,
		...(original ? { original: original.slice(0, maxChars) } : {}),
		ts: now,
		day: dayKey(now),
		direction: self ? "out" : "in",
	};
}

export function makeBeepRecord({ data, player, maxChars = 8000, now = Date.now() }) {
	if (!data || typeof data !== "object") return null;
	const text = beepText(data).slice(0, maxChars);
	if (!text) return null;

	const member = Number(data.MemberNumber) || 0;
	const playerId = Number(player?.MemberNumber) || 0;
	const parsed = parseBeepMessage(data.Message);
	const msgid = parsed?.metadata?.messageId;

	return {
		uid: msgid ? `${playerId}|${member}|${msgid}` : `${playerId}|${member}|${fnv1a(text)}|${Math.floor(now / 1000)}`,
		member,
		name: typeof data.MemberName === "string" ? data.MemberName : "",
		self: false,
		account: "",
		playerId,
		playerName: typeof player?.Name === "string" ? player.Name : "",
		color: "",
		kind: "beep",
		room: "",
		target: null,
		text,
		ts: now,
		day: dayKey(now),
		direction: "in",
	};
}

export function makeOutgoingBeepRecord({ target, msg, player, maxChars = 8000, now = Date.now() }) {
	const member = Number(target) || 0;
	if (member <= 0) return null;
	if (typeof msg !== "string" || msg.trim() === "") return null;

	const text = beepText({ Message: msg }).slice(0, maxChars);
	if (!text) return null;

	const playerId = Number(player?.MemberNumber) || 0;
	const parsed = parseBeepMessage(msg);
	const msgid = parsed?.metadata?.messageId;
	const friendName = player?.FriendNames && typeof player.FriendNames.get === "function"
		? player.FriendNames.get(member)
		: "";

	return {
		uid: msgid ? `${playerId}|${member}|${msgid}` : `${playerId}|${member}|${fnv1a(text)}|${Math.floor(now / 1000)}`,
		member,
		name: typeof friendName === "string" && friendName ? friendName : `#${member}`,
		self: true,
		account: "",
		playerId,
		playerName: typeof player?.Name === "string" ? player.Name : "",
		color: typeof player?.LabelColor === "string" ? player.LabelColor : "",
		kind: "beep",
		room: "",
		target: member,
		text,
		ts: now,
		day: dayKey(now),
		direction: "out",
	};
}
