import { addRecords, clearRecords, getAllRecords, purgeRecords, queryRecords } from "./log-store.js";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_MAX = 20000;

export function createLogger({ state, settings }) {
	let lastPurgeDay = "";

	function normalizeRecords(records, account, playerId, playerName) {
		const out = [];
		for (const record of Array.isArray(records) ? records : []) {
			if (!record || typeof record !== "object") continue;
			if (!record.account && account) record.account = account;
			// Every record carries the receiving account's PlayerID before it is
			// written. The parent fills it in when the child frame could not.
			record.playerId = Number(record.playerId) || 0;
			if (!(record.playerId > 0) && Number(playerId) > 0) {
				record.playerId = Number(playerId);
			}
			if (!record.playerName && playerName) record.playerName = playerName;
			// Defensive: records produced by an older frame may not yet include
			// the receiver in their ID, which would overwrite another account's copy.
			if (record.playerId > 0 && typeof record.uid === "string"
				&& !record.uid.startsWith(`${record.playerId}|`)) {
				record.uid = `${record.playerId}|${record.uid}`;
			}
			out.push(record);
		}
		return out;
	}

	function ingest(records, account, playerId, playerName) {
		const added = normalizeRecords(records, account, playerId, playerName);
		if (added.length === 0) return;

		state.sessionRecords.push(...added);
		if (state.sessionRecords.length > SESSION_MAX) {
			state.sessionRecords.splice(0, state.sessionRecords.length - SESSION_MAX);
		}

		if (!settings.log.enabled) return;

		const today = new Date().toDateString();
		if (today !== lastPurgeDay) {
			lastPurgeDay = today;
			purgeRecords(Date.now() - RETENTION_MS).catch(() => {});
		}
		addRecords(added).catch((err) => console.warn("[BC Multi] log write failed", err));
	}

	function currentRecords() {
		return state.sessionRecords.slice();
	}

	async function cacheStats() {
		const records = await getAllRecords();
		let bytes = 0;
		for (const record of records) {
			try {
				bytes += new TextEncoder().encode(JSON.stringify(record)).length;
			} catch {
				bytes += String(record.text || "").length;
			}
		}
		const earliest = records.reduce((min, r) => (typeof r.ts === "number" && r.ts < min ? r.ts : min), Infinity);
		return {
			count: records.length,
			bytes,
			earliest: Number.isFinite(earliest) ? earliest : 0,
		};
	}

	async function queryCache(from, to) {
		return queryRecords(from, to);
	}

	async function clearCache() {
		await clearRecords();
	}

	return {
		ingest,
		currentRecords,
		cacheStats,
		queryCache,
		clearCache,
	};
}
