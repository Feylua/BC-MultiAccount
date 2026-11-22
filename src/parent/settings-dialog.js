const SOUND_OPTIONS = [
	{ value: "all", label: "所有声音" },
	{ value: "notification", label: "仅提示音" },
	{ value: "mute", label: "静音" },
];

const POS_KEY = "bcma.settingsPos";

function formatBytes(bytes) {
	const value = Number(bytes) || 0;
	if (value < 1024) return `${value} B`;
	if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
	return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTime(ts) {
	if (!ts) return "暂无缓存";
	return new Date(ts).toLocaleString();
}

export function createSettingsDialog({ settings, onChange, logger, logDialog }) {
	let overlay;
	let panel;
	let autoInput;
	let logEnabledInput;
	let cacheStart;
	let cacheSize;
	const activeRadios = [];
	const backgroundRadios = [];

	function addRadio(target, name, value, labelText, checked) {
		const label = document.createElement("label");
		label.className = "bcma-settings-radio";
		const input = document.createElement("input");
		input.type = "radio";
		input.name = name;
		input.value = value;
		input.checked = checked;
		input.addEventListener("change", () => target());
		label.appendChild(input);
		label.appendChild(document.createTextNode(labelText));
		return { label, input };
	}

	function addButton(text, className, onClick) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = `bcma-settings-button ${className || ""}`.trim();
		button.textContent = text;
		button.addEventListener("click", onClick);
		return button;
	}

	function sync() {
		autoInput.checked = !!settings.autoReconnect;
		logEnabledInput.checked = settings.log?.enabled !== false;
		for (const { input } of activeRadios) input.checked = input.value === settings.sounds.active;
		for (const { input } of backgroundRadios) input.checked = input.value === settings.sounds.background;
	}

	function emit() {
		sync();
		onChange(settings);
	}

	async function refreshCacheInfo() {
		if (!logger || !cacheStart || !cacheSize) return;
		try {
			const stats = await logger.cacheStats();
			cacheStart.textContent = formatTime(stats.earliest);
			cacheSize.textContent = stats.count > 0
				? `${stats.count} 条 · ${formatBytes(stats.bytes)}`
				: "0 条 · 0 B";
		} catch {
			cacheStart.textContent = "读取失败";
			cacheSize.textContent = "—";
		}
	}

	function setupDrag(header) {
		let drag = null;
		header.addEventListener("pointerdown", (event) => {
			if (event.target.closest("#bcma-settings-close")) return;
			const rect = panel.getBoundingClientRect();
			drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, pointerId: event.pointerId };
			panel.style.left = `${rect.left}px`;
			panel.style.top = `${rect.top}px`;
			panel.style.transform = "none";
			header.setPointerCapture(event.pointerId);
			event.preventDefault();
		});
		header.addEventListener("pointermove", (event) => {
			if (!drag) return;
			const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
			const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
			panel.style.left = `${Math.max(0, Math.min(maxLeft, event.clientX - drag.dx))}px`;
			panel.style.top = `${Math.max(0, Math.min(maxTop, event.clientY - drag.dy))}px`;
		});
		const end = (event) => {
			if (!drag) return;
			drag = null;
			try {
				header.releasePointerCapture(event.pointerId);
			} catch {
				/* ignore */
			}
			try {
				localStorage.setItem(POS_KEY, JSON.stringify({ left: panel.style.left, top: panel.style.top }));
			} catch {
				/* ignore */
			}
		};
		header.addEventListener("pointerup", end);
		header.addEventListener("pointercancel", end);
	}

	function restorePosition() {
		if (!panel) return;
		try {
			const saved = JSON.parse(localStorage.getItem(POS_KEY) || "null");
			if (saved && saved.left && saved.top) {
				panel.style.left = saved.left;
				panel.style.top = saved.top;
				panel.style.transform = "none";
				const rect = panel.getBoundingClientRect();
				panel.style.left = `${Math.max(0, Math.min(rect.left, window.innerWidth - rect.width))}px`;
				panel.style.top = `${Math.max(0, Math.min(rect.top, window.innerHeight - rect.height))}px`;
				return;
			}
		} catch {
			/* ignore */
		}
		panel.style.left = "50%";
		panel.style.top = "50%";
		panel.style.transform = "translate(-50%, -50%)";
	}

	function mount() {
		overlay = document.createElement("div");
		overlay.id = "bcma-settings-overlay";
		overlay.hidden = true;

		panel = document.createElement("section");
		panel.id = "bcma-settings-panel";
		panel.setAttribute("role", "dialog");
		panel.setAttribute("aria-modal", "true");
		panel.setAttribute("aria-label", "设置");

		const header = document.createElement("div");
		header.className = "bcma-settings-header";
		const title = document.createElement("h2");
		title.className = "bcma-settings-title";
		title.textContent = "[设置]";
		const close = document.createElement("button");
		close.type = "button";
		close.id = "bcma-settings-close";
		close.textContent = "×";
		close.title = "关闭设置";
		close.addEventListener("click", () => closeDialog());
		header.appendChild(title);
		header.appendChild(close);
		panel.appendChild(header);

		const autoLabel = document.createElement("label");
		autoLabel.className = "bcma-settings-check";
		autoInput = document.createElement("input");
		autoInput.type = "checkbox";
		autoInput.addEventListener("change", () => {
			settings.autoReconnect = autoInput.checked;
			emit();
		});
		autoLabel.appendChild(autoInput);
		autoLabel.appendChild(document.createTextNode("自动重新连接"));
		panel.appendChild(autoLabel);

		const soundTitle = document.createElement("h3");
		soundTitle.className = "bcma-settings-section-title";
		soundTitle.textContent = "声音";
		panel.appendChild(soundTitle);

		const activeSection = document.createElement("div");
		activeSection.className = "bcma-settings-sound";
		const activeTitle = document.createElement("div");
		activeTitle.className = "bcma-settings-sound-title";
		activeTitle.textContent = "当前账号";
		activeSection.appendChild(activeTitle);
		for (const option of SOUND_OPTIONS) {
			const radio = addRadio(
				() => {
					settings.sounds.active = option.value;
					emit();
				},
				"bcma-sound-active",
				option.value,
				option.label,
				settings.sounds.active === option.value,
			);
			activeRadios.push(radio);
			activeSection.appendChild(radio.label);
		}
		panel.appendChild(activeSection);

		const backgroundSection = document.createElement("div");
		backgroundSection.className = "bcma-settings-sound";
		const backgroundTitle = document.createElement("div");
		backgroundTitle.className = "bcma-settings-sound-title";
		backgroundTitle.textContent = "后台账号";
		backgroundSection.appendChild(backgroundTitle);
		for (const option of SOUND_OPTIONS) {
			const radio = addRadio(
				() => {
					settings.sounds.background = option.value;
					emit();
				},
				"bcma-sound-background",
				option.value,
				option.label,
				settings.sounds.background === option.value,
			);
			backgroundRadios.push(radio);
			backgroundSection.appendChild(radio.label);
		}
		panel.appendChild(backgroundSection);

		const logTitle = document.createElement("h3");
		logTitle.className = "bcma-settings-section-title";
		logTitle.textContent = "消息缓存和导出";
		panel.appendChild(logTitle);

		const logLabel = document.createElement("label");
		logLabel.className = "bcma-settings-check";
		logEnabledInput = document.createElement("input");
		logEnabledInput.type = "checkbox";
		logEnabledInput.addEventListener("change", () => {
			settings.log = settings.log || {};
			settings.log.enabled = logEnabledInput.checked;
			emit();
			refreshCacheInfo();
		});
		logLabel.appendChild(logEnabledInput);
		logLabel.appendChild(document.createTextNode("缓存聊天消息（默认开启，保留 7 天）"));
		panel.appendChild(logLabel);

		const info = document.createElement("div");
		info.className = "bcma-settings-log-info";
		const startRow = document.createElement("div");
		startRow.className = "bcma-settings-log-row";
		const startLabel = document.createElement("span");
		startLabel.textContent = "缓存起始：";
		cacheStart = document.createElement("span");
		cacheStart.className = "bcma-settings-log-value";
		cacheStart.textContent = "读取中…";
		startRow.append(startLabel, cacheStart);
		const sizeRow = document.createElement("div");
		sizeRow.className = "bcma-settings-log-row";
		const sizeLabel = document.createElement("span");
		sizeLabel.textContent = "缓存大小：";
		cacheSize = document.createElement("span");
		cacheSize.className = "bcma-settings-log-value";
		cacheSize.textContent = "读取中…";
		sizeRow.append(sizeLabel, cacheSize);
		info.append(startRow, sizeRow);
		panel.appendChild(info);

		const actions = document.createElement("div");
		actions.className = "bcma-settings-actions";
		actions.appendChild(addButton("清除缓存", "", async () => {
			if (!window.confirm("确认清除所有本地消息缓存？当前会话消息不受影响。")) return;
			try {
				await logger.clearCache();
			} catch (err) {
				window.alert(`清除失败：${err?.message || err}`);
			}
			await refreshCacheInfo();
		}));
		actions.appendChild(addButton("导出当前消息记录", "", () => logDialog?.open("current")));
		actions.appendChild(addButton("导出缓存", "primary", () => logDialog?.open("cache")));
		panel.appendChild(actions);

		overlay.appendChild(panel);
		overlay.addEventListener("click", (event) => {
			if (event.target === overlay) closeDialog();
		});
		document.body.appendChild(overlay);
		setupDrag(header);
		sync();
	}

	function openDialog() {
		if (!overlay) return;
		sync();
		overlay.hidden = false;
		restorePosition();
		refreshCacheInfo();
	}

	function closeDialog() {
		if (!overlay) return;
		overlay.hidden = true;
	}

	return { mount, open: openDialog, close: closeDialog };
}
