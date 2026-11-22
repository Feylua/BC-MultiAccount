export function leaveFullscreen() {
	try {
		const result = document.exitFullscreen && document.exitFullscreen();
		if (result && typeof result.catch === "function") result.catch(() => {});
	} catch {
		/* ignore */
	}
}
