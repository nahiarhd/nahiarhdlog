/* nahiarhdlog dashboard. Vanilla JS, no dependencies.
   The app's runtime as a transit network: each event kind is a line,
   a trace is a route, red is disruption. */
(function () {
  "use strict";

  var BASE = location.pathname.replace(/\/$/, "") || "/";
  if (BASE === "/") BASE = "";
  var API = BASE + "/api";

  function readSession(key) {
    try { return sessionStorage.getItem(key); } catch (e) { return null; }
  }
  function readLocal(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function writeLocal(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }
  function freshLogFilters(live) {
    return {
      text: "", level: "", type: "", signature: "", range: 0, custom: null,
      offset: 0, limit: 50, live: !!live,
    };
  }

  var state = {
    token: readSession("nhl_token") || "",
    view: "logs",
    logs: freshLogFilters(false),
    liveTimer: null,
    metricsTimer: null,
    selectedId: null,
  };

  // Request generations: rapid clicks and live-tail ticks overlap in flight,
  // so a slow older response must never overwrite newer state. Each loader
  // bumps its counter when issuing and drops responses from a past generation.
  var reqSeq = { logs: 0, volume: 0, errors: 0, trace: 0, metrics: 0, detail: 0, health: 0, status: 0 };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pad2(n) { return n < 10 ? "0" + n : String(n); }
  function fmtTime(ts) {
    // One unambiguous 24-hour form everywhere, down to the millisecond.
    if (ts == null) return "";
    var d = new Date(ts * 1000);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " +
      pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()) + "." +
      String(d.getMilliseconds()).padStart(3, "0");
  }
  function fmtTimeShort(ts) {
    if (ts == null) return "";
    var d = new Date(ts * 1000);
    var now = new Date();
    var clock = pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
    if (d.toDateString() === now.toDateString()) return clock;
    var md = pad2(d.getMonth() + 1) + "/" + pad2(d.getDate());
    if (d.getFullYear() === now.getFullYear()) return md + " " + clock;
    return d.getFullYear() + "/" + md + " " + clock;
  }
  function fmtAgo(ts) {
    if (ts == null) return "";
    var sec = Math.max(0, Date.now() / 1000 - ts);
    if (sec < 60) return Math.floor(sec) + " s ago";
    if (sec < 3600) return Math.floor(sec / 60) + " min ago";
    if (sec < 86400) return Math.floor(sec / 3600) + " h ago";
    return Math.floor(sec / 86400) + " d ago";
  }
  function fmtNum(n) {
    if (n == null || isNaN(Number(n))) return "–";
    return Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 });
  }
  function fmtDur(ms) {
    var n = Number(ms);
    if (ms == null || isNaN(n)) return "";
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 1 : 2) + " s";
    return (n >= 100 ? n.toFixed(0) : n.toFixed(1)) + " ms";
  }
  function fmtPct(r) { return ((r || 0) * 100).toFixed(1) + "%"; }

  var ICON = {
    copy: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>',
    check: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  };
  var EMPTY_ROUTE = '<svg viewBox="0 0 120 28" aria-hidden="true"><path d="M6 20H50l12-12H114"/><circle cx="6" cy="20" r="4.5"/><circle cx="114" cy="8" r="4.5"/></svg>';
  function emptyState(title, text) {
    return "<div class='empty-state'>" + EMPTY_ROUTE + "<strong>" + esc(title) + "</strong>" +
      (text ? "<p>" + esc(text) + "</p>" : "") + "</div>";
  }

  function formatTraceback(text) {
    if (!text) return "";
    var lines = String(text).split("\n");
    var hasTraceback = lines.some(function (l) { return l.indexOf("Traceback") !== -1; });
    if (!hasTraceback) return esc(text);
    return lines.map(function (line) {
      var escaped = esc(line);
      if (/^\s*File\s+["'].*["'],\s+line\s+\d+/.test(line)) return "<span class='tb-frame'>" + escaped + "</span>";
      if (/^\[\.\.\..*truncated.*\]$/.test(line.trim())) return "<span class='tb-trunc'>" + escaped + "</span>";
      if (/^\s*(?:\|\s*)*->/.test(line)) return "<span class='tb-var'>" + escaped + "</span>";
      if (/^([a-zA-Z0-9_.]*(?:Error|Exception|Exit|Interrupt|Fault|Warning|Disconnect|Notice|Cancel)[a-zA-Z0-9_]*)(?::.*)?$/.test(line.trim())) {
        return "<span class='tb-exc'>" + escaped + "</span>";
      }
      return escaped;
    }).join("\n");
  }
  function formatPayload(val) {
    if (val === null || val === undefined) return "";
    if (typeof val === "object") {
      try { return esc(JSON.stringify(val, null, 2)); } catch (err) { return esc(String(val)); }
    }
    if (typeof val === "string") {
      try { return esc(JSON.stringify(JSON.parse(val), null, 2)); } catch (err) { return esc(val); }
    }
    return esc(String(val));
  }
  function displayMessage(e) {
    var raw = String(e.message == null ? "" : e.message);
    var d = e.data || {};
    if (e.type === "error") {
      if (d.exc_type) {
        var msg = d.exc_message ? String(d.exc_message).trim() : "";
        if (msg) {
          if (msg.indexOf(d.exc_type) === 0) return msg;
          return d.exc_type + ": " + msg;
        }
      }
      var lines = raw.split("\n");
      for (var i = lines.length - 1; i >= 0; i--) {
        var line = lines[i].trim();
        if (!line) continue;
        if (line.indexOf("Traceback (most recent call last)") === 0) continue;
        if (/^(?:The above exception|During handling of the above)/.test(line)) continue;
        if (/^[\|\-\+\>\s]*\^+\s*$/.test(line)) continue;
        if (/^(?:\|?\s*->\s*|<st\b)/.test(line)) continue;
        if (/^File\s+["'].*["'],\s+line\s+\d+/.test(line)) continue;
        if (/^\[\.\.\..*truncated.*\]$/.test(line)) continue;
        if (/^([a-zA-Z0-9_.]*(?:Error|Exception|Exit|Interrupt|Fault|Warning|Disconnect|Notice|Cancel)[a-zA-Z0-9_]*)(?::\s*(.*))?$/.test(line)) return line;
        if (/^([A-Z][A-Za-z0-9_]+):\s+(.+)$/.test(line)) return line;
      }
      var first = lines[0].trim();
      if (first && first.indexOf("Traceback") !== 0) {
        var cleanFirst = first.replace(/:\s*%[sdr]$/, "").replace(/%[sdr]$/, "").trim();
        if (cleanFirst) {
          if (d.exc_type && cleanFirst.indexOf(d.exc_type) === -1) return d.exc_type + ": " + cleanFirst;
          return cleanFirst;
        }
      }
      if (d.exc_type) return d.exc_type;
      if (d.signature) return d.signature;
      if (first) return first;
      return "Error";
    }
    return raw.split("\n")[0];
  }

  /* Lines: every event kind rides its own colour. */
  var SPAN_LINES = {
    llm: "llm", agent: "agent", tool: "tool", embedding: "embedding", embed: "embedding",
    db: "db", sql: "db", cache: "cache", redis: "cache", http: "http", service: "http", auth: "auth",
  };
  function lineOf(e) {
    if (e.type === "request") return "request";
    if (e.type === "error") return "error";
    if (e.type === "span") return SPAN_LINES[String((e.data || {}).span_type || "").toLowerCase()] || "custom";
    return "log";
  }
  function failed(e) {
    var d = e.data || {};
    return e.type === "error" || d.status === "error" || Number(d.status) >= 500;
  }
  function stationHtml(e) {
    var d = e.data || {};
    var label = e.type === "span" ? (d.span_type || "span") : e.type;
    return "<span class='stn l-" + lineOf(e) + (e.type === "span" && d.status === "error" ? " failed" : "") +
      "'><span class='stn-label'>" + esc(label) + "</span></span>";
  }
  function chip(text, cls) {
    return '<span class="chip ' + esc(cls || text) + '">' + esc(text) + "</span>";
  }
  function methodChip(method) {
    var m = String(method || "").toUpperCase();
    if (!m) return "";
    return chip(m, "method method-" + m.toLowerCase());
  }
  function statusChip(status) {
    var s = Number(status);
    var cls = s >= 500 ? "s5" : s >= 400 ? "s4" : s >= 300 ? "s3" : "s2";
    return chip(String(status), "code " + cls);
  }

  /* Banner: view loaders own "error", the health poll owns "warn"; each
     only clears its own message, so a live-tail tick can't wipe the other. */
  var bannerKind = null;
  function showBanner(msg, kind) {
    kind = kind || "error";
    $("banner-text").textContent = msg;
    $("banner").classList.toggle("warn", kind === "warn");
    $("banner").classList.remove("hidden");
    bannerKind = kind;
  }
  function hideBanner(kind) {
    if (kind && bannerKind && kind !== bannerKind) return;
    $("banner").classList.add("hidden");
    bannerKind = null;
  }
  $("banner-close").addEventListener("click", function () { hideBanner(); });

  function initToken() {
    // Auth normally rides the login cookie (survives refresh + new tabs).
    // A ?token= in the URL (old bookmarks) still works and migrates to a cookie.
    var q = new URLSearchParams(location.search).get("token");
    if (q) {
      state.token = q;
      try { sessionStorage.setItem("nhl_token", q); } catch (e) { /* ignore */ }
      fetch(API + "/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: q }),
      }).catch(function () { /* cookie optional when URL token present */ });
      history.replaceState(null, "", location.pathname);
    }
  }

  function api(path, params) {
    var all = {};
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] !== undefined && params[k] !== null && params[k] !== "") all[k] = params[k];
    });
    var qs = new URLSearchParams(all).toString();
    var url = API + path + (qs ? "?" + qs : "");
    // The token rides a header, never the URL: query strings end up in
    // server access logs (uvicorn prints them), headers don't.
    var headers = { Accept: "application/json" };
    if (state.token) headers.Authorization = "Bearer " + state.token;
    return fetch(url, { headers: headers, credentials: "same-origin" }).then(function (r) {
      if (r.status === 401 || r.status === 403) {
        try { sessionStorage.removeItem("nhl_token"); } catch (e) { /* ignore */ }
        location.assign(BASE + "/");
        throw new Error("unauthorized");
      }
      if (!r.ok) throw new Error("the server answered " + r.status);
      return r.json();
    }, function () {
      throw new Error("the server is unreachable");
    });
  }

  function copyText(text, btn, done) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(text).then(function () {
      if (!btn) return;
      var old = btn.innerHTML;
      btn.classList.add("copied");
      btn.innerHTML = ICON.check + (done || "Copied");
      clearTimeout(btn._copied);
      btn._copied = setTimeout(function () {
        btn.innerHTML = old;
        btn.classList.remove("copied");
      }, 1400);
    }).catch(function () { /* ignore */ });
  }

  /* Tabs (WAI-ARIA tablist, automatic activation) */
  var tabs = Array.prototype.slice.call(document.querySelectorAll("[role='tab']"));
  function activateTab(view, opts) {
    opts = opts || {};
    var t = null;
    tabs.forEach(function (x) {
      var on = x.getAttribute("data-view") === view;
      x.classList.toggle("active", on);
      x.setAttribute("aria-selected", on ? "true" : "false");
      x.tabIndex = on ? 0 : -1;
      if (on) t = x;
    });
    document.querySelectorAll("[role='tabpanel']").forEach(function (v) {
      v.classList.toggle("active", v.id === "view-" + view);
    });
    if (state.view !== view) closeInspector();
    state.view = view;
    $("chart-tip").hidden = true;
    if (opts.focus && t) t.focus();
    if (view === "logs" && state.logs.live) loadLogs({ silent: true });
    if (view === "errors") loadErrors();
    if (view === "metrics") loadMetrics();
    if (view === "trace") {
      if ($("t-id").value.trim()) loadTrace();
      else loadRecentTraces();
    }
  }
  tabs.forEach(function (t) {
    t.addEventListener("click", function () { activateTab(t.getAttribute("data-view")); });
  });
  document.querySelector("[role='tablist']").addEventListener("keydown", function (e) {
    var i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    var next = i;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    activateTab(tabs[next].getAttribute("data-view"), { focus: true });
  });

  /* Theme: index.html sets it before first paint; only explicit choices
     persist, so the OS preference keeps applying until the user toggles. */
  function syncThemeLabel() {
    var dark = document.documentElement.getAttribute("data-theme") === "dark";
    $("theme-toggle").setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  }
  function applyTheme(name) {
    document.documentElement.setAttribute("data-theme", name);
    writeLocal("nhl_theme", name);
    syncThemeLabel();
  }
  (function initTheme() {
    if (!document.documentElement.getAttribute("data-theme")) {
      var saved = readLocal("nhl_theme");
      document.documentElement.setAttribute("data-theme",
        saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
    }
    syncThemeLabel();
  })();
  $("theme-toggle").addEventListener("click", function () {
    var cur = document.documentElement.getAttribute("data-theme");
    applyTheme(cur === "dark" ? "light" : "dark");
    // Chart colours are baked into the SVG: redraw from the last payloads.
    if (state.view === "metrics" && lastMetrics) renderMetrics(lastMetrics);
  });

  /* Service status: derived from the last five minutes of requests. */
  var STATUS_RULE = "Minor delays from 1% errors or p95 1 s; severe delays from 5% or 3 s.";
  function serviceStatus(s, windowLabel) {
    if (!s || !s.count) {
      return { key: "idle", title: "No traffic", reason: "No requests in " + windowLabel + "." };
    }
    var p95 = s.p95_ms;
    var reason = windowLabel.charAt(0).toUpperCase() + windowLabel.slice(1) + ": " + fmtPct(s.error_rate) +
      " errors, p95 " + (p95 == null ? "unknown" : fmtDur(p95)) + ", " + fmtNum(s.count) +
      (s.count === 1 ? " request." : " requests.");
    if (s.error_rate >= 0.05 || (p95 != null && p95 >= 3000)) return { key: "severe", title: "Severe delays", reason: reason };
    if (s.error_rate >= 0.01 || (p95 != null && p95 >= 1000)) return { key: "minor", title: "Minor delays", reason: reason };
    return { key: "good", title: "Good service", reason: reason };
  }
  var lastHealth = null;
  var lastStatus = { key: "unknown", title: "Checking service", reason: "" };
  function renderStatusButton() {
    $("status-btn").setAttribute("data-status", lastStatus.key);
    $("status-text").textContent = lastStatus.title;
    $("status-short").textContent = { good: "Good", minor: "Minor", severe: "Severe", idle: "No traffic", down: "Unreachable" }[lastStatus.key] || "Checking";
    $("pop-title").textContent = lastStatus.title;
    $("pop-reason").textContent = (lastStatus.reason ? lastStatus.reason + " " : "") +
      (lastStatus.key === "down" ? "" : STATUS_RULE);
    var h = lastHealth;
    var dropped = h ? h.dropped : 0;
    $("dropped-badge").classList.toggle("hidden", !(dropped > 0));
    $("dropped-badge").textContent = fmtNum(dropped) + " dropped";
    var queued = h ? h.queued : 0;
    $("queued-badge").classList.toggle("hidden", !(queued > 0));
    $("queued-badge").textContent = fmtNum(queued) + " queued";
    var inst = h && h.instance ? h.instance.host + "/" + h.instance.pid : "unknown";
    $("status-btn").title = lastStatus.title + ". Backend " + inst;
    $("status-btn").setAttribute("aria-label", "Service status: " + lastStatus.title +
      (queued > 0 ? ", " + fmtNum(queued) + " events queued" : "") +
      (dropped > 0 ? ", " + fmtNum(dropped) + " events dropped" : "") + ". Show details");
    if (!h) { $("pop-dl").innerHTML = ""; return; }
    var rows = [
      ["Queued events", fmtNum(h.queued)],
      ["Dropped events", fmtNum(h.dropped)],
      ["Backend", inst],
      ["Storage", h.shared_storage ? "Shared" : "Per process"],
      ["Text search", h.fts_available ? "Full-text index" : "Substring match"],
      ["Retention", h.retention_days > 0 ? h.retention_days + " days" : "Kept forever"],
      ["Version", "v" + h.version],
    ];
    $("pop-dl").innerHTML = rows.map(function (r) {
      return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>";
    }).join("");
  }
  var lastInstance = null;
  function loadHealth() {
    var my = ++reqSeq.health;
    api("/health").then(function (h) {
      if (my !== reqSeq.health) return;
      lastHealth = h;
      $("version").textContent = "v" + h.version;
      if (lastStatus.key === "down") lastStatus = { key: "unknown", title: "Checking service", reason: "" };
      var inst = h.instance ? h.instance.host + "/" + h.instance.pid : "?";
      // Switching backends only loses data when each one has its own store.
      if (!h.shared_storage && lastInstance && lastInstance !== inst &&
          $("banner").classList.contains("hidden")) {
        showBanner("Dashboard reached a different backend (" + lastInstance + " to " + inst + "). " +
          "With multiple replicas each has its own database — enable sticky sessions for stable reads.", "warn");
      }
      lastInstance = inst;
      renderStatusButton();
    }).catch(function (err) {
      if (my !== reqSeq.health || err.message === "unauthorized") return;
      lastStatus = { key: "down", title: "Backend unreachable", reason: "The dashboard could not reach " + location.host + "; retrying every 15 s." };
      renderStatusButton();
    });
  }
  function loadStatus() {
    var my = ++reqSeq.status;
    api("/metrics", { window: 300, buckets: 1 }).then(function (res) {
      if (my !== reqSeq.status || lastStatus.key === "down") return;
      lastStatus = serviceStatus(res.summary, "the last 5 minutes");
      renderStatusButton();
    }).catch(function () { /* health owns the outage state */ });
  }
  function toggleStatusPop(open) {
    var pop = $("status-pop");
    var show = open === undefined ? pop.classList.contains("hidden") : open;
    pop.classList.toggle("hidden", !show);
    $("status-btn").setAttribute("aria-expanded", show ? "true" : "false");
  }
  $("status-btn").addEventListener("click", function (e) { e.stopPropagation(); toggleStatusPop(); });
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#status-pop") && !e.target.closest("#status-btn")) toggleStatusPop(false);
  });

  /* Logs */
  function rowClass(e) {
    var d = e.data || {};
    var st = Number(d.status);
    var lvl = e.level || "";
    var method = String(d.method || "").toUpperCase();
    var msg = displayMessage(e);
    if (e.type === "error" || lvl === "CRITICAL" || st >= 500) return "sev-crit";
    if (lvl === "ERROR" || st >= 400 || (e.type === "span" && d.status === "error")) return "sev-err";
    if (lvl === "WARNING") return "sev-warn";
    if (method === "DELETE" || /^\s*Deleted\b/i.test(msg)) return "sev-mut";
    if (method === "PUT" || method === "PATCH" || /^\s*(Updated|Renamed)\b/i.test(msg)) return "sev-upd";
    return "";
  }
  function requestMsgHtml(e) {
    var d = e.data || {};
    var parts = [];
    if (d.method) parts.push(methodChip(d.method));
    parts.push("<span class='path'>" + esc(d.path || displayMessage(e)) + "</span>");
    if (d.status != null) parts.push(" " + statusChip(d.status));
    if (d.duration_ms != null) parts.push("<span class='dur'>" + esc(fmtDur(d.duration_ms)) + "</span>");
    return parts.join("");
  }
  function actionClass(action) {
    var a = String(action || "").toLowerCase();
    if (a === "deleted") return "action-delete";
    if (a === "created") return "action-create";
    return "action-update";
  }
  function logMsgHtml(e) {
    var raw = displayMessage(e);
    var stripped = raw.replace(/^[^A-Za-z]*/, "");
    var m = stripped.match(/^(Deleted|Updated|Created|Renamed)\s+(.+)$/i);
    if (!m) return esc(raw);
    var parts = [chip(m[1], "action " + actionClass(m[1]))];
    var rest = m[2];
    var em = rest.match(/^(document|folder|agent|organization)s?\s*:?\s*(.*)$/i);
    if (!em) {
      parts.push("<span class='rest'>" + esc(rest) + "</span>");
      return parts.join("");
    }
    parts.push(chip(em[1].replace(/s$/i, "").toLowerCase(), "entity"));
    var tail = (em[2] || "").trim();
    var idName = tail.match(/^(\S+?)(?:\s+\((.+)\))?$/);
    if (idName) {
      if (idName[2]) parts.push("<span class='name'>" + esc(idName[2]) + "</span>");
      parts.push("<span class='id' title='" + esc(idName[1]) + "'>" + esc(idName[1]) + "</span>");
    } else if (tail) {
      parts.push("<span class='rest'>" + esc(tail) + "</span>");
    }
    return parts.join("");
  }
  function errorMsgHtml(e) {
    var raw = displayMessage(e);
    var colonIdx = raw.indexOf(":");
    if (colonIdx !== -1 && colonIdx < 60) {
      var exc = raw.slice(0, colonIdx).trim();
      var rest = raw.slice(colonIdx + 1).trim();
      return "<span class='exc-type'>" + esc(exc) + "</span>" + (rest ? ": <span class='exc-msg'>" + esc(rest) + "</span>" : "");
    }
    return "<span class='exc-type'>" + esc(raw) + "</span>";
  }
  function spanMsgHtml(e) {
    var d = e.data || {};
    var parts = ["<span class='name'>" + esc(d.name || displayMessage(e)) + "</span>"];
    if (d.model) parts.push("<span class='id'>" + esc(d.model) + "</span>");
    if (d.duration_ms != null) parts.push("<span class='dur'>" + esc(fmtDur(d.duration_ms)) + "</span>");
    if (d.total_tokens) parts.push("<span class='dur'>" + esc(fmtNum(d.total_tokens)) + " tokens</span>");
    if (d.status === "error") {
      var why = d.error && d.error.exc_message ? d.error.exc_message : "failed";
      parts.push(" <span class='exc-msg'>failed: " + esc(why) + "</span>");
    }
    return parts.join("");
  }
  function msgHtml(e) {
    if (e.type === "request") return requestMsgHtml(e);
    if (e.type === "error") return errorMsgHtml(e);
    if (e.type === "span") return spanMsgHtml(e);
    return logMsgHtml(e);
  }
  function logRowHtml(e) {
    var traceCell = e.trace_id
      ? "<button type='button' class='trace-id' data-trace='" + esc(e.trace_id) + "' title='Open trace " + esc(e.trace_id) +
        "'>" + esc(e.trace_id) + "</button>" +
        "<button type='button' class='copy-btn' data-copy='" + esc(e.trace_id) +
        "' aria-label='Copy trace id' title='Copy trace id' tabindex='-1'>" + ICON.copy + "</button>"
      : "";
    var cls = rowClass(e) + (String(e.id) === String(state.selectedId) ? " selected" : "");
    return "<tr data-id='" + e.id + "' tabindex='0' class='" + cls.trim() + "'>" +
      "<td class='time' title='" + esc(fmtTime(e.ts)) + "'>" + esc(fmtTimeShort(e.ts)) + "</td>" +
      "<td class='line'>" + stationHtml(e) + "</td>" +
      "<td class='level'>" + (e.level ? chip(e.level) : "") + "</td>" +
      "<td class='msg' title='" + esc(displayMessage(e)) + "'>" + msgHtml(e) + "</td>" +
      "<td class='trace'>" + traceCell + "</td></tr>";
  }
  function logRange() {
    var f = state.logs;
    if (f.custom) return { since: f.custom.since, until: f.custom.until };
    // Relative ranges are re-anchored on every load so live tail keeps moving.
    if (f.range > 0) return { since: Date.now() / 1000 - f.range, until: null };
    return { since: null, until: null };
  }
  function logParams() {
    var f = state.logs;
    var r = logRange();
    return { text: f.text, level: f.level, type: f.type, signature: f.signature, since: r.since, until: r.until };
  }
  function renderChips() {
    var f = state.logs;
    $("sig-chip").classList.toggle("hidden", !f.signature);
    $("sig-chip-text").textContent = f.signature || "";
    $("range-chip").classList.toggle("hidden", !f.custom);
    if (f.custom) {
      $("range-chip-text").textContent = "From " + fmtTimeShort(f.custom.since) + " to " + fmtTimeShort(f.custom.until);
    }
  }
  function loadLogs(opts) {
    var silent = !!(opts && opts.silent);
    var f = state.logs;
    var params = Object.assign(logParams(), { limit: f.limit, offset: f.offset });
    var my = ++reqSeq.logs;
    hideBanner("error");
    renderChips();
    var body = $("logs-body");
    if (!silent) body.innerHTML = "<tr class='empty-row'><td colspan='5'><p class='meta loading'>Loading events</p></td></tr>";
    loadVolume();
    return api("/logs", params).then(function (res) {
      if (my !== reqSeq.logs) return;
      var ids = res.items.map(function (e) { return String(e.id); }).join(",");
      if (silent && body.getAttribute("data-ids") === ids) {
        renderLogsMeta(res);
        return;
      }
      var active = document.activeElement;
      var focusId = active && active.getAttribute && active.getAttribute("data-id");
      body.innerHTML = res.items.length
        ? res.items.map(logRowHtml).join("")
        : "<tr class='empty-row'><td colspan='5'>" + emptyState("No events match these filters",
            f.text || f.level || f.type || f.signature || f.range || f.custom
              ? "Widen the time range or clear a filter."
              : "Events appear here as soon as the app logs, serves a request, or records a span.") + "</td></tr>";
      body.setAttribute("data-ids", ids);
      if (silent && focusId) {
        var el = body.querySelector("tr[data-id='" + focusId + "']");
        if (el) el.focus({ preventScroll: true });
      }
      renderLogsMeta(res);
    }).catch(function (err) {
      if (my !== reqSeq.logs) return;
      if (err.message !== "unauthorized") showBanner("Could not load events: " + err.message + ". Retry with Search.");
    });
  }
  function renderLogsMeta(res) {
    var start = res.total === 0 ? 0 : res.offset + 1;
    $("logs-meta").innerHTML = "<strong>" + fmtNum(res.total) + "</strong> " + (res.total === 1 ? "event" : "events") +
      (res.total ? ", showing " + fmtNum(start) + " to " + fmtNum(res.offset + res.items.length) : "");
    var pages = Math.max(1, Math.ceil(res.total / res.limit));
    $("page-info").textContent = "Page " + fmtNum(Math.floor(res.offset / res.limit) + 1) + " of " + fmtNum(pages);
    $("page-prev").disabled = res.offset <= 0;
    $("page-next").disabled = res.offset + res.items.length >= res.total;
  }

  /* Event volume: the line's traffic over the selected range. */
  var lastVolume = null;
  function loadVolume() {
    var my = ++reqSeq.volume;
    var buckets = window.innerWidth < 760 ? 36 : 90;
    api("/logs/histogram", Object.assign(logParams(), { buckets: buckets })).then(function (res) {
      if (my !== reqSeq.volume) return;
      lastVolume = res;
      renderVolume(res);
    }).catch(function () { /* the table reports load errors */ });
  }
  function renderVolume(res) {
    var el = $("volume");
    if (!res || !res.supported) { el.innerHTML = ""; return; }
    var b = res.buckets || [];
    var total = b.reduce(function (a, x) { return a + x.total; }, 0);
    if (!total) {
      el.innerHTML = "<div class='volume-empty'>No events in this range</div>";
      return;
    }
    var W = Math.max(200, el.clientWidth || 1000), H = 64;
    var max = Math.max.apply(null, b.map(function (x) { return x.total; }));
    var bw = W / b.length;
    var gap = bw > 6 ? 2 : bw > 3 ? 1 : 0;
    var bars = b.map(function (x, i) {
      var bx = (i * bw + gap / 2).toFixed(2), w = Math.max(0.5, bw - gap).toFixed(2);
      var h = x.total ? Math.max(2, (x.total / max) * (H - 2)) : 0;
      var he = x.total ? (x.errors / x.total) * h : 0;
      var hw = x.total ? (x.warnings / x.total) * h : 0;
      var out = "";
      if (h) out += "<rect class='v-bar' x='" + bx + "' y='" + (H - h).toFixed(2) + "' width='" + w + "' height='" + h.toFixed(2) + "' rx='1'/>";
      if (hw) out += "<rect class='v-warn' x='" + bx + "' y='" + (H - he - hw).toFixed(2) + "' width='" + w + "' height='" + hw.toFixed(2) + "'/>";
      if (he) out += "<rect class='v-err' x='" + bx + "' y='" + (H - he).toFixed(2) + "' width='" + w + "' height='" + he.toFixed(2) + "'/>";
      return out + "<rect class='v-hit' data-i='" + i + "' x='" + (i * bw).toFixed(2) + "' y='0' width='" + bw.toFixed(2) + "' height='" + H + "'/>";
    }).join("");
    var mid = b[Math.floor(b.length / 2)];
    el.innerHTML = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='none' role='img' aria-label='" +
      esc(fmtNum(total) + " events between " + fmtTime(res.since) + " and " + fmtTime(res.until) + ". Select a bar to narrow the range.") + "'>" +
      bars + "</svg>" +
      "<div class='volume-axis'><span>" + esc(fmtTimeShort(res.since)) + "</span><span>" + esc(mid ? fmtTimeShort(mid.ts) : "") +
      "</span><span>" + esc(fmtTimeShort(res.until)) + "</span></div>";
  }
  $("volume").addEventListener("mousemove", function (e) {
    var hit = e.target.closest && e.target.closest(".v-hit");
    var tip = $("chart-tip");
    if (!hit || !lastVolume) { tip.hidden = true; return; }
    var x = lastVolume.buckets[Number(hit.getAttribute("data-i"))];
    tip.innerHTML = "<div class='t'>" + esc(fmtTimeShort(x.ts)) + " to " + esc(fmtTimeShort(x.ts + lastVolume.width)) + "</div>" +
      "<div class='row'><span class='k'>Events</span><span class='v'>" + fmtNum(x.total) + "</span></div>" +
      "<div class='row'><span class='k'>Errors</span><span class='v'>" + fmtNum(x.errors) + "</span></div>" +
      "<div class='row'><span class='k'>Warnings</span><span class='v'>" + fmtNum(x.warnings) + "</span></div>";
    placeTip(tip, e);
  });
  $("volume").addEventListener("mouseleave", function () { $("chart-tip").hidden = true; });
  $("volume").addEventListener("click", function (e) {
    var hit = e.target.closest && e.target.closest(".v-hit");
    if (!hit || !lastVolume) return;
    var x = lastVolume.buckets[Number(hit.getAttribute("data-i"))];
    if (!x.total) return;
    // Narrowing to a past slice makes live tail meaningless: pause it.
    if (state.logs.live) setLive(false, { quiet: true });
    state.logs.custom = { since: x.ts, until: x.ts + lastVolume.width };
    state.logs.offset = 0;
    $("f-range").value = "custom";
    $("chart-tip").hidden = true;
    loadLogs();
  });
  function placeTip(tip, e) {
    tip.hidden = false;
    tip.style.left = e.clientX + 14 + "px";
    tip.style.top = e.clientY + 14 + "px";
    var box = tip.getBoundingClientRect();
    if (box.right > window.innerWidth - 8) tip.style.left = (e.clientX - box.width - 14) + "px";
    if (box.bottom > window.innerHeight - 8) tip.style.top = (e.clientY - box.height - 14) + "px";
  }

  function applyLogFilters() {
    state.logs.text = $("f-text").value.trim();
    state.logs.level = $("f-level").value;
    state.logs.type = $("f-type").value;
    var r = $("f-range").value;
    if (r !== "custom") {
      state.logs.range = Number(r) || 0;
      state.logs.custom = null;
    }
    state.logs.signature = "";
    state.logs.offset = 0;
    loadLogs();
  }
  $("log-filters").addEventListener("submit", function (e) { e.preventDefault(); applyLogFilters(); });
  // Selects apply immediately; only the text box waits for Enter or Search.
  ["f-level", "f-type", "f-range"].forEach(function (id) { $(id).addEventListener("change", applyLogFilters); });
  $("f-clear").addEventListener("click", function () {
    $("f-text").value = "";
    $("f-level").value = "";
    $("f-type").value = "";
    $("f-range").value = "0";
    state.logs = freshLogFilters(state.logs.live);
    if (state.logs.live) setLive(true);
    else loadLogs();
  });
  $("sig-chip-clear").addEventListener("click", function () {
    state.logs.signature = "";
    state.logs.offset = 0;
    loadLogs();
  });
  $("range-chip-clear").addEventListener("click", function () {
    state.logs.custom = null;
    state.logs.offset = 0;
    $("f-range").value = String(state.logs.range || 0);
    loadLogs();
  });
  $("page-prev").addEventListener("click", function () {
    state.logs.offset = Math.max(0, state.logs.offset - state.logs.limit);
    if (state.logs.offset === 0 && !state.logs.custom && readLocal("nhl_live") !== "0") setLive(true);
    else loadLogs();
  });
  $("page-next").addEventListener("click", function () {
    setLive(false, { quiet: true });
    state.logs.offset += state.logs.limit;
    loadLogs();
  });
  function setLive(on, opts) {
    state.logs.live = on;
    $("f-live").checked = on;
    $("live-label").classList.toggle("on", on);
    if (!(opts && opts.quiet)) writeLocal("nhl_live", on ? "1" : "0");
    if (state.liveTimer) { clearInterval(state.liveTimer); state.liveTimer = null; }
    if (on) {
      state.logs.offset = 0;
      if (state.logs.custom) {
        state.logs.custom = null;
        $("f-range").value = String(state.logs.range || 0);
      }
      loadLogs({ silent: true });
      state.liveTimer = setInterval(function () {
        if (document.hidden || state.view !== "logs") return;
        loadLogs({ silent: true });
      }, 2000);
    }
  }
  $("f-live").addEventListener("change", function (e) { setLive(e.target.checked); });

  $("logs-body").addEventListener("click", function (e) {
    var copyBtn = e.target.closest("[data-copy]");
    if (copyBtn) {
      e.stopPropagation();
      copyText(copyBtn.getAttribute("data-copy"), null);
      copyBtn.classList.add("copied");
      setTimeout(function () { copyBtn.classList.remove("copied"); }, 1200);
      return;
    }
    var traceBtn = e.target.closest("[data-trace]");
    if (traceBtn) {
      e.stopPropagation();
      openTrace(traceBtn.getAttribute("data-trace"));
      return;
    }
    var row = e.target.closest("tr[data-id]");
    if (row) openDetail(row.getAttribute("data-id"));
  });

  /* Keyboard: "/" searches, j/k walk the current list, Enter opens, Esc closes. */
  function currentRows() {
    var root = state.view === "trace" ? $("trace-list") : state.view === "logs" ? $("logs-body") : null;
    return root ? Array.prototype.slice.call(root.querySelectorAll("[data-id]")) : [];
  }
  document.addEventListener("keydown", function (e) {
    var t = e.target;
    var typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if (e.key === "Escape") {
      if (!$("status-pop").classList.contains("hidden")) { toggleStatusPop(false); $("status-btn").focus(); return; }
      if (isInspectorOpen()) { closeInspector({ restoreFocus: true }); return; }
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "/") {
      e.preventDefault();
      if (state.view !== "logs") activateTab("logs");
      $("f-text").focus();
      $("f-text").select();
      return;
    }
    if (e.key === "j" || e.key === "k") {
      var rows = currentRows();
      if (!rows.length) return;
      var i = rows.indexOf(document.activeElement);
      if (i < 0) i = rows.findIndex(function (r) { return r.getAttribute("data-id") === String(state.selectedId); });
      var next = e.key === "j" ? Math.min(rows.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
      e.preventDefault();
      rows[next].focus();
      rows[next].scrollIntoView({ block: "nearest" });
      if (isInspectorOpen()) openDetail(rows[next].getAttribute("data-id"));
      return;
    }
    if ((e.key === "Enter" || e.key === " ") && t && t.matches && t.matches("tr[data-id], .wf-row[data-id]")) {
      e.preventDefault();
      openDetail(t.getAttribute("data-id"));
    }
  });

  /* Inspector: a side panel, so the list stays readable and walkable. */
  var detailEvent = null;
  function isInspectorOpen() { return $("inspector").classList.contains("open"); }
  function markSelected() {
    document.querySelectorAll("[data-id].selected").forEach(function (el) { el.classList.remove("selected"); });
    if (state.selectedId == null) return;
    document.querySelectorAll("[data-id='" + state.selectedId + "']").forEach(function (el) { el.classList.add("selected"); });
  }
  var lastFocus = null;
  function closeInspector(opts) {
    if (!isInspectorOpen()) return;
    $("inspector").classList.remove("open");
    $("inspector").setAttribute("aria-hidden", "true");
    document.body.classList.remove("inspecting");
    if (lastVolume) renderVolume(lastVolume);
    state.selectedId = null;
    markSelected();
    if (opts && opts.restoreFocus && lastFocus && document.contains(lastFocus)) lastFocus.focus();
    if (state.logs.live && state.view === "logs") loadLogs({ silent: true });
  }
  function section(label, copyLabel, bodyHtml) {
    return "<div class='detail-section'><div class='detail-section-head'><h3>" + esc(label) + "</h3>" +
      (copyLabel ? "<button type='button' class='btn small copy-section-btn' data-copy-pre='1'>" + ICON.copy + esc(copyLabel) + "</button>" : "") +
      "</div>" + bodyHtml + "</div>";
  }
  function headersHtml(h) {
    if (!h || !Object.keys(h).length) return "";
    return "<dl class='headers-block'>" + Object.keys(h).map(function (k) {
      return "<dt>" + esc(k) + "</dt><dd>" + esc(h[k]) + "</dd>";
    }).join("") + "</dl>";
  }
  function shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
  function curlFor(e) {
    var d = e.data || {};
    var h = d.request_headers || {};
    var host = h.host || location.host;
    var scheme = h["x-forwarded-proto"] || location.protocol.replace(":", "");
    var url = scheme + "://" + host + (d.path || "/") + (d.query ? "?" + d.query : "");
    var parts = ["curl -X " + (d.method || "GET") + " " + shq(url)];
    var skip = { host: 1, "content-length": 1, connection: 1, "accept-encoding": 1 };
    Object.keys(h).forEach(function (k) { if (!skip[k]) parts.push("-H " + shq(k + ": " + h[k])); });
    var body = d.request_body;
    if (body !== undefined && body !== null) {
      var ctype = String(h["content-type"] || "");
      var raw;
      if (typeof body === "object") {
        var clean = Array.isArray(body) ? body : Object.assign({}, body);
        if (!Array.isArray(clean)) delete clean._truncated;
        if (ctype.indexOf("x-www-form-urlencoded") !== -1 && !Array.isArray(clean)) {
          var form = new URLSearchParams();
          Object.keys(clean).forEach(function (k) {
            [].concat(clean[k]).forEach(function (v) { form.append(k, v); });
          });
          raw = form.toString();
        } else {
          raw = JSON.stringify(clean);
        }
      } else {
        raw = String(body);
      }
      parts.push("--data-raw " + shq(raw));
    }
    return parts.join(" \\\n  ");
  }
  function openDetail(id) {
    var my = ++reqSeq.detail;
    if (!isInspectorOpen()) lastFocus = document.activeElement;
    state.selectedId = String(id);
    markSelected();
    api("/logs/" + id).then(function (e) {
      if (my !== reqSeq.detail) return;
      detailEvent = e;
      renderDetail(e);
      var insp = $("inspector");
      insp.classList.add("open");
      insp.setAttribute("aria-hidden", "false");
      document.body.classList.add("inspecting");
      if (lastVolume) renderVolume(lastVolume);
      $("detail-body").scrollTop = 0;
    }).catch(function (err) {
      if (my !== reqSeq.detail) return;
      if (err.message !== "unauthorized") showBanner("Could not open event " + id + ": " + err.message + ".");
    });
  }
  function renderDetail(e) {
    var d = e.data || {};
    var head = "", rows = [], badges = "", errCard = "", sections = "";
    function add(k, v, mono) {
      if (v === null || v === undefined || v === "") return;
      rows.push("<dt>" + esc(k) + "</dt><dd" + (mono ? "" : " class='plain'") + ">" + esc(v) + "</dd>");
    }
    badges += stationHtml(e);
    if (e.type === "request") {
      head = (d.method || "?") + " " + (d.path || "?");
      if (d.status != null) badges += statusChip(d.status);
      add("Time", fmtTime(e.ts), true);
      add("Duration", d.duration_ms == null ? null : fmtDur(d.duration_ms));
      add("Query", d.query ? "?" + d.query : null, true);
      add("Client", d.client, true);
      add("User agent", d.user_agent);
      add("Span id", d.span_id, true);
      add("Upstream parent", d.parent_id, true);
      if (d.request_headers || d.request_body !== undefined) {
        sections += section("Request", "Copy request", headersHtml(d.request_headers) +
          (d.request_body !== undefined ? "<pre class='payload-block'>" + formatPayload(d.request_body) + "</pre>" : ""));
      }
      if (d.response_headers || d.response_body !== undefined) {
        sections += section("Response", "Copy response", headersHtml(d.response_headers) +
          (d.response_body !== undefined ? "<pre class='payload-block'>" + formatPayload(d.response_body) + "</pre>" : ""));
      }
    } else if (e.type === "span") {
      head = d.name || displayMessage(e);
      badges += d.status === "error" ? chip("Failed", "s5") : chip("OK", "s2");
      if (d.model) badges += chip(d.model, "model");
      add("Time", fmtTime(e.ts), true);
      add("Duration", d.duration_ms == null ? null : fmtDur(d.duration_ms));
      add("Span id", d.span_id, true);
      add("Parent span", d.parent_span_id, true);
      if (d.total_tokens != null) {
        add("Tokens", fmtNum(d.total_tokens) + " (prompt " + fmtNum(d.prompt_tokens || 0) + ", completion " + fmtNum(d.completion_tokens || 0) + ")", true);
      }
      if (d.error) {
        errCard = "<div class='detail-error-card'><div class='detail-error-head'><span class='detail-error-title'>" +
          esc(d.error.exc_type || "Span failed") + "</span></div>" +
          "<div class='detail-error-msg'>" + esc(d.error.exc_message || "The span ended with an error.") + "</div></div>";
      }
      if (d.system_prompt) sections += section("System prompt", "Copy system prompt", "<pre class='payload-block'>" + esc(d.system_prompt) + "</pre>");
      if (d.messages !== undefined && d.messages !== null) sections += section("Messages", "Copy messages", "<pre class='payload-block'>" + formatPayload(d.messages) + "</pre>");
      if (d.tool_calls && d.tool_calls.length) sections += section("Tool calls", "Copy tool calls", "<pre class='payload-block'>" + formatPayload(d.tool_calls) + "</pre>");
      if (d.completion !== undefined && d.completion !== null) sections += section("Completion", "Copy completion", "<pre class='payload-block'>" + formatPayload(d.completion) + "</pre>");
      if (d.input !== undefined && d.input !== null && d.messages === undefined) sections += section("Input", "Copy input", "<pre class='payload-block'>" + formatPayload(d.input) + "</pre>");
      if (d.output !== undefined && d.output !== null && d.completion === undefined) sections += section("Output", "Copy output", "<pre class='payload-block'>" + formatPayload(d.output) + "</pre>");
    } else if (e.type === "error") {
      var summary = displayMessage(e);
      head = d.exc_type || summary;
      if (e.level) badges += chip(e.level);
      add("Time", fmtTime(e.ts), true);
      add("Signature", d.signature, true);
      add("Logger", d.logger, true);
      add("Location", d.pathname ? d.pathname + ":" + d.lineno + (d.func ? " in " + d.func : "") : null, true);
      if (d.method) add("Request", d.method + " " + (d.path || ""), true);
      if (d.origin) add("Captured by", d.origin, true);
      var reason = d.exc_message || (summary.indexOf(":") !== -1 ? summary.slice(summary.indexOf(":") + 1).trim() : "");
      errCard = "<div class='detail-error-card'><div class='detail-error-head'><span class='detail-error-title'>" +
        esc(d.exc_type || "Error") + "</span>" + (d.signature ? chip(d.signature, "sig") : "") + "</div>" +
        (reason ? "<div class='detail-error-msg'>" + esc(reason) + "</div>" : "") + "</div>";
    } else {
      head = displayMessage(e);
      if (e.level) badges += chip(e.level);
      add("Time", fmtTime(e.ts), true);
      add("Logger", d.logger, true);
      add("Location", d.pathname ? d.pathname + ":" + d.lineno + (d.func ? " in " + d.func : "") : null, true);
    }

    var standardKeys = [
      "method", "path", "query", "status", "duration_ms", "client", "user_agent",
      "signature", "logger", "pathname", "lineno", "func", "exc_type", "exc_message",
      "origin", "request_headers", "request_body", "response_headers", "response_body", "parent_id",
      "name", "span_type", "span_id", "parent_span_id", "error", "model",
      "prompt_tokens", "completion_tokens", "total_tokens", "system_prompt", "messages",
      "tool_calls", "completion", "input", "output",
    ];
    var extraObjects = {};
    Object.keys(d).forEach(function (k) {
      if (standardKeys.indexOf(k) !== -1 || d[k] == null) return;
      if (typeof d[k] === "object") extraObjects[k] = d[k];
      else add(k, String(d[k]), true);
    });
    if (Object.keys(extraObjects).length) {
      sections += section("Attributes", "Copy attributes", "<pre class='payload-block'>" + formatPayload(extraObjects) + "</pre>");
    }
    if (e.trace_id) add("Trace id", e.trace_id, true);

    var content = "";
    if (e.message && e.type !== "request" && e.type !== "span") {
      var isTb = e.message.indexOf("Traceback") !== -1;
      content = section(isTb ? "Traceback" : "Message", isTb ? "Copy traceback" : "Copy message",
        "<pre class='traceback-block'>" + (isTb ? formatTraceback(e.message) : esc(e.message)) + "</pre>");
    }
    $("detail-title").textContent = head;
    $("detail-badge-bar").innerHTML = badges;
    $("detail-body").innerHTML = errCard + "<dl class='kv'>" + rows.join("") + "</dl>" + content + sections;
    var traceBtn = $("detail-trace-btn");
    traceBtn.hidden = !e.trace_id || (state.view === "trace" && $("t-id").value.trim() === e.trace_id);
    traceBtn.setAttribute("data-opentrace", e.trace_id || "");
    $("detail-copy-curl").hidden = e.type !== "request";
  }
  $("detail-close").addEventListener("click", function () { closeInspector({ restoreFocus: true }); });
  $("detail-trace-btn").addEventListener("click", function () {
    var tid = this.getAttribute("data-opentrace");
    closeInspector();
    if (tid) openTrace(tid);
  });
  $("detail-copy-json").addEventListener("click", function () {
    if (detailEvent) copyText(JSON.stringify(detailEvent, null, 2), this);
  });
  $("detail-copy-curl").addEventListener("click", function () {
    if (detailEvent) copyText(curlFor(detailEvent), this);
  });
  $("detail-body").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-copy-pre]");
    if (!btn) return;
    var sec = btn.closest(".detail-section");
    var blocks = sec ? sec.querySelectorAll("pre, dl") : [];
    var text = Array.prototype.map.call(blocks, function (b) {
      if (b.tagName === "DL") {
        return Array.prototype.map.call(b.querySelectorAll("dt"), function (dt) {
          return dt.textContent + ": " + (dt.nextElementSibling ? dt.nextElementSibling.textContent : "");
        }).join("\n");
      }
      return b.textContent;
    }).join("\n\n");
    copyText(text, btn);
  });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && state.logs.live && state.view === "logs") loadLogs({ silent: true });
  });

  /* Errors: the disruption list */
  function loadErrors() {
    var my = ++reqSeq.errors;
    hideBanner("error");
    var list = $("errors-list");
    list.innerHTML = "<p class='meta'>Loading errors</p>";
    var win = Number($("e-window").value) || 0;
    var params = { limit: 50 };
    if (win > 0) params.since = Date.now() / 1000 - win;
    api("/errors/top", params).then(function (rows) {
      if (my !== reqSeq.errors) return;
      var total = rows.reduce(function (acc, r) { return acc + (r.count || 0); }, 0);
      $("errors-meta").innerHTML = rows.length
        ? "<strong>" + fmtNum(total) + "</strong> " + (total === 1 ? "error" : "errors") + " in " + fmtNum(rows.length) +
          (rows.length === 1 ? " signature" : " signatures") + ", most frequent first."
        : "";
      if (!rows.length) {
        list.innerHTML = emptyState("No errors" + (win > 0 ? " in this window" : ""),
          "Uncaught exceptions and logger.exception() calls are grouped here by type and line.");
        return;
      }
      list.innerHTML = "<div class='disruptions'>" + rows.map(function (r) {
        var summary = displayMessage({ type: "error", message: r.last_message || "", data: { signature: r.signature } });
        return "<button type='button' class='dis-row' data-sig='" + esc(r.signature) + "' title='Show these errors in Logs'>" +
          "<span class='dis-count'>" + fmtNum(r.count) + "</span>" +
          "<span class='dis-sig'>" + esc(r.signature) + "</span>" +
          "<span class='dis-when' title='" + esc(fmtTime(r.last_ts)) + "'>Last seen " + esc(fmtAgo(r.last_ts)) + "</span>" +
          "<span class='dis-msg' title='" + esc(summary) + "'>" + esc(summary) + "</span></button>";
      }).join("") + "</div>";
    }).catch(function (err) {
      if (my !== reqSeq.errors) return;
      if (err.message !== "unauthorized") showBanner("Could not load errors: " + err.message + ".");
    });
  }
  $("errors-list").addEventListener("click", function (e) {
    var b = e.target.closest("[data-sig]");
    if (!b) return;
    state.logs = freshLogFilters(state.logs.live);
    state.logs.type = "error";
    state.logs.signature = b.getAttribute("data-sig");
    $("f-text").value = "";
    $("f-level").value = "";
    $("f-type").value = "error";
    $("f-range").value = "0";
    activateTab("logs");
    // activateTab already issued a silent load when live is on —
    // a second explicit load only doubles requests that can race.
    if (!state.logs.live) loadLogs();
  });
  $("e-window").addEventListener("change", loadErrors);
  $("e-refresh").addEventListener("click", loadErrors);

  /* Metrics */
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function niceStep(x) {
    if (!(x > 0)) return 1;
    var exp = Math.pow(10, Math.floor(Math.log10(x)));
    var f = x / exp;
    var nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return nf * exp;
  }
  function lineChart(el, series, opts) {
    opts = opts || {};
    // Sized from the container so tick labels stay at their real size.
    var W = Math.max(300, Math.round(el.clientWidth || 560)), H = W < 480 ? 190 : 200, L = 40, R = 12, T = 12, B = 26;
    var integer = !!opts.integer;
    var times = opts.times || [];
    var max = Math.max.apply(null, [0].concat(series.map(function (s) {
      return Math.max.apply(null, [0].concat(s.values.filter(function (v) { return v != null; })));
    })));
    // Four even steps of 1/2/2.5/5 x 10^k: gridlines read 0, 2, 4, 6, 8.
    var step = niceStep(max / 4);
    if (integer) step = Math.max(1, Math.ceil(step));
    max = step * 4;
    var n = (series[0] && series[0].values.length) || 1;
    function x(i) { return L + (i * (W - L - R)) / Math.max(1, n - 1); }
    function y(v) { return H - B - ((v / max) * (H - T - B)); }
    var grid = "";
    for (var g = 0; g <= 4; g++) {
      var gv = step * g, gy = y(gv);
      grid += "<line x1='" + L + "' y1='" + gy + "' x2='" + (W - R) + "' y2='" + gy + "' stroke='" + cssVar("--rule") + "'/>" +
        "<text class='axis' x='" + (L - 8) + "' y='" + (gy + 3.5) + "' text-anchor='end'>" + (integer ? String(Math.round(gv)) : fmtNum(gv)) + "</text>";
    }
    var xlabels = "";
    if (times.length) {
      [0, Math.floor((times.length - 1) / 2), times.length - 1].forEach(function (i, k) {
        var anchor = k === 0 ? "start" : k === 2 ? "end" : "middle";
        xlabels += "<text class='axis' x='" + x(i).toFixed(1) + "' y='" + (H - 6) + "' text-anchor='" + anchor + "'>" + esc(fmtTimeShort(times[i])) + "</text>";
      });
    }
    var thr = "", above = [];
    (opts.thresholds || []).forEach(function (t) {
      if (t.v > max) { above.push(t.short); return; }
      var ty = y(t.v);
      thr += "<line x1='" + L + "' y1='" + ty + "' x2='" + (W - R) + "' y2='" + ty + "' stroke='" + t.color +
        "' stroke-width='1.5' stroke-dasharray='5 4'/>" +
        "<text class='thr' x='" + (W - R) + "' y='" + (ty - 5) + "' text-anchor='end' fill='" + t.color + "'>" + esc(t.label) + "</text>";
    });
    if (opts.noteId) {
      var drawn = (opts.thresholds || []).length - above.length;
      $(opts.noteId).textContent = above.length
        ? (drawn ? "" : "Status thresholds ") + "(" + above.join(" and ") + (above.length === 1 ? " is" : " are") + " above this range)"
        : "";
      // A legend key only for marks the chart actually draws.
      if (opts.swatchId) $(opts.swatchId).hidden = drawn === 0;
    }
    var paths = series.map(function (s) {
      // null = no samples in that bucket: break the line instead of
      // drawing a fake drop to zero. Lone points get a station dot.
      var runs = [], cur = [];
      s.values.forEach(function (v, i) {
        if (v == null) { if (cur.length) runs.push(cur); cur = []; return; }
        cur.push([x(i), y(v)]);
      });
      if (cur.length) runs.push(cur);
      return runs.map(function (run) {
        if (run.length === 1) {
          return "<circle cx='" + run[0][0].toFixed(1) + "' cy='" + run[0][1].toFixed(1) + "' r='3.5' fill='" + cssVar("--surface") +
            "' stroke='" + s.color + "' stroke-width='2.5'/>";
        }
        var pts = run.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ");
        var area = s.fill
          ? "<polygon points='" + run[0][0].toFixed(1) + "," + (H - B) + " " + pts + " " + run[run.length - 1][0].toFixed(1) + "," + (H - B) +
            "' fill='" + s.color + "' opacity='0.09'/>"
          : "";
        return area + "<polyline points='" + pts + "' fill='none' stroke='" + s.color + "' stroke-width='2.5' stroke-linejoin='round' stroke-linecap='round'/>";
      }).join("");
    }).join("");
    var hasData = series.some(function (s) { return s.values.some(function (v) { return v > 0; }); });
    var legend = opts.legendId ? $(opts.legendId) : null;
    if (legend) legend.hidden = !hasData;
    el.innerHTML = hasData
      ? "<svg viewBox='0 0 " + W + " " + H + "' role='img' aria-label='" + esc(opts.label || "chart") + "'>" + grid + thr + paths + xlabels +
        "<line class='chart-cross' stroke='" + cssVar("--muted") + "' stroke-dasharray='3 3' visibility='hidden'/></svg>"
      : "<p class='chart-empty'>No requests in this window yet.</p>";
    if (hasData) bindChartHover(el, series, times, { W: W, L: L, R: R, T: T, B: B, H: H, n: n, x: x, integer: integer, unit: opts.unit || "" });
  }
  function bindChartHover(el, series, times, geo) {
    var svg = el.querySelector("svg");
    var tip = $("chart-tip");
    if (!svg || !tip) return;
    var cross = svg.querySelector(".chart-cross");
    svg.addEventListener("mouseleave", function () {
      tip.hidden = true;
      if (cross) cross.setAttribute("visibility", "hidden");
    });
    svg.addEventListener("mousemove", function (e) {
      var rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      var vx = ((e.clientX - rect.left) / rect.width) * geo.W;
      var span = (geo.W - geo.L - geo.R) / Math.max(1, geo.n - 1);
      var i = Math.max(0, Math.min(geo.n - 1, Math.round((vx - geo.L) / span)));
      var xi = geo.x(i);
      if (cross) {
        cross.setAttribute("x1", xi); cross.setAttribute("x2", xi);
        cross.setAttribute("y1", geo.T); cross.setAttribute("y2", geo.H - geo.B);
        cross.setAttribute("visibility", "visible");
      }
      tip.innerHTML = "<div class='t'>" + esc(times[i] != null ? fmtTimeShort(times[i]) : "") + "</div>" +
        series.map(function (s) {
          var val = s.values[i];
          var shown = val == null ? "no requests" : (geo.integer ? String(Math.round(val)) : fmtNum(val)) + geo.unit;
          return "<div class='row'><span class='k'>" + esc(s.name || "") + "</span><span class='v'>" + esc(shown) + "</span></div>";
        }).join("");
      placeTip(tip, e);
    });
  }
  function stat(k, v, u, extra) {
    // extra: "danger" | "warn" | ""
    return "<div class='stat" + (extra ? " " + extra : "") + "'><div class='k'>" + esc(k) + "</div>" +
      "<div class='v'>" + esc(v) + (u ? "<span class='u'>" + esc(u) + "</span>" : "") + "</div></div>";
  }
  var lastMetrics = null;
  function windowLabel() {
    var opt = $("m-window").selectedOptions[0];
    return opt ? opt.textContent.toLowerCase() : "this window";
  }
  function renderMetrics(res) {
    var s = res.summary, series = res.series;
    var st = serviceStatus(s, windowLabel());
    $("line-status").setAttribute("data-status", st.key === "unknown" ? "idle" : st.key);
    $("ls-title").textContent = st.title;
    $("ls-reason").textContent = st.reason + (st.key === "idle" ? "" : " " + STATUS_RULE);
    var times = series.map(function (b) { return b.ts; });
    $("stats").innerHTML =
      stat("Requests", fmtNum(s.count), "") +
      (s.rps >= 1 || !s.count ? stat("Throughput", fmtNum(s.rps), "req/s") : stat("Throughput", fmtNum(s.rps * 60), "req/min")) +
      stat("Error rate", (s.error_rate * 100).toFixed(1), "%", s.error_rate >= 0.05 ? "danger" : s.error_rate >= 0.01 ? "warn" : "") +
      stat("Latency p50", s.p50_ms == null ? "–" : fmtNum(s.p50_ms), "ms") +
      stat("Latency p95", s.p95_ms == null ? "–" : fmtNum(s.p95_ms), "ms", s.p95_ms >= 3000 ? "danger" : s.p95_ms >= 1000 ? "warn" : "");
    lineChart($("chart-req"), [
      { name: "Requests", values: series.map(function (b) { return b.count; }), color: cssVar("--l-request"), fill: true },
      { name: "Errors", values: series.map(function (b) { return b.errors; }), color: cssVar("--disrupt") },
    ], { times: times, integer: true, label: "Requests and errors over time", legendId: "legend-req" });
    lineChart($("chart-lat"), [
      { name: "p95", values: series.map(function (b) { return b.p95_ms; }), color: cssVar("--l-request"), fill: true },
      { name: "Average", values: series.map(function (b) { return b.avg_ms; }), color: cssVar("--l-log") },
    ], {
      times: times, label: "p95 and average latency in milliseconds", legendId: "legend-lat", unit: " ms", noteId: "thr-note", swatchId: "thr-swatch",
      thresholds: [
        { v: 1000, label: "Minor delays, 1 s", short: "1 s", color: cssVar("--delay") },
        { v: 3000, label: "Severe delays, 3 s", short: "3 s", color: cssVar("--disrupt") },
      ],
    });
  }
  function loadMetrics() {
    var my = ++reqSeq.metrics;
    hideBanner("error");
    // One call, one scan of the window (summary + series used to be two).
    api("/metrics", { window: $("m-window").value, buckets: 60 }).then(function (res) {
      if (my !== reqSeq.metrics) return;
      lastMetrics = res;
      renderMetrics(res);
      $("m-updated").textContent = "Updated " + fmtTimeShort(Date.now() / 1000);
    }).catch(function (err) {
      if (my !== reqSeq.metrics) return;
      if (err.message !== "unauthorized") showBanner("Could not load metrics: " + err.message + ".");
    });
  }
  function setMetricsAuto(on) {
    if (state.metricsTimer) { clearInterval(state.metricsTimer); state.metricsTimer = null; }
    if (!on) return;
    state.metricsTimer = setInterval(function () {
      if (!document.hidden && state.view === "metrics") loadMetrics();
    }, 15000);
  }
  $("m-refresh").addEventListener("click", loadMetrics);
  $("m-window").addEventListener("change", loadMetrics);
  $("m-auto").addEventListener("change", function (e) {
    writeLocal("nhl_metrics_auto", e.target.checked ? "1" : "0");
    setMetricsAuto(e.target.checked);
  });

  /* Trace: the route */
  function openTrace(traceId) {
    $("t-id").value = traceId;
    if (state.view === "trace") loadTrace();
    else activateTab("trace");
  }
  function loadRecentTraces() {
    var my = ++reqSeq.trace;
    var list = $("trace-list");
    list.innerHTML = "<p class='meta'>Loading recent traces</p>";
    api("/logs", { limit: 200 }).then(function (res) {
      if (my !== reqSeq.trace) return;
      // Group the newest events by trace; label each trace by its root
      // request (or first event), not by whichever log happened last.
      var groups = {}, order = [];
      res.items.forEach(function (e) {
        if (!e.trace_id) return;
        var g = groups[e.trace_id];
        if (!g) {
          g = groups[e.trace_id] = { id: e.trace_id, last: e.ts, label: e, count: 0, failed: false };
          order.push(g);
        }
        g.count++;
        if (failed(e)) g.failed = true;
        if (e.type === "request" && g.label.type !== "request") g.label = e;
        else if (g.label.type !== "request" && e.ts <= g.label.ts) g.label = e;
      });
      var items = order.slice(0, 30);
      if (!items.length) {
        list.innerHTML = emptyState("No traces yet", "Every request starts a trace. Open one from a log row, or paste a trace id above.");
        return;
      }
      list.innerHTML = "<p class='meta'>Recent traces, newest first</p><div class='recent-list'>" + items.map(function (g) {
        var e = g.label, d = e.data || {};
        var top = e.type === "request"
          ? methodChip(d.method) + "<span class='path'>" + esc(d.path || "") + "</span>" + (d.status != null ? statusChip(d.status) : "") +
            (d.duration_ms != null ? "<span class='dur'>" + esc(fmtDur(d.duration_ms)) + "</span>" : "")
          : stationHtml(e) + "<span class='path'>" + esc(displayMessage(e)) + "</span>";
        return "<button type='button' class='recent-row' data-trace='" + esc(g.id) + "'>" +
          "<span class='recent-top'>" + top + "</span>" +
          "<span class='recent-when' title='" + esc(fmtTime(g.last)) + "'>" + esc(fmtAgo(g.last)) + "</span>" +
          "<span class='recent-sub'><span class='mono'>" + esc(g.id) + "</span><span>" + g.count + (g.count === 1 ? " event" : " events") + "</span>" +
          (g.failed ? "<span class='bad'>Has errors</span>" : "") + "</span></button>";
      }).join("") + "</div>";
    }).catch(function (err) {
      if (my !== reqSeq.trace) return;
      if (err.message !== "unauthorized") showBanner("Could not load traces: " + err.message + ".");
    });
  }
  // Order trace events as a tree: each event sits under the span it ran
  // inside (spans: parent_span_id; logs/errors: the span active when they
  // were emitted; requests: the upstream W3C parent). Siblings run in time
  // order. Old events without links fall back to hanging off the request.
  function buildTraceTree(events) {
    function byTime(a, b) {
      var dt = (Number(a.ts) || 0) - (Number(b.ts) || 0);
      if (dt) return dt;
      if (a.type === "request" && b.type !== "request") return -1;
      if (b.type === "request" && a.type !== "request") return 1;
      return (a.id || 0) - (b.id || 0);
    }
    var sorted = events.slice().sort(byTime);
    var bySpan = {};
    sorted.forEach(function (e) {
      var d = e.data || {};
      if ((e.type === "span" || e.type === "request") && d.span_id && !bySpan[d.span_id]) bySpan[d.span_id] = e;
    });
    var rootReq = null;
    sorted.forEach(function (e) { if (!rootReq && e.type === "request") rootReq = e; });
    var nodes = {}, roots = [];
    sorted.forEach(function (e) { nodes[e.id] = { e: e, kids: [], parent: null }; });
    sorted.forEach(function (e) {
      var d = e.data || {};
      var link = e.type === "request" ? d.parent_id : d.parent_span_id;
      var parent = link ? bySpan[link] : null;
      if (parent === e) parent = null;
      if (!parent && rootReq && e !== rootReq && e.type !== "request" && !d.parent_span_id) parent = rootReq;
      if (parent) { nodes[e.id].parent = nodes[parent.id]; nodes[parent.id].kids.push(nodes[e.id]); }
      else roots.push(nodes[e.id]);
    });
    var out = [], seen = {};
    function walk(n, depth) {
      if (seen[n.e.id]) return;
      seen[n.e.id] = true;
      n.depth = depth;
      out.push(n);
      n.kids.forEach(function (k, i) { k.last = i === n.kids.length - 1; walk(k, depth + 1); });
    }
    roots.forEach(function (r) { r.last = true; walk(r, 0); });
    // Anything stuck in a parent cycle still gets shown.
    sorted.forEach(function (e) { if (!seen[e.id]) { nodes[e.id].parent = null; walk(nodes[e.id], 0); } });
    return out;
  }
  // The route column: each level is a line in its event's colour; children
  // branch off their parent's line at 45 degrees, and stops sit on the line.
  var RW = 14, RH = 38, RMID = 19, MAX_DEPTH = 10;
  function lineVar(e) { return "var(--l-" + lineOf(e) + ")"; }
  // Logs are stops on their span's line, coloured by level where it matters.
  function stopVar(e) {
    if (e.level === "ERROR" || e.level === "CRITICAL") return "var(--disrupt)";
    if (e.level === "WARNING") return "var(--delay)";
    return lineVar(e);
  }
  function routeSvg(n, maxDepth) {
    var depth = Math.min(n.depth, MAX_DEPTH);
    var X = function (d) { return 7 + Math.min(d, MAX_DEPTH) * RW; };
    var w = X(maxDepth) + 9;
    var p = [];
    function seg(d, color) { p.push("<path pathLength='1' d='" + d + "' style='stroke:" + color + "'/>"); }
    // Ancestors whose lines still have stops further down pass straight through.
    var chain = [];
    for (var a = n; a.parent; a = a.parent) chain.push(a);
    chain.forEach(function (c) {
      var anc = c.parent;
      if (c === n) return;
      if (!c.last) seg("M" + X(anc.depth) + " 0V" + RH, lineVar(anc.e));
    });
    if (n.parent) {
      var px = X(n.parent.depth), cx = X(depth);
      if (!n.last) seg("M" + px + " 0V" + RH, lineVar(n.parent.e));
      else seg("M" + px + " 0V" + (RMID - (cx - px)), lineVar(n.parent.e));
      seg("M" + px + " " + (RMID - (cx - px)) + "L" + cx + " " + RMID, lineVar(n.e));
    }
    if (n.kids.length) seg("M" + X(depth) + " " + RMID + "V" + RH, lineVar(n.e));
    var stop;
    if (n.e.type === "log") {
      stop = "<circle class='tick' cx='" + X(depth) + "' cy='" + RMID + "' r='" + (stopVar(n.e) === lineVar(n.e) ? 3.5 : 4.5) + "' style='fill:" + stopVar(n.e) + "'/>";
    } else {
      stop = "<circle class='" + (failed(n.e) ? "fail" : "") + "' cx='" + X(depth) + "' cy='" + RMID + "' r='5' style='stroke:" + lineVar(n.e) + "'/>";
    }
    return "<svg class='route' width='" + w + "' height='" + RH + "' viewBox='0 0 " + w + " " + RH + "' aria-hidden='true'>" + p.join("") + stop + "</svg>";
  }
  function loadTrace() {
    var tid = $("t-id").value.trim();
    var list = $("trace-list");
    if (!tid) { loadRecentTraces(); return; }
    var my = ++reqSeq.trace;
    hideBanner("error");
    list.innerHTML = "<p class='meta'>Loading trace</p>";
    api("/traces/" + encodeURIComponent(tid)).then(function (res) {
      if (my !== reqSeq.trace) return;
      if (res.trace_id && res.trace_id !== tid) $("t-id").value = res.trace_id;
      if (!res.events.length) {
        list.innerHTML = emptyState("No events for this trace id",
          "Check the id, or it may be older than the retention window. Prefixes need at least 8 characters.");
        return;
      }
      var summary = res.summary || {};
      var totalDur = Number(summary.total_duration_ms || 0);
      var startTs = Number(summary.start_ts || res.events[0].ts || 0);
      var facts = [["Duration", totalDur > 0 ? fmtDur(totalDur) : "–"], ["Events", fmtNum(res.events.length)]];
      if (summary.span_count) facts.push(["Spans", fmtNum(summary.span_count)]);
      if (summary.has_ai && summary.ai_summary) {
        var ai = summary.ai_summary;
        if (ai.total_tokens) facts.push(["Tokens", fmtNum(ai.total_tokens)]);
        if (ai.tool_calls_count) facts.push(["Tool calls", fmtNum(ai.tool_calls_count)]);
      }
      var models = summary.ai_summary && summary.ai_summary.models ? summary.ai_summary.models : [];
      var head = "<div class='trace-head'><span class='route-id'>" + esc(res.trace_id) + "</span>" +
        "<dl class='facts'>" + facts.map(function (f) { return "<div><dt>" + esc(f[0]) + "</dt><dd>" + esc(f[1]) + "</dd></div>"; }).join("") +
        (summary.error_count ? "<div><dt>Errors</dt><dd class='bad'>" + fmtNum(summary.error_count) + "</dd></div>" : "") +
        "</dl>" + models.map(function (m) { return chip(m, "model"); }).join("") +
        "<span class='push-right'><button type='button' class='btn small' data-copy-trace='" + esc(res.trace_id) + "'>" + ICON.copy + "Copy trace id</button></span></div>";

      RW = window.innerWidth < 760 ? 10 : 14;
      var rows = buildTraceTree(res.events);
      var maxDepth = Math.min(MAX_DEPTH, rows.reduce(function (m, r) { return Math.max(m, r.depth); }, 0));
      var lastEnd = rows.reduce(function (acc, r) {
        var d = r.e.data || {};
        return Math.max(acc, (Number(r.e.ts) - startTs) * 1000 + (Number(d.duration_ms) || 0));
      }, 0);
      // Never let an event fall off the right edge, even for old data whose
      // summary only knew the request's own duration.
      var scale = Math.max(totalDur, lastEnd, 0.001);
      var body = rows.map(function (n, idx) {
        var e = n.e, d = e.data || {};
        var relMs = Math.max(0, (Number(e.ts) - startTs) * 1000);
        var evDur = d.duration_ms != null ? Math.max(0, Number(d.duration_ms)) : 0;
        var left = Math.min(100, (relMs / scale) * 100);
        var width = Math.min(100 - left, (evDur / scale) * 100);
        var name, badge = "";
        if (e.type === "request") { badge = methodChip(d.method || "REQ"); name = d.path || displayMessage(e); }
        else if (e.type === "span") { name = d.name || displayMessage(e); }
        else if (e.type === "error") { name = displayMessage(e); }
        else { badge = e.level ? chip(e.level) : ""; name = displayMessage(e); }
        var sub = e.type === "span" ? (d.span_type || "span") + (d.model ? ", " + d.model : "") + (d.total_tokens ? ", " + fmtNum(d.total_tokens) + " tokens" : "") : "";
        if (e.type === "request" && d.status != null) badge += statusChip(d.status);
        var lbl = evDur > 0 ? fmtDur(evDur) : "";
        var mark = evDur > 0
          ? "<div class='wf-seg l-" + lineOf(e) + "' style='left:" + left.toFixed(2) + "%;width:" + width.toFixed(2) + "%'></div>"
          : "<div class='wf-mark l-" + lineOf(e) + (failed(e) || e.level === "ERROR" || e.level === "CRITICAL" ? " fail" : e.level === "WARNING" ? " lvl-warn" : "") +
            "' style='left:" + left.toFixed(2) + "%'></div>";
        // Durations get their own column: labels beside bars collide with
        // names and with each other once bars cross the whole track.
        var durCell = lbl
          ? "<div class='wf-dur'>" + esc(lbl) + "</div>"
          : "<div class='wf-dur at' title='Point event: when it happened'>+" + esc(fmtDur(relMs)) + "</div>";
        var label = name + (lbl ? ", " + lbl : "") + ", starts at +" + fmtDur(relMs);
        return "<div class='wf-row" + (failed(e) ? " error" : "") + (String(e.id) === String(state.selectedId) ? " selected" : "") +
          "' data-id='" + e.id + "' tabindex='0' role='button' aria-label='" + esc(label) + "' style='--i:" + Math.min(idx, 30) + "'>" +
          "<div class='wf-info'>" + routeSvg(n, maxDepth) + badge +
          "<span class='wf-name' title='" + esc(name) + "'>" + esc(name) + (sub ? "<span class='sub'>" + esc(sub) + "</span>" : "") + "</span></div>" +
          durCell +
          "<div class='wf-track' title='Starts at +" + esc(fmtDur(relMs)) + (lbl ? ", lasts " + esc(lbl) : "") + "'>" + mark + "</div></div>";
      }).join("");
      var ticks = [0, 0.25, 0.5, 0.75, 1].map(function (f) {
        return "<span class='wf-tick" + (f === 0 ? " first" : f === 1 ? " last" : "") + "' style='left:" + f * 100 + "%'>" + esc(fmtDur(scale * f)) + "</span>";
      }).join("");
      list.innerHTML = head + "<div class='trace-waterfall drawn'><div class='wf-header'><span>Route</span><span class='wf-dur'>Duration</span>" +
        "<span class='wf-ticks' aria-hidden='true'>" + ticks + "</span></div>" + body + "</div>";
    }).catch(function (err) {
      if (my !== reqSeq.trace) return;
      if (err.message !== "unauthorized") showBanner("Could not load trace: " + err.message + ".");
    });
  }
  $("trace-form").addEventListener("submit", function (e) { e.preventDefault(); loadTrace(); });
  $("t-recent").addEventListener("click", function () { $("t-id").value = ""; loadRecentTraces(); });
  $("trace-list").addEventListener("click", function (e) {
    var copyTrace = e.target.closest("[data-copy-trace]");
    if (copyTrace) { copyText(copyTrace.getAttribute("data-copy-trace"), copyTrace); return; }
    var t = e.target.closest("[data-trace]");
    if (t) { openTrace(t.getAttribute("data-trace")); return; }
    var item = e.target.closest("[data-id]");
    if (item) openDetail(item.getAttribute("data-id"));
  });

  /* Boot */
  $("logout-btn").addEventListener("click", function () {
    fetch(API + "/logout", { method: "POST" }).finally(function () {
      try { sessionStorage.removeItem("nhl_token"); } catch (e) { /* ignore */ }
      state.token = "";
      location.assign(BASE + "/");
    });
  });
  var resizeFrame = 0;
  window.addEventListener("resize", function () {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(function () {
      if (lastVolume) renderVolume(lastVolume);
      if (state.view === "metrics" && lastMetrics) renderMetrics(lastMetrics);
    });
  });
  initToken();
  loadHealth();
  loadStatus();
  var savedLive = readLocal("nhl_live");
  if (savedLive === null || savedLive === "1") setLive(true);
  else loadLogs();
  var autoMetrics = readLocal("nhl_metrics_auto") !== "0";
  $("m-auto").checked = autoMetrics;
  setMetricsAuto(autoMetrics);
  setInterval(function () {
    if (document.hidden) return;
    loadHealth();
    loadStatus();
  }, 15000);
})();
