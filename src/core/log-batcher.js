export function createLogBatcher(sendBatch, { batchSize = 32, interval = 250, maxQueue = 512 } = {}) {
	let queue = [];
	let timer = null;

	function flush() {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
		if (queue.length === 0) return;
		const batch = queue;
		queue = [];
		try {
			sendBatch(batch);
		} catch (err) {
			console.warn("[BC Multi] log batch failed", err);
		}
	}

	function push(record) {
		if (!record) return;
		queue.push(record);
		if (queue.length > maxQueue) queue.splice(0, queue.length - maxQueue);
		if (queue.length >= batchSize) {
			flush();
			return;
		}
		if (timer === null) {
			timer = setTimeout(() => {
				timer = null;
				flush();
			}, interval);
		}
	}

	return { push, flush };
}
