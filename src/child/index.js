import { VERSION } from "../constants.js";
import { MSG } from "../protocol.js";
import { waitFor } from "../core/async.js";
import { getAccountInfo } from "../core/account-info.js";
import { leaveFullscreen } from "../core/fullscreen.js";
import { digitFromEvent } from "../core/input.js";
import { currentRoomName, messageRoom, scrollChatToBottom } from "../core/chat.js";
import { handleDisplayMessage } from "../core/messages.js";
import { beepPreviewText, countBeep, isRecordableBeep } from "../core/beep.js";
import { installMessageDisplayHook } from "../core/display-hook.js";
import { hookAuthInfo, hookPresence, hookRoomInfo } from "../core/mod-sdk.js";
import { installAudioPolicy } from "../core/audio.js";
import { installReconnect } from "../core/reconnect.js";
import { createLogBatcher } from "../core/log-batcher.js";
import { makeBeepRecord, makeOutgoingBeepRecord, makeRecord } from "../core/log-record.js";
import { getRoomState, joinRoomByName, leaveRoom } from "../core/room-nav.js";
import { createChildBridge } from "./bridge.js";

export function initChild(id) {
	const state = {
		id,
		active: false,
		seen: new Set(),
		lastInfoKey: "",
		mod: null,
		reconnect: null,
		audio: null,
		soundMode: "mute",
		pendingConfig: null,
		logBatcher: null,
	};
	const bridge = createChildBridge(id);
	const post = bridge.post;
	const logBatcher = createLogBatcher((records) => post(MSG.LOG_BATCH, { records }));
	state.logBatcher = logBatcher;
	window.addEventListener("beforeunload", () => logBatcher.flush());

	function publishInfo(force = false) {
		const info = getAccountInfo();
		const key = [
			info.loggedIn,
			info.online,
			info.name,
			info.account,
			info.memberNumber,
			info.inRoom,
			info.room,
			info.roomSpace,
			info.roomMemberCount,
		].join("\u0001");
		if (!force && key === state.lastInfoKey) return;
		state.lastInfoKey = key;
		post(MSG.ACCOUNT, info);
	}

	function installDisplayCapture() {
		installMessageDisplayHook((data, sender, msg, metadata) => {
			const record = makeRecord({
				data,
				sender,
				msg,
				metadata,
				room: currentRoomName(),
				player: window.Player,
			});
			if (record) state.logBatcher?.push(record);

			if (state.active) return;
			handleDisplayMessage(data, sender, msg, metadata, state.seen, (kind, text, room, id, senderId) => {
				post(MSG.UNREAD, { kind, text, room, id, sender: senderId });
			});
		});
	}

	function applyConfig(data) {
		state.pendingConfig = data;
		state.reconnect?.configure({
			reconnect: data.reconnect !== false,
			remember: data.remember !== false,
		});
		state.soundMode = data.sound === "all" || data.sound === "notification" ? data.sound : "mute";
		state.audio?.setMode(state.soundMode);
	}

	const reconnectTransport = {
		requestCredential(account, reqId) {
			post(MSG.CREDENTIAL_REQUEST, { account, reqId });
		},
		saveCredential(account, password) {
			post(MSG.CREDENTIAL_SAVE, { account, password });
		},
		notifyAuth(phase, reason, attempts) {
			post(MSG.AUTH, { phase, reason, attempts });
		},
		notifyRateLimited() {
			post(MSG.RATE_LIMITED);
		},
	};

	bridge.listen((data) => {
		if (data.type === MSG.ROOM_STATE_REQUEST) {
			post(MSG.ROOM_STATE, { reqId: data.reqId, ...getRoomState() });
			return;
		}
		if (data.type === MSG.ROOM_JOIN) {
			const reqId = data.reqId;
			joinRoomByName(data.roomName)
				.then((result) => {
					post(MSG.ROOM_JOIN_RESULT, { reqId, ...result });
					publishInfo(true);
				})
				.catch((err) => {
					post(MSG.ROOM_JOIN_RESULT, {
						reqId,
						ok: false,
						error: err?.name || "JoinFailed",
					});
					publishInfo(true);
				});
			return;
		}
		if (data.type === MSG.ROOM_LEAVE) {
			const reqId = data.reqId;
			leaveRoom()
				.then((result) => {
					post(MSG.ROOM_LEAVE_RESULT, { reqId, ...result });
					publishInfo(true);
				})
				.catch((err) => {
					post(MSG.ROOM_LEAVE_RESULT, {
						reqId,
						ok: false,
						error: err?.name || "LeaveFailed",
					});
					publishInfo(true);
				});
			return;
		}
		if (data.type === MSG.SET_ACTIVE) {
			state.active = !!data.active;
			if (state.active) {
				state.seen.clear();
			} else if (document.fullscreenElement) {
				leaveFullscreen();
			}
		} else if (data.type === MSG.SCROLL_BOTTOM) {
			setTimeout(scrollChatToBottom, 80);
		} else if (data.type === MSG.CONFIG) {
			applyConfig(data);
		} else if (data.type === MSG.CREDENTIAL) {
			state.reconnect?.resolveCredential(data.reqId, {
				password: data.password,
				reason: data.reason,
				retryIn: data.retryIn,
			});
		} else if (data.type === MSG.RECONNECT_NOW) {
			state.reconnect?.retryNow();
		} else if (data.type === MSG.LOG_FLUSH) {
			state.logBatcher?.flush();
		}
	});

	// Alt+1..9 works even when the iframe has keyboard focus.
	window.addEventListener("keydown", (event) => {
		if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		const n = digitFromEvent(event);
		if (n === null) return;
		event.preventDefault();
		event.stopPropagation();
		post(MSG.SWITCH_REQUEST, { index: n });
	}, true);

	(async () => {
		const sdk = await waitFor(() => window.bcModSdk, 20000).catch(() => null);
		if (!sdk) {
			post(MSG.READY, getAccountInfo());
			post(MSG.ERROR, { message: "bcModSdk not found" });
			setInterval(() => post(MSG.ACCOUNT, getAccountInfo()), 2000);
			return;
		}

		const mod = sdk.registerMod({
			name: "BCMultiAccount",
			fullName: "BC Multi-Account Switcher",
			version: VERSION,
		}, { allowReplace: true });
		state.mod = mod;

		state.audio = installAudioPolicy(mod, state.soundMode);
		state.reconnect = installReconnect(mod, reconnectTransport);
		if (state.pendingConfig) applyConfig(state.pendingConfig);

		hookPresence(mod, () => publishInfo(true));
		hookAuthInfo(mod, () => publishInfo(true));
		hookRoomInfo(mod, () => publishInfo(true));

		const registerHandler = await waitFor(
			() => typeof window.ChatRoomRegisterMessageHandler === "function"
				? window.ChatRoomRegisterMessageHandler
				: null,
			30000,
		).catch(() => null);
		if (registerHandler) {
			installDisplayCapture();
		} else {
			console.warn("[BC Multi] ChatRoomRegisterMessageHandler not found; chat unread capture disabled");
		}

		const serverAccountBeep = await waitFor(
			() => typeof window.ServerAccountBeep === "function" ? window.ServerAccountBeep : null,
			30000,
		).catch(() => null);
		if (serverAccountBeep) {
			mod.hookFunction("ServerAccountBeep", 5, (args, next) => {
				const data = args[0];
				if (isRecordableBeep(data)) {
					const record = makeBeepRecord({ data, player: window.Player });
					if (record) state.logBatcher?.push(record);
					if (!state.active) {
						countBeep(data, state.seen, (kind, beep) => {
							post(MSG.UNREAD, { kind, text: beepPreviewText(beep), room: messageRoom() });
						});
					}
				}
				return next(args);
			});
		}

		const serverSend = await waitFor(
			() => typeof window.ServerSend === "function" ? window.ServerSend : null,
			30000,
		).catch(() => null);
		if (serverSend) {
			// Capture at the lowest common send point so beeps sent from the
			// friend list, slash commands, or other mods are all included.
			mod.hookFunction("ServerSend", 5, (args, next) => {
				const [message, data] = args;
				if (message === "AccountBeep" && isRecordableBeep(data)) {
					const record = makeOutgoingBeepRecord({
						target: data.MemberNumber,
						msg: data.Message,
						player: window.Player,
					});
					if (record) state.logBatcher?.push(record);
				}
				return next(args);
			});
		}

		const drawProcess = await waitFor(
			() => typeof window.DrawProcess === "function" ? window.DrawProcess : null,
			30000,
		).catch(() => null);
		if (drawProcess) {
			// Hidden accounts keep timers/sockets alive but skip drawing.
			mod.hookFunction("DrawProcess", 5, (args, next) => {
				if (!state.active) return;
				return next(args);
			});
		}

		post(MSG.READY, getAccountInfo());
		publishInfo(true);

		setInterval(() => {
			publishInfo();
			post(MSG.ALIVE);
		}, 2000);
	})();
}
