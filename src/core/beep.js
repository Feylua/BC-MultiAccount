import { stripFeedNoise } from "./messages.js";

export function parseBeepMessage(raw) {
	try {
		return typeof window.FriendListBeepParseMessage === "function"
			? window.FriendListBeepParseMessage(raw ?? "")
			: null;
	} catch {
		return null;
	}
}

/**
 * 协议层的“聊天 Beep”判据，与 LianChat 出站过滤一致：
 * - BeepType 必须为空（"" / null / undefined）
 * - Message 必须是非空字符串
 * - MemberNumber 必须是正整数
 * 不看“是否附带房间信息”：附带房间的 Beep 同样属于聊天 Beep。
 */
export function isChatBeep(data) {
	if (!data || typeof data !== "object") return false;
	if (data.BeepType) return false;
	if (typeof data.Message !== "string" || data.Message.trim() === "") return false;
	const member = Number(data.MemberNumber);
	return Number.isFinite(member) && member > 0;
}

/**
 * Reaction 是 Message 尾部 metadata 的 messageType，不是 BeepType。
 */
export function isReactionBeep(data) {
	const parsed = parseBeepMessage(data && data.Message);
	return !!parsed && parsed.metadata?.messageType === "Reaction";
}

/**
 * 可入库 / 可计未读的 Beep：聊天 Beep 且不是 Reaction。
 */
export function isRecordableBeep(data) {
	return isChatBeep(data) && !isReactionBeep(data);
}

export function countBeep(data, seen, report) {
	if (!isRecordableBeep(data)) return;
	const parsed = parseBeepMessage(data.Message);
	const id = parsed && parsed.metadata && parsed.metadata.messageId;
	if (typeof id === "string" && id) {
		if (seen.has(id)) return;
		seen.add(id);
		if (seen.size > 2000) seen.clear();
	}
	report("whisper", data);
}

export function beepText(data) {
	const parsed = parseBeepMessage(data && data.Message);
	const text = parsed && typeof parsed.text === "string"
		? parsed.text.trim()
		: (data && typeof data.Message === "string" ? data.Message.trim() : "");
	return stripFeedNoise(text) || "(Beep)";
}

export function beepSpeaker(data) {
	const name = typeof data?.MemberName === "string" ? data.MemberName.trim() : "";
	const member = Number(data?.MemberNumber) || 0;
	if (name && member) return `${name} #${member}`;
	if (name) return name;
	if (member) return `#${member}`;
	return "";
}

export function beepPreviewText(data) {
	const speaker = beepSpeaker(data);
	const text = beepText(data);
	return speaker ? `${speaker}: ${text}` : text;
}
