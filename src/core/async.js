export function waitFor(getter, timeout = 30000) {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		(function poll() {
			try {
				const value = getter();
				if (value) return resolve(value);
			} catch {
				/* not ready yet */
			}
			if (Date.now() - started > timeout) return reject(new Error("waitFor timeout"));
			setTimeout(poll, 100);
		})();
	});
}
