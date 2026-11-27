export function canFollowRooms(active, target, busy = false) {
	if (busy || !active || !target) return false;
	if (active.key === target.key) return false;
	if (!active.loggedIn || !active.online || !target.loggedIn || !target.online) return false;
	if (!target.inRoom || !target.room) return false;

	// The foreground account may be in the lobby (no room). It can still follow
	// the background account into its room.
	if (!active.inRoom || !active.room) return true;
	return active.room !== target.room;
}

export function canSwapRooms(active, target, busy = false) {
	if (!canFollowRooms(active, target, busy)) return false;
	// In the lobby there is no foreground room to exchange. The background
	// account just leaves its room; see the coordinator's lobby branch.
	if (!active.inRoom || !active.room) return true;
	// If the foreground room only contains the foreground account, leaving it
	// may destroy the room before the background account can enter.
	return Number(active.roomMemberCount) > 1;
}
