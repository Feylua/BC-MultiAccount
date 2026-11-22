import { CHANNEL } from "../constants.js";

export function createChildBridge(id) {
	function post(type, payload = {}) {
		try {
			window.parent.postMessage({
				channel: CHANNEL,
				type,
				id,
				...payload,
			}, "*");
		} catch (err) {
			console.warn("[BC Multi] postMessage failed", err);
		}
	}

	function listen(handler) {
		window.addEventListener("message", (event) => {
			const data = event.data;
			if (!data || data.channel !== CHANNEL) return;
			handler(data);
		});
	}

	return { post, listen };
}
