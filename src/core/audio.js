function isNotificationSound(src) {
	return /(?:^|\/)BeepAlarm\.mp3(?:\?|$)/i.test(String(src || ""));
}

export function installAudioPolicy(mod, initialMode = "all") {
	let mode = initialMode;

	function setMode(nextMode) {
		mode = nextMode === "notification" || nextMode === "mute" ? nextMode : "all";
		if (mode !== "all") {
			try {
				window.AudioBackgroundMusicStop?.();
				window.AudioDialogStop?.();
			} catch {
				/* ignore */
			}
		}
	}

	function hook(name, callback) {
		if (typeof window[name] !== "function") return;
		mod.hookFunction(name, 5, callback);
	}

	hook("AudioPlayInstantSound", (args, next) => {
		if (mode === "mute") return;
		if (mode === "notification" && !isNotificationSound(args[0])) return;
		return next(args);
	});

	hook("AudioDialogStart", (args, next) => {
		if (mode !== "all") return;
		return next(args);
	});

	hook("AudioBackgroundMusicPlay", (args, next) => {
		if (mode !== "all") return;
		return next(args);
	});

	hook("AudioBackgroundMusicSetVolume", (args, next) => {
		if (mode !== "all") {
			try {
				window.AudioBackgroundMusicStop?.();
			} catch {
				/* ignore */
			}
			return;
		}
		return next(args);
	});

	return { setMode, get mode() { return mode; } };
}
