import { HASH_KEY } from "../constants.js";
import { MSG } from "../protocol.js";
import { getAccountInfo } from "../core/account-info.js";
import { digitFromEvent } from "../core/input.js";
import { installAudioPolicy } from "../core/audio.js";
import { installReconnect, normalizeAccountName, RC } from "../core/reconnect.js";
import { createParentState } from "./state.js";
import { createFeed } from "./feed.js";
import { createToolbar } from "./toolbar.js";
import { createAccounts } from "./accounts.js";
import { createParentBridge } from "./bridge.js";
import { installTopHooks } from "./top-hooks.js";
import { loadSettings, saveSettings } from "./settings.js";
import { createSettingsDialog } from "./settings-dialog.js";
import { createLogger } from "./logger.js";
import { createLogDialog } from "./log-dialog.js";

export function initParent() {
	const state = createParentState();
	const settings = loadSettings();
	state.settings = settings;
	const feed = createFeed(state);
	const logger = createLogger({ state, settings });
	state.logger = logger;
	const logDialog = createLogDialog({ logger });
	state.logDialog = logDialog;
	let accounts;
	let settingsDialog;

	function configureAccount(acc) {
		const sound = acc.key === state.activeKey ? settings.sounds.active : settings.sounds.background;
		if (acc.top) {
			state.topAudio?.setMode(sound);
			state.topReconnect?.configure({
				reconnect: settings.autoReconnect,
				remember: true,
			});
		} else if (acc.frame) {
			accounts?.postTo(acc, {
				type: MSG.CONFIG,
				reconnect: settings.autoReconnect,
				remember: true,
				sound,
			});
		}
	}

	function configureAllAccounts() {
		for (const account of state.accounts) configureAccount(account);
	}

	function applySettings() {
		saveSettings(settings);
		configureAllAccounts();
	}

	settingsDialog = createSettingsDialog({
		settings,
		onChange: applySettings,
		logger,
		logDialog,
	});

	const toolbar = createToolbar({
		state,
		feed,
		handlers: {
			onSwitch: (key) => accounts.switchTo(key),
			onAdd: () => accounts.add(),
			onRemove: (key) => accounts.remove(key),
			onSettings: () => settingsDialog.open(),
		},
	});

	accounts = createAccounts({
		state,
		render: () => toolbar.render(),
		configureAccount,
		afterSwitch: () => feed.render(),
	});

	function scheduleRender() {
		if (state.renderTimer) return;
		state.renderTimer = setTimeout(() => {
			state.renderTimer = null;
			toolbar.render();
		}, 80);
	}

	function topTransport() {
		return {
			requestCredential(account, reqId) {
				if (Date.now() < state.pausedUntil) {
					state.topReconnect?.resolveCredential(reqId, {
						password: null,
						reason: "paused",
						retryIn: state.pausedUntil - Date.now() + 1000,
					});
					return;
				}
				const password = state.credentials.get(normalizeAccountName(account)) || null;
				state.topReconnect?.resolveCredential(reqId, {
					password,
					reason: password ? undefined : "missing",
				});
			},
			saveCredential(account, password) {
				const key = normalizeAccountName(account);
				if (key && typeof password === "string" && password) {
					state.credentials.set(key, password);
				}
			},
			notifyAuth(phase, reason, attempts) {
				const top = state.accounts.find((a) => a.top);
				if (top) {
					top.auth = {
						phase: typeof phase === "string" ? phase : "idle",
						reason: typeof reason === "string" ? reason : "",
						attempts: Number(attempts) || 0,
					};
				}
				if (phase === "idle") state.pausedUntil = 0;
				scheduleRender();
			},
			notifyRateLimited() {
				state.pausedUntil = Date.now() + RC.GLOBAL_PAUSE_MS + Math.random() * RC.GLOBAL_PAUSE_JITTER_MS;
			},
		};
	}

	const bridge = createParentBridge({
		state,
		accounts,
		feed,
		scheduleRender,
		configureAccount,
		logger,
	});

	function updateTopInfo(force = false) {
		const top = state.accounts.find((a) => a.top);
		if (!top) return;
		const info = getAccountInfo();
		const key = [
			info.loggedIn,
			info.online,
			info.name,
			info.account,
			info.memberNumber,
			info.room,
		].join("\u0001");
		if (!force && key === state.topInfoKey) return;
		state.topInfoKey = key;
		const previousRoom = top.room;
		accounts.applyInfo(top, info);
		if (state.topActive) {
			if (previousRoom !== top.room) {
				feed.clearRoom(previousRoom);
				feed.clearRoom(top.room);
			} else {
				feed.render();
			}
		}
		scheduleRender();
	}

	function installKeyboard() {
		// Alt+1..9 in the top window.
		window.addEventListener("keydown", (event) => {
			if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
			const n = digitFromEvent(event);
			if (n === null) return;
			const target = state.accounts[n - 1];
			if (!target) return;
			event.preventDefault();
			event.stopPropagation();
			accounts.switchTo(target.key);
		}, true);
	}

	function startInfoPoll() {
		updateTopInfo(true);
		setInterval(() => updateTopInfo(), 2000);
	}

	function start() {
		if (state.started) return;
		state.started = true;

		// If an iframe URL was somehow opened as the top page, drop our hash.
		try {
			if (location.hash.includes(HASH_KEY + "=")) {
				history.replaceState(null, "", location.pathname + location.search);
			}
		} catch {
			/* ignore */
		}

		toolbar.mount();
		accounts.addTop();
		settingsDialog.mount();
		logDialog.mount();
		toolbar.render();

		installTopHooks({ state, feed, scheduleRender, updateInfo: updateTopInfo, logger })
			.then((mod) => {
				if (!mod) return;
				state.topAudio = installAudioPolicy(mod, state.topActive ? settings.sounds.active : settings.sounds.background);
				state.topReconnect = installReconnect(mod, topTransport());
				configureAllAccounts();
			})
			.catch((err) => console.error("[BC Multi] top hooks failed", err));

		bridge.listen();
		startInfoPoll();
		installKeyboard();
		console.info("[BC Multi] loaded. Click + to add an account, Alt+1..9 to switch.");
	}

	if (document.body) {
		start();
	} else {
		document.addEventListener("DOMContentLoaded", start, { once: true });
	}
}
