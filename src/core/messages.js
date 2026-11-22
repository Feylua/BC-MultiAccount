import { messageRoom } from "./chat.js";

export function classifyMessage(data) {
	if (!data || typeof data.Type !== "string") return null;
	switch (data.Type) {
		case "Whisper": return "whisper";
		case "Chat": return "chat";
		case "Action": return "action";
		case "Activity": return "activity";
		case "ServerMessage": return "system";
		default: return null;
	}
}

export function isUnreadKind(kind) {
	return kind === "whisper" || kind === "chat" || kind === "action" || kind === "activity";
}

export function isIncoming(data, player) {
	if (!data || typeof data !== "object") return false;
	const self = player && player.MemberNumber;
	const sender = typeof data.Sender === "number" ? data.Sender : Number(data.Sender);
	const target = typeof data.Target === "number" ? data.Target : null;
	if (Number.isFinite(sender) && typeof self === "number" && sender === self) {
		return false;
	}
	// A whisper addressed to somebody else is an outgoing copy, not unread.
	if (data.Type === "Whisper" && target !== null && typeof self === "number" && target !== self) {
		return false;
	}
	return true;
}

export function messageId(data) {
	if (!Array.isArray(data.Dictionary)) return null;
	for (const entry of data.Dictionary) {
		if (entry && typeof entry === "object" && typeof entry.MsgId === "string") {
			return entry.MsgId;
		}
	}
	return null;
}

export function stripFeedNoise(text) {
	let result = String(text ?? "").trim();

	// BC's `msg` normally has no sender id or timestamp, but some
	// actions/translations can expose one. Apply the three patterns
	// repeatedly until a fixed point so combined metadata such as
	// "#123 12:34 hello" is fully removed regardless of order.
	// Every replacement shortens the string, so this always terminates.
	while (true) {
		const before = result;
		result = result
			.replace(
				/^\s*[\[(]?\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?[\])]?\s*[-–—:·]?\s*/,
				"",
			)
			.replace(
				/^\s*[\[(]?\d{1,2}:\d{2}(?::\d{2})?[\])]?\s*[-–—:·]?\s*/,
				"",
			)
			.replace(
				/^\s*(?:#\s*\d+|ID\s*[:：]?\s*\d+|\[\s*#?\d+\s*\]|\(\s*#?\d+\s*\))\s*[-–—:·]?\s*/i,
				"",
			)
			.trim();
		if (result === before) break;
	}

	return result;
}

export function formatDisplayMessage(kind, msg) {
	let text = String(msg ?? "");
	if (typeof window.CommonCensor === "function") {
		try {
			text = window.CommonCensor(text);
		} catch {
			/* fall back to the uncensored text */
		}
	}
	if (text === "¶¶¶") return null;
	text = stripFeedNoise(text);
	if (!text) return null;
	// ChatRoomMessageDisplay wraps Action/Activity in parentheses.
	if (kind === "action" || kind === "activity") text = `(${text})`;
	return text;
}

export function displayNameOf(sender) {
	if (!sender) return "";
	try {
		if (typeof window.CharacterNickname === "function") {
			const nick = window.CharacterNickname(sender);
			if (typeof nick === "string" && nick.trim()) return nick.trim();
		}
	} catch {
		/* fall through */
	}
	if (typeof sender.Nickname === "string" && sender.Nickname.trim()) return sender.Nickname.trim();
	if (typeof sender.Name === "string" && sender.Name.trim()) return sender.Name.trim();
	if (typeof sender.MemberNumber === "number") return `#${sender.MemberNumber}`;
	return "";
}

export function handleDisplayMessage(data, sender, msg, metadata, seen, report) {
	const kind = classifyMessage(data);
	if (!kind || !isUnreadKind(kind)) return;
	if (!isIncoming(data, window.Player)) return;

	const id = (metadata && typeof metadata.MsgId === "string" && metadata.MsgId) || messageId(data);
	if (id) {
		if (seen.has(id)) return;
		seen.add(id);
		if (seen.size > 2000) seen.clear();
	}

	let text = formatDisplayMessage(kind, msg);
	if (!text) return;
	if (kind === "chat" || kind === "whisper") {
		const speaker = displayNameOf(sender);
		if (speaker) text = `${speaker}: ${text}`;
	}
	report(kind, text, messageRoom(), id);
}
