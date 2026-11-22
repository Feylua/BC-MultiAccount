export function installMessageDisplayHook(handler) {
	if (typeof window.ChatRoomRegisterMessageHandler !== "function") return false;
	window.__BCMultiDisplayHandler = handler;
	if (!window.__BCMultiDisplayHandlerInstalled) {
		window.__BCMultiDisplayHandlerInstalled = true;
		window.ChatRoomRegisterMessageHandler({
			Description: "BC Multi-Account background feed",
			Priority: 499,
			Callback: (data, sender, msg, metadata) => {
				try {
					window.__BCMultiDisplayHandler?.(data, sender, msg, metadata);
				} catch (err) {
					console.warn("[BC Multi] display handler failed", err);
				}
				return false;
			},
		});
	}
	return true;
}
