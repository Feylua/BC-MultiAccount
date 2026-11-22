import { SETTINGS_KEY } from "../constants.js";

export const SOUND_MODES = Object.freeze(["all", "notification", "mute"]);

export function defaultSettings() {
	return {
		autoReconnect: true,
		sounds: {
			active: "all",
			background: "mute",
		},
		log: {
			enabled: true,
		},
	};
}

function normalizeSoundMode(value, fallback) {
	return SOUND_MODES.includes(value) ? value : fallback;
}

export function normalizeSettings(raw) {
	const fallback = defaultSettings();
	const data = raw && typeof raw === "object" ? raw : {};
	const sounds = data.sounds && typeof data.sounds === "object" ? data.sounds : {};
	const log = data.log && typeof data.log === "object" ? data.log : {};
	return {
		autoReconnect: typeof data.autoReconnect === "boolean" ? data.autoReconnect : fallback.autoReconnect,
		sounds: {
			active: normalizeSoundMode(sounds.active, fallback.sounds.active),
			background: normalizeSoundMode(sounds.background, fallback.sounds.background),
		},
		log: {
			enabled: typeof log.enabled === "boolean" ? log.enabled : fallback.log.enabled,
		},
	};
}

export function loadSettings() {
	try {
		return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null"));
	} catch {
		return normalizeSettings(null);
	}
}

export function saveSettings(settings) {
	try {
		localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
	} catch {
		/* ignore */
	}
}
