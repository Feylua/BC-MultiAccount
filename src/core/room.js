export function sameRoom(a, b) {
	const left = String(a || "").trim();
	const right = String(b || "").trim();
	return left !== "" && right !== "" && left === right;
}

export function isSameRoomChatOrAction(kind, room, activeRoom) {
	return (kind === "chat" || kind === "action") && sameRoom(room, activeRoom);
}
