function escapeHtml(text) {
	return String(text ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function kindLabel(kind) {
	switch (kind) {
		case "chat": return "聊天";
		case "whisper": return "私聊";
		case "action": return "动作";
		case "activity": return "互动";
		case "beep": return "Beep";
		case "system": return "系统";
		default: return kind;
	}
}

function playerLabel(record) {
	const playerId = Number(record.playerId) || 0;
	if (!playerId) return "未知（旧记录）";
	const name = record.playerName || "Player";
	return `${name} #${playerId}`;
}

function formatDateTime(date) {
	const pad = (value) => String(value).padStart(2, "0");
	return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ` +
		`${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const PLAYER_COLORS = [
	"#60a5fa",
	"#34d399",
	"#f59e0b",
	"#f472b6",
	"#a78bfa",
	"#22d3ee",
	"#fb7185",
	"#84cc16",
	"#e879f9",
	"#facc15",
];

export function generateExportHtml(records, meta = {}) {
	const accounts = new Map();
	for (const record of records) {
		const playerId = Number(record.playerId) || 0;
		if (!accounts.has(playerId)) accounts.set(playerId, playerLabel(record));
	}
	const accountList = [...accounts.entries()].map(([playerId, name]) => ({ playerId, name }));
	const total = records.length;
	const playerStats = accountList.map((account, index) => {
		const count = records.filter((record) => (Number(record.playerId) || 0) === account.playerId).length;
		return {
			...account,
			count,
			color: PLAYER_COLORS[index % PLAYER_COLORS.length],
		};
	}).filter((account) => account.count > 0);

	const bars = playerStats.map((account) => {
		const percent = total > 0 ? (account.count / total) * 100 : 0;
		const title = `${account.name}: ${account.count} 条 (${percent.toFixed(1)}%)`;
		return `<span class="player-segment" style="flex:0 0 ${percent.toFixed(4)}%;background:${account.color}" title="${escapeHtml(title)}"></span>`;
	}).join("");

	const legend = playerStats.map((account) => {
		const percent = total > 0 ? (account.count / total) * 100 : 0;
		return `<span class="player-legend-item" title="${escapeHtml(account.name)}: ${account.count} 条 (${percent.toFixed(1)}%)">` +
			`<i style="background:${account.color}"></i>${escapeHtml(account.name)} <b>${account.count}</b></span>`;
	}).join("");

	const payload = JSON.stringify(records).replaceAll("<", "\\u003c");
	const title = meta.title || "BC Multi-Account 消息记录";
	const source = meta.source || "";
	const range = meta.range || "";
	const generated = formatDateTime(new Date());

	return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #15171c; color: #e5e7eb; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
header { position: sticky; top: 0; z-index: 10; padding: 14px 18px 10px; background: rgba(21,23,28,.95); border-bottom: 1px solid #2a2f3a; backdrop-filter: blur(8px); }
h1 { margin: 0 0 4px; font-size: 18px; }
.meta-line { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
.meta { color: #9ca3af; font-size: 12px; }
.player-chart { flex: 1 1 260px; max-width: 430px; min-width: 190px; }
.player-bars { display: flex; width: 100%; height: 9px; overflow: hidden; border-radius: 5px; background: #2a2f3a; }
.player-segment { height: 100%; }
.player-legend { display: flex; flex-wrap: wrap; gap: 3px 11px; margin-top: 5px; color: #9ca3af; font-size: 11px; }
.player-legend-item { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
.player-legend-item i { display: inline-block; width: 8px; height: 8px; margin-right: 4px; border-radius: 50%; vertical-align: -1px; }
.player-legend-item b { color: #d1d5db; font-weight: 600; }
.search-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 10px; }
#search { flex: 1 1 220px; min-width: 160px; padding: 7px 9px; border: 1px solid #374151; border-radius: 7px; background: #1f232b; color: #e5e7eb; outline: none; }
#kindFilters { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }
.kind-filter { border: 1px solid #374151; border-radius: 7px; background: #1f232b; color: #cbd5e1; padding: 5px 9px; cursor: pointer; font: inherit; }
.kind-filter.active { background: #1e3a5f; border-color: #60a5fa; color: #fff; }
.kind-filter[aria-pressed="false"] { opacity: 0.48; text-decoration: line-through; }
#tabs { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }
.tab { border: 1px solid #374151; border-radius: 7px; background: #1f232b; color: #cbd5e1; padding: 5px 9px; cursor: pointer; font: inherit; }
.tab.active { background: #1e3a5f; border-color: #60a5fa; color: #fff; }
main { padding: 10px 18px 30px; }
.count { color: #9ca3af; font-size: 12px; margin: 4px 0 8px; }
.row { display: grid; grid-template-columns: 100px 110px 150px 64px minmax(0,1fr); gap: 8px; padding: 7px 8px; border-bottom: 1px solid #262b35; align-items: start; }
.row:hover { background: #1b1f27; }
.time { color: #9ca3af; font-variant-numeric: tabular-nums; }
.room { color: #93c5fd; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.name { color: #f3f4f6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.name.self { color: #86efac; }
.kind { color: #c4b5fd; font-size: 12px; }
.text { white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 760px) {
  .row { grid-template-columns: 96px minmax(0,1fr); }
  .room, .name, .kind { grid-column: 2; }
  .text { grid-column: 2; }
}
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta-line">
    <div class="meta">${escapeHtml(source)}${range ? ` · ${escapeHtml(range)}` : ""} · 生成于 ${escapeHtml(generated)} · ${total} 条</div>
    <div class="player-chart" aria-label="每个收信 Player 的消息条数比例">
      <div class="player-bars" role="img" title="每个收信 Player 的消息条数比例">${bars}</div>
      <div class="player-legend">${legend || '<span class="meta">暂无统计数据</span>'}</div>
    </div>
  </div>
  <div class="search-row">
    <input id="search" type="search" placeholder="搜索消息、角色或房间…">
  </div>
  <div id="kindFilters" aria-label="消息类型筛选"></div>
  <div id="tabs" aria-label="收信 Player 筛选"></div>
</header>
<main>
  <div class="count" id="count"></div>
  <div id="rows"></div>
</main>
<script id="payload" type="application/json">${payload}</script>
<script>
const DATA = JSON.parse(document.getElementById("payload").textContent);
const ACCOUNTS = ${JSON.stringify(accountList).replaceAll("<", "\\u003c")};
const KIND_LABEL = ${JSON.stringify({
		chat: "聊天", whisper: "私聊", action: "动作", activity: "互动", beep: "Beep", system: "系统",
	})};
const KIND_FILTERS = [
  { id: "chat", label: "Chat", kinds: ["chat"] },
  { id: "action", label: "Action", kinds: ["action", "activity"] },
  { id: "whisper", label: "Whisper", kinds: ["whisper"] },
  { id: "beep", label: "Beep", kinds: ["beep"] },
  { id: "system", label: "系统消息", kinds: ["system"] },
];
const kindVisible = { chat: true, action: true, whisper: true, beep: true, system: true };
let current = "all";
let query = "";
const kindFilters = document.getElementById("kindFilters");
const tabs = document.getElementById("tabs");
const rows = document.getElementById("rows");
const count = document.getElementById("count");

function addKindFilter(filter) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "kind-filter" + (kindVisible[filter.id] ? " active" : "");
  button.textContent = filter.label;
  button.dataset.kind = filter.id;
  button.setAttribute("aria-pressed", kindVisible[filter.id] ? "true" : "false");
  button.addEventListener("click", () => {
    kindVisible[filter.id] = !kindVisible[filter.id];
    button.classList.toggle("active", kindVisible[filter.id]);
    button.setAttribute("aria-pressed", kindVisible[filter.id] ? "true" : "false");
    render();
  });
  kindFilters.appendChild(button);
}
for (const filter of KIND_FILTERS) addKindFilter(filter);

function addTab(value, label) {
  const button = document.createElement("button");
  button.className = "tab" + (value === current ? " active" : "");
  button.textContent = label;
  button.addEventListener("click", () => {
    current = value;
    for (const el of tabs.querySelectorAll(".tab")) el.classList.toggle("active", el.dataset.value === value);
    render();
  });
  button.dataset.value = value;
  tabs.appendChild(button);
}

addTab("all", "全部");
for (const account of ACCOUNTS) addTab(String(account.playerId), account.name);

function formatTime(ts) {
  const d = new Date(ts);
  const pad = (value) => String(value).padStart(2, "0");
  return pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " +
    pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}

function kindVisibleFor(record) {
  const filter = KIND_FILTERS.find((item) => item.kinds.includes(record.kind));
  if (!filter) return true;
  return kindVisible[filter.id];
}

function render() {
  rows.replaceChildren();
  const q = query.trim().toLowerCase();
  const filtered = DATA.filter(record => {
    if (current !== "all" && String(record.playerId) !== current) return false;
    if (!kindVisibleFor(record)) return false;
    if (!q) return true;
    return [record.text, record.name, record.room, record.account, record.playerName].some(value => String(value || "").toLowerCase().includes(q));
  });
  count.textContent = filtered.length + " 条" + (filtered.length === DATA.length ? "" : "（共 " + DATA.length + " 条）");
  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "meta";
    empty.textContent = "没有匹配的消息";
    rows.appendChild(empty);
    return;
  }
  for (const record of filtered) {
    const row = document.createElement("div");
    row.className = "row";
    const time = document.createElement("div");
    time.className = "time";
    time.textContent = formatTime(record.ts);
    const room = document.createElement("div");
    room.className = "room";
    room.textContent = record.room ? "[" + record.room + "]" : "";
    const name = document.createElement("div");
    name.className = "name" + (record.self ? " self" : "");
    const suffix = record.kind === "beep" && record.direction === "out"
      ? "（我发出）"
      : (record.self ? "（我）" : "");
    name.textContent = (record.name || "未知") + (record.member ? " #" + record.member : "") + suffix;
    const kind = document.createElement("div");
    kind.className = "kind";
    kind.textContent = KIND_LABEL[record.kind] || record.kind;
    const text = document.createElement("div");
    text.className = "text";
    text.textContent = record.text;
    row.append(time, room, name, kind, text);
    rows.appendChild(row);
  }
}

document.getElementById("search").addEventListener("input", (event) => {
  query = event.target.value;
  render();
});
render();
</script>
</body>
</html>`;
}

export function downloadExport(records, meta = {}) {
	const html = generateExportHtml(records, meta);
	const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
	const blob = new Blob([html], { type: "text/html;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `BCMA-chat-${stamp}.html`;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 2000);
}
