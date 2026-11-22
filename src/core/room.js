export function sameRoom(a, b) {
	const left = String(a || "").trim();
	const right = String(b || "").trim();
	return left !== "" && right !== "" && left === right;
}

export function isSameRoomChatOrAction(kind, room, activeRoom) {
	// BC distinguishes Action and Activity, but both are action-like chat rows.
	// Chat works while Activity was still counted in the wild, so include both.
	return (kind === "chat" || kind === "action" || kind === "activity")
		&& sameRoom(room, activeRoom);
}
