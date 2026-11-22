import { getAccountInfo } from "./account-info.js";

export function messageRoom() {
	const info = getAccountInfo();
	return info.room || "大厅";
}

export function currentRoomName() {
	return getAccountInfo().room || "";
}

export function scrollChatToBottom() {
	if (typeof window.ServerPlayerIsInChatRoom === "function" && !window.ServerPlayerIsInChatRoom()) return;
	const log = document.getElementById("TextAreaChatLog");
	if (!log) return;
	log.scrollTop = log.scrollHeight;
}
