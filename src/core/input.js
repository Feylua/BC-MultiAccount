import { HASH_KEY } from "../constants.js";

export function readChildId() {
	const match = new RegExp(HASH_KEY + "=(\\d+)").exec(location.hash);
	return match ? Number(match[1]) : null;
}

export function digitFromEvent(event) {
	const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code || "");
	if (match) return Number(match[1]);
	const n = Number(event.key);
	return Number.isInteger(n) && n >= 1 && n <= 9 ? n : null;
}
