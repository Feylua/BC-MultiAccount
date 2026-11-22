export function emptyUnread() {
	return { whisper: 0, chat: 0, action: 0, activity: 0 };
}

export function createParentState() {
	return {
		accounts: [],
		activeKey: 1,
		nextKey: 2,
		topActive: true,
		toolbar: null,
		topSeen: new Set(),
		topInfoKey: "",
		mod: null,
		renderTimer: null,
		started: false,
		feed: null,
		feedToggle: null,
		feedMessages: [],
		feedOpen: false,
		credentials: new Map(),
		pausedUntil: 0,
		topAudio: null,
		topReconnect: null,
		settings: null,
		sessionRecords: [],
		logger: null,
		logDialog: null,
	};
}
