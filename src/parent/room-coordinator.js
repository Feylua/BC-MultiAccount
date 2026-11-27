import { MSG } from "../protocol.js";
import { getRoomState, joinRoomByName, leaveRoom } from "../core/room-nav.js";
import { canFollowRooms, canSwapRooms } from "../core/room-rules.js";

function withTimeout(promise, ms, label) {
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			console.warn(`[BC Multi] room ${label} timeout`);
			resolve(null);
		}, ms);
		Promise.resolve(promise).then((value) => {
			clearTimeout(timer);
			resolve(value);
		}, (err) => {
			clearTimeout(timer);
			console.warn(`[BC Multi] room ${label} failed`, err);
			resolve(null);
		});
	});
}

export function createRoomCoordinator({ state, accounts, feed, onChange }) {
	let seq = 0;
	const pending = new Map();

	function activeAccount() {
		return state.accounts.find((a) => a.key === state.activeKey);
	}

	function notify(text, level = "warning") {
		try {
			const toast = window.ToastManager;
			if (toast && typeof toast[level] === "function") {
				toast[level](text, { category: "BCMultiAccount" });
				return;
			}
		} catch {
			/* ignore */
		}
		if (level === "error" || level === "warning") window.alert(text);
		else console.info(`[BC Multi] ${text}`);
	}

	function requestState(acc) {
		if (!acc) return Promise.resolve(null);
		if (acc.top) return Promise.resolve(getRoomState());
		const reqId = `room-state-${++seq}`;
		return withTimeout(new Promise((resolve) => {
			const timer = setTimeout(() => {
				pending.delete(reqId);
				resolve(null);
			}, 4000);
			pending.set(reqId, { accKey: acc.key, resolve, timer });
			accounts.postTo(acc, { type: MSG.ROOM_STATE_REQUEST, reqId });
		}), 4500, "state");
	}

	function requestJoin(acc, roomName) {
		if (!acc || !roomName) return Promise.resolve(null);
		if (acc.top) return withTimeout(joinRoomByName(roomName), 30000, "join");
		const reqId = `room-join-${++seq}`;
		return withTimeout(new Promise((resolve) => {
			const timer = setTimeout(() => {
				pending.delete(reqId);
				resolve(null);
			}, 30000);
			pending.set(reqId, { accKey: acc.key, resolve, timer });
			accounts.postTo(acc, { type: MSG.ROOM_JOIN, reqId, roomName });
		}), 31000, "join");
	}

	function requestLeave(acc) {
		if (!acc) return Promise.resolve(null);
		if (acc.top) return withTimeout(leaveRoom(), 15000, "leave");
		const reqId = `room-leave-${++seq}`;
		return withTimeout(new Promise((resolve) => {
			const timer = setTimeout(() => {
				pending.delete(reqId);
				resolve(null);
			}, 15000);
			pending.set(reqId, { accKey: acc.key, resolve, timer });
			accounts.postTo(acc, { type: MSG.ROOM_LEAVE, reqId });
		}), 16000, "leave");
	}

	function handleMessage(acc, data) {
		if (!data || (data.type !== MSG.ROOM_STATE
			&& data.type !== MSG.ROOM_JOIN_RESULT
			&& data.type !== MSG.ROOM_LEAVE_RESULT)) {
			return false;
		}
		const entry = pending.get(data.reqId);
		if (!entry || entry.accKey !== acc.key) return true;
		pending.delete(data.reqId);
		clearTimeout(entry.timer);
		entry.resolve(data);
		return true;
	}

	function canFollow(target) {
		return canFollowRooms(activeAccount(), target, state.roomBusy);
	}

	function canSwap(target) {
		return canSwapRooms(activeAccount(), target, state.roomBusy);
	}

	function applyState(acc, roomState) {
		if (!acc || !roomState) return;
		acc.inRoom = !!roomState.inRoom;
		acc.room = roomState.name || "";
		acc.roomSpace = roomState.space || "";
		acc.roomMemberCount = Number(roomState.memberCount) || 0;
	}

	async function applyRoom(acc, fallbackRoom) {
		const fresh = await requestState(acc);
		if (fresh) {
			applyState(acc, fresh);
		} else {
			acc.inRoom = !!fallbackRoom;
			acc.room = fallbackRoom || "";
			if (!fallbackRoom) {
				acc.roomSpace = "";
				acc.roomMemberCount = 0;
			}
		}
		onChange?.();
	}

	async function rollback(acc, roomName) {
		if (!acc || !roomName) return false;
		const result = await requestJoin(acc, roomName);
		if (!result || !result.ok) return false;
		await applyRoom(acc, result.currentRoom || roomName);
		return true;
	}

	async function follow(target) {
		const active = activeAccount();
		if (!canFollow(target)) return;
		state.roomBusy = true;
		onChange?.();
		try {
			const [a, b] = await Promise.all([requestState(active), requestState(target)]);
			if (!a || !b?.inRoom || !b.name || (a.inRoom && (!a.name || a.name === b.name))) {
				notify("房间状态已变化，请重试。", "warning");
				return;
			}
			const result = await requestJoin(active, b.name);
			if (!result || !result.ok) {
				if (a.inRoom) await rollback(active, a.name);
				notify(`进入房间失败：${result?.error || "未知错误"}`, "error");
				return;
			}
			await applyRoom(active, result.currentRoom || b.name);
			notify(`已进入 ${b.name}。`, "info");
		} finally {
			state.roomBusy = false;
			onChange?.();
		}
	}

	async function swap(target) {
		const active = activeAccount();
		if (!canSwap(target)) return;
		state.roomBusy = true;
		onChange?.();
		try {
			const [a, b] = await Promise.all([requestState(active), requestState(target)]);
			if (!a || !b?.inRoom || !b.name || (a.inRoom && (!a.name || a.name === b.name))) {
				notify("房间状态已变化，请重试。", "warning");
				return;
			}

			// The foreground account is in the lobby. Move it into the target room
			// first, then make the background account leave its room.
			if (!a.inRoom) {
				const entered = await requestJoin(active, b.name);
				if (!entered || !entered.ok) {
					notify(`前台账号进入 ${b.name} 失败：${entered?.error || "未知错误"}`, "error");
					return;
				}
				await applyRoom(active, entered.currentRoom || b.name);

				const left = await requestLeave(target);
				if (!left || !left.ok) {
					// Put the foreground account back into the lobby; the background
					// account may still be in its room.
					await requestLeave(active);
					await applyRoom(active, "");
					notify(`后台账号离开房间失败：${left?.error || "未知错误"}`, "error");
					return;
				}
				await applyRoom(target, "");
				notify(`已交换：${b.name} 由前台接管，${target.name} 已离开房间。`, "info");
				return;
			}

			if ((Number(a.memberCount) || 0) <= 1) {
				notify("前台房间只有你一个人，交换可能导致房间消失，已取消。", "warning");
				return;
			}

			// Foreground always moves first. The background account remains in its
			// room until the foreground has safely arrived.
			const first = await requestJoin(active, b.name);
			if (!first || !first.ok) {
				await rollback(active, a.name);
				notify(`前台账号进入 ${b.name} 失败：${first?.error || "未知错误"}`, "error");
				return;
			}
			await applyRoom(active, first.currentRoom || b.name);

			const second = await requestJoin(target, a.name);
			if (second && second.ok) {
				await applyRoom(target, second.currentRoom || a.name);
				notify(`已交换：${a.name} ⇄ ${b.name}。`, "info");
				return;
			}

			// Roll back the background account first: the foreground is currently in
			// its room, so that room is guaranteed to exist.
			const backgroundBack = await rollback(target, b.name);
			const foregroundBack = await rollback(active, a.name);
			if (backgroundBack && foregroundBack) {
				notify(`交换失败，已恢复原房间：${second?.error || "未知错误"}`, "error");
			} else {
				notify(
					`交换部分失败：后台账号${backgroundBack ? "已回到" : "未能回到"} ${b.name}；` +
					`前台账号${foregroundBack ? "已回到" : "未能回到"} ${a.name}。请手动检查。`,
					"error",
				);
			}
		} finally {
			state.roomBusy = false;
			onChange?.();
		}
	}

	return {
		handleMessage,
		canFollow,
		canSwap,
		follow,
		swap,
		requestState,
		requestJoin,
	};
}
