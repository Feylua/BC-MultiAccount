export const RC = Object.freeze({
	MAX_ATTEMPTS: 5,
	BACKOFF_MS: [2000, 5000, 15000, 45000],
	ATTEMPT_TIMEOUT_MS: 15000,
	CREDENTIAL_TIMEOUT_MS: 2000,
	GLOBAL_PAUSE_MS: 30000,
	GLOBAL_PAUSE_JITTER_MS: 15000,
});

export function normalizeAccountName(name) {
	return typeof name === "string" ? name.trim().toUpperCase().slice(0, 40) : "";
}

export function installReconnect(mod, transport) {
	const rc = {
		enabled: true,
		remember: true,
		authedOnce: false,
		blocked: false,
		busy: false,
		attempts: 0,
		timerId: null,
		seq: 0,
		reqSeq: 0,
		phase: "idle",
		pending: null,
		lastAttempt: null,
	};

	function say(phase, reason = "") {
		if (rc.phase === phase && !reason) return;
		rc.phase = phase;
		transport.notifyAuth(phase, reason, rc.attempts);
	}

	function clearTimer() {
		if (rc.timerId !== null) {
			clearTimeout(rc.timerId);
			rc.timerId = null;
		}
	}

	function schedule(delay) {
		clearTimer();
		const id = ++rc.seq;
		rc.timerId = setTimeout(() => {
			if (id !== rc.seq) return;
			rc.timerId = null;
			tryRelog();
		}, Math.max(0, delay));
	}

	function halt(phase, reason) {
		rc.blocked = true;
		rc.busy = false;
		clearTimer();
		say(phase, reason);
	}

	async function requestCredential(account) {
		rc.busy = true;
		say("asking");
		const reqId = ++rc.reqSeq;
		const reply = await new Promise((resolve) => {
			rc.pending = { reqId, resolve };
			transport.requestCredential(account, reqId);
			setTimeout(() => {
				if (rc.pending && rc.pending.reqId === reqId) {
					rc.pending = null;
					resolve({ password: null, reason: "timeout" });
				}
			}, RC.CREDENTIAL_TIMEOUT_MS);
		});
		rc.busy = false;
		return reply || { password: null, reason: "missing" };
	}

	async function tryRelog() {
		if (!rc.enabled || rc.blocked || rc.busy || !rc.authedOnce) return;
		if (window.CurrentScreen !== "Relog") {
			say("idle");
			return;
		}
		const socket = window.ServerSocket;
		if (!window.ServerIsConnected || !socket || !socket.connected || window.LoginSubmitted) {
			say("waiting");
			return;
		}
		if (rc.attempts >= RC.MAX_ATTEMPTS) {
			halt("manual", "exhausted");
			return;
		}

		const account = normalizeAccountName(window.Player?.AccountName);
		if (!account) {
			say("waiting");
			return;
		}

		rc.attempts += 1;
		const reply = await requestCredential(account);
		if (!rc.enabled || rc.blocked) return;

		if (reply.reason === "paused") {
			say("waiting", "global-pause");
			schedule(reply.retryIn || RC.GLOBAL_PAUSE_MS);
			return;
		}
		if (typeof reply.password !== "string" || !reply.password) {
			halt("manual", reply.reason || "no-credential");
			return;
		}
		if (typeof window.ServerAccountPasswordRegex !== "undefined"
			&& !window.ServerAccountPasswordRegex.test(reply.password)) {
			halt("manual", "invalid-credential");
			return;
		}

		say("logging-in");
		rc.lastAttempt = { account, password: reply.password };
		window.LoginDoLogin(account, reply.password);
		schedule(RC.ATTEMPT_TIMEOUT_MS);
	}

	function hook(name, priority, fn) {
		if (typeof window[name] !== "function") {
			console.warn(`[BC Multi] reconnect: ${name} not found, skipped`);
			return;
		}
		mod.hookFunction(name, priority, fn);
	}

	hook("LoginDoLogin", 11, (args, next) => {
		rc.lastAttempt = {
			account: normalizeAccountName(args[0]),
			password: typeof args[1] === "string" ? args[1] : "",
		};
		return next(args);
	});

	hook("LoginResponse", 11, (args, next) => {
		const result = next(args);
		const payload = args[0];

		if (typeof payload === "string") {
			clearTimer();
			if (payload === "ErrorDuplicatedLogin") {
				halt("duplicate", payload);
			} else if (payload === "ErrorRateLimited") {
				transport.notifyRateLimited();
				halt("manual", "rate-limited");
			} else if (rc.attempts >= 2) {
				halt("manual", payload);
			} else if (rc.authedOnce && !rc.blocked) {
				const i = Math.min(rc.attempts, RC.BACKOFF_MS.length - 1);
				schedule(RC.BACKOFF_MS[i] + Math.random() * 1000);
			}
			rc.lastAttempt = null;
			return result;
		}

		const wasRelog = rc.phase === "logging-in";
		const attempt = rc.lastAttempt;
		rc.lastAttempt = null;

		rc.authedOnce = true;
		rc.blocked = false;
		rc.busy = false;
		rc.attempts = 0;
		clearTimer();
		say("idle");

		if (!wasRelog && rc.remember && attempt && attempt.account && attempt.password) {
			transport.saveCredential(attempt.account, attempt.password);
		}
		return result;
	});

	hook("ServerConnect", 5, (args, next) => {
		const result = next(args);
		if (rc.authedOnce && !rc.blocked && rc.timerId === null) schedule(300);
		return result;
	});

	hook("ServerDisconnect", 11, (args, next) => {
		const [err, force] = args;
		const result = next(args);
		if (!rc.authedOnce) return result;

		rc.attempts = 0;
		if (!rc.blocked) say("waiting");

		if (force && err !== "ErrorDuplicatedLogin" && err !== "ErrorRateLimited") {
			setTimeout(() => {
				if (rc.authedOnce && !rc.blocked && !window.ServerIsConnected
					&& typeof window.ServerInit === "function") {
					window.ServerInit();
				}
			}, 5000);
		}
		return result;
	});

	hook("RelogRun", 5, (args, next) => {
		if (rc.authedOnce && !rc.blocked && !rc.busy && rc.timerId === null) schedule(0);
		return next(args);
	});

	hook("RelogExit", 11, (args, next) => {
		halt("off", "user-left");
		rc.authedOnce = false;
		return next(args);
	});

	return {
		configure(options) {
			if (typeof options.reconnect === "boolean") {
				rc.enabled = options.reconnect;
				if (rc.enabled) {
					rc.blocked = false;
					if (rc.phase === "off") rc.phase = "idle";
				} else {
					halt("off", "config");
				}
			}
			if (typeof options.remember === "boolean") rc.remember = options.remember;
		},
		retryNow() {
			rc.blocked = false;
			rc.attempts = 0;
			say("waiting", "manual-retry");
			schedule(0);
		},
		resolveCredential(reqId, reply) {
			if (!rc.pending || rc.pending.reqId !== reqId) return;
			const pending = rc.pending;
			rc.pending = null;
			pending.resolve(reply);
		},
		get phase() {
			return rc.phase;
		},
	};
}
