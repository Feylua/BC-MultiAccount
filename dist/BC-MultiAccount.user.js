// ==UserScript==
// @name         BC Multi-Account Switcher
// @namespace    bc-multi-account
// @version      1.2.2
// @description  One BC window, multiple accounts, unread feed, room follow/swap, collapsible account bar, auto-reconnect, and message-log export with WCE original text.
// @author       Feylua
// @match        https://*.bondageprojects.elementfx.com/R*/*
// @match        https://*.bondage-europe.com/R*/*
// @match        https://*.bondageprojects.com/R*/*
// @match        https://*.bondage-asia.com/club/R*
// @match        http://localhost:*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  // src/constants.js
  var CHANNEL = "bc-multi-account";
  var HASH_KEY = "bcmulti";
  var MAX_ACCOUNTS = 8;
  var FEED_MAX_LINES = 14;
  var SETTINGS_KEY = "bcma.settings";
  var VERSION = "1.2.2";

  // src/core/input.js
  function readChildId() {
    const match = new RegExp(HASH_KEY + "=(\\d+)").exec(location.hash);
    return match ? Number(match[1]) : null;
  }
  function digitFromEvent(event) {
    const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code || "");
    if (match) return Number(match[1]);
    const n = Number(event.key);
    return Number.isInteger(n) && n >= 1 && n <= 9 ? n : null;
  }

  // src/protocol.js
  var MSG = Object.freeze({
    READY: "ready",
    ACCOUNT: "account",
    UNREAD: "unread",
    SET_ACTIVE: "set-active",
    SCROLL_BOTTOM: "scroll-chat-bottom",
    SWITCH_REQUEST: "switch-request",
    ALIVE: "alive",
    ERROR: "error",
    NAME: "name",
    CONFIG: "config",
    CREDENTIAL_REQUEST: "credential-request",
    CREDENTIAL_SAVE: "credential-save",
    CREDENTIAL: "credential",
    AUTH: "auth",
    RATE_LIMITED: "rate-limited",
    RECONNECT_NOW: "reconnect-now",
    LOG_BATCH: "log-batch",
    LOG_FLUSH: "log-flush",
    ROOM_STATE_REQUEST: "room-state-request",
    ROOM_STATE: "room-state",
    ROOM_JOIN: "room-join",
    ROOM_JOIN_RESULT: "room-join-result",
    ROOM_LEAVE: "room-leave",
    ROOM_LEAVE_RESULT: "room-leave-result"
  });

  // src/core/account-info.js
  function isLoggedInNow() {
    if (typeof window.ServerIsLoggedIn === "function" && window.ServerIsLoggedIn()) return true;
    const p = window.Player;
    return !!(p && p.CharacterID && typeof p.MemberNumber === "number" && p.MemberNumber > 0);
  }
  function getAccountInfo() {
    const loggedIn = isLoggedInNow();
    const p = window.Player;
    const authPending = window.CurrentScreen === "Relog" || window.CurrentScreen === "Login";
    const online = loggedIn && !authPending && window.ServerIsConnected === true;
    const name = loggedIn && p && typeof p.Name === "string" ? p.Name : "";
    const account = loggedIn && p && typeof p.AccountName === "string" ? p.AccountName : "";
    const memberNumber = loggedIn && p && typeof p.MemberNumber === "number" ? p.MemberNumber : null;
    let room = "";
    let roomSpace = "";
    let roomMemberCount = 0;
    const inRoom = typeof window.ServerPlayerIsInChatRoom === "function" ? window.ServerPlayerIsInChatRoom() : false;
    if (loggedIn && inRoom && window.ChatRoomData && typeof window.ChatRoomData.Name === "string") {
      room = window.ChatRoomData.Name.trim();
      roomSpace = typeof window.ChatRoomData.Space === "string" ? window.ChatRoomData.Space : "";
      roomMemberCount = Array.isArray(window.ChatRoomData.Character) ? window.ChatRoomData.Character.length : Array.isArray(window.ChatRoomCharacter) ? window.ChatRoomCharacter.length : 0;
    }
    return { loggedIn, online, name, account, memberNumber, inRoom, room, roomSpace, roomMemberCount };
  }

  // src/core/audio.js
  function isNotificationSound(src) {
    return /(?:^|\/)BeepAlarm\.mp3(?:\?|$)/i.test(String(src || ""));
  }
  function installAudioPolicy(mod, initialMode = "all") {
    let mode = initialMode;
    function setMode(nextMode) {
      mode = nextMode === "notification" || nextMode === "mute" ? nextMode : "all";
      if (mode !== "all") {
        try {
          window.AudioBackgroundMusicStop?.();
          window.AudioDialogStop?.();
        } catch {
        }
      }
    }
    function hook(name, callback) {
      if (typeof window[name] !== "function") return;
      mod.hookFunction(name, 5, callback);
    }
    hook("AudioPlayInstantSound", (args, next) => {
      if (mode === "mute") return;
      if (mode === "notification" && !isNotificationSound(args[0])) return;
      return next(args);
    });
    hook("AudioDialogStart", (args, next) => {
      if (mode !== "all") return;
      return next(args);
    });
    hook("AudioBackgroundMusicPlay", (args, next) => {
      if (mode !== "all") return;
      return next(args);
    });
    hook("AudioBackgroundMusicSetVolume", (args, next) => {
      if (mode !== "all") {
        try {
          window.AudioBackgroundMusicStop?.();
        } catch {
        }
        return;
      }
      return next(args);
    });
    return { setMode, get mode() {
      return mode;
    } };
  }

  // src/core/reconnect.js
  var RC = Object.freeze({
    MAX_ATTEMPTS: 5,
    BACKOFF_MS: [2e3, 5e3, 15e3, 45e3],
    ATTEMPT_TIMEOUT_MS: 15e3,
    CREDENTIAL_TIMEOUT_MS: 2e3,
    GLOBAL_PAUSE_MS: 3e4,
    GLOBAL_PAUSE_JITTER_MS: 15e3
  });
  function normalizeAccountName(name) {
    return typeof name === "string" ? name.trim().toUpperCase().slice(0, 40) : "";
  }
  function installReconnect(mod, transport) {
    const rc = {
      enabled: true,
      remember: true,
      authedOnce: false,
      blocked: false,
      busy: false,
      attempts: 0,
      timerId: null,
      seq: 0,
      reqSeq: 0,
      phase: "idle",
      pending: null,
      lastAttempt: null
    };
    function say(phase, reason = "") {
      if (rc.phase === phase && !reason) return;
      rc.phase = phase;
      transport.notifyAuth(phase, reason, rc.attempts);
    }
    function clearTimer() {
      if (rc.timerId !== null) {
        clearTimeout(rc.timerId);
        rc.timerId = null;
      }
    }
    function schedule(delay) {
      clearTimer();
      const id = ++rc.seq;
      rc.timerId = setTimeout(() => {
        if (id !== rc.seq) return;
        rc.timerId = null;
        tryRelog();
      }, Math.max(0, delay));
    }
    function halt(phase, reason) {
      rc.blocked = true;
      rc.busy = false;
      clearTimer();
      say(phase, reason);
    }
    async function requestCredential(account) {
      rc.busy = true;
      say("asking");
      const reqId = ++rc.reqSeq;
      const reply = await new Promise((resolve) => {
        rc.pending = { reqId, resolve };
        transport.requestCredential(account, reqId);
        setTimeout(() => {
          if (rc.pending && rc.pending.reqId === reqId) {
            rc.pending = null;
            resolve({ password: null, reason: "timeout" });
          }
        }, RC.CREDENTIAL_TIMEOUT_MS);
      });
      rc.busy = false;
      return reply || { password: null, reason: "missing" };
    }
    async function tryRelog() {
      if (!rc.enabled || rc.blocked || rc.busy || !rc.authedOnce) return;
      if (window.CurrentScreen !== "Relog") {
        say("idle");
        return;
      }
      const socket = window.ServerSocket;
      if (!window.ServerIsConnected || !socket || !socket.connected || window.LoginSubmitted) {
        say("waiting");
        return;
      }
      if (rc.attempts >= RC.MAX_ATTEMPTS) {
        halt("manual", "exhausted");
        return;
      }
      const account = normalizeAccountName(window.Player?.AccountName);
      if (!account) {
        say("waiting");
        return;
      }
      rc.attempts += 1;
      const reply = await requestCredential(account);
      if (!rc.enabled || rc.blocked) return;
      if (reply.reason === "paused") {
        say("waiting", "global-pause");
        schedule(reply.retryIn || RC.GLOBAL_PAUSE_MS);
        return;
      }
      if (typeof reply.password !== "string" || !reply.password) {
        halt("manual", reply.reason || "no-credential");
        return;
      }
      if (typeof window.ServerAccountPasswordRegex !== "undefined" && !window.ServerAccountPasswordRegex.test(reply.password)) {
        halt("manual", "invalid-credential");
        return;
      }
      say("logging-in");
      rc.lastAttempt = { account, password: reply.password };
      window.LoginDoLogin(account, reply.password);
      schedule(RC.ATTEMPT_TIMEOUT_MS);
    }
    function hook(name, priority, fn) {
      if (typeof window[name] !== "function") {
        console.warn(`[BC Multi] reconnect: ${name} not found, skipped`);
        return;
      }
      mod.hookFunction(name, priority, fn);
    }
    hook("LoginDoLogin", 11, (args, next) => {
      rc.lastAttempt = {
        account: normalizeAccountName(args[0]),
        password: typeof args[1] === "string" ? args[1] : ""
      };
      return next(args);
    });
    hook("LoginResponse", 11, (args, next) => {
      const result = next(args);
      const payload = args[0];
      if (typeof payload === "string") {
        clearTimer();
        if (payload === "ErrorDuplicatedLogin") {
          halt("duplicate", payload);
        } else if (payload === "ErrorRateLimited") {
          transport.notifyRateLimited();
          halt("manual", "rate-limited");
        } else if (rc.attempts >= 2) {
          halt("manual", payload);
        } else if (rc.authedOnce && !rc.blocked) {
          const i = Math.min(rc.attempts, RC.BACKOFF_MS.length - 1);
          schedule(RC.BACKOFF_MS[i] + Math.random() * 1e3);
        }
        rc.lastAttempt = null;
        return result;
      }
      const wasRelog = rc.phase === "logging-in";
      const attempt = rc.lastAttempt;
      rc.lastAttempt = null;
      rc.authedOnce = true;
      rc.blocked = false;
      rc.busy = false;
      rc.attempts = 0;
      clearTimer();
      say("idle");
      if (!wasRelog && rc.remember && attempt && attempt.account && attempt.password) {
        transport.saveCredential(attempt.account, attempt.password);
      }
      return result;
    });
    hook("ServerConnect", 5, (args, next) => {
      const result = next(args);
      if (rc.authedOnce && !rc.blocked && rc.timerId === null) schedule(300);
      return result;
    });
    hook("ServerDisconnect", 11, (args, next) => {
      const [err, force] = args;
      const result = next(args);
      if (!rc.authedOnce) return result;
      rc.attempts = 0;
      if (!rc.blocked) say("waiting");
      if (force && err !== "ErrorDuplicatedLogin" && err !== "ErrorRateLimited") {
        setTimeout(() => {
          if (rc.authedOnce && !rc.blocked && !window.ServerIsConnected && typeof window.ServerInit === "function") {
            window.ServerInit();
          }
        }, 5e3);
      }
      return result;
    });
    hook("RelogRun", 5, (args, next) => {
      if (rc.authedOnce && !rc.blocked && !rc.busy && rc.timerId === null) schedule(0);
      return next(args);
    });
    hook("RelogExit", 11, (args, next) => {
      halt("off", "user-left");
      rc.authedOnce = false;
      return next(args);
    });
    return {
      configure(options) {
        if (typeof options.reconnect === "boolean") {
          rc.enabled = options.reconnect;
          if (rc.enabled) {
            rc.blocked = false;
            if (rc.phase === "off") rc.phase = "idle";
          } else {
            halt("off", "config");
          }
        }
        if (typeof options.remember === "boolean") rc.remember = options.remember;
      },
      retryNow() {
        rc.blocked = false;
        rc.attempts = 0;
        say("waiting", "manual-retry");
        schedule(0);
      },
      resolveCredential(reqId, reply) {
        if (!rc.pending || rc.pending.reqId !== reqId) return;
        const pending = rc.pending;
        rc.pending = null;
        pending.resolve(reply);
      },
      get phase() {
        return rc.phase;
      }
    };
  }

  // src/parent/state.js
  function emptyUnread() {
    return { whisper: 0, chat: 0, action: 0, activity: 0 };
  }
  function createParentState() {
    return {
      accounts: [],
      activeKey: 1,
      nextKey: 2,
      topActive: true,
      toolbar: null,
      topSeen: /* @__PURE__ */ new Set(),
      topInfoKey: "",
      mod: null,
      renderTimer: null,
      started: false,
      feed: null,
      feedToggle: null,
      feedMessages: [],
      feedSeen: /* @__PURE__ */ new Set(),
      feedRecent: /* @__PURE__ */ new Map(),
      feedOpen: false,
      roomBusy: false,
      credentials: /* @__PURE__ */ new Map(),
      pausedUntil: 0,
      topAudio: null,
      topReconnect: null,
      settings: null,
      sessionRecords: [],
      logger: null,
      logDialog: null
    };
  }

  // src/parent/feed.js
  function createFeed(state) {
    let feedElement = null;
    let toggleElement = null;
    function setOpen(open) {
      state.feedOpen = !!open;
      if (feedElement) feedElement.hidden = !state.feedOpen;
      if (toggleElement) {
        toggleElement.textContent = state.feedOpen ? "\u25BE" : "\u25B8";
        toggleElement.title = state.feedOpen ? "\u6536\u8D77\u540E\u53F0\u6D88\u606F" : "\u5C55\u5F00\u540E\u53F0\u6D88\u606F";
        toggleElement.setAttribute("aria-expanded", state.feedOpen ? "true" : "false");
      }
      try {
        localStorage.setItem("bcma.feedOpen", state.feedOpen ? "1" : "0");
      } catch {
      }
    }
    function visibleEntries() {
      return state.feedMessages.filter((entry) => {
        if (!entry || typeof entry === "string") return true;
        if (entry.accountKey === state.activeKey) return false;
        return true;
      });
    }
    function render() {
      if (!feedElement) return;
      const frag = document.createDocumentFragment();
      for (const entry of visibleEntries()) {
        const line = typeof entry === "string" ? entry : entry.line;
        const elem = document.createElement("div");
        elem.className = "bcma-feed-line";
        elem.textContent = line;
        elem.title = line;
        frag.appendChild(elem);
      }
      feedElement.replaceChildren(frag);
    }
    function push(room, text, meta = {}) {
      const id = typeof meta.id === "string" && meta.id ? meta.id : "";
      if (id) {
        const key = `${meta.kind || ""}|${id}`;
        if (state.feedSeen.has(key)) return false;
        state.feedSeen.add(key);
        if (state.feedSeen.size > 2e3) state.feedSeen.clear();
      }
      const cleanRoom = String(room || "\u5927\u5385").trim() || "\u5927\u5385";
      const cleanText = String(text || "(\u7A7A\u6D88\u606F)").replace(/\s+/g, " ").trim() || "(\u7A7A\u6D88\u606F)";
      const kind = typeof meta.kind === "string" ? meta.kind : "";
      if (!id && (kind === "chat" || kind === "action" || kind === "activity")) {
        const sender = Number(meta.sender) || 0;
        const recentKey = `${kind}|${cleanRoom}|${sender}|${cleanText}`;
        const now = Date.now();
        const last = state.feedRecent.get(recentKey);
        if (last !== void 0 && now - last <= 2e3) return false;
        state.feedRecent.set(recentKey, now);
        if (state.feedRecent.size > 1e3) {
          const oldest = state.feedRecent.keys().next().value;
          if (oldest !== void 0) state.feedRecent.delete(oldest);
        }
      }
      state.feedMessages.push({
        line: `[${cleanRoom}] ${cleanText}`,
        kind: typeof meta.kind === "string" ? meta.kind : "",
        accountKey: Number.isInteger(meta.accountKey) ? meta.accountKey : null,
        room: cleanRoom
      });
      if (state.feedMessages.length > FEED_MAX_LINES) {
        state.feedMessages.splice(0, state.feedMessages.length - FEED_MAX_LINES);
      }
      render();
      return true;
    }
    function clearRoom(room) {
      const cleanRoom = String(room || "").trim();
      if (!cleanRoom) return;
      state.feedMessages = state.feedMessages.filter((entry) => {
        if (typeof entry === "string") return true;
        return entry.room !== cleanRoom;
      });
      render();
    }
    function bind(feed, toggle) {
      feedElement = feed;
      toggleElement = toggle;
      state.feed = feed;
      state.feedToggle = toggle;
      toggleElement.addEventListener("click", (event) => {
        event.stopPropagation();
        setOpen(!state.feedOpen);
      });
      try {
        state.feedOpen = localStorage.getItem("bcma.feedOpen") === "1";
      } catch {
        state.feedOpen = false;
      }
      setOpen(state.feedOpen);
    }
    return { bind, setOpen, render, push, clearRoom };
  }

  // src/parent/styles.css
  var styles_default = '\n				#bcma-bar {\n					position: fixed;\n					top: 8px;\n					left: 50%;\n					transform: translateX(-50%);\n					z-index: 2147483647;\n					display: flex;\n					align-items: flex-start;\n					gap: 6px;\n					padding: 5px 7px;\n					box-sizing: border-box;\n					max-width: calc(100vw - 16px);\n					border: 1px solid rgba(255,255,255,0.14);\n					border-radius: 12px;\n					background: rgba(18,19,24,0.88);\n					box-shadow: 0 6px 24px rgba(0,0,0,0.35);\n					backdrop-filter: blur(8px);\n					font: 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;\n					color: #fff;\n					user-select: none;\n					pointer-events: auto;\n				}\n				#bcma-drag {\n					cursor: grab;\n					opacity: 0.55;\n					padding: 0 2px;\n					font-size: 16px;\n					line-height: 1;\n				}\n				#bcma-drag:active { cursor: grabbing; }\n				#bcma-list {\n					display: flex;\n					align-items: flex-start;\n					gap: 8px;\n					max-width: calc(100vw - 70px);\n					overflow-x: auto;\n					overflow-y: hidden;\n					scrollbar-width: thin;\n				}\n				.bcma-account {\n					display: flex;\n					flex-direction: column;\n					align-items: center;\n					gap: 3px;\n					min-width: 48px;\n					max-width: 76px;\n					flex: 0 0 auto;\n				}\n				.bcma-acc, .bcma-add {\n					appearance: none;\n					-webkit-appearance: none;\n					box-sizing: border-box;\n					margin: 0;\n					padding: 0;\n					border: 1px solid rgba(255,255,255,0.18);\n					border-radius: 10px;\n					background: #2a2d34;\n					color: #fff;\n					cursor: pointer;\n					font: inherit;\n					outline: none;\n				}\n				.bcma-acc {\n					position: relative;\n					width: 40px;\n					height: 40px;\n					display: grid;\n					place-items: center;\n					transition: opacity 120ms ease, filter 120ms ease, background 120ms ease;\n				}\n				.bcma-acc:hover, .bcma-add:hover {\n					background: #3a3f49;\n					border-color: rgba(255,255,255,0.35);\n				}\n				.bcma-acc.active {\n					background: #1e3a5f;\n					border-color: #93c5fd;\n					box-shadow: 0 0 0 2px rgba(59,130,246,0.75);\n				}\n				.bcma-acc.online {\n					background: #2f3d33;\n					border-color: rgba(74,222,128,0.55);\n					box-shadow: 0 0 10px rgba(74,222,128,0.16);\n				}\n				.bcma-acc.active.online {\n					background: #1e3a5f;\n					border-color: #93c5fd;\n					box-shadow: 0 0 0 2px rgba(59,130,246,0.75), 0 0 12px rgba(74,222,128,0.2);\n				}\n				.bcma-acc.offline {\n					opacity: 0.38;\n					filter: grayscale(0.75);\n				}\n				.bcma-name, .bcma-room {\n					max-width: 76px;\n					overflow: hidden;\n					text-overflow: ellipsis;\n					white-space: nowrap;\n					text-align: center;\n					line-height: 1.2;\n				}\n				.bcma-name {\n					font-size: 11px;\n					font-weight: 600;\n					color: #e5e7eb;\n				}\n				.bcma-room {\n					font-size: 10px;\n					color: #93c5fd;\n				}\n				.bcma-name:empty, .bcma-room:empty {\n					display: none;\n				}\n				.bcma-account.offline .bcma-name,\n				.bcma-account.offline .bcma-room {\n					opacity: 0.55;\n				}\n				.bcma-add {\n					width: 32px;\n					height: 40px;\n					font-size: 20px;\n					line-height: 1;\n					color: #cbd5e1;\n					flex: 0 0 auto;\n				}\n				.bcma-frame {\n					position: fixed;\n					inset: 0;\n					width: 100%;\n					height: 100%;\n					border: 0;\n					background: #000;\n					z-index: 2147483000;\n				}\n\n				/* ===== v1.0.3 compact square tiles ===== */\n				#bcma-bar {\n					width: auto;\n					max-width: calc(100vw - 16px);\n					flex-direction: row;\n					align-items: flex-start;\n					gap: 6px;\n					padding: 5px 7px;\n				}\n				#bcma-drag {\n					text-align: left;\n					align-self: center;\n					padding: 0 2px;\n					font-size: 16px;\n				}\n				#bcma-list {\n					max-width: calc(100vw - 70px);\n					max-height: none;\n					flex-direction: row;\n					align-items: flex-start;\n					gap: 8px;\n					overflow-x: auto;\n					overflow-y: hidden;\n				}\n				.bcma-account {\n					position: relative;\n					width: 88px;\n					min-width: 88px;\n					max-width: 88px;\n					flex-direction: column;\n					align-items: center;\n					gap: 2px;\n					padding: 8px 0 0;\n					flex: 0 0 auto;\n				}\n				.bcma-close {\n					appearance: none;\n					-webkit-appearance: none;\n					box-sizing: border-box;\n					position: absolute;\n					left: 0;\n					top: 16px;\n					z-index: 3;\n					width: 24px;\n					min-width: 24px;\n					height: 24px;\n					margin: 0;\n					padding: 0;\n					border: 1px solid transparent;\n					border-radius: 6px;\n					background: transparent;\n					color: #9ca3af;\n					cursor: pointer;\n					font: 700 15px/1 system-ui, -apple-system, "Segoe UI", sans-serif;\n					outline: none;\n				}\n				/* Enlarge the touch target without enlarging the visible X. */\n				.bcma-close::before {\n					content: "";\n					position: absolute;\n					inset: -5px;\n					border-radius: 9px;\n				}\n				.bcma-close:hover {\n					background: rgba(220, 38, 38, 0.18);\n					border-color: rgba(220, 38, 38, 0.55);\n					color: #fecaca;\n				}\n				.bcma-close.disabled {\n					opacity: 0.28;\n					cursor: not-allowed;\n				}\n				.bcma-close.disabled:hover {\n					background: transparent;\n					border-color: transparent;\n					color: #9ca3af;\n				}\n				.bcma-icon {\n					position: relative;\n					width: 40px;\n					height: 40px;\n					flex: 0 0 auto;\n					margin: 0 auto;\n				}\n				.bcma-acc {\n					width: 40px;\n					height: 40px;\n					min-width: 0;\n					flex: none;\n					display: grid;\n					place-items: center;\n					padding: 0;\n					overflow: visible;\n				}\n				.bcma-avatar {\n					font-weight: 700;\n					font-size: 14px;\n					line-height: 1;\n				}\n				.bcma-name {\n					width: 84px;\n					max-width: 84px;\n					font-size: 11px;\n					font-weight: 600;\n					line-height: 1.2;\n					text-align: center;\n					color: #e5e7eb;\n				}\n				.bcma-room {\n					width: 84px;\n					max-width: 84px;\n					font-size: 9px;\n					line-height: 1.2;\n					text-align: center;\n					color: #93c5fd;\n				}\n				.bcma-unread {\n					position: absolute;\n					top: -6px;\n					right: -6px;\n					min-width: 16px;\n					height: 16px;\n					padding: 0 4px;\n					box-sizing: content-box;\n					border-radius: 8px;\n					background: #6b7280;\n					color: #fff;\n					font: 700 10px/16px system-ui, -apple-system, "Segoe UI", sans-serif;\n					text-align: center;\n					white-space: nowrap;\n					box-shadow: 0 0 0 2px #141418;\n					pointer-events: none;\n				}\n				.bcma-unread.chat { background: #2563eb; }\n				.bcma-unread.whisper { background: #dc2626; }\n				.bcma-unread.muted { background: #6b7280; }\n				.bcma-unread.empty {\n					visibility: hidden;\n				}\n				.bcma-add {\n					width: 32px;\n					height: 32px;\n					margin: 12px 0 0;\n					font-size: 20px;\n					align-self: flex-start;\n					flex: 0 0 auto;\n				}\n\n				/* ===== v1.0.4 background-message feed ===== */\n				#bcma-feed-toggle {\n					appearance: none;\n					-webkit-appearance: none;\n					position: absolute;\n					left: 50%;\n					bottom: -15px;\n					transform: translateX(-50%);\n					z-index: 5;\n					width: 52px;\n					height: 16px;\n					margin: 0;\n					padding: 0;\n					border: 1px solid rgba(255,255,255,0.18);\n					border-top: 0;\n					border-radius: 0 0 8px 8px;\n					background: rgba(0,0,0,0.72);\n					color: #e5e7eb;\n					cursor: pointer;\n					font: 700 10px/12px system-ui, -apple-system, "Segoe UI", sans-serif;\n					outline: none;\n				}\n				#bcma-feed-toggle:hover {\n					background: rgba(20,20,24,0.9);\n					color: #fff;\n				}\n				#bcma-feed {\n					position: absolute;\n					top: calc(100% + 17px);\n					left: 0;\n					z-index: 4;\n					width: 22em;\n					height: 19.6em; /* 14 lines at line-height 1.4 */\n					padding: 4px 6px;\n					box-sizing: content-box;\n					overflow: hidden;\n					border: 1px solid rgba(255,255,255,0.16);\n					border-radius: 10px;\n					background: rgba(0,0,0,0.72);\n					backdrop-filter: blur(5px);\n					color: #fff;\n					font-size: 11px;\n					line-height: 1.4;\n					text-align: left;\n					pointer-events: auto;\n				}\n				#bcma-feed[hidden] {\n					display: none;\n				}\n				.bcma-feed-line {\n					height: 1.4em;\n					line-height: 1.4;\n					white-space: nowrap;\n					overflow: hidden;\n					text-overflow: ellipsis;\n				}\n			\n\n				/* ===== v1.1.1 settings ===== */\n				#bcma-settings {\n					appearance: none;\n					-webkit-appearance: none;\n					position: absolute;\n					right: 4px;\n					bottom: 0;\n					z-index: 6;\n					width: 18px;\n					height: 18px;\n					margin: 0;\n					padding: 0;\n					border: 1px solid transparent;\n					border-radius: 6px;\n					background: transparent;\n					color: #9ca3af;\n					cursor: pointer;\n					font: 14px/1 system-ui, -apple-system, "Segoe UI", sans-serif;\n					outline: none;\n				}\n				#bcma-settings:hover {\n					background: rgba(255,255,255,0.1);\n					border-color: rgba(255,255,255,0.25);\n					color: #fff;\n				}\n				#bcma-settings-overlay {\n					position: fixed;\n					inset: 0;\n					z-index: 2147483647;\n					display: grid;\n					place-items: center;\n					background: rgba(0,0,0,0.45);\n					pointer-events: auto;\n				}\n				#bcma-settings-overlay[hidden] {\n					display: none;\n				}\n				#bcma-settings-panel {\n					width: 310px;\n					max-width: calc(100vw - 24px);\n					max-height: calc(100vh - 24px);\n					overflow-y: auto;\n					box-sizing: border-box;\n					padding: 10px 12px 12px;\n					border: 1px solid rgba(255,255,255,0.18);\n					border-radius: 12px;\n					background: rgba(0,0,0,0.86);\n					box-shadow: 0 10px 40px rgba(0,0,0,0.5);\n					backdrop-filter: blur(8px);\n					color: #fff;\n					font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;\n				}\n				.bcma-settings-header {\n					display: flex;\n					align-items: center;\n					justify-content: space-between;\n					gap: 8px;\n					margin-bottom: 10px;\n				}\n				.bcma-settings-title {\n					margin: 0;\n					font-size: 16px;\n					font-weight: 700;\n					color: #fff;\n				}\n				#bcma-settings-close {\n					appearance: none;\n					-webkit-appearance: none;\n					width: 26px;\n					height: 26px;\n					margin: 0;\n					padding: 0;\n					border: 1px solid transparent;\n					border-radius: 6px;\n					background: transparent;\n					color: #d1d5db;\n					cursor: pointer;\n					font: 700 18px/1 system-ui, -apple-system, "Segoe UI", sans-serif;\n					outline: none;\n				}\n				#bcma-settings-close:hover {\n					background: rgba(220,38,38,0.2);\n					border-color: rgba(220,38,38,0.55);\n					color: #fecaca;\n				}\n				.bcma-settings-check {\n					display: flex;\n					align-items: center;\n					gap: 7px;\n					margin-bottom: 12px;\n					cursor: pointer;\n				}\n				.bcma-settings-check input {\n					accent-color: #3b82f6;\n				}\n				.bcma-settings-section-title {\n					margin: 0 0 7px;\n					padding-top: 9px;\n					border-top: 1px solid rgba(255,255,255,0.14);\n					font-size: 13px;\n					font-weight: 700;\n					color: #e5e7eb;\n				}\n				.bcma-settings-sound {\n					margin-bottom: 9px;\n				}\n				.bcma-settings-sound-title {\n					margin-bottom: 5px;\n					color: #93c5fd;\n					font-size: 12px;\n					font-weight: 600;\n				}\n				.bcma-settings-radio {\n					display: flex;\n					align-items: center;\n					gap: 6px;\n					margin: 3px 0;\n					cursor: pointer;\n				}\n				.bcma-settings-radio input {\n					accent-color: #3b82f6;\n				}\n\n				/* ===== v1.1.2 draggable settings + log export ===== */\n				#bcma-settings-panel {\n					position: absolute;\n					left: 50%;\n					top: 50%;\n					transform: translate(-50%, -50%);\n					margin: 0;\n				}\n				.bcma-settings-header {\n					cursor: grab;\n					user-select: none;\n					touch-action: none;\n				}\n				.bcma-settings-header:active {\n					cursor: grabbing;\n				}\n				.bcma-settings-log-info {\n					margin: 2px 0 8px;\n					padding: 6px 8px;\n					border: 1px solid rgba(255,255,255,0.1);\n					border-radius: 8px;\n					background: rgba(255,255,255,0.035);\n					font-size: 12px;\n					color: #cbd5e1;\n				}\n				.bcma-settings-log-row {\n					display: flex;\n					justify-content: space-between;\n					gap: 10px;\n					line-height: 1.6;\n				}\n				.bcma-settings-log-value {\n					color: #93c5fd;\n					text-align: right;\n					overflow: hidden;\n					text-overflow: ellipsis;\n					white-space: nowrap;\n				}\n				.bcma-settings-actions {\n					display: flex;\n					flex-wrap: wrap;\n					gap: 6px;\n					margin-top: 2px;\n				}\n				.bcma-settings-button,\n				.bcma-log-btn {\n					appearance: none;\n					-webkit-appearance: none;\n					margin: 0;\n					padding: 6px 9px;\n					border: 1px solid rgba(255,255,255,0.2);\n					border-radius: 7px;\n					background: #2a2d34;\n					color: #e5e7eb;\n					cursor: pointer;\n					font: 12px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;\n				}\n				.bcma-settings-button:hover,\n				.bcma-log-btn:hover {\n					background: #3a3f49;\n					border-color: rgba(255,255,255,0.35);\n				}\n				.bcma-settings-button.primary,\n				.bcma-log-btn.primary {\n					background: #1e3a5f;\n					border-color: #60a5fa;\n					color: #fff;\n				}\n				#bcma-log-overlay {\n					position: fixed;\n					inset: 0;\n					z-index: 2147483647;\n					display: grid;\n					place-items: center;\n					background: rgba(0,0,0,0.45);\n					pointer-events: auto;\n				}\n				#bcma-log-overlay[hidden] {\n					display: none;\n				}\n				#bcma-log-panel {\n					width: 340px;\n					max-width: calc(100vw - 24px);\n					max-height: calc(100vh - 24px);\n					overflow-y: auto;\n					box-sizing: border-box;\n					padding: 10px 12px 12px;\n					border: 1px solid rgba(255,255,255,0.18);\n					border-radius: 12px;\n					background: rgba(0,0,0,0.88);\n					box-shadow: 0 10px 40px rgba(0,0,0,0.5);\n					backdrop-filter: blur(8px);\n					color: #fff;\n					font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;\n				}\n				.bcma-log-header {\n					display: flex;\n					align-items: center;\n					justify-content: space-between;\n					gap: 8px;\n					margin-bottom: 6px;\n				}\n				.bcma-log-title {\n					margin: 0;\n					font-size: 16px;\n					font-weight: 700;\n				}\n				#bcma-log-close {\n					appearance: none;\n					-webkit-appearance: none;\n					width: 26px;\n					height: 26px;\n					padding: 0;\n					border: 1px solid transparent;\n					border-radius: 6px;\n					background: transparent;\n					color: #d1d5db;\n					cursor: pointer;\n					font: 700 18px/1 system-ui, -apple-system, "Segoe UI", sans-serif;\n				}\n				#bcma-log-close:hover {\n					background: rgba(220,38,38,0.2);\n					border-color: rgba(220,38,38,0.55);\n					color: #fecaca;\n				}\n				.bcma-log-source {\n					margin-bottom: 10px;\n					color: #93c5fd;\n					font-size: 12px;\n				}\n				.bcma-log-field {\n					margin-bottom: 8px;\n				}\n				.bcma-log-field[hidden] {\n					display: none;\n				}\n				.bcma-log-field-title {\n					margin: 8px 0 4px;\n					color: #e5e7eb;\n					font-size: 12px;\n					font-weight: 700;\n				}\n				.bcma-log-inline {\n					display: flex;\n					flex-wrap: wrap;\n					gap: 10px;\n				}\n				.bcma-log-check {\n					display: flex;\n					align-items: center;\n					gap: 6px;\n					margin: 4px 0;\n					cursor: pointer;\n				}\n				.bcma-log-check input {\n					accent-color: #3b82f6;\n				}\n				.bcma-log-footer {\n					display: flex;\n					justify-content: flex-end;\n					gap: 7px;\n					margin-top: 12px;\n				}\n\n				#bcma-settings-overlay:not([hidden]) {\n					display: block;\n				}\n\n				/* ===== v1.2.0 room actions ===== */\n				.bcma-room-actions {\n					position: absolute;\n					bottom: 1px;\n					left: 50%;\n					z-index: 6;\n					display: flex;\n					gap: 3px;\n					padding: 2px;\n					border: 1px solid rgba(255,255,255,0.18);\n					border-radius: 6px;\n					background: rgba(0,0,0,0.86);\n					box-shadow: 0 2px 10px rgba(0,0,0,0.45);\n					transform: translateX(-50%) translateY(3px);\n					opacity: 0;\n					visibility: hidden;\n					pointer-events: none;\n					transition: opacity 120ms ease, transform 120ms ease, visibility 120ms ease;\n				}\n				.bcma-account:hover .bcma-room-actions,\n				.bcma-account:focus-within .bcma-room-actions {\n					opacity: 1;\n					visibility: visible;\n					pointer-events: auto;\n					transform: translateX(-50%) translateY(0);\n				}\n				.bcma-room-action {\n					appearance: none;\n					-webkit-appearance: none;\n					width: 20px;\n					height: 20px;\n					margin: 0;\n					padding: 0;\n					border: 1px solid rgba(255,255,255,0.18);\n					border-radius: 5px;\n					background: #2a2d34;\n					color: #e5e7eb;\n					cursor: pointer;\n					font: 14px/1 system-ui, -apple-system, "Segoe UI", sans-serif;\n					outline: none;\n				}\n				.bcma-room-action:hover {\n					background: #3b82f6;\n					border-color: #93c5fd;\n					color: #fff;\n				}\n				.bcma-room-action:disabled {\n					opacity: 0.45;\n					cursor: wait;\n				}\n				@media (hover: none) {\n					.bcma-room-actions {\n						opacity: 1;\n						visibility: visible;\n						pointer-events: auto;\n						transform: translateX(-50%) translateY(0);\n					}\n				}\n\n				/* ===== v1.2.2 collapsible account bar ===== */\n				#bcma-bar-toggle {\n					appearance: none;\n					-webkit-appearance: none;\n					width: 16px;\n					height: 16px;\n					margin: 0;\n					padding: 0;\n					border: 1px solid transparent;\n					border-radius: 5px;\n					background: transparent;\n					color: #9ca3af;\n					cursor: pointer;\n					font: 700 14px/1 system-ui, -apple-system, "Segoe UI", sans-serif;\n					align-self: center;\n					flex: 0 0 auto;\n					outline: none;\n				}\n				#bcma-bar-toggle:hover {\n					background: rgba(255,255,255,0.1);\n					border-color: rgba(255,255,255,0.22);\n					color: #fff;\n				}\n				#bcma-bar.collapsed {\n					width: 52px;\n					min-width: 52px;\n					max-width: 52px;\n					padding: 3px 0 0;\n					gap: 0;\n					flex-direction: column;\n					align-items: center;\n				}\n				#bcma-bar.collapsed #bcma-bar-toggle {\n					width: 100%;\n					height: 24px;\n					border-radius: 9px;\n					background: rgba(255,255,255,0.07);\n					color: #e5e7eb;\n					font-size: 16px;\n				}\n				#bcma-bar.collapsed #bcma-drag,\n				#bcma-bar.collapsed #bcma-list,\n				#bcma-bar.collapsed #bcma-settings {\n					display: none;\n				}\n\n				#bcma-bar-toggle {\n					position: relative;\n				}\n				#bcma-bar-toggle::before {\n					content: "";\n					position: absolute;\n					left: -3px;\n					right: -3px;\n					top: 50%;\n					height: 40px;\n					transform: translateY(-50%);\n					border-radius: 8px;\n				}\n				#bcma-bar-toggle:hover::before {\n					background: rgba(255,255,255,0.08);\n				}\n				#bcma-bar.collapsed #bcma-bar-toggle::before {\n					display: none;\n				}\n';

  // src/parent/toolbar.js
  function createToolbar({ state, feed, handlers }) {
    function injectStyles() {
      if (document.getElementById("bcma-style")) return;
      const style = document.createElement("style");
      style.id = "bcma-style";
      style.textContent = styles_default;
      (document.head || document.documentElement).appendChild(style);
    }
    function setupDrag(bar) {
      const handle = bar.querySelector("#bcma-drag");
      let drag = null;
      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        const rect = bar.getBoundingClientRect();
        drag = {
          dx: event.clientX - rect.left,
          dy: event.clientY - rect.top,
          pointerId: event.pointerId
        };
        handle.setPointerCapture(event.pointerId);
      });
      handle.addEventListener("pointermove", (event) => {
        if (!drag) return;
        const maxLeft = Math.max(0, window.innerWidth - bar.offsetWidth);
        const maxTop = Math.max(0, window.innerHeight - bar.offsetHeight);
        const left = Math.max(0, Math.min(maxLeft, event.clientX - drag.dx));
        const top = Math.max(0, Math.min(maxTop, event.clientY - drag.dy));
        bar.style.left = `${left}px`;
        bar.style.top = `${top}px`;
        bar.style.transform = "none";
      });
      handle.addEventListener("pointercancel", () => {
        drag = null;
      });
      handle.addEventListener("pointerup", (event) => {
        if (!drag) return;
        drag = null;
        try {
          handle.releasePointerCapture(event.pointerId);
        } catch {
        }
        try {
          localStorage.setItem("bcma.pos", JSON.stringify({ left: bar.style.left, top: bar.style.top }));
        } catch {
        }
      });
    }
    function updateBarToggle() {
      const bar = state.toolbar;
      if (!bar) return;
      const toggle = bar.querySelector("#bcma-bar-toggle");
      if (!toggle) return;
      const collapsed = bar.classList.contains("collapsed");
      const count = state.accounts?.length || 0;
      toggle.textContent = collapsed ? `\u203A ${count}` : "\u2039";
      toggle.title = collapsed ? `\u5C55\u5F00\u8D26\u53F7\u680F\uFF08${count} \u4E2A\u8D26\u53F7\uFF09` : "\u6536\u8D77\u8D26\u53F7\u680F";
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
    function setCollapsed(collapsed, persist = true) {
      const bar = state.toolbar;
      if (!bar) return;
      bar.classList.toggle("collapsed", !!collapsed);
      updateBarToggle();
      if (!collapsed) {
        const rect = bar.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
          bar.style.transform = "none";
          bar.style.left = `${Math.max(0, window.innerWidth - bar.offsetWidth)}px`;
        }
        if (rect.bottom > window.innerHeight) {
          bar.style.top = `${Math.max(0, window.innerHeight - bar.offsetHeight)}px`;
        }
      }
      if (persist) {
        try {
          localStorage.setItem("bcma.barCollapsed", collapsed ? "1" : "0");
        } catch {
        }
      }
    }
    function mount() {
      injectStyles();
      const old = document.getElementById("bcma-bar");
      if (old) old.remove();
      const bar = document.createElement("div");
      bar.id = "bcma-bar";
      bar.innerHTML = '<button id="bcma-bar-toggle" type="button" title="\u6536\u8D77\u8D26\u53F7\u680F" aria-controls="bcma-list" aria-expanded="true">\u2039</button><div id="bcma-drag" title="\u62D6\u52A8\u5DE5\u5177\u680F">\u283F</div><div id="bcma-list"></div><button id="bcma-feed-toggle" type="button" title="\u540E\u53F0\u6D88\u606F" aria-controls="bcma-feed" aria-expanded="false">\u25B8</button><div id="bcma-feed" hidden></div><button id="bcma-settings" type="button" title="\u8BBE\u7F6E">\u2699</button>';
      document.body.appendChild(bar);
      state.toolbar = bar;
      feed.bind(bar.querySelector("#bcma-feed"), bar.querySelector("#bcma-feed-toggle"));
      bar.querySelector("#bcma-settings").addEventListener("click", handlers.onSettings);
      const barToggle = bar.querySelector("#bcma-bar-toggle");
      barToggle.addEventListener("click", (event) => {
        event.stopPropagation();
        setCollapsed(!bar.classList.contains("collapsed"));
      });
      try {
        setCollapsed(localStorage.getItem("bcma.barCollapsed") === "1", false);
      } catch {
      }
      try {
        const saved = JSON.parse(localStorage.getItem("bcma.pos") || "null");
        if (saved && saved.left && saved.top) {
          bar.style.left = saved.left;
          bar.style.top = saved.top;
          bar.style.transform = "none";
          const rect = bar.getBoundingClientRect();
          bar.style.left = `${Math.max(0, Math.min(rect.left, window.innerWidth - rect.width))}px`;
          bar.style.top = `${Math.max(0, Math.min(rect.top, window.innerHeight - rect.height))}px`;
        }
      } catch {
      }
      setupDrag(bar);
    }
    function accountLabel(acc, index) {
      return acc.name || `\u8D26\u53F7 ${index + 1}`;
    }
    function badgeOf(acc) {
      const { whisper, chat, action, activity } = acc.unread;
      const total = whisper + chat + action + activity;
      let cls = "muted";
      if (whisper > 0) cls = "whisper";
      else if (chat > 0) cls = "chat";
      return {
        total,
        cls,
        title: `\u79C1\u804A/Beep ${whisper} \xB7 \u804A\u5929 ${chat} \xB7 \u52A8\u4F5C ${action} \xB7 \u4E92\u52A8 ${activity}`
      };
    }
    function buildAccountEntry(acc, index) {
      const wrap = document.createElement("div");
      wrap.className = "bcma-account " + (acc.online ? "online" : "offline");
      const label = accountLabel(acc, index);
      const close = document.createElement("button");
      close.type = "button";
      close.className = "bcma-close" + (acc.top ? " disabled" : "");
      close.textContent = "\xD7";
      close.title = acc.top ? "\u4E3B\u8D26\u53F7\u662F\u5F53\u524D\u9875\u9762\uFF0C\u65E0\u6CD5\u5355\u72EC\u5173\u95ED" : `\u5173\u95ED ${label} \u7A97\u683C`;
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        if (acc.top) {
          window.alert("\u4E3B\u8D26\u53F7\u662F\u5F53\u524D\u9875\u9762\uFF0C\u65E0\u6CD5\u5355\u72EC\u5173\u95ED\u3002\u8BF7\u5173\u95ED\u6574\u4E2A\u6807\u7B7E\u9875\u3002");
          return;
        }
        handlers.onRemove(acc.key);
      });
      wrap.appendChild(close);
      const icon = document.createElement("div");
      icon.className = "bcma-icon";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "bcma-acc " + (acc.online ? "online" : "offline") + (acc.key === state.activeKey ? " active" : "");
      const status = acc.online ? "\u5728\u7EBF" : acc.loggedIn ? "\u8FDE\u63A5\u65AD\u5F00" : "\u672A\u767B\u5F55";
      button.title = `${label}${acc.member ? ` (#${acc.member})` : ""}
${status}` + (acc.room ? `
\u623F\u95F4\uFF1A${acc.room}` : "") + `
\u5DE6\u952E\u5207\u6362`;
      const avatar = document.createElement("span");
      avatar.className = "bcma-avatar";
      avatar.textContent = String(index + 1);
      button.appendChild(avatar);
      button.addEventListener("click", () => handlers.onSwitch(acc.key));
      icon.appendChild(button);
      const badge = badgeOf(acc);
      const unread = document.createElement("span");
      unread.className = `bcma-unread ${badge.total > 0 ? badge.cls : "empty"}`;
      unread.textContent = badge.total > 99 ? "99+" : String(badge.total);
      unread.title = badge.title;
      icon.appendChild(unread);
      wrap.appendChild(icon);
      const name = document.createElement("span");
      name.className = "bcma-name";
      name.textContent = acc.loggedIn && acc.name ? acc.name : "Empty";
      wrap.appendChild(name);
      if (acc.loggedIn && acc.name && acc.room) {
        const room = document.createElement("span");
        room.className = "bcma-room";
        room.textContent = acc.room;
        wrap.appendChild(room);
      }
      const canFollow = acc.key !== state.activeKey && handlers.canFollow?.(acc);
      const canSwap = acc.key !== state.activeKey && handlers.canSwap?.(acc);
      if (canFollow) {
        const actions = document.createElement("div");
        actions.className = "bcma-room-actions";
        actions.addEventListener("click", (event) => event.stopPropagation());
        const follow = document.createElement("button");
        follow.type = "button";
        follow.className = "bcma-room-action";
        follow.textContent = "\u21AA";
        follow.title = `\u5F53\u524D\u8D26\u53F7\u8FDB\u5165 ${acc.room}`;
        follow.addEventListener("click", (event) => {
          event.stopPropagation();
          handlers.onFollow?.(acc);
        });
        actions.appendChild(follow);
        if (canSwap) {
          const swap = document.createElement("button");
          swap.type = "button";
          swap.className = "bcma-room-action";
          swap.textContent = "\u21C4";
          const active = state.accounts.find((a) => a.key === state.activeKey);
          swap.title = active && !active.inRoom ? `\u524D\u53F0\u8FDB\u5165\u8BE5\u623F\u95F4\uFF0C\u5E76\u8BA9 ${label} \u79BB\u5F00\uFF08\u5F53\u524D\u8D26\u53F7\u5728\u5927\u5385\uFF09` : `\u4EA4\u6362\u4E24\u4E2A\u8D26\u53F7\u7684\u623F\u95F4\uFF1A${acc.room}`;
          swap.addEventListener("click", (event) => {
            event.stopPropagation();
            handlers.onSwap?.(acc);
          });
          actions.appendChild(swap);
        }
        wrap.appendChild(actions);
      }
      return wrap;
    }
    function buildAddButton() {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "bcma-add";
      button.textContent = "+";
      button.title = `\u6DFB\u52A0\u8D26\u53F7\uFF08\u6700\u591A ${MAX_ACCOUNTS} \u4E2A\uFF09`;
      button.addEventListener("click", handlers.onAdd);
      return button;
    }
    function render() {
      if (!state.toolbar) return;
      const list = state.toolbar.querySelector("#bcma-list");
      if (!list) return;
      const frag = document.createDocumentFragment();
      state.accounts.forEach((acc, index) => frag.appendChild(buildAccountEntry(acc, index)));
      frag.appendChild(buildAddButton());
      list.replaceChildren(frag);
      updateBarToggle();
    }
    return { mount, render };
  }

  // src/core/fullscreen.js
  function leaveFullscreen() {
    try {
      const result = document.exitFullscreen && document.exitFullscreen();
      if (result && typeof result.catch === "function") result.catch(() => {
      });
    } catch {
    }
  }

  // src/core/chat.js
  function messageRoom() {
    const info = getAccountInfo();
    return info.room || "\u5927\u5385";
  }
  function currentRoomName() {
    return getAccountInfo().room || "";
  }
  function scrollChatToBottom() {
    if (typeof window.ServerPlayerIsInChatRoom === "function" && !window.ServerPlayerIsInChatRoom()) return;
    const log = document.getElementById("TextAreaChatLog");
    if (!log) return;
    log.scrollTop = log.scrollHeight;
  }

  // src/parent/accounts.js
  function createAccounts({ state, render, configureAccount, afterSwitch }) {
    function createFrame(key) {
      const url = new URL(location.href);
      if (!url.pathname.endsWith("/") && !/\.[^/]+$/.test(url.pathname)) url.pathname += "/";
      url.hash = `${HASH_KEY}=${key}`;
      const frame = document.createElement("iframe");
      frame.className = "bcma-frame";
      frame.title = `BC account ${key}`;
      frame.src = url.href;
      frame.allow = "clipboard-read; clipboard-write; fullscreen";
      frame.setAttribute("allowfullscreen", "");
      frame.style.display = "none";
      document.body.appendChild(frame);
      return frame;
    }
    function postTo(acc, message) {
      if (!acc || !acc.frame) return;
      try {
        acc.frame.contentWindow.postMessage({ channel: CHANNEL, ...message }, "*");
      } catch (err) {
        console.warn("[BC Multi] postTo failed", err);
      }
    }
    function accountLabel(acc, index) {
      return acc.name || `\u8D26\u53F7 ${index + 1}`;
    }
    function applyInfo(acc, info) {
      if (!acc || !info || typeof info !== "object") return;
      if (typeof info.loggedIn === "boolean") acc.loggedIn = info.loggedIn;
      if (typeof info.online === "boolean") acc.online = info.online;
      if (typeof info.name === "string") acc.name = info.name;
      if (typeof info.account === "string") acc.account = info.account;
      if (typeof info.memberNumber === "number") acc.member = info.memberNumber;
      else if (info.memberNumber === null) acc.member = null;
      if (typeof info.inRoom === "boolean") acc.inRoom = info.inRoom;
      if (typeof info.room === "string") acc.room = info.room;
      if (typeof info.roomSpace === "string") acc.roomSpace = info.roomSpace;
      if (typeof info.roomMemberCount === "number") acc.roomMemberCount = info.roomMemberCount;
    }
    function clearUnread(acc) {
      if (!acc) return;
      acc.unread = emptyUnread();
    }
    function focus(acc) {
      if (!acc) return;
      if (acc.top) {
        const canvas = document.getElementById("MainCanvas");
        if (canvas) canvas.focus();
      } else {
        const win = acc.frame && acc.frame.contentWindow;
        if (win) {
          setTimeout(() => {
            try {
              win.focus();
            } catch {
            }
          }, 0);
        }
      }
    }
    function requestScrollBottom(acc) {
      if (!acc) return;
      setTimeout(() => {
        if (acc.top) {
          scrollChatToBottom();
        } else {
          postTo(acc, { type: MSG.SCROLL_BOTTOM });
        }
      }, 120);
    }
    function switchTo(key) {
      const acc = state.accounts.find((a) => a.key === key);
      if (!acc) return;
      if (state.activeKey === key) {
        clearUnread(acc);
        render();
        focus(acc);
        requestScrollBottom(acc);
        afterSwitch?.();
        return;
      }
      if (!acc.top && document.fullscreenElement) {
        leaveFullscreen();
      }
      state.activeKey = key;
      state.topActive = !!acc.top;
      for (const other of state.accounts) {
        if (other.top) continue;
        other.frame.style.display = other.key === key ? "block" : "none";
        postTo(other, { type: MSG.SET_ACTIVE, active: other.key === key });
      }
      for (const other of state.accounts) configureAccount?.(other);
      clearUnread(acc);
      render();
      focus(acc);
      requestScrollBottom(acc);
      afterSwitch?.();
    }
    function add() {
      if (state.accounts.length >= MAX_ACCOUNTS) {
        window.alert(`\u6700\u591A\u540C\u65F6\u6253\u5F00 ${MAX_ACCOUNTS} \u4E2A\u8D26\u53F7\u3002`);
        return;
      }
      const key = state.nextKey++;
      const frame = createFrame(key);
      const acc = {
        key,
        top: false,
        frame,
        name: "",
        account: "",
        auth: null,
        member: null,
        loggedIn: false,
        online: false,
        inRoom: false,
        room: "",
        roomSpace: "",
        roomMemberCount: 0,
        ready: false,
        unread: emptyUnread()
      };
      state.accounts.push(acc);
      render();
      switchTo(key);
      setTimeout(() => {
        if (!acc.ready && state.accounts.includes(acc)) {
          console.warn(
            `[BC Multi] ${accountLabel(acc, state.accounts.indexOf(acc))} did not report ready after 20s. Check whether the game is blocked from being framed (X-Frame-Options / CSP frame-ancestors).`
          );
        }
      }, 2e4);
    }
    function remove(key) {
      const index = state.accounts.findIndex((a) => a.key === key);
      if (index < 0) return;
      const acc = state.accounts[index];
      if (acc.top) return;
      if (!window.confirm(`\u786E\u8BA4\u5173\u95ED\u300C${accountLabel(acc, index)}\u300D\u7A97\u683C\uFF1F`)) return;
      postTo(acc, { type: MSG.LOG_FLUSH });
      setTimeout(() => {
        try {
          acc.frame.remove();
        } catch {
        }
        state.accounts.splice(index, 1);
        if (state.activeKey === key) {
          switchTo(state.accounts[0].key);
        } else {
          render();
        }
      }, 150);
    }
    function addTop() {
      state.accounts.push({
        key: 1,
        top: true,
        frame: null,
        name: "",
        account: "",
        auth: null,
        member: null,
        loggedIn: false,
        online: false,
        inRoom: false,
        room: "",
        roomSpace: "",
        roomMemberCount: 0,
        ready: true,
        unread: emptyUnread()
      });
    }
    return {
      createFrame,
      postTo,
      applyInfo,
      clearUnread,
      focus,
      requestScrollBottom,
      switchTo,
      add,
      remove,
      addTop
    };
  }

  // src/core/messages.js
  function classifyMessage(data) {
    if (!data || typeof data.Type !== "string") return null;
    switch (data.Type) {
      case "Whisper":
        return "whisper";
      case "Chat":
        return "chat";
      case "Action":
        return "action";
      case "Activity":
        return "activity";
      case "ServerMessage":
        return "system";
      default:
        return null;
    }
  }
  function isUnreadKind(kind) {
    return kind === "whisper" || kind === "chat" || kind === "action" || kind === "activity";
  }
  function isIncoming(data, player) {
    if (!data || typeof data !== "object") return false;
    const self = player && player.MemberNumber;
    const sender = typeof data.Sender === "number" ? data.Sender : Number(data.Sender);
    const target = typeof data.Target === "number" ? data.Target : null;
    if (Number.isFinite(sender) && typeof self === "number" && sender === self) {
      return false;
    }
    if (data.Type === "Whisper" && target !== null && typeof self === "number" && target !== self) {
      return false;
    }
    return true;
  }
  function messageId(data) {
    if (!Array.isArray(data.Dictionary)) return null;
    for (const entry of data.Dictionary) {
      if (entry && typeof entry === "object" && typeof entry.MsgId === "string") {
        return entry.MsgId;
      }
    }
    return null;
  }
  function stripFeedNoise(text) {
    let result = String(text ?? "").trim();
    while (true) {
      const before = result;
      result = result.replace(
        /^\s*[\[(]?\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?[\])]?\s*[-–—:·]?\s*/,
        ""
      ).replace(
        /^\s*[\[(]?\d{1,2}:\d{2}(?::\d{2})?[\])]?\s*[-–—:·]?\s*/,
        ""
      ).replace(
        /^\s*(?:#\s*\d+|ID\s*[:：]?\s*\d+|\[\s*#?\d+\s*\]|\(\s*#?\d+\s*\))\s*[-–—:·]?\s*/i,
        ""
      ).trim();
      if (result === before) break;
    }
    return result;
  }
  function formatDisplayMessage(kind, msg) {
    let text = String(msg ?? "");
    if (typeof window.CommonCensor === "function") {
      try {
        text = window.CommonCensor(text);
      } catch {
      }
    }
    if (text === "\xB6\xB6\xB6") return null;
    text = stripFeedNoise(text);
    if (!text) return null;
    if (kind === "action" || kind === "activity") text = `(${text})`;
    return text;
  }
  function extractOriginalMessage(data, metadata, kind, msg, sender) {
    let raw = typeof metadata?.OriginalMsg === "string" && metadata.OriginalMsg.trim() ? metadata.OriginalMsg : "";
    if (!raw && Array.isArray(data?.Dictionary)) {
      const entry = data.Dictionary.find((item) => item && Array.isArray(item.Effects) && typeof item.Original === "string" && item.Original.trim() !== "");
      raw = entry?.Original || "";
    }
    if (!raw) return "";
    if (raw !== metadata?.OriginalMsg) {
      try {
        const extracted = window.ChatRoomMessageRunExtractors?.(data, sender);
        const substitutions = extracted?.substitutions;
        if (Array.isArray(substitutions) && typeof window.CommonStringSubstitute === "function") {
          raw = window.CommonStringSubstitute(raw, substitutions);
        }
      } catch {
      }
    }
    const original = formatDisplayMessage(kind, raw);
    if (!original) return "";
    const current = formatDisplayMessage(kind, msg);
    if (!current || original === current) return "";
    return original;
  }
  function displayNameOf(sender) {
    if (!sender) return "";
    try {
      if (typeof window.CharacterNickname === "function") {
        const nick = window.CharacterNickname(sender);
        if (typeof nick === "string" && nick.trim()) return nick.trim();
      }
    } catch {
    }
    if (typeof sender.Nickname === "string" && sender.Nickname.trim()) return sender.Nickname.trim();
    if (typeof sender.Name === "string" && sender.Name.trim()) return sender.Name.trim();
    if (typeof sender.MemberNumber === "number") return `#${sender.MemberNumber}`;
    return "";
  }
  function handleDisplayMessage(data, sender, msg, metadata, seen, report) {
    const kind = classifyMessage(data);
    if (!kind || !isUnreadKind(kind)) return;
    if (!isIncoming(data, window.Player)) return;
    const id = metadata && typeof metadata.MsgId === "string" && metadata.MsgId || messageId(data);
    if (id) {
      if (seen.has(id)) return;
      seen.add(id);
      if (seen.size > 2e3) seen.clear();
    }
    let text = formatDisplayMessage(kind, msg);
    if (!text) return;
    if (kind === "chat" || kind === "whisper") {
      const speaker = displayNameOf(sender);
      if (speaker) text = `${speaker}: ${text}`;
    }
    report(kind, text, messageRoom(), id, Number(data?.Sender) || 0);
  }

  // src/core/room.js
  function sameRoom(a, b) {
    const left = String(a || "").trim();
    const right = String(b || "").trim();
    return left !== "" && right !== "" && left === right;
  }
  function isSameRoomChatOrAction(kind, room, activeRoom) {
    return (kind === "chat" || kind === "action" || kind === "activity") && sameRoom(room, activeRoom);
  }

  // src/parent/bridge.js
  function createParentBridge({ state, accounts, feed, scheduleRender, configureAccount, logger, roomCoordinator }) {
    function listen() {
      window.addEventListener("message", (event) => {
        const data = event.data;
        if (!data || data.channel !== CHANNEL) return;
        const acc = state.accounts.find((a) => a.frame && a.frame.contentWindow === event.source);
        if (!acc) return;
        if (roomCoordinator?.handleMessage(acc, data)) return;
        switch (data.type) {
          case MSG.READY: {
            acc.ready = true;
            accounts.applyInfo(acc, data);
            accounts.clearUnread(acc);
            configureAccount?.(acc);
            accounts.postTo(acc, { type: MSG.SET_ACTIVE, active: acc.key === state.activeKey });
            if (acc.key === state.activeKey) {
              accounts.requestScrollBottom(acc);
              feed.render();
            }
            scheduleRender();
            break;
          }
          case MSG.ACCOUNT: {
            accounts.applyInfo(acc, data);
            if (acc.key === state.activeKey) feed.render();
            scheduleRender();
            break;
          }
          case MSG.NAME: {
            accounts.applyInfo(acc, data);
            scheduleRender();
            break;
          }
          case MSG.UNREAD: {
            if (acc.key === state.activeKey) break;
            if (!isUnreadKind(data.kind)) break;
            const active = state.accounts.find((a) => a.key === state.activeKey);
            if (isSameRoomChatOrAction(data.kind, data.room, active?.room)) break;
            acc.unread[data.kind] += 1;
            feed.push(data.room, data.text, {
              kind: data.kind,
              accountKey: acc.key,
              id: data.id,
              sender: data.sender
            });
            scheduleRender();
            break;
          }
          case MSG.SWITCH_REQUEST: {
            if (!Number.isInteger(data.index)) break;
            const target = state.accounts[data.index - 1];
            if (target) accounts.switchTo(target.key);
            break;
          }
          case MSG.CREDENTIAL_REQUEST: {
            const account = normalizeAccountName(data.account);
            if (!account || acc.account && account !== normalizeAccountName(acc.account)) {
              accounts.postTo(acc, {
                type: MSG.CREDENTIAL,
                reqId: data.reqId,
                password: null,
                reason: "mismatch"
              });
              break;
            }
            if (Date.now() < state.pausedUntil) {
              accounts.postTo(acc, {
                type: MSG.CREDENTIAL,
                reqId: data.reqId,
                password: null,
                reason: "paused",
                retryIn: state.pausedUntil - Date.now() + 1e3
              });
              break;
            }
            const password = state.credentials.get(account) || null;
            accounts.postTo(acc, {
              type: MSG.CREDENTIAL,
              reqId: data.reqId,
              password,
              reason: password ? void 0 : "missing"
            });
            break;
          }
          case MSG.CREDENTIAL_SAVE: {
            const account = normalizeAccountName(data.account);
            const password = typeof data.password === "string" ? data.password : "";
            if (!account || !password) break;
            state.credentials.set(account, password);
            acc.account = account;
            scheduleRender();
            break;
          }
          case MSG.AUTH: {
            acc.auth = {
              phase: typeof data.phase === "string" ? data.phase : "idle",
              reason: typeof data.reason === "string" ? data.reason : "",
              attempts: Number(data.attempts) || 0
            };
            if (acc.auth.phase === "idle") state.pausedUntil = 0;
            scheduleRender();
            break;
          }
          case MSG.RATE_LIMITED: {
            state.pausedUntil = Date.now() + RC.GLOBAL_PAUSE_MS + Math.random() * RC.GLOBAL_PAUSE_JITTER_MS;
            break;
          }
          case MSG.LOG_BATCH: {
            logger?.ingest(data.records, acc.account, acc.member, acc.name);
            break;
          }
          case MSG.ALIVE: {
            acc.lastAlive = Date.now();
            break;
          }
          case MSG.ERROR: {
            console.warn(`[BC Multi] ${acc.name}:`, data.message);
            break;
          }
          default:
            break;
        }
      });
    }
    return { listen };
  }

  // src/core/async.js
  function waitFor(getter, timeout = 3e4) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      (function poll() {
        try {
          const value = getter();
          if (value) return resolve(value);
        } catch {
        }
        if (Date.now() - started > timeout) return reject(new Error("waitFor timeout"));
        setTimeout(poll, 100);
      })();
    });
  }

  // src/core/beep.js
  function parseBeepMessage(raw) {
    try {
      return typeof window.FriendListBeepParseMessage === "function" ? window.FriendListBeepParseMessage(raw ?? "") : null;
    } catch {
      return null;
    }
  }
  function isChatBeep(data) {
    if (!data || typeof data !== "object") return false;
    if (data.BeepType) return false;
    if (typeof data.Message !== "string" || data.Message.trim() === "") return false;
    const member = Number(data.MemberNumber);
    return Number.isFinite(member) && member > 0;
  }
  function isReactionBeep(data) {
    const parsed = parseBeepMessage(data && data.Message);
    return !!parsed && parsed.metadata?.messageType === "Reaction";
  }
  function isRecordableBeep(data) {
    return isChatBeep(data) && !isReactionBeep(data);
  }
  function countBeep(data, seen, report) {
    if (!isRecordableBeep(data)) return;
    const parsed = parseBeepMessage(data.Message);
    const id = parsed && parsed.metadata && parsed.metadata.messageId;
    if (typeof id === "string" && id) {
      if (seen.has(id)) return;
      seen.add(id);
      if (seen.size > 2e3) seen.clear();
    }
    report("whisper", data);
  }
  function beepText(data) {
    const parsed = parseBeepMessage(data && data.Message);
    const text = parsed && typeof parsed.text === "string" ? parsed.text.trim() : data && typeof data.Message === "string" ? data.Message.trim() : "";
    return stripFeedNoise(text) || "(Beep)";
  }
  function beepSpeaker(data) {
    const name = typeof data?.MemberName === "string" ? data.MemberName.trim() : "";
    const member = Number(data?.MemberNumber) || 0;
    if (name && member) return `${name} #${member}`;
    if (name) return name;
    if (member) return `#${member}`;
    return "";
  }
  function beepPreviewText(data) {
    const speaker = beepSpeaker(data);
    const text = beepText(data);
    return speaker ? `${speaker}: ${text}` : text;
  }

  // src/core/display-hook.js
  function installMessageDisplayHook(handler) {
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
        }
      });
    }
    return true;
  }

  // src/core/mod-sdk.js
  function hookPresence(mod, publish) {
    for (const name of ["ServerConnect", "ServerDisconnect"]) {
      if (typeof window[name] !== "function") continue;
      mod.hookFunction(name, 5, (args, next) => {
        const result = next(args);
        setTimeout(() => {
          try {
            publish();
          } catch {
          }
        }, 0);
        return result;
      });
    }
  }
  function hookAuthInfo(mod, publish) {
    if (typeof window.LoginResponse !== "function") return;
    mod.hookFunction("LoginResponse", 5, (args, next) => {
      const result = next(args);
      setTimeout(() => {
        try {
          publish();
        } catch {
        }
      }, 300);
      return result;
    });
  }
  function hookRoomInfo(mod, publish) {
    if (typeof window.ChatRoomSync === "function") {
      mod.hookFunction("ChatRoomSync", 5, (args, next) => {
        const result = next(args);
        Promise.resolve(result).then(
          () => {
            try {
              publish();
            } catch {
            }
          },
          () => {
            try {
              publish();
            } catch {
            }
          }
        );
        return result;
      });
    }
    if (typeof window.ChatRoomLeave === "function") {
      mod.hookFunction("ChatRoomLeave", 5, (args, next) => {
        const result = next(args);
        setTimeout(() => {
          try {
            publish();
          } catch {
          }
        }, 0);
        return result;
      });
    }
  }

  // src/core/log-batcher.js
  function createLogBatcher(sendBatch, { batchSize = 32, interval = 250, maxQueue = 512 } = {}) {
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

  // src/core/log-record.js
  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function fnv1a(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(36);
  }
  function makeRecord({ data, sender, msg, metadata, room, player, maxChars = 8e3, now = Date.now() }) {
    const kind = classifyMessage(data);
    if (!kind) return null;
    const text = formatDisplayMessage(kind, msg);
    if (!text) return null;
    const member = Number(sender?.MemberNumber) || 0;
    const playerId = Number(player?.MemberNumber) || 0;
    const self = playerId === member && member !== 0;
    const msgid = metadata?.MsgId || messageId(data);
    const body = text.slice(0, maxChars);
    const original = extractOriginalMessage(data, metadata, kind, msg, sender);
    return {
      // Include the receiving PlayerID so the same room message is stored once
      // per account instead of being overwritten by another recipient.
      uid: msgid ? `${playerId}|${member}|${msgid}` : `${playerId}|${member}|${fnv1a(body)}|${Math.floor(now / 1e3)}`,
      member,
      name: displayNameOf(sender),
      self,
      account: "",
      playerId,
      playerName: typeof player?.Name === "string" ? player.Name : "",
      color: typeof sender?.LabelColor === "string" ? sender.LabelColor : "",
      kind,
      // New in v1.1.3: whispers keep the room the receiving player was in.
      room: room || "",
      target: typeof data?.Target === "number" ? data.Target : null,
      text: body,
      ...original ? { original: original.slice(0, maxChars) } : {},
      ts: now,
      day: dayKey(now),
      direction: self ? "out" : "in"
    };
  }
  function makeBeepRecord({ data, player, maxChars = 8e3, now = Date.now() }) {
    if (!data || typeof data !== "object") return null;
    const text = beepText(data).slice(0, maxChars);
    if (!text) return null;
    const member = Number(data.MemberNumber) || 0;
    const playerId = Number(player?.MemberNumber) || 0;
    const parsed = parseBeepMessage(data.Message);
    const msgid = parsed?.metadata?.messageId;
    return {
      uid: msgid ? `${playerId}|${member}|${msgid}` : `${playerId}|${member}|${fnv1a(text)}|${Math.floor(now / 1e3)}`,
      member,
      name: typeof data.MemberName === "string" ? data.MemberName : "",
      self: false,
      account: "",
      playerId,
      playerName: typeof player?.Name === "string" ? player.Name : "",
      color: "",
      kind: "beep",
      room: "",
      target: null,
      text,
      ts: now,
      day: dayKey(now),
      direction: "in"
    };
  }
  function makeOutgoingBeepRecord({ target, msg, player, maxChars = 8e3, now = Date.now() }) {
    const member = Number(target) || 0;
    if (member <= 0) return null;
    if (typeof msg !== "string" || msg.trim() === "") return null;
    const text = beepText({ Message: msg }).slice(0, maxChars);
    if (!text) return null;
    const playerId = Number(player?.MemberNumber) || 0;
    const parsed = parseBeepMessage(msg);
    const msgid = parsed?.metadata?.messageId;
    const friendName = player?.FriendNames && typeof player.FriendNames.get === "function" ? player.FriendNames.get(member) : "";
    return {
      uid: msgid ? `${playerId}|${member}|${msgid}` : `${playerId}|${member}|${fnv1a(text)}|${Math.floor(now / 1e3)}`,
      member,
      name: typeof friendName === "string" && friendName ? friendName : `#${member}`,
      self: true,
      account: "",
      playerId,
      playerName: typeof player?.Name === "string" ? player.Name : "",
      color: typeof player?.LabelColor === "string" ? player.LabelColor : "",
      kind: "beep",
      room: "",
      target: member,
      text,
      ts: now,
      day: dayKey(now),
      direction: "out"
    };
  }

  // src/parent/top-hooks.js
  async function installTopHooks({ state, feed, scheduleRender, updateInfo, logger }) {
    const topBatcher = createLogBatcher((records) => {
      const top = state.accounts.find((a) => a.top);
      logger?.ingest(records, top?.account, top?.member, top?.name);
    });
    window.addEventListener("beforeunload", () => topBatcher.flush());
    const sdk = await waitFor(() => window.bcModSdk, 2e4).catch(() => null);
    if (!sdk) {
      console.warn("[BC Multi] bcModSdk not found; unread counting for account 1 is disabled");
      return;
    }
    const mod = sdk.registerMod({
      name: "BCMultiAccount",
      fullName: "BC Multi-Account Switcher",
      version: VERSION
    }, { allowReplace: true });
    state.mod = mod;
    hookPresence(mod, () => updateInfo(true));
    hookAuthInfo(mod, () => updateInfo(true));
    hookRoomInfo(mod, () => updateInfo(true));
    function installDisplayCapture() {
      installMessageDisplayHook((data, sender, msg, metadata) => {
        const top = state.accounts.find((a) => a.top);
        const record = makeRecord({
          data,
          sender,
          msg,
          metadata,
          room: currentRoomName(),
          player: window.Player
        });
        if (record) topBatcher.push(record);
        if (state.topActive) return;
        handleDisplayMessage(data, sender, msg, metadata, state.topSeen, (kind, text, room, id, senderId) => {
          if (!top) return;
          const active = state.accounts.find((a) => a.key === state.activeKey);
          if (isSameRoomChatOrAction(kind, room, active?.room)) return;
          top.unread[kind] += 1;
          feed.push(room, text, { kind, accountKey: 1, id, sender: senderId });
          scheduleRender();
        });
      });
    }
    const registerHandler = await waitFor(
      () => typeof window.ChatRoomRegisterMessageHandler === "function" ? window.ChatRoomRegisterMessageHandler : null,
      3e4
    ).catch(() => null);
    if (registerHandler) {
      installDisplayCapture();
    } else {
      console.warn("[BC Multi] ChatRoomRegisterMessageHandler not found; chat unread capture disabled");
    }
    const serverAccountBeep = await waitFor(
      () => typeof window.ServerAccountBeep === "function" ? window.ServerAccountBeep : null,
      3e4
    ).catch(() => null);
    if (serverAccountBeep) {
      mod.hookFunction("ServerAccountBeep", 5, (args, next) => {
        const data = args[0];
        const top = state.accounts.find((a) => a.top);
        if (isRecordableBeep(data)) {
          const record = makeBeepRecord({ data, player: window.Player });
          if (record) topBatcher.push(record);
          if (!state.topActive) {
            countBeep(data, state.topSeen, (kind, beep) => {
              if (!top) return;
              top.unread[kind] += 1;
              feed.push(messageRoom(), beepPreviewText(beep), { kind: "beep", accountKey: 1 });
              scheduleRender();
            });
          }
        }
        return next(args);
      });
    }
    const serverSend = await waitFor(
      () => typeof window.ServerSend === "function" ? window.ServerSend : null,
      3e4
    ).catch(() => null);
    if (serverSend) {
      mod.hookFunction("ServerSend", 5, (args, next) => {
        const [message, data] = args;
        if (message === "AccountBeep" && isRecordableBeep(data)) {
          const record = makeOutgoingBeepRecord({
            target: data.MemberNumber,
            msg: data.Message,
            player: window.Player
          });
          if (record) topBatcher.push(record);
        }
        return next(args);
      });
    }
    const drawProcess = await waitFor(
      () => typeof window.DrawProcess === "function" ? window.DrawProcess : null,
      3e4
    ).catch(() => null);
    if (drawProcess) {
      mod.hookFunction("DrawProcess", 5, (args, next) => {
        if (!state.topActive) return;
        return next(args);
      });
    }
    return mod;
  }

  // src/parent/settings.js
  var SOUND_MODES = Object.freeze(["all", "notification", "mute"]);
  function defaultSettings() {
    return {
      autoReconnect: true,
      sounds: {
        active: "all",
        background: "mute"
      },
      log: {
        enabled: true
      }
    };
  }
  function normalizeSoundMode(value, fallback) {
    return SOUND_MODES.includes(value) ? value : fallback;
  }
  function normalizeSettings(raw) {
    const fallback = defaultSettings();
    const data = raw && typeof raw === "object" ? raw : {};
    const sounds = data.sounds && typeof data.sounds === "object" ? data.sounds : {};
    const log = data.log && typeof data.log === "object" ? data.log : {};
    return {
      autoReconnect: typeof data.autoReconnect === "boolean" ? data.autoReconnect : fallback.autoReconnect,
      sounds: {
        active: normalizeSoundMode(sounds.active, fallback.sounds.active),
        background: normalizeSoundMode(sounds.background, fallback.sounds.background)
      },
      log: {
        enabled: typeof log.enabled === "boolean" ? log.enabled : fallback.log.enabled
      }
    };
  }
  function loadSettings() {
    try {
      return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null"));
    } catch {
      return normalizeSettings(null);
    }
  }
  function saveSettings(settings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
    } catch {
    }
  }

  // src/parent/settings-dialog.js
  var SOUND_OPTIONS = [
    { value: "all", label: "\u6240\u6709\u58F0\u97F3" },
    { value: "notification", label: "\u4EC5\u63D0\u793A\u97F3" },
    { value: "mute", label: "\u9759\u97F3" }
  ];
  var POS_KEY = "bcma.settingsPos";
  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  }
  function formatTime(ts) {
    if (!ts) return "\u6682\u65E0\u7F13\u5B58";
    return new Date(ts).toLocaleString();
  }
  function createSettingsDialog({ settings, onChange, logger, logDialog }) {
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
        cacheSize.textContent = stats.count > 0 ? `${stats.count} \u6761 \xB7 ${formatBytes(stats.bytes)}` : "0 \u6761 \xB7 0 B";
      } catch {
        cacheStart.textContent = "\u8BFB\u53D6\u5931\u8D25";
        cacheSize.textContent = "\u2014";
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
        }
        try {
          localStorage.setItem(POS_KEY, JSON.stringify({ left: panel.style.left, top: panel.style.top }));
        } catch {
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
      panel.setAttribute("aria-label", "\u8BBE\u7F6E");
      const header = document.createElement("div");
      header.className = "bcma-settings-header";
      const title = document.createElement("h2");
      title.className = "bcma-settings-title";
      title.textContent = "[\u8BBE\u7F6E]";
      const close = document.createElement("button");
      close.type = "button";
      close.id = "bcma-settings-close";
      close.textContent = "\xD7";
      close.title = "\u5173\u95ED\u8BBE\u7F6E";
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
      autoLabel.appendChild(document.createTextNode("\u81EA\u52A8\u91CD\u65B0\u8FDE\u63A5"));
      panel.appendChild(autoLabel);
      const soundTitle = document.createElement("h3");
      soundTitle.className = "bcma-settings-section-title";
      soundTitle.textContent = "\u58F0\u97F3";
      panel.appendChild(soundTitle);
      const activeSection = document.createElement("div");
      activeSection.className = "bcma-settings-sound";
      const activeTitle = document.createElement("div");
      activeTitle.className = "bcma-settings-sound-title";
      activeTitle.textContent = "\u5F53\u524D\u8D26\u53F7";
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
          settings.sounds.active === option.value
        );
        activeRadios.push(radio);
        activeSection.appendChild(radio.label);
      }
      panel.appendChild(activeSection);
      const backgroundSection = document.createElement("div");
      backgroundSection.className = "bcma-settings-sound";
      const backgroundTitle = document.createElement("div");
      backgroundTitle.className = "bcma-settings-sound-title";
      backgroundTitle.textContent = "\u540E\u53F0\u8D26\u53F7";
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
          settings.sounds.background === option.value
        );
        backgroundRadios.push(radio);
        backgroundSection.appendChild(radio.label);
      }
      panel.appendChild(backgroundSection);
      const logTitle = document.createElement("h3");
      logTitle.className = "bcma-settings-section-title";
      logTitle.textContent = "\u6D88\u606F\u7F13\u5B58\u548C\u5BFC\u51FA";
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
      logLabel.appendChild(document.createTextNode("\u7F13\u5B58\u804A\u5929\u6D88\u606F\uFF08\u9ED8\u8BA4\u5F00\u542F\uFF0C\u4FDD\u7559 7 \u5929\uFF09"));
      panel.appendChild(logLabel);
      const info = document.createElement("div");
      info.className = "bcma-settings-log-info";
      const startRow = document.createElement("div");
      startRow.className = "bcma-settings-log-row";
      const startLabel = document.createElement("span");
      startLabel.textContent = "\u7F13\u5B58\u8D77\u59CB\uFF1A";
      cacheStart = document.createElement("span");
      cacheStart.className = "bcma-settings-log-value";
      cacheStart.textContent = "\u8BFB\u53D6\u4E2D\u2026";
      startRow.append(startLabel, cacheStart);
      const sizeRow = document.createElement("div");
      sizeRow.className = "bcma-settings-log-row";
      const sizeLabel = document.createElement("span");
      sizeLabel.textContent = "\u7F13\u5B58\u5927\u5C0F\uFF1A";
      cacheSize = document.createElement("span");
      cacheSize.className = "bcma-settings-log-value";
      cacheSize.textContent = "\u8BFB\u53D6\u4E2D\u2026";
      sizeRow.append(sizeLabel, cacheSize);
      info.append(startRow, sizeRow);
      panel.appendChild(info);
      const actions = document.createElement("div");
      actions.className = "bcma-settings-actions";
      actions.appendChild(addButton("\u6E05\u9664\u7F13\u5B58", "", async () => {
        if (!window.confirm("\u786E\u8BA4\u6E05\u9664\u6240\u6709\u672C\u5730\u6D88\u606F\u7F13\u5B58\uFF1F\u5F53\u524D\u4F1A\u8BDD\u6D88\u606F\u4E0D\u53D7\u5F71\u54CD\u3002")) return;
        try {
          await logger.clearCache();
        } catch (err) {
          window.alert(`\u6E05\u9664\u5931\u8D25\uFF1A${err?.message || err}`);
        }
        await refreshCacheInfo();
      }));
      actions.appendChild(addButton("\u5BFC\u51FA\u5F53\u524D\u6D88\u606F\u8BB0\u5F55", "", () => logDialog?.open("current")));
      actions.appendChild(addButton("\u5BFC\u51FA\u7F13\u5B58", "primary", () => logDialog?.open("cache")));
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

  // src/parent/log-store.js
  var DB_NAME = "bcma-log";
  var DB_VERSION = 1;
  var STORE_NAME = "messages";
  var TS_INDEX = "ts";
  var dbPromise = null;
  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  function openDb() {
    if (!("indexedDB" in window)) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: "uid" });
            store.createIndex(TS_INDEX, "ts", { unique: false });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return dbPromise;
  }
  async function withStore(mode, fn) {
    const db = await openDb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        let result = null;
        try {
          result = fn(store, tx);
        } catch {
          resolve(null);
          return;
        }
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  async function addRecords(records) {
    if (!Array.isArray(records) || records.length === 0) return;
    await withStore("readwrite", (store) => {
      for (const record of records) {
        if (record && typeof record.uid === "string") store.put(record);
      }
    });
  }
  async function getAllRecords() {
    const records = await withStore("readonly", (store) => {
      const request = store.index(TS_INDEX).getAll();
      return requestToPromise(request);
    });
    return Array.isArray(records) ? records : [];
  }
  async function queryRecords(from, to) {
    const records = await withStore("readonly", (store) => {
      const index = store.index(TS_INDEX);
      const range = IDBKeyRange.bound(from, to);
      return requestToPromise(index.getAll(range));
    });
    return Array.isArray(records) ? records : [];
  }
  async function clearRecords() {
    await withStore("readwrite", (store) => store.clear());
  }
  async function purgeRecords(cutoff) {
    await withStore("readwrite", (store) => {
      const index = store.index(TS_INDEX);
      const request = index.openCursor(IDBKeyRange.upperBound(cutoff));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
    });
  }

  // src/parent/logger.js
  var RETENTION_MS = 7 * 24 * 60 * 60 * 1e3;
  var SESSION_MAX = 2e4;
  function createLogger({ state, settings }) {
    let lastPurgeDay = "";
    function normalizeRecords(records, account, playerId, playerName) {
      const out = [];
      for (const record of Array.isArray(records) ? records : []) {
        if (!record || typeof record !== "object") continue;
        if (!record.account && account) record.account = account;
        record.playerId = Number(record.playerId) || 0;
        if (!(record.playerId > 0) && Number(playerId) > 0) {
          record.playerId = Number(playerId);
        }
        if (!record.playerName && playerName) record.playerName = playerName;
        if (record.playerId > 0 && typeof record.uid === "string" && !record.uid.startsWith(`${record.playerId}|`)) {
          record.uid = `${record.playerId}|${record.uid}`;
        }
        out.push(record);
      }
      return out;
    }
    function ingest(records, account, playerId, playerName) {
      const added = normalizeRecords(records, account, playerId, playerName);
      if (added.length === 0) return;
      state.sessionRecords.push(...added);
      if (state.sessionRecords.length > SESSION_MAX) {
        state.sessionRecords.splice(0, state.sessionRecords.length - SESSION_MAX);
      }
      if (!settings.log.enabled) return;
      const today = (/* @__PURE__ */ new Date()).toDateString();
      if (today !== lastPurgeDay) {
        lastPurgeDay = today;
        purgeRecords(Date.now() - RETENTION_MS).catch(() => {
        });
      }
      addRecords(added).catch((err) => console.warn("[BC Multi] log write failed", err));
    }
    function currentRecords() {
      return state.sessionRecords.slice();
    }
    async function cacheStats() {
      const records = await getAllRecords();
      let bytes = 0;
      for (const record of records) {
        try {
          bytes += new TextEncoder().encode(JSON.stringify(record)).length;
        } catch {
          bytes += String(record.text || "").length;
        }
      }
      const earliest = records.reduce((min, r) => typeof r.ts === "number" && r.ts < min ? r.ts : min, Infinity);
      return {
        count: records.length,
        bytes,
        earliest: Number.isFinite(earliest) ? earliest : 0
      };
    }
    async function queryCache(from, to) {
      return queryRecords(from, to);
    }
    async function clearCache() {
      await clearRecords();
    }
    return {
      ingest,
      currentRecords,
      cacheStats,
      queryCache,
      clearCache
    };
  }

  // src/parent/export-html.js
  function escapeHtml(text) {
    return String(text ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }
  function playerLabel(record) {
    const playerId = Number(record.playerId) || 0;
    if (!playerId) return "\u672A\u77E5\uFF08\u65E7\u8BB0\u5F55\uFF09";
    const name = record.playerName || "Player";
    return `${name} #${playerId}`;
  }
  function formatDateTime(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }
  var PLAYER_COLORS = [
    "#60a5fa",
    "#34d399",
    "#f59e0b",
    "#f472b6",
    "#a78bfa",
    "#22d3ee",
    "#fb7185",
    "#84cc16",
    "#e879f9",
    "#facc15"
  ];
  function generateExportHtml(records, meta = {}) {
    const accounts = /* @__PURE__ */ new Map();
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
        color: PLAYER_COLORS[index % PLAYER_COLORS.length]
      };
    }).filter((account) => account.count > 0);
    const bars = playerStats.map((account) => {
      const percent = total > 0 ? account.count / total * 100 : 0;
      const title2 = `${account.name}: ${account.count} \u6761 (${percent.toFixed(1)}%)`;
      return `<span class="player-segment" style="flex:0 0 ${percent.toFixed(4)}%;background:${account.color}" title="${escapeHtml(title2)}"></span>`;
    }).join("");
    const legend = playerStats.map((account) => {
      const percent = total > 0 ? account.count / total * 100 : 0;
      return `<span class="player-legend-item" title="${escapeHtml(account.name)}: ${account.count} \u6761 (${percent.toFixed(1)}%)"><i style="background:${account.color}"></i>${escapeHtml(account.name)} <b>${account.count}</b></span>`;
    }).join("");
    const includeOriginal = meta.includeOriginal !== false;
    const exportRecords = includeOriginal ? records : records.map((record) => {
      const { original, ...rest } = record;
      return rest;
    });
    const payload = JSON.stringify(exportRecords).replaceAll("<", "\\u003c");
    const title = meta.title || "BC Multi-Account \u6D88\u606F\u8BB0\u5F55";
    const source = meta.source || "";
    const range = meta.range || "";
    const generated = formatDateTime(/* @__PURE__ */ new Date());
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
.text-original {
  margin-top: 3px;
  padding-left: 7px;
  border-left: 2px solid #34d399;
  color: #a7f3d0;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
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
    <div class="meta">${escapeHtml(source)}${range ? ` \xB7 ${escapeHtml(range)}` : ""} \xB7 \u751F\u6210\u4E8E ${escapeHtml(generated)} \xB7 ${total} \u6761</div>
    <div class="player-chart" aria-label="\u6BCF\u4E2A\u6536\u4FE1 Player \u7684\u6D88\u606F\u6761\u6570\u6BD4\u4F8B">
      <div class="player-bars" role="img" title="\u6BCF\u4E2A\u6536\u4FE1 Player \u7684\u6D88\u606F\u6761\u6570\u6BD4\u4F8B">${bars}</div>
      <div class="player-legend">${legend || '<span class="meta">\u6682\u65E0\u7EDF\u8BA1\u6570\u636E</span>'}</div>
    </div>
  </div>
  <div class="search-row">
    <input id="search" type="search" placeholder="\u641C\u7D22\u6D88\u606F\u3001\u89D2\u8272\u6216\u623F\u95F4\u2026">
  </div>
  <div id="kindFilters" aria-label="\u6D88\u606F\u7C7B\u578B\u7B5B\u9009"></div>
  <div id="tabs" aria-label="\u6536\u4FE1 Player \u7B5B\u9009"></div>
</header>
<main>
  <div class="count" id="count"></div>
  <div id="rows"></div>
</main>
<script id="payload" type="application/json">${payload}<\/script>
<script>
const DATA = JSON.parse(document.getElementById("payload").textContent);
const SHOW_ORIGINAL = ${includeOriginal ? "true" : "false"};
const ACCOUNTS = ${JSON.stringify(accountList).replaceAll("<", "\\u003c")};
const KIND_LABEL = ${JSON.stringify({
      chat: "\u804A\u5929",
      whisper: "\u79C1\u804A",
      action: "\u52A8\u4F5C",
      activity: "\u4E92\u52A8",
      beep: "Beep",
      system: "\u7CFB\u7EDF"
    })};
const KIND_FILTERS = [
  { id: "chat", label: "Chat", kinds: ["chat"] },
  { id: "action", label: "Action", kinds: ["action", "activity"] },
  { id: "whisper", label: "Whisper", kinds: ["whisper"] },
  { id: "beep", label: "Beep", kinds: ["beep"] },
  { id: "system", label: "\u7CFB\u7EDF\u6D88\u606F", kinds: ["system"] },
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

addTab("all", "\u5168\u90E8");
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
    return [record.text, SHOW_ORIGINAL ? record.original : "", record.name, record.room, record.account, record.playerName]
      .some(value => String(value || "").toLowerCase().includes(q));
  });
  count.textContent = filtered.length + " \u6761" + (filtered.length === DATA.length ? "" : "\uFF08\u5171 " + DATA.length + " \u6761\uFF09");
  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "meta";
    empty.textContent = "\u6CA1\u6709\u5339\u914D\u7684\u6D88\u606F";
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
      ? "\uFF08\u6211\u53D1\u51FA\uFF09"
      : (record.self ? "\uFF08\u6211\uFF09" : "");
    name.textContent = (record.name || "\u672A\u77E5") + (record.member ? " #" + record.member : "") + suffix;
    const kind = document.createElement("div");
    kind.className = "kind";
    kind.textContent = KIND_LABEL[record.kind] || record.kind;
    const text = document.createElement("div");
    text.className = "text";
    text.textContent = record.text;
    if (SHOW_ORIGINAL && record.original) {
      const original = document.createElement("div");
      original.className = "text-original";
      original.textContent = "\u539F\u6587\uFF1A" + record.original;
      text.appendChild(original);
    }
    row.append(time, room, name, kind, text);
    rows.appendChild(row);
  }
}

document.getElementById("search").addEventListener("input", (event) => {
  query = event.target.value;
  render();
});
render();
<\/script>
</body>
</html>`;
  }
  function downloadExport(records, meta = {}) {
    const html = generateExportHtml(records, meta);
    const stamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replaceAll(":", "-");
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `BCMA-chat-${stamp}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2e3);
  }

  // src/parent/log-dialog.js
  var RANGES = [
    { value: "24h", label: "\u6700\u8FD1 24 \u5C0F\u65F6", ms: 24 * 60 * 60 * 1e3 },
    { value: "7d", label: "\u6700\u8FD1 7 \u5929", ms: 7 * 24 * 60 * 60 * 1e3 }
  ];
  function createLogDialog({ logger }) {
    let overlay;
    let sourceLabel;
    let rangeField;
    let rangeName = "24h";
    let source = "current";
    function includes(record) {
      if (record.kind === "whisper") return privateInput.checked;
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
      panel.setAttribute("aria-label", "\u5BFC\u51FA\u6D88\u606F\u8BB0\u5F55");
      const header = document.createElement("div");
      header.className = "bcma-log-header";
      const title = document.createElement("h2");
      title.className = "bcma-log-title";
      title.textContent = "\u5BFC\u51FA\u6D88\u606F\u8BB0\u5F55";
      const close = document.createElement("button");
      close.type = "button";
      close.id = "bcma-log-close";
      close.textContent = "\xD7";
      close.title = "\u5173\u95ED";
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
      rangeTitle.textContent = "\u65F6\u95F4\u8303\u56F4";
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
      includeTitle.textContent = "\u5305\u542B\u5185\u5BB9";
      panel.appendChild(includeTitle);
      const privateCheck = makeCheck("\u6084\u6084\u8BDD", true);
      privateInput = privateCheck.input;
      const beepCheck = makeCheck("\u79C1\u804A", true);
      beepInput = beepCheck.input;
      const systemCheck = makeCheck("\u7CFB\u7EDF\u6D88\u606F", false);
      systemInput = systemCheck.input;
      const originalCheck = makeCheck("\u5305\u542B WCE \u53CD\u6DF7\u6DC6\u539F\u6587", true);
      originalInput = originalCheck.input;
      panel.append(privateCheck.label, beepCheck.label, systemCheck.label, originalCheck.label);
      const footer = document.createElement("div");
      footer.className = "bcma-log-footer";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "bcma-log-btn";
      cancel.textContent = "\u53D6\u6D88";
      cancel.addEventListener("click", closeDialog);
      const exportButton = document.createElement("button");
      exportButton.type = "button";
      exportButton.className = "bcma-log-btn primary";
      exportButton.textContent = "\u5BFC\u51FA HTML";
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
      sourceLabel.textContent = source === "cache" ? "\u6765\u6E90\uFF1A\u672C\u5730\u6D88\u606F\u7F13\u5B58" : "\u6765\u6E90\uFF1A\u5F53\u524D\u4F1A\u8BDD\u6D88\u606F";
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
          window.alert("\u6240\u9009\u8303\u56F4\u5185\u6CA1\u6709\u53EF\u5BFC\u51FA\u7684\u6D88\u606F\u3002");
          return;
        }
        downloadExport(records, {
          title: "BC Multi-Account \u6D88\u606F\u8BB0\u5F55",
          source: source === "cache" ? "\u672C\u5730\u6D88\u606F\u7F13\u5B58" : "\u5F53\u524D\u4F1A\u8BDD\u6D88\u606F",
          range: rangeText,
          includeOriginal: originalInput.checked
        });
        closeDialog();
      } catch (err) {
        console.error("[BC Multi] export failed", err);
        window.alert(`\u5BFC\u51FA\u5931\u8D25\uFF1A${err?.message || err}`);
      }
    }
    return { mount, open: openDialog, close: closeDialog };
  }

  // src/core/room-nav.js
  function getRoomState() {
    const inRoom = typeof window.ServerPlayerIsInChatRoom === "function" ? window.ServerPlayerIsInChatRoom() : false;
    const characters = window.ChatRoomData?.Character;
    const roomCharacter = window.ChatRoomCharacter;
    return {
      inRoom,
      name: window.ChatRoomData?.Name ?? "",
      space: window.ChatRoomData?.Space ?? "",
      memberCount: Array.isArray(characters) ? characters.length : Array.isArray(roomCharacter) ? roomCharacter.length : 0,
      screen: window.CurrentScreen,
      loggedIn: typeof window.ServerIsLoggedIn === "function" ? window.ServerIsLoggedIn() : false
    };
  }
  async function leaveRoom() {
    const previousRoom = window.ChatRoomData?.Name ?? "";
    if (!window.ServerPlayerIsInChatRoom()) {
      return { ok: true, previousRoom, currentRoom: "" };
    }
    try {
      window.ChatRoomLeave();
      await window.CommonSetScreen("Online", "ChatSearch");
      await waitFor(
        () => !window.ServerPlayerIsInChatRoom() && window.CurrentScreen === "ChatSearch",
        5e3
      ).catch(() => false);
      return { ok: true, previousRoom, currentRoom: "" };
    } catch (err) {
      return { ok: false, error: err?.name || "LeaveFailed", previousRoom, currentRoom: previousRoom };
    }
  }
  async function joinRoomByName(roomName) {
    const previousRoom = window.ChatRoomData?.Name ?? "";
    if (typeof roomName !== "string" || roomName.trim() === "") {
      return { ok: false, error: "EmptyRoomName", previousRoom, currentRoom: previousRoom };
    }
    const target = roomName.trim();
    if (window.ServerPlayerIsInChatRoom() && previousRoom === target) {
      return { ok: true, roomName: target, previousRoom, currentRoom: target };
    }
    if (typeof window.ServerRoomJoin !== "function") {
      return { ok: false, error: "ServerRoomJoinUnavailable", previousRoom, currentRoom: previousRoom };
    }
    try {
      if (window.ServerPlayerIsInChatRoom()) window.ChatRoomLeave();
      await window.CommonSetScreen("Online", "ChatSearch");
      const result = await window.ServerRoomJoin(target);
      if (!result?.ok) {
        return {
          ok: false,
          error: result?.error?.name || "JoinFailed",
          previousRoom,
          currentRoom: window.ChatRoomData?.Name ?? ""
        };
      }
      const synced = await waitFor(
        () => window.CurrentScreen === "ChatRoom" && window.ChatRoomData?.Name === target,
        1e4
      ).catch(() => false);
      if (!synced && window.ChatRoomData?.Name !== target) {
        return {
          ok: false,
          error: "RoomSyncTimeout",
          previousRoom,
          currentRoom: window.ChatRoomData?.Name ?? ""
        };
      }
      return {
        ok: true,
        roomName: target,
        previousRoom,
        currentRoom: window.ChatRoomData?.Name ?? target
      };
    } catch (err) {
      return {
        ok: false,
        error: err?.name || "JoinFailed",
        previousRoom,
        currentRoom: window.ChatRoomData?.Name ?? ""
      };
    }
  }

  // src/core/room-rules.js
  function canFollowRooms(active, target, busy = false) {
    if (busy || !active || !target) return false;
    if (active.key === target.key) return false;
    if (!active.loggedIn || !active.online || !target.loggedIn || !target.online) return false;
    if (!target.inRoom || !target.room) return false;
    if (!active.inRoom || !active.room) return true;
    return active.room !== target.room;
  }
  function canSwapRooms(active, target, busy = false) {
    if (!canFollowRooms(active, target, busy)) return false;
    if (!active.inRoom || !active.room) return true;
    return Number(active.roomMemberCount) > 1;
  }

  // src/parent/room-coordinator.js
  function withTimeout(promise, ms, label) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        console.warn(`[BC Multi] room ${label} timeout`);
        resolve(null);
      }, ms);
      Promise.resolve(promise).then((value) => {
        clearTimeout(timer);
        resolve(value);
      }, (err) => {
        clearTimeout(timer);
        console.warn(`[BC Multi] room ${label} failed`, err);
        resolve(null);
      });
    });
  }
  function createRoomCoordinator({ state, accounts, feed, onChange }) {
    let seq = 0;
    const pending = /* @__PURE__ */ new Map();
    function activeAccount() {
      return state.accounts.find((a) => a.key === state.activeKey);
    }
    function notify(text, level = "warning") {
      try {
        const toast = window.ToastManager;
        if (toast && typeof toast[level] === "function") {
          toast[level](text, { category: "BCMultiAccount" });
          return;
        }
      } catch {
      }
      if (level === "error" || level === "warning") window.alert(text);
      else console.info(`[BC Multi] ${text}`);
    }
    function requestState(acc) {
      if (!acc) return Promise.resolve(null);
      if (acc.top) return Promise.resolve(getRoomState());
      const reqId = `room-state-${++seq}`;
      return withTimeout(new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(reqId);
          resolve(null);
        }, 4e3);
        pending.set(reqId, { accKey: acc.key, resolve, timer });
        accounts.postTo(acc, { type: MSG.ROOM_STATE_REQUEST, reqId });
      }), 4500, "state");
    }
    function requestJoin(acc, roomName) {
      if (!acc || !roomName) return Promise.resolve(null);
      if (acc.top) return withTimeout(joinRoomByName(roomName), 3e4, "join");
      const reqId = `room-join-${++seq}`;
      return withTimeout(new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(reqId);
          resolve(null);
        }, 3e4);
        pending.set(reqId, { accKey: acc.key, resolve, timer });
        accounts.postTo(acc, { type: MSG.ROOM_JOIN, reqId, roomName });
      }), 31e3, "join");
    }
    function requestLeave(acc) {
      if (!acc) return Promise.resolve(null);
      if (acc.top) return withTimeout(leaveRoom(), 15e3, "leave");
      const reqId = `room-leave-${++seq}`;
      return withTimeout(new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(reqId);
          resolve(null);
        }, 15e3);
        pending.set(reqId, { accKey: acc.key, resolve, timer });
        accounts.postTo(acc, { type: MSG.ROOM_LEAVE, reqId });
      }), 16e3, "leave");
    }
    function handleMessage(acc, data) {
      if (!data || data.type !== MSG.ROOM_STATE && data.type !== MSG.ROOM_JOIN_RESULT && data.type !== MSG.ROOM_LEAVE_RESULT) {
        return false;
      }
      const entry = pending.get(data.reqId);
      if (!entry || entry.accKey !== acc.key) return true;
      pending.delete(data.reqId);
      clearTimeout(entry.timer);
      entry.resolve(data);
      return true;
    }
    function canFollow(target) {
      return canFollowRooms(activeAccount(), target, state.roomBusy);
    }
    function canSwap(target) {
      return canSwapRooms(activeAccount(), target, state.roomBusy);
    }
    function applyState(acc, roomState) {
      if (!acc || !roomState) return;
      acc.inRoom = !!roomState.inRoom;
      acc.room = roomState.name || "";
      acc.roomSpace = roomState.space || "";
      acc.roomMemberCount = Number(roomState.memberCount) || 0;
    }
    async function applyRoom(acc, fallbackRoom) {
      const fresh = await requestState(acc);
      if (fresh) {
        applyState(acc, fresh);
      } else {
        acc.inRoom = !!fallbackRoom;
        acc.room = fallbackRoom || "";
        if (!fallbackRoom) {
          acc.roomSpace = "";
          acc.roomMemberCount = 0;
        }
      }
      onChange?.();
    }
    async function rollback(acc, roomName) {
      if (!acc || !roomName) return false;
      const result = await requestJoin(acc, roomName);
      if (!result || !result.ok) return false;
      await applyRoom(acc, result.currentRoom || roomName);
      return true;
    }
    async function follow(target) {
      const active = activeAccount();
      if (!canFollow(target)) return;
      state.roomBusy = true;
      onChange?.();
      try {
        const [a, b] = await Promise.all([requestState(active), requestState(target)]);
        if (!a || !b?.inRoom || !b.name || a.inRoom && (!a.name || a.name === b.name)) {
          notify("\u623F\u95F4\u72B6\u6001\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u8BD5\u3002", "warning");
          return;
        }
        const result = await requestJoin(active, b.name);
        if (!result || !result.ok) {
          if (a.inRoom) await rollback(active, a.name);
          notify(`\u8FDB\u5165\u623F\u95F4\u5931\u8D25\uFF1A${result?.error || "\u672A\u77E5\u9519\u8BEF"}`, "error");
          return;
        }
        await applyRoom(active, result.currentRoom || b.name);
        notify(`\u5DF2\u8FDB\u5165 ${b.name}\u3002`, "info");
      } finally {
        state.roomBusy = false;
        onChange?.();
      }
    }
    async function swap(target) {
      const active = activeAccount();
      if (!canSwap(target)) return;
      state.roomBusy = true;
      onChange?.();
      try {
        const [a, b] = await Promise.all([requestState(active), requestState(target)]);
        if (!a || !b?.inRoom || !b.name || a.inRoom && (!a.name || a.name === b.name)) {
          notify("\u623F\u95F4\u72B6\u6001\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u8BD5\u3002", "warning");
          return;
        }
        if (!a.inRoom) {
          const entered = await requestJoin(active, b.name);
          if (!entered || !entered.ok) {
            notify(`\u524D\u53F0\u8D26\u53F7\u8FDB\u5165 ${b.name} \u5931\u8D25\uFF1A${entered?.error || "\u672A\u77E5\u9519\u8BEF"}`, "error");
            return;
          }
          await applyRoom(active, entered.currentRoom || b.name);
          const left = await requestLeave(target);
          if (!left || !left.ok) {
            await requestLeave(active);
            await applyRoom(active, "");
            notify(`\u540E\u53F0\u8D26\u53F7\u79BB\u5F00\u623F\u95F4\u5931\u8D25\uFF1A${left?.error || "\u672A\u77E5\u9519\u8BEF"}`, "error");
            return;
          }
          await applyRoom(target, "");
          notify(`\u5DF2\u4EA4\u6362\uFF1A${b.name} \u7531\u524D\u53F0\u63A5\u7BA1\uFF0C${target.name} \u5DF2\u79BB\u5F00\u623F\u95F4\u3002`, "info");
          return;
        }
        if ((Number(a.memberCount) || 0) <= 1) {
          notify("\u524D\u53F0\u623F\u95F4\u53EA\u6709\u4F60\u4E00\u4E2A\u4EBA\uFF0C\u4EA4\u6362\u53EF\u80FD\u5BFC\u81F4\u623F\u95F4\u6D88\u5931\uFF0C\u5DF2\u53D6\u6D88\u3002", "warning");
          return;
        }
        const first = await requestJoin(active, b.name);
        if (!first || !first.ok) {
          await rollback(active, a.name);
          notify(`\u524D\u53F0\u8D26\u53F7\u8FDB\u5165 ${b.name} \u5931\u8D25\uFF1A${first?.error || "\u672A\u77E5\u9519\u8BEF"}`, "error");
          return;
        }
        await applyRoom(active, first.currentRoom || b.name);
        const second = await requestJoin(target, a.name);
        if (second && second.ok) {
          await applyRoom(target, second.currentRoom || a.name);
          notify(`\u5DF2\u4EA4\u6362\uFF1A${a.name} \u21C4 ${b.name}\u3002`, "info");
          return;
        }
        const backgroundBack = await rollback(target, b.name);
        const foregroundBack = await rollback(active, a.name);
        if (backgroundBack && foregroundBack) {
          notify(`\u4EA4\u6362\u5931\u8D25\uFF0C\u5DF2\u6062\u590D\u539F\u623F\u95F4\uFF1A${second?.error || "\u672A\u77E5\u9519\u8BEF"}`, "error");
        } else {
          notify(
            `\u4EA4\u6362\u90E8\u5206\u5931\u8D25\uFF1A\u540E\u53F0\u8D26\u53F7${backgroundBack ? "\u5DF2\u56DE\u5230" : "\u672A\u80FD\u56DE\u5230"} ${b.name}\uFF1B\u524D\u53F0\u8D26\u53F7${foregroundBack ? "\u5DF2\u56DE\u5230" : "\u672A\u80FD\u56DE\u5230"} ${a.name}\u3002\u8BF7\u624B\u52A8\u68C0\u67E5\u3002`,
            "error"
          );
        }
      } finally {
        state.roomBusy = false;
        onChange?.();
      }
    }
    return {
      handleMessage,
      canFollow,
      canSwap,
      follow,
      swap,
      requestState,
      requestJoin
    };
  }

  // src/parent/index.js
  function initParent() {
    const state = createParentState();
    const settings = loadSettings();
    state.settings = settings;
    const feed = createFeed(state);
    const logger = createLogger({ state, settings });
    state.logger = logger;
    const logDialog = createLogDialog({ logger });
    state.logDialog = logDialog;
    let accounts;
    let settingsDialog;
    let roomCoordinator;
    function configureAccount(acc) {
      const sound = acc.key === state.activeKey ? settings.sounds.active : settings.sounds.background;
      if (acc.top) {
        state.topAudio?.setMode(sound);
        state.topReconnect?.configure({
          reconnect: settings.autoReconnect,
          remember: true
        });
      } else if (acc.frame) {
        accounts?.postTo(acc, {
          type: MSG.CONFIG,
          reconnect: settings.autoReconnect,
          remember: true,
          sound
        });
      }
    }
    function configureAllAccounts() {
      for (const account of state.accounts) configureAccount(account);
    }
    function applySettings() {
      saveSettings(settings);
      configureAllAccounts();
    }
    settingsDialog = createSettingsDialog({
      settings,
      onChange: applySettings,
      logger,
      logDialog
    });
    const toolbar = createToolbar({
      state,
      feed,
      handlers: {
        onSwitch: (key) => accounts.switchTo(key),
        onAdd: () => accounts.add(),
        onRemove: (key) => accounts.remove(key),
        onSettings: () => settingsDialog.open(),
        canFollow: (acc) => roomCoordinator?.canFollow(acc) ?? false,
        canSwap: (acc) => roomCoordinator?.canSwap(acc) ?? false,
        onFollow: (acc) => roomCoordinator?.follow(acc),
        onSwap: (acc) => roomCoordinator?.swap(acc)
      }
    });
    accounts = createAccounts({
      state,
      render: () => toolbar.render(),
      configureAccount,
      afterSwitch: () => feed.render()
    });
    roomCoordinator = createRoomCoordinator({
      state,
      accounts,
      feed,
      onChange: () => scheduleRender()
    });
    function scheduleRender() {
      if (state.renderTimer) return;
      state.renderTimer = setTimeout(() => {
        state.renderTimer = null;
        toolbar.render();
      }, 80);
    }
    function topTransport() {
      return {
        requestCredential(account, reqId) {
          if (Date.now() < state.pausedUntil) {
            state.topReconnect?.resolveCredential(reqId, {
              password: null,
              reason: "paused",
              retryIn: state.pausedUntil - Date.now() + 1e3
            });
            return;
          }
          const password = state.credentials.get(normalizeAccountName(account)) || null;
          state.topReconnect?.resolveCredential(reqId, {
            password,
            reason: password ? void 0 : "missing"
          });
        },
        saveCredential(account, password) {
          const key = normalizeAccountName(account);
          if (key && typeof password === "string" && password) {
            state.credentials.set(key, password);
          }
        },
        notifyAuth(phase, reason, attempts) {
          const top = state.accounts.find((a) => a.top);
          if (top) {
            top.auth = {
              phase: typeof phase === "string" ? phase : "idle",
              reason: typeof reason === "string" ? reason : "",
              attempts: Number(attempts) || 0
            };
          }
          if (phase === "idle") state.pausedUntil = 0;
          scheduleRender();
        },
        notifyRateLimited() {
          state.pausedUntil = Date.now() + RC.GLOBAL_PAUSE_MS + Math.random() * RC.GLOBAL_PAUSE_JITTER_MS;
        }
      };
    }
    const bridge = createParentBridge({
      state,
      accounts,
      feed,
      scheduleRender,
      configureAccount,
      logger,
      roomCoordinator
    });
    function updateTopInfo(force = false) {
      const top = state.accounts.find((a) => a.top);
      if (!top) return;
      const info = getAccountInfo();
      const key = [
        info.loggedIn,
        info.online,
        info.name,
        info.account,
        info.memberNumber,
        info.inRoom,
        info.room,
        info.roomSpace,
        info.roomMemberCount
      ].join("");
      if (!force && key === state.topInfoKey) return;
      state.topInfoKey = key;
      accounts.applyInfo(top, info);
      if (state.topActive) feed.render();
      scheduleRender();
    }
    function installKeyboard() {
      window.addEventListener("keydown", (event) => {
        if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const n = digitFromEvent(event);
        if (n === null) return;
        const target = state.accounts[n - 1];
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        accounts.switchTo(target.key);
      }, true);
    }
    function startInfoPoll() {
      updateTopInfo(true);
      setInterval(() => updateTopInfo(), 2e3);
    }
    function start() {
      if (state.started) return;
      state.started = true;
      try {
        if (location.hash.includes(HASH_KEY + "=")) {
          history.replaceState(null, "", location.pathname + location.search);
        }
      } catch {
      }
      toolbar.mount();
      accounts.addTop();
      settingsDialog.mount();
      logDialog.mount();
      toolbar.render();
      installTopHooks({ state, feed, scheduleRender, updateInfo: updateTopInfo, logger }).then((mod) => {
        if (!mod) return;
        state.topAudio = installAudioPolicy(mod, state.topActive ? settings.sounds.active : settings.sounds.background);
        state.topReconnect = installReconnect(mod, topTransport());
        configureAllAccounts();
      }).catch((err) => console.error("[BC Multi] top hooks failed", err));
      bridge.listen();
      startInfoPoll();
      installKeyboard();
      console.info("[BC Multi] loaded. Click + to add an account, Alt+1..9 to switch.");
    }
    if (document.body) {
      start();
    } else {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    }
  }

  // src/child/bridge.js
  function createChildBridge(id) {
    function post(type, payload = {}) {
      try {
        window.parent.postMessage({
          channel: CHANNEL,
          type,
          id,
          ...payload
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

  // src/child/index.js
  function initChild(id) {
    const state = {
      id,
      active: false,
      seen: /* @__PURE__ */ new Set(),
      lastInfoKey: "",
      mod: null,
      reconnect: null,
      audio: null,
      soundMode: "mute",
      pendingConfig: null,
      logBatcher: null
    };
    const bridge = createChildBridge(id);
    const post = bridge.post;
    const logBatcher = createLogBatcher((records) => post(MSG.LOG_BATCH, { records }));
    state.logBatcher = logBatcher;
    window.addEventListener("beforeunload", () => logBatcher.flush());
    function publishInfo(force = false) {
      const info = getAccountInfo();
      const key = [
        info.loggedIn,
        info.online,
        info.name,
        info.account,
        info.memberNumber,
        info.inRoom,
        info.room,
        info.roomSpace,
        info.roomMemberCount
      ].join("");
      if (!force && key === state.lastInfoKey) return;
      state.lastInfoKey = key;
      post(MSG.ACCOUNT, info);
    }
    function installDisplayCapture() {
      installMessageDisplayHook((data, sender, msg, metadata) => {
        const record = makeRecord({
          data,
          sender,
          msg,
          metadata,
          room: currentRoomName(),
          player: window.Player
        });
        if (record) state.logBatcher?.push(record);
        if (state.active) return;
        handleDisplayMessage(data, sender, msg, metadata, state.seen, (kind, text, room, id2, senderId) => {
          post(MSG.UNREAD, { kind, text, room, id: id2, sender: senderId });
        });
      });
    }
    function applyConfig(data) {
      state.pendingConfig = data;
      state.reconnect?.configure({
        reconnect: data.reconnect !== false,
        remember: data.remember !== false
      });
      state.soundMode = data.sound === "all" || data.sound === "notification" ? data.sound : "mute";
      state.audio?.setMode(state.soundMode);
    }
    const reconnectTransport = {
      requestCredential(account, reqId) {
        post(MSG.CREDENTIAL_REQUEST, { account, reqId });
      },
      saveCredential(account, password) {
        post(MSG.CREDENTIAL_SAVE, { account, password });
      },
      notifyAuth(phase, reason, attempts) {
        post(MSG.AUTH, { phase, reason, attempts });
      },
      notifyRateLimited() {
        post(MSG.RATE_LIMITED);
      }
    };
    bridge.listen((data) => {
      if (data.type === MSG.ROOM_STATE_REQUEST) {
        post(MSG.ROOM_STATE, { reqId: data.reqId, ...getRoomState() });
        return;
      }
      if (data.type === MSG.ROOM_JOIN) {
        const reqId = data.reqId;
        joinRoomByName(data.roomName).then((result) => {
          post(MSG.ROOM_JOIN_RESULT, { reqId, ...result });
          publishInfo(true);
        }).catch((err) => {
          post(MSG.ROOM_JOIN_RESULT, {
            reqId,
            ok: false,
            error: err?.name || "JoinFailed"
          });
          publishInfo(true);
        });
        return;
      }
      if (data.type === MSG.ROOM_LEAVE) {
        const reqId = data.reqId;
        leaveRoom().then((result) => {
          post(MSG.ROOM_LEAVE_RESULT, { reqId, ...result });
          publishInfo(true);
        }).catch((err) => {
          post(MSG.ROOM_LEAVE_RESULT, {
            reqId,
            ok: false,
            error: err?.name || "LeaveFailed"
          });
          publishInfo(true);
        });
        return;
      }
      if (data.type === MSG.SET_ACTIVE) {
        state.active = !!data.active;
        if (state.active) {
          state.seen.clear();
        } else if (document.fullscreenElement) {
          leaveFullscreen();
        }
      } else if (data.type === MSG.SCROLL_BOTTOM) {
        setTimeout(scrollChatToBottom, 80);
      } else if (data.type === MSG.CONFIG) {
        applyConfig(data);
      } else if (data.type === MSG.CREDENTIAL) {
        state.reconnect?.resolveCredential(data.reqId, {
          password: data.password,
          reason: data.reason,
          retryIn: data.retryIn
        });
      } else if (data.type === MSG.RECONNECT_NOW) {
        state.reconnect?.retryNow();
      } else if (data.type === MSG.LOG_FLUSH) {
        state.logBatcher?.flush();
      }
    });
    window.addEventListener("keydown", (event) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const n = digitFromEvent(event);
      if (n === null) return;
      event.preventDefault();
      event.stopPropagation();
      post(MSG.SWITCH_REQUEST, { index: n });
    }, true);
    (async () => {
      const sdk = await waitFor(() => window.bcModSdk, 2e4).catch(() => null);
      if (!sdk) {
        post(MSG.READY, getAccountInfo());
        post(MSG.ERROR, { message: "bcModSdk not found" });
        setInterval(() => post(MSG.ACCOUNT, getAccountInfo()), 2e3);
        return;
      }
      const mod = sdk.registerMod({
        name: "BCMultiAccount",
        fullName: "BC Multi-Account Switcher",
        version: VERSION
      }, { allowReplace: true });
      state.mod = mod;
      state.audio = installAudioPolicy(mod, state.soundMode);
      state.reconnect = installReconnect(mod, reconnectTransport);
      if (state.pendingConfig) applyConfig(state.pendingConfig);
      hookPresence(mod, () => publishInfo(true));
      hookAuthInfo(mod, () => publishInfo(true));
      hookRoomInfo(mod, () => publishInfo(true));
      const registerHandler = await waitFor(
        () => typeof window.ChatRoomRegisterMessageHandler === "function" ? window.ChatRoomRegisterMessageHandler : null,
        3e4
      ).catch(() => null);
      if (registerHandler) {
        installDisplayCapture();
      } else {
        console.warn("[BC Multi] ChatRoomRegisterMessageHandler not found; chat unread capture disabled");
      }
      const serverAccountBeep = await waitFor(
        () => typeof window.ServerAccountBeep === "function" ? window.ServerAccountBeep : null,
        3e4
      ).catch(() => null);
      if (serverAccountBeep) {
        mod.hookFunction("ServerAccountBeep", 5, (args, next) => {
          const data = args[0];
          if (isRecordableBeep(data)) {
            const record = makeBeepRecord({ data, player: window.Player });
            if (record) state.logBatcher?.push(record);
            if (!state.active) {
              countBeep(data, state.seen, (kind, beep) => {
                post(MSG.UNREAD, { kind, text: beepPreviewText(beep), room: messageRoom() });
              });
            }
          }
          return next(args);
        });
      }
      const serverSend = await waitFor(
        () => typeof window.ServerSend === "function" ? window.ServerSend : null,
        3e4
      ).catch(() => null);
      if (serverSend) {
        mod.hookFunction("ServerSend", 5, (args, next) => {
          const [message, data] = args;
          if (message === "AccountBeep" && isRecordableBeep(data)) {
            const record = makeOutgoingBeepRecord({
              target: data.MemberNumber,
              msg: data.Message,
              player: window.Player
            });
            if (record) state.logBatcher?.push(record);
          }
          return next(args);
        });
      }
      const drawProcess = await waitFor(
        () => typeof window.DrawProcess === "function" ? window.DrawProcess : null,
        3e4
      ).catch(() => null);
      if (drawProcess) {
        mod.hookFunction("DrawProcess", 5, (args, next) => {
          if (!state.active) return;
          return next(args);
        });
      }
      post(MSG.READY, getAccountInfo());
      publishInfo(true);
      setInterval(() => {
        publishInfo();
        post(MSG.ALIVE);
      }, 2e3);
    })();
  }

  // src/main.js
  if (window.self !== window.top) {
    const id = readChildId();
    if (id) initChild(id);
  } else {
    initParent();
  }
})();
