const DB_NAME = "bcma-log";
const DB_VERSION = 1;
const STORE_NAME = "messages";
const TS_INDEX = "ts";

let dbPromise = null;

function requestToPromise(request) {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function openDb() {
	if (!("indexedDB" in window)) return Promise.resolve(null);
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve) => {
		try {
			const request = indexedDB.open(DB_NAME, DB_VERSION);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					const store = db.createObjectStore(STORE_NAME, { keyPath: "uid" });
					store.createIndex(TS_INDEX, "ts", { unique: false });
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => resolve(null);
			request.onblocked = () => resolve(null);
		} catch {
			resolve(null);
		}
	});
	return dbPromise;
}

async function withStore(mode, fn) {
	const db = await openDb();
	if (!db) return null;
	return new Promise((resolve) => {
		try {
			const tx = db.transaction(STORE_NAME, mode);
			const store = tx.objectStore(STORE_NAME);
			let result = null;
			try {
				result = fn(store, tx);
			} catch {
				resolve(null);
				return;
			}
			tx.oncomplete = () => resolve(result);
			tx.onerror = () => resolve(null);
			tx.onabort = () => resolve(null);
		} catch {
			resolve(null);
		}
	});
}

export async function addRecords(records) {
	if (!Array.isArray(records) || records.length === 0) return;
	await withStore("readwrite", (store) => {
		for (const record of records) {
			if (record && typeof record.uid === "string") store.put(record);
		}
	});
}

export async function getAllRecords() {
	const records = await withStore("readonly", (store) => {
		const request = store.index(TS_INDEX).getAll();
		return requestToPromise(request);
	});
	return Array.isArray(records) ? records : [];
}

export async function queryRecords(from, to) {
	const records = await withStore("readonly", (store) => {
		const index = store.index(TS_INDEX);
		const range = IDBKeyRange.bound(from, to);
		return requestToPromise(index.getAll(range));
	});
	return Array.isArray(records) ? records : [];
}

export async function clearRecords() {
	await withStore("readwrite", (store) => store.clear());
}

export async function purgeRecords(cutoff) {
	await withStore("readwrite", (store) => {
		const index = store.index(TS_INDEX);
		const request = index.openCursor(IDBKeyRange.upperBound(cutoff));
		request.onsuccess = () => {
			const cursor = request.result;
			if (!cursor) return;
			cursor.delete();
			cursor.continue();
		};
	});
}

export async function countRecords() {
	const count = await withStore("readonly", (store) => requestToPromise(store.count()));
	return typeof count === "number" ? count : 0;
}
