export function hookPresence(mod, publish) {
	for (const name of ["ServerConnect", "ServerDisconnect"]) {
		if (typeof window[name] !== "function") continue;
		mod.hookFunction(name, 5, (args, next) => {
			const result = next(args);
			setTimeout(() => {
				try {
					publish();
				} catch {
					/* ignore */
				}
			}, 0);
			return result;
		});
	}
}

export function hookAuthInfo(mod, publish) {
	if (typeof window.LoginResponse !== "function") return;
	mod.hookFunction("LoginResponse", 5, (args, next) => {
		const result = next(args);
		// Relog restores the previous screen asynchronously; give it a moment
		// before recomputing the account's online state.
		setTimeout(() => {
			try {
				publish();
			} catch {
				/* ignore */
			}
		}, 300);
		return result;
	});
}

export function hookRoomInfo(mod, publish) {
	if (typeof window.ChatRoomSync === "function") {
		mod.hookFunction("ChatRoomSync", 5, (args, next) => {
			const result = next(args);
			Promise.resolve(result).then(
				() => {
					try {
						publish();
					} catch {
						/* ignore */
					}
				},
				() => {
					try {
						publish();
					} catch {
						/* ignore */
					}
				},
			);
			return result;
		});
	}
	if (typeof window.ChatRoomLeave === "function") {
		mod.hookFunction("ChatRoomLeave", 5, (args, next) => {
			const result = next(args);
			setTimeout(() => {
				try {
					publish();
				} catch {
					/* ignore */
				}
			}, 0);
			return result;
		});
	}
}
