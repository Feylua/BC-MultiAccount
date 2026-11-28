import { downloadExport } from "./export-html.js";

const RANGES = [
	{ value: "24h", label: "最近 24 小时", ms: 24 * 60 * 60 * 1000 },
	{ value: "7d", label: "最近 7 天", ms: 7 * 24 * 60 * 60 * 1000 },
	{ value: "30d", label: "最近 30 天", ms: 30 * 24 * 60 * 60 * 1000 },
];

export function createLogDialog({ logger }) {
	let overlay;
	let sourceLabel;
	let rangeField;
	let rangeName = "24h";
	let source = "current";

	function includes(record) {
		if (record.kind === "whisper") return privateInput.checked;
		// Both received and sent private beeps are included by the same toggle.
		if (record.kind === "beep") return beepInput.checked;
		if (record.kind === "system") return systemInput.checked;
		return true;
	}

	let privateInput;
	let beepInput;
	let systemInput;
	let originalInput;

	function makeCheck(labelText, checked = false) {
		const label = document.createElement("label");
		label.className = "bcma-log-check";
		const input = document.createElement("input");
		input.type = "checkbox";
		input.checked = checked;
		label.appendChild(input);
		label.appendChild(document.createTextNode(labelText));
		return { label, input };
	}

	function mount() {
		overlay = document.createElement("div");
		overlay.id = "bcma-log-overlay";
		overlay.hidden = true;

		const panel = document.createElement("section");
		panel.id = "bcma-log-panel";
		panel.setAttribute("role", "dialog");
		panel.setAttribute("aria-modal", "true");
		panel.setAttribute("aria-label", "导出消息记录");

		const header = document.createElement("div");
		header.className = "bcma-log-header";
		const title = document.createElement("h2");
		title.className = "bcma-log-title";
		title.textContent = "导出消息记录";
		const close = document.createElement("button");
		close.type = "button";
		close.id = "bcma-log-close";
		close.textContent = "×";
		close.title = "关闭";
		close.addEventListener("click", closeDialog);
		header.append(title, close);
		panel.appendChild(header);

		sourceLabel = document.createElement("div");
		sourceLabel.className = "bcma-log-source";
		panel.appendChild(sourceLabel);

		rangeField = document.createElement("div");
		rangeField.className = "bcma-log-field";
		const rangeTitle = document.createElement("div");
		rangeTitle.className = "bcma-log-field-title";
		rangeTitle.textContent = "时间范围";
		rangeField.appendChild(rangeTitle);
		const rangeOptions = document.createElement("div");
		rangeOptions.className = "bcma-log-inline";
		for (const range of RANGES) {
			const label = document.createElement("label");
			label.className = "bcma-log-check";
			const input = document.createElement("input");
			input.type = "radio";
			input.name = "bcma-log-range";
			input.value = range.value;
			input.checked = range.value === rangeName;
			input.addEventListener("change", () => {
				rangeName = range.value;
			});
			label.append(input, document.createTextNode(range.label));
			rangeOptions.appendChild(label);
		}
		rangeField.appendChild(rangeOptions);
		panel.appendChild(rangeField);

		const includeTitle = document.createElement("div");
		includeTitle.className = "bcma-log-field-title";
		includeTitle.textContent = "包含内容";
		panel.appendChild(includeTitle);

		const privateCheck = makeCheck("悄悄话", true);
		privateInput = privateCheck.input;
		const beepCheck = makeCheck("私聊", true);
		beepInput = beepCheck.input;
		const systemCheck = makeCheck("系统消息", false);
		systemInput = systemCheck.input;
		const originalCheck = makeCheck("包含 WCE 反混淆原文", true);
		originalInput = originalCheck.input;
		panel.append(privateCheck.label, beepCheck.label, systemCheck.label, originalCheck.label);

		const footer = document.createElement("div");
		footer.className = "bcma-log-footer";
		const cancel = document.createElement("button");
		cancel.type = "button";
		cancel.className = "bcma-log-btn";
		cancel.textContent = "取消";
		cancel.addEventListener("click", closeDialog);
		const exportButton = document.createElement("button");
		exportButton.type = "button";
		exportButton.className = "bcma-log-btn primary";
		exportButton.textContent = "导出 HTML";
		exportButton.addEventListener("click", doExport);
		footer.append(cancel, exportButton);
		panel.appendChild(footer);

		overlay.appendChild(panel);
		overlay.addEventListener("click", (event) => {
			if (event.target === overlay) closeDialog();
		});
		document.body.appendChild(overlay);
	}

	function openDialog(nextSource) {
		source = nextSource === "cache" ? "cache" : "current";
		sourceLabel.textContent = source === "cache" ? "来源：本地消息缓存" : "来源：当前会话消息";
		rangeField.hidden = source !== "cache";
		privateInput.checked = true;
		beepInput.checked = true;
		systemInput.checked = false;
		originalInput.checked = true;
		overlay.hidden = false;
	}

	function closeDialog() {
		if (overlay) overlay.hidden = true;
	}

	async function doExport() {
		try {
			const now = Date.now();
			let records;
			let rangeText = "";
			if (source === "cache") {
				const range = RANGES.find((item) => item.value === rangeName) || RANGES[0];
				records = await logger.queryCache(now - range.ms, now);
				rangeText = range.label;
			} else {
				records = logger.currentRecords();
			}
			records = (records || []).filter(includes);
			if (records.length === 0) {
				window.alert("所选范围内没有可导出的消息。");
				return;
			}
			downloadExport(records, {
				title: "BC Multi-Account 消息记录",
				source: source === "cache" ? "本地消息缓存" : "当前会话消息",
				range: rangeText,
				includeOriginal: originalInput.checked,
			});
			closeDialog();
		} catch (err) {
			console.error("[BC Multi] export failed", err);
			window.alert(`导出失败：${err?.message || err}`);
		}
	}

	return { mount, open: openDialog, close: closeDialog };
}
