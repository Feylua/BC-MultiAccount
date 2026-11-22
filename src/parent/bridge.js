import { CHANNEL } from "../constants.js";
import { MSG } from "../protocol.js";
import { isUnreadKind } from "../core/messages.js";
import { normalizeAccountName, RC } from "../core/reconnect.js";

export function createParentBridge({ state, accounts, feed, scheduleRender, configureAccount, logger }) {
	function listen() {
		window.addEventListener("message", (event) => {
			const data = event.data;
			if (!data || data.channel !== CHANNEL) return;
			const acc = state.accounts.find((a) => a.frame && a.frame.contentWindow === event.source);
			if (!acc) return;

			switch (data.type) {
				case MSG.READY: {
					acc.ready = true;
					accounts.applyInfo(acc, data);
					accounts.clearUnread(acc);
					configureAccount?.(acc);
					accounts.postTo(acc, { type: MSG.SET_ACTIVE, active: acc.key === state.activeKey });
					if (acc.key === state.activeKey) accounts.requestScrollBottom(acc);
					scheduleRender();
					break;
				}
				case MSG.ACCOUNT: {
					accounts.applyInfo(acc, data);
					scheduleRender();
					break;
				}
				case MSG.NAME: {
					// Backwards compatibility with v1.0.x child frames.
					accounts.applyInfo(acc, data);
					scheduleRender();
					break;
				}
				case MSG.UNREAD: {
					if (acc.key === state.activeKey) break;
					if (!isUnreadKind(data.kind)) break;
					acc.unread[data.kind] += 1;
					feed.push(data.room, data.text);
					scheduleRender();
					break;
				}
				case MSG.SWITCH_REQUEST: {
					if (!Number.isInteger(data.index)) break;
					const target = state.accounts[data.index - 1];
					if (target) accounts.switchTo(target.key);
					break;
				}
				case MSG.CREDENTIAL_REQUEST: {
					const account = normalizeAccountName(data.account);
					if (!account || (acc.account && account !== normalizeAccountName(acc.account))) {
						accounts.postTo(acc, {
							type: MSG.CREDENTIAL,
							reqId: data.reqId,
							password: null,
							reason: "mismatch",
						});
						break;
					}
					if (Date.now() < state.pausedUntil) {
						accounts.postTo(acc, {
							type: MSG.CREDENTIAL,
							reqId: data.reqId,
							password: null,
							reason: "paused",
							retryIn: state.pausedUntil - Date.now() + 1000,
						});
						break;
					}
					const password = state.credentials.get(account) || null;
					accounts.postTo(acc, {
						type: MSG.CREDENTIAL,
						reqId: data.reqId,
						password,
						reason: password ? undefined : "missing",
					});
					break;
				}
				case MSG.CREDENTIAL_SAVE: {
					const account = normalizeAccountName(data.account);
					const password = typeof data.password === "string" ? data.password : "";
					if (!account || !password) break;
					state.credentials.set(account, password);
					acc.account = account;
					scheduleRender();
					break;
				}
				case MSG.AUTH: {
					acc.auth = {
						phase: typeof data.phase === "string" ? data.phase : "idle",
						reason: typeof data.reason === "string" ? data.reason : "",
						attempts: Number(data.attempts) || 0,
					};
					if (acc.auth.phase === "idle") state.pausedUntil = 0;
					scheduleRender();
					break;
				}
				case MSG.RATE_LIMITED: {
					state.pausedUntil = Date.now() + RC.GLOBAL_PAUSE_MS + Math.random() * RC.GLOBAL_PAUSE_JITTER_MS;
					break;
				}
				case MSG.LOG_BATCH: {
					logger?.ingest(data.records, acc.account, acc.member, acc.name);
					break;
				}
				case MSG.ALIVE: {
					acc.lastAlive = Date.now();
					break;
				}
				case MSG.ERROR: {
					console.warn(`[BC Multi] ${acc.name}:`, data.message);
					break;
				}
				default:
					break;
			}
		});
	}

	return { listen };
}
