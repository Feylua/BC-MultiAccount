import { VERSION } from "../constants.js";
import { waitFor } from "../core/async.js";
import { currentRoomName, messageRoom } from "../core/chat.js";
import { beepPreviewText, countBeep, isRecordableBeep } from "../core/beep.js";
import { installMessageDisplayHook } from "../core/display-hook.js";
import { handleDisplayMessage } from "../core/messages.js";
import { hookAuthInfo, hookPresence, hookRoomInfo } from "../core/mod-sdk.js";
import { createLogBatcher } from "../core/log-batcher.js";
import { makeBeepRecord, makeOutgoingBeepRecord, makeRecord } from "../core/log-record.js";
import { isSameRoomChatOrAction } from "../core/room.js";

export async function installTopHooks({ state, feed, scheduleRender, updateInfo, logger }) {
	const topBatcher = createLogBatcher((records) => {
		const top = state.accounts.find((a) => a.top);
		logger?.ingest(records, top?.account, top?.member, top?.name);
	});
	window.addEventListener("beforeunload", () => topBatcher.flush());
	const sdk = await waitFor(() => window.bcModSdk, 20000).catch(() => null);
	if (!sdk) {
		console.warn("[BC Multi] bcModSdk not found; unread counting for account 1 is disabled");
		return;
	}

	const mod = sdk.registerMod({
		name: "BCMultiAccount",
		fullName: "BC Multi-Account Switcher",
		version: VERSION,
	}, { allowReplace: true });
	state.mod = mod;

	hookPresence(mod, () => updateInfo(true));
	hookAuthInfo(mod, () => updateInfo(true));
	hookRoomInfo(mod, () => updateInfo(true));

	function installDisplayCapture() {
		installMessageDisplayHook((data, sender, msg, metadata) => {
			const top = state.accounts.find((a) => a.top);
			const record = makeRecord({
				data,
				sender,
				msg,
				metadata,
				room: currentRoomName(),
				player: window.Player,
			});
			if (record) topBatcher.push(record);

			if (state.topActive) return;
			handleDisplayMessage(data, sender, msg, metadata, state.topSeen, (kind, text, room) => {
				if (!top) return;
				const active = state.accounts.find((a) => a.key === state.activeKey);
				// Same-room chat/action is already visible in the foreground account.
				if (isSameRoomChatOrAction(kind, room, active?.room)) return;
				top.unread[kind] += 1;
				feed.push(room, text);
				scheduleRender();
			});
		});
	}

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
			const top = state.accounts.find((a) => a.top);
			if (isRecordableBeep(data)) {
				const record = makeBeepRecord({ data, player: window.Player });
				if (record) topBatcher.push(record);
				if (!state.topActive) {
					countBeep(data, state.topSeen, (kind, beep) => {
						if (!top) return;
						top.unread[kind] += 1;
						feed.push(messageRoom(), beepPreviewText(beep));
						scheduleRender();
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
				if (record) topBatcher.push(record);
			}
			return next(args);
		});
	}

	const drawProcess = await waitFor(
		() => typeof window.DrawProcess === "function" ? window.DrawProcess : null,
		30000,
	).catch(() => null);
	if (drawProcess) {
		// The top account keeps its socket/timers alive but skips drawing
		// while a child iframe is visible.
		mod.hookFunction("DrawProcess", 5, (args, next) => {
			if (!state.topActive) return;
			return next(args);
		});
	}

	return mod;
}
