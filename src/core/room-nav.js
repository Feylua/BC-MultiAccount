import { waitFor } from "./async.js";

export function getRoomState() {
	const inRoom = typeof window.ServerPlayerIsInChatRoom === "function"
		? window.ServerPlayerIsInChatRoom()
		: false;
	const characters = window.ChatRoomData?.Character;
	const roomCharacter = window.ChatRoomCharacter;
	return {
		inRoom,
		name: window.ChatRoomData?.Name ?? "",
		space: window.ChatRoomData?.Space ?? "",
		memberCount: Array.isArray(characters)
			? characters.length
			: (Array.isArray(roomCharacter) ? roomCharacter.length : 0),
		screen: window.CurrentScreen,
		loggedIn: typeof window.ServerIsLoggedIn === "function" ? window.ServerIsLoggedIn() : false,
	};
}

/**
 * Leave the current room and return to ChatSearch.
 */
export async function leaveRoom() {
	const previousRoom = window.ChatRoomData?.Name ?? "";
	if (!window.ServerPlayerIsInChatRoom()) {
		return { ok: true, previousRoom, currentRoom: "" };
	}
	try {
		window.ChatRoomLeave();
		await window.CommonSetScreen("Online", "ChatSearch");
		await waitFor(
			() => !window.ServerPlayerIsInChatRoom() && window.CurrentScreen === "ChatSearch",
			5000,
		).catch(() => false);
		return { ok: true, previousRoom, currentRoom: "" };
	} catch (err) {
		return { ok: false, error: err?.name || "LeaveFailed", previousRoom, currentRoom: previousRoom };
	}
}

/**
 * Leave the current room (if any) and join another room by name.
 * BC does not have an atomic "switch room" call, so this is intentionally
 * best-effort and reports the previous room for a caller-driven rollback.
 */
export async function joinRoomByName(roomName) {
	const previousRoom = window.ChatRoomData?.Name ?? "";
	if (typeof roomName !== "string" || roomName.trim() === "") {
		return { ok: false, error: "EmptyRoomName", previousRoom, currentRoom: previousRoom };
	}
	const target = roomName.trim();

	if (window.ServerPlayerIsInChatRoom() && previousRoom === target) {
		return { ok: true, roomName: target, previousRoom, currentRoom: target };
	}
	if (typeof window.ServerRoomJoin !== "function") {
		return { ok: false, error: "ServerRoomJoinUnavailable", previousRoom, currentRoom: previousRoom };
	}

	try {
		if (window.ServerPlayerIsInChatRoom()) window.ChatRoomLeave();
		await window.CommonSetScreen("Online", "ChatSearch");
		const result = await window.ServerRoomJoin(target);
		if (!result?.ok) {
			return {
				ok: false,
				error: result?.error?.name || "JoinFailed",
				previousRoom,
				currentRoom: window.ChatRoomData?.Name ?? "",
			};
		}
		const synced = await waitFor(
			() => window.CurrentScreen === "ChatRoom" && window.ChatRoomData?.Name === target,
			10000,
		).catch(() => false);
		if (!synced && window.ChatRoomData?.Name !== target) {
			return {
				ok: false,
				error: "RoomSyncTimeout",
				previousRoom,
				currentRoom: window.ChatRoomData?.Name ?? "",
			};
		}
		return {
			ok: true,
			roomName: target,
			previousRoom,
			currentRoom: window.ChatRoomData?.Name ?? target,
		};
	} catch (err) {
		return {
			ok: false,
			error: err?.name || "JoinFailed",
			previousRoom,
			currentRoom: window.ChatRoomData?.Name ?? "",
		};
	}
}
