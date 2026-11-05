/* nahiarhdlog dashboard. Vanilla JS, no dependencies. */
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
      text: "", level: "", type: "", signature: "", range: 0,
      offset: 0, limit: 50, live: !!live,
    };
  }

  var state = {
    token: readSession("nhl_token") || "",
    view: "logs",
    logs: freshLogFilters(false),
    liveTimer: null,
    metricsTimer: null,
  };

  // Request generations: rapid clicks and live-tail ticks overlap in flight,
  // so a slow older response must never overwrite newer state. Each loader
  // bumps its counter when issuing and drops responses from a past generation.
  var reqSeq = { logs: 0, errors: 0, trace: 0, metrics: 0, detail: 0, health: 0 };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtTime(ts) {
    if (ts == null) return "—";
    var d = new Date(ts * 1000);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString();
  }
  function pad2(n) { return n < 10 ? "0" + n : String(n); }
  function fmtTimeShort(ts) {
    if (ts == null) return "—";
    var d = new Date(ts * 1000);
    var now = new Date();
    var clock = pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
    if (d.toDateString() === now.toDateString()) return clock;
    var md = pad2(d.getMonth() + 1) + "/" + pad2(d.getDate());
    if (d.getFullYear() === now.getFullYear()) return md + " " + clock;
    return d.getFullYear() + "/" + md + " " + clock;
  }
  function formatTraceback(text) {
    if (!text) return "";
    var lines = String(text).split("\n");
    var hasTraceback = lines.some(function (l) { return l.indexOf("Traceback") !== -1; });
    if (!hasTraceback) return esc(text);
    return lines.map(function (line) {
      var escaped = esc(line);
      if (/^\s*File\s+["'].*["'],\s+line\s+\d+/.test(line)) {
        return "<span class='tb-frame'>" + escaped + "</span>";
      }
      if (/^\[\.\.\..*truncated.*\]$/.test(line.trim())) {
        return "<span class='tb-trunc'>" + escaped + "</span>";
      }
      if (/^\s*(?:\|\s*)*->/.test(line)) {
        return "<span class='tb-var'>" + escaped + "</span>";
      }
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
      try {
        var p = JSON.parse(val);
        return esc(JSON.stringify(p, null, 2));
      } catch (err) {
        return esc(val);
      }
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

        var excMatch = line.match(/^([a-zA-Z0-9_.]*(?:Error|Exception|Exit|Interrupt|Fault|Warning|Disconnect|Notice|Cancel)[a-zA-Z0-9_]*)(?::\s*(.*))?$/);
        if (excMatch) return line;

        var colonMatch = line.match(/^([A-Z][A-Za-z0-9_]+):\s+(.+)$/);
        if (colonMatch) return line;
      }

      var first = lines[0].trim();
      if (first && first.indexOf("Traceback") !== 0) {
        var cleanFirst = first.replace(/:\s*%[sdr]$/, "").replace(/%[sdr]$/, "").trim();
        if (cleanFirst) {
          if (d.exc_type && cleanFirst.indexOf(d.exc_type) === -1) {
            return d.exc_type + ": " + cleanFirst;
          }
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
  function rowClass(e) {
    var d = e.data || {};
    var st = Number(d.status);
    var lvl = e.level || "";
    var method = String(d.method || "").toUpperCase();
    var msg = displayMessage(e);
    if (e.type === "error" || lvl === "CRITICAL" || st >= 500) return "sev-crit";
    if (e.type === "span" && d.status === "error") return "sev-err";
    if (lvl === "ERROR" || st >= 400) return "sev-err";
    if (lvl === "WARNING") return "sev-warn";
    if (method === "DELETE" || /^\s*Deleted\b/i.test(msg)) return "sev-mut";
    if (method === "PUT" || method === "PATCH" || /^\s*(Updated|Renamed)\b/i.test(msg)) return "sev-upd";
    return "";
  }
  var COPY_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  function fmtAgo(ts) {
    if (ts == null) return "—";
    var sec = Math.max(0, Date.now() / 1000 - ts);
    if (sec < 60) return Math.floor(sec) + "s ago";
    if (sec < 3600) return Math.floor(sec / 60) + "m ago";
    if (sec < 86400) return Math.floor(sec / 3600) + "h ago";
    return Math.floor(sec / 86400) + "d ago";
  }
  function fmtNum(n) {
    if (n == null) return "—";
    return Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 });
  }
  // One banner, two owners: view loaders report load errors ("error") and
  // the health poll reports backend flips ("warn"). Each only clears its
  // own message, so a 2s live-tail tick can't wipe the backend warning.
  var bannerKind = null;
  function showBanner(msg, kind) {
    kind = kind || "error";
    var b = $("banner");
    $("banner-text").textContent = msg;
    b.classList.toggle("warn", kind === "warn");
    b.classList.remove("hidden");
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
      if (!r.ok) throw new Error("request failed: " + r.status);
      return r.json();
    }, function () {
      throw new Error("server unreachable");
    });
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
    state.view = view;
    var tip = $("chart-tip");
    if (tip) tip.hidden = true;
    if (opts.focus && t) t.focus();
    if (view === "logs") {
      if (state.logs.live) loadLogs({ silent: true });
    }
    if (view === "errors") loadErrors();
    if (view === "metrics") loadMetrics();
    if (view === "trace") {
      if ($("t-id").value.trim()) loadTrace();
      else loadRecentTraces();
    }
  }
  tabs.forEach(function (t) {
    t.addEventListener("click", function () {
      activateTab(t.getAttribute("data-view"));
    });
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

  /* Theme */
  function applyTheme(name) {
    document.documentElement.setAttribute("data-theme", name);
    writeLocal("nhl_theme", name);
  }
  (function initTheme() {
    // index.html sets it before first paint; only persist explicit choices,
    // so the OS preference keeps applying until the user toggles.
    if (document.documentElement.getAttribute("data-theme")) return;
    var saved = readLocal("nhl_theme");
    document.documentElement.setAttribute("data-theme",
      saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  })();
  $("theme-toggle").addEventListener("click", function () {
    var cur = document.documentElement.getAttribute("data-theme");
    applyTheme(cur === "dark" ? "light" : "dark");
    // Chart colors are baked into the SVG: redraw from the last payload.
    if (state.view === "metrics" && lastMetrics) renderMetrics(lastMetrics.summary, lastMetrics.series);
  });

  /* Health */
  var lastInstance = null;
  function loadHealth() {
    var my = ++reqSeq.health;
    api("/health").then(function (h) {
      if (my !== reqSeq.health) return;
      $("version").textContent = "v" + h.version;
      var inst = h.instance ? h.instance.host + "/" + h.instance.pid : "?";
      $("health-text").textContent = "queue " + h.queued + " · dropped " + h.dropped + " · " + inst;
      $("health").title = "Backend " + inst + " · collector queue / dropped events";
      $("health-dot").className = "dot" + (h.dropped > 0 ? " warn" : " ok");
      // Switching backends only loses data when each one has its own store.
      if (!h.shared_storage && lastInstance && lastInstance !== inst &&
          $("banner").classList.contains("hidden")) {
        showBanner("Dashboard reached a different backend (" + lastInstance + " → " + inst + "). " +
          "With multiple replicas each has its own database — enable sticky sessions for stable reads.", "warn");
      }
      lastInstance = inst;
    }).catch(function (err) {
      if (my !== reqSeq.health || err.message === "unauthorized") return;
      // Banner stays owned by the view loaders; the dot shows the outage.
      $("health-dot").className = "dot down";
      $("health-text").textContent = "backend unreachable";
    });
  }

  /* Logs */
  function chip(text, cls) {
    return '<span class="chip ' + esc(cls || text) + '">' + esc(text) + "</span>";
  }
  function methodChip(method) {
    var m = String(method || "").toUpperCase();
    if (!m) return "";
    return chip(m, "method method-" + m.toLowerCase());
  }
  function requestMsgHtml(e) {
    var d = e.data || {};
    var path = d.path || displayMessage(e);
    var parts = [];
    if (d.method) parts.push(methodChip(d.method));
    parts.push("<span class='path'>" + esc(path) + "</span>");
    if (d.status != null) parts.push(statusChip(d.status));
    if (d.duration_ms != null) parts.push("<span class='dur'>" + esc(fmtDur(d.duration_ms)) + "</span>");
    return parts.join(" ");
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
    var action = m[1];
    var rest = m[2];
    var parts = [chip(action, "action " + actionClass(action))];
    var em = rest.match(/^(document|folder|agent|organization)s?\s*:?\s*(.*)$/i);
    if (!em) {
      parts.push("<span class='rest'>" + esc(rest) + "</span>");
      return parts.join(" ");
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
    return parts.join(" ");
  }
  function errorMsgHtml(e) {
    var raw = displayMessage(e);
    var colonIdx = raw.indexOf(":");
    if (colonIdx !== -1 && colonIdx < 60) {
      var exc = raw.slice(0, colonIdx).trim();
      var rest = raw.slice(colonIdx + 1).trim();
      return "<strong class='exc-type'>" + esc(exc) + "</strong>" + (rest ? ": <span class='exc-msg'>" + esc(rest) + "</span>" : "");
    }
    return "<strong class='exc-type'>" + esc(raw) + "</strong>";
  }
  function fmtDur(ms) {
    var n = Number(ms);
    if (ms == null || isNaN(n)) return "";
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 1 : 2) + " s";
    return (n >= 100 ? n.toFixed(0) : n.toFixed(1)) + " ms";
  }
  var SPAN_KINDS = {
    llm: "llm", tool: "tool", embedding: "embedding", embed: "embedding", agent: "agent",
    db: "db", sql: "db", cache: "cache", redis: "cache", http: "http", service: "http", auth: "auth",
  };
  function spanKindChip(st) {
    st = String(st || "span");
    var cls = SPAN_KINDS[st.toLowerCase()] || "span";
    return chip(st, cls + " type");
  }
  function spanMsgHtml(e) {
    var d = e.data || {};
    var parts = [spanKindChip(d.span_type)];
    parts.push("<span class='name'>" + esc(d.name || displayMessage(e)) + "</span>");
    if (d.model) parts.push("<span class='id'>" + esc(d.model) + "</span>");
    if (d.duration_ms != null) parts.push("<span class='dur'>" + esc(fmtDur(d.duration_ms)) + "</span>");
    if (d.total_tokens) parts.push("<span class='dur'>" + esc(fmtNum(d.total_tokens)) + " tok</span>");
    if (d.status === "error") {
      var why = d.error && d.error.exc_message ? d.error.exc_message : "failed";
      parts.push(chip("error", "error") + " <span class='exc-msg'>" + esc(why) + "</span>");
    }
    return parts.join(" ");
  }
  function msgHtml(e) {
    if (e.type === "request") return requestMsgHtml(e);
    if (e.type === "error") return errorMsgHtml(e);
    if (e.type === "span") return spanMsgHtml(e);
    return logMsgHtml(e);
  }
  function logRowHtml(e) {
    var traceCell = e.trace_id
      ? '<button type="button" class="link trace-id" data-trace="' + esc(e.trace_id) +
        '" title="' + esc(e.trace_id) + '" aria-label="Open trace ' + esc(e.trace_id) + '">' +
        esc(e.trace_id) + "</button>" +
        '<button type="button" class="copy-btn" data-copy="' + esc(e.trace_id) +
        '" aria-label="Copy trace id" title="Copy trace id" tabindex="-1">' +
        COPY_ICON + "</button>"
      : "—";
    return "<tr data-id='" + e.id + "' tabindex='0' class='" + rowClass(e) + "'>" +
      "<td class='time' title='" + esc(fmtTime(e.ts)) + "'>" + esc(fmtTimeShort(e.ts)) + "</td>" +
      "<td class='level'>" + (e.level ? chip(e.level) : "—") + "</td>" +
      "<td class='type'>" + chip(e.type, e.type + " type") + "</td>" +
      "<td class='msg' title='" + esc(displayMessage(e)) + "'>" + msgHtml(e) + "</td>" +
      "<td class='trace'>" + traceCell + "</td></tr>";
  }
  function renderSigChip() {
    var chipEl = $("sig-chip");
    if (state.logs.signature) {
      $("sig-chip-text").textContent = state.logs.signature;
      chipEl.classList.remove("hidden");
    } else {
      chipEl.classList.add("hidden");
    }
  }
  function loadLogs(opts) {
    var silent = !!(opts && opts.silent);
    var f = state.logs;
    var params = { limit: f.limit, offset: f.offset };
    if (f.text) params.text = f.text;
    if (f.level) params.level = f.level;
    if (f.type) params.type = f.type;
    if (f.signature) params.signature = f.signature;
    // Relative ranges are re-anchored on every load so live tail keeps moving.
    if (f.range > 0) params.since = Date.now() / 1000 - f.range;
    var my = ++reqSeq.logs;
    hideBanner("error");
    var body = $("logs-body");
    if (!silent) {
      body.innerHTML = '<tr class="empty-row"><td colspan="5">Loading…</td></tr>';
    }
    return api("/logs", params).then(function (res) {
      if (my !== reqSeq.logs) return;
      var ids = res.items.map(function (e) { return String(e.id); }).join(",");
      if (silent && body.getAttribute("data-ids") === ids) {
        renderLogsMeta(res);
        return;
      }
      var wrap = body.closest(".table-wrap");
      var scroll = wrap ? wrap.scrollTop : 0;
      var active = document.activeElement;
      var focusId = active && active.getAttribute && active.getAttribute("data-id");
      var rows = res.items.map(logRowHtml);
      body.innerHTML = rows.length
        ? rows.join("")
        : '<tr class="empty-row"><td colspan="5">No events match these filters.</td></tr>';
      body.setAttribute("data-ids", ids);
      if (silent && wrap) wrap.scrollTop = scroll;
      if (silent && focusId) {
        var el = body.querySelector("tr[data-id='" + focusId + "']");
        if (el) el.focus();
      }
      renderLogsMeta(res);
    }).catch(function (err) {
      if (my !== reqSeq.logs) return;
      if (err.message !== "unauthorized") showBanner("Could not load logs: " + err.message);
    });
  }
  function renderLogsMeta(res) {
    var f = state.logs;
    var start = res.total === 0 ? 0 : res.offset + 1;
    $("logs-meta").innerHTML = "Showing <strong>" + fmtNum(start) + "–" +
      fmtNum(res.offset + res.items.length) + "</strong> of <strong>" + fmtNum(res.total) + "</strong>" +
      (f.range > 0 ? " · " + esc(rangeLabel(f.range)) : "");
    var pages = Math.max(1, Math.ceil(res.total / res.limit));
    $("page-info").textContent = "Page " + fmtNum(Math.floor(res.offset / res.limit) + 1) + " of " + fmtNum(pages);
    $("page-prev").disabled = res.offset <= 0;
    $("page-next").disabled = res.offset + res.items.length >= res.total;
    renderSigChip();
  }
  function rangeLabel(seconds) {
    var opt = $("f-range").querySelector("option[value='" + seconds + "']");
    return opt ? opt.textContent : "";
  }
  function applyLogFilters() {
    state.logs.text = $("f-text").value.trim();
    state.logs.level = $("f-level").value;
    state.logs.type = $("f-type").value;
    state.logs.range = Number($("f-range").value) || 0;
    state.logs.signature = "";
    state.logs.offset = 0;
    loadLogs();
  }
  $("log-filters").addEventListener("submit", function (e) {
    e.preventDefault();
    applyLogFilters();
  });
  // Selects apply immediately; only the text box waits for Enter/Apply.
  ["f-level", "f-type", "f-range"].forEach(function (id) {
    $(id).addEventListener("change", applyLogFilters);
  });
  $("f-clear").addEventListener("click", function () {
    $("f-text").value = "";
    $("f-level").value = "";
    $("f-type").value = "";
    $("f-range").value = "0";
    state.logs = freshLogFilters(state.logs.live);
    if (state.logs.live) setLive(true);
    else loadLogs();
  });
  document.addEventListener("keydown", function (e) {
    // "/" focuses search, like most log viewers.
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if ($("detail").open) return;
    e.preventDefault();
    if (state.view !== "logs") activateTab("logs");
    $("f-text").focus();
    $("f-text").select();
  });
  $("sig-chip-clear").addEventListener("click", function () {
    state.logs.signature = "";
    state.logs.offset = 0;
    if (state.logs.live) setLive(true);
    else loadLogs();
  });
  $("page-prev").addEventListener("click", function () {
    state.logs.offset = Math.max(0, state.logs.offset - state.logs.limit);
    if (state.logs.offset === 0) {
      if (readLocal("nhl_live") !== "0") setLive(true);
      else loadLogs();
    } else {
      setLive(false);
      loadLogs();
    }
  });
  $("page-next").addEventListener("click", function () {
    setLive(false);
    state.logs.offset += state.logs.limit;
    loadLogs();
  });
  function setLive(on) {
    state.logs.live = on;
    $("f-live").checked = on;
    $("live-label").classList.toggle("on", on);
    writeLocal("nhl_live", on ? "1" : "0");
    if (state.liveTimer) { clearInterval(state.liveTimer); state.liveTimer = null; }
    if (on) {
      state.logs.offset = 0;
      loadLogs({ silent: true });
      state.liveTimer = setInterval(function () {
        if (document.hidden || state.view !== "logs") return;
        if ($("detail").open) return;
        loadLogs({ silent: true });
      }, 2000);
    }
  }
  $("f-live").addEventListener("change", function (e) { setLive(e.target.checked); });

  /* Row detail + trace jumps (event delegation) */
  $("logs-body").addEventListener("click", function (e) {
    var copyBtn = e.target.closest("[data-copy]");
    if (copyBtn) {
      e.stopPropagation();
      e.preventDefault();
      var id = copyBtn.getAttribute("data-copy");
      if (id && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(id).then(function () {
          copyBtn.classList.add("copied");
          copyBtn.setAttribute("aria-label", "Copied");
          clearTimeout(copyBtn._copied);
          copyBtn._copied = setTimeout(function () {
            copyBtn.classList.remove("copied");
            copyBtn.setAttribute("aria-label", "Copy trace id");
          }, 1200);
        }).catch(function () { /* ignore */ });
      }
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
  $("logs-body").addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var row = e.target.closest("tr[data-id]");
    if (row) { e.preventDefault(); openDetail(row.getAttribute("data-id")); }
  });
  function statusChip(status) {
    var s = Number(status);
    var cls = s >= 500 ? "ERROR" : s >= 400 ? "WARNING" : s >= 300 ? "INFO" : "ok";
    return chip(String(status), cls);
  }
  var detailEvent = null;
  function payloadSection(label, copyLabel, bodyHtml) {
    return "<div class='detail-section'>" +
      "<div class='detail-section-head'>" +
        "<span class='section-label'>" + esc(label) + "</span>" +
        "<button type='button' class='btn small copy-section-btn' data-copy-pre='1'>" +
          COPY_ICON + " " + esc(copyLabel) +
        "</button>" +
      "</div>" + bodyHtml +
    "</div>";
  }
  function openDetail(id) {
    var my = ++reqSeq.detail;
    api("/logs/" + id).then(function (e) {
      if (my !== reqSeq.detail) return;
      detailEvent = e;
      var d = e.data || {};
      var head = "", rows = [];
      function add(k, v, mono) {
        if (v === null || v === undefined || v === "") return;
        var val = mono ? "<span class='mono'>" + esc(v) + "</span>" : esc(v);
        rows.push("<dt>" + esc(k) + "</dt><dd>" + val + "</dd>");
      }

      var badgesHtml = "";
      var errBanner = "";
      var payloadSections = "";

      if (e.type === "request") {
        head = esc(d.method || "?") + " " + esc(d.path || "?");
        if (d.status != null) badgesHtml += statusChip(d.status) + " ";
        if (d.method) badgesHtml += methodChip(d.method);
        add("time", fmtTime(e.ts));
        add("duration", d.duration_ms == null ? null : d.duration_ms + " ms");
        add("query", d.query ? "?" + d.query : null, true);
        add("client", d.client, true);
        add("user agent", d.user_agent);
        add("span id", d.span_id, true);
        add("upstream parent", d.parent_id, true);

        if (d.request_headers || d.request_body !== undefined) {
          var reqHdrs = "";
          if (d.request_headers && Object.keys(d.request_headers).length) {
            reqHdrs = "<dl class='headers-block'>" +
              Object.keys(d.request_headers).map(function (k) {
                return "<dt>" + esc(k) + "</dt><dd>" + esc(d.request_headers[k]) + "</dd>";
              }).join("") + "</dl>";
          }
          var reqBody = d.request_body !== undefined ?
            "<pre class='payload-block'>" + formatPayload(d.request_body) + "</pre>" : "";
          payloadSections += "<div class='detail-section'>" +
            "<div class='detail-section-head'>" +
              "<span class='section-label'>Request Payload</span>" +
              "<button type='button' class='btn small copy-section-btn' data-copy-pre='1'>" +
                COPY_ICON + " Copy request" +
              "</button>" +
            "</div>" +
            reqHdrs + reqBody +
          "</div>";
        }

        if (d.response_headers || d.response_body !== undefined) {
          var respHdrs = "";
          if (d.response_headers && Object.keys(d.response_headers).length) {
            respHdrs = "<dl class='headers-block'>" +
              Object.keys(d.response_headers).map(function (k) {
                return "<dt>" + esc(k) + "</dt><dd>" + esc(d.response_headers[k]) + "</dd>";
              }).join("") + "</dl>";
          }
          var respBody = d.response_body !== undefined ?
            "<pre class='payload-block'>" + formatPayload(d.response_body) + "</pre>" : "";
          payloadSections += "<div class='detail-section'>" +
            "<div class='detail-section-head'>" +
              "<span class='section-label'>Response Payload</span>" +
              "<button type='button' class='btn small copy-section-btn' data-copy-pre='1'>" +
                COPY_ICON + " Copy response" +
              "</button>" +
            "</div>" +
            respHdrs + respBody +
          "</div>";
        }
      } else if (e.type === "span") {
        head = esc(d.name || displayMessage(e));
        badgesHtml += spanKindChip(d.span_type) + " ";
        if (d.status === "error") badgesHtml += chip("error", "error") + " ";
        else badgesHtml += chip("ok", "ok") + " ";
        if (d.model) badgesHtml += chip(d.model, "model") + " ";
        if (d.total_tokens) badgesHtml += chip(d.total_tokens + " tok", "tokens") + " ";

        add("time", fmtTime(e.ts));
        add("duration", d.duration_ms == null ? null : d.duration_ms + " ms");
        add("span id", d.span_id, true);
        add("parent span", d.parent_span_id, true);
        add("span type", d.span_type, true);
        add("status", d.status, true);
        if (d.model) add("model", d.model, true);
        if (d.total_tokens != null) {
          add("tokens", d.total_tokens + " (prompt: " + (d.prompt_tokens || 0) + ", compl: " + (d.completion_tokens || 0) + ")", true);
        }

        if (d.error) {
          errBanner = "<div class='detail-error-card'>" +
            "<div class='detail-error-head'>" +
              "<span class='detail-error-title'>" + esc(d.error.exc_type || "Error") + "</span>" +
            "</div>" +
            "<div class='detail-error-msg'>" + esc(d.error.exc_message || "Operation failed") + "</div>" +
          "</div>";
        }

        if (d.system_prompt) {
          payloadSections += "<div class='detail-section'>" +
            "<div class='detail-section-head'>" +
              "<span class='section-label'>System Prompt</span>" +
              "<button type='button' class='btn small copy-section-btn' data-copy-pre='1'>" +
                COPY_ICON + " Copy system prompt" +
              "</button>" +
            "</div>" +
            "<pre class='payload-block'>" + esc(d.system_prompt) + "</pre>" +
          "</div>";
        }

        if (d.messages !== undefined && d.messages !== null) {
          payloadSections += "<div class='detail-section'>" +
            "<div class='detail-section-head'>" +
              "<span class='section-label'>Messages / Prompt</span>" +
              "<button type='button' class='btn small copy-section-btn' data-copy-pre='1'>" +
                COPY_ICON + " Copy messages" +
              "</button>" +
            "</div>" +
            "<pre class='payload-block'>" + formatPayload(d.messages) + "</pre>" +
          "</div>";
        }

        if (d.tool_calls && d.tool_calls.length) {
          payloadSections += "<div class='detail-section'>" +
            "<div class='detail-section-head'>" +
              "<span class='section-label'>Tool Calls</span>" +
              "<button type='button' class='btn small copy-section-btn' data-copy-pre='1'>" +
                COPY_ICON + " Copy tool calls" +
              "</button>" +
            "</div>" +
            "<pre class='payload-block'>" + formatPayload(d.tool_calls) + "</pre>" +
          "</div>";
        }

        if (d.completion !== undefined && d.completion !== null) {
          payloadSections += "<div class='detail-section'>" +
            "<div class='detail-section-head'>" +
              "<span class='section-label'>Completion / Output</span>" +
              "<button type='button' class='btn small copy-section-btn' data-copy-pre='1'>" +
                COPY_ICON + " Copy completion" +
              "</button>" +
            "</div>" +
            "<pre class='payload-block'>" + formatPayload(d.completion) + "</pre>" +
          "</div>";
        }

        if (d.input !== undefined && d.input !== null && d.messages === undefined) {
          payloadSections += "<div class='detail-section'>" +
            "<div class='detail-section-head'>" +
              "<span class='section-label'>Input</span>" +
              "<button type='button' class='btn small copy-section-btn' data-copy-pre='1'>" +
                COPY_ICON + " Copy input" +
              "</button>" +
            "</div>" +
            "<pre class='payload-block'>" + formatPayload(d.input) + "</pre>" +
          "</div>";
        }

        if (d.output !== undefined && d.output !== null && d.completion === undefined) {
          payloadSections += "<div class='detail-section'>" +
            "<div class='detail-section-head'>" +
              "<span class='section-label'>Output</span>" +
              "<button type='button' class='btn small copy-section-btn' data-copy-pre='1'>" +
                COPY_ICON + " Copy output" +
              "</button>" +
            "</div>" +
            "<pre class='payload-block'>" + formatPayload(d.output) + "</pre>" +
          "</div>";
        }
      } else if (e.type === "error") {
        var summary = displayMessage(e);
        head = esc(d.exc_type || summary);
        if (e.level) badgesHtml += chip(e.level) + " ";
        badgesHtml += chip("error", "error type");
        add("time", fmtTime(e.ts));
        add("signature", d.signature, true);
        add("logger", d.logger, true);
        add("location", d.pathname ? d.pathname + ":" + d.lineno + (d.func ? " in " + d.func : "") : null, true);
        if (d.method) add("http", d.method + " " + (d.path || ""), true);
        if (d.origin) add("origin", d.origin, true);

        var reason = d.exc_message || (summary.indexOf(":") !== -1 ? summary.slice(summary.indexOf(":") + 1).trim() : "");
        errBanner = "<div class='detail-error-card'>" +
          "<div class='detail-error-head'>" +
            "<span class='detail-error-title'>" + esc(d.exc_type || "Error") + "</span>" +
            (d.signature ? "<span class='chip mono'>" + esc(d.signature) + "</span>" : "") +
          "</div>" +
          (reason ? "<div class='detail-error-msg'>" + esc(reason) + "</div>" : "") +
        "</div>";
      } else {
        head = esc(displayMessage(e));
        if (e.level) badgesHtml += chip(e.level) + " ";
        badgesHtml += chip(e.type, e.type + " type");
        add("time", fmtTime(e.ts));
        add("logger", d.logger, true);
        add("location", d.pathname ? d.pathname + ":" + d.lineno + (d.func ? " in " + d.func : "") : null, true);
      }

      var standardKeys = [
        "method", "path", "query", "status", "duration_ms", "client", "user_agent",
        "signature", "logger", "pathname", "lineno", "func", "exc_type", "exc_message",
        "origin", "request_headers", "request_body", "response_headers", "response_body", "parent_id",
        "name", "span_type", "span_id", "parent_span_id", "status", "error", "model",
        "prompt_tokens", "completion_tokens", "total_tokens", "system_prompt", "messages",
        "tool_calls", "completion", "input", "output"
      ];
      var extraObjects = {};
      Object.keys(d).forEach(function (k) {
        if (standardKeys.indexOf(k) !== -1 || d[k] == null) return;
        if (typeof d[k] === "object") extraObjects[k] = d[k];
        else add(k, String(d[k]), true);
      });
      if (Object.keys(extraObjects).length) {
        // Nested attributes (span extras, default_data) used to be dropped.
        payloadSections += payloadSection("Attributes", "Copy attributes",
          "<pre class='payload-block'>" + formatPayload(extraObjects) + "</pre>");
      }

      if (e.trace_id) {
        add("trace id", e.trace_id, true);
      }

      var traceActionBtn = $("detail-trace-btn");
      if (traceActionBtn) {
        if (e.trace_id) {
          traceActionBtn.hidden = false;
          traceActionBtn.setAttribute("data-opentrace", e.trace_id);
        } else {
          traceActionBtn.hidden = true;
        }
      }

      $("detail-title").innerHTML = head;
      var badgeBar = $("detail-badge-bar");
      if (badgeBar) badgeBar.innerHTML = badgesHtml;

      var contentSection = "";
      if (e.message && e.type !== "request" && e.type !== "span") {
        var isTb = e.message.indexOf("Traceback") !== -1;
        var sectionTitle = isTb ? "Traceback" : "Message";
        contentSection = "<div class='detail-section'>" +
          "<div class='detail-section-head'>" +
            "<span class='section-label'>" + sectionTitle + "</span>" +
            "<button type='button' class='btn small copy-section-btn' data-copy-pre='1'>" +
              COPY_ICON + " Copy " + sectionTitle.toLowerCase() +
            "</button>" +
          "</div>" +
          "<pre class='traceback-block'>" + (isTb ? formatTraceback(e.message) : esc(e.message)) + "</pre>" +
        "</div>";
      }

      $("detail-body").innerHTML = errBanner +
        "<dl class='kv'>" + rows.join("") + "</dl>" +
        contentSection +
        payloadSections;

      if (!$("detail").open) $("detail").showModal();
      $("detail-body").scrollTop = 0;
      $("detail-close").focus();
    }).catch(function (err) {
      if (my !== reqSeq.detail) return;
      if (err.message !== "unauthorized") showBanner("Could not load event: " + err.message);
    });
  }
  $("detail-close").addEventListener("click", function () { $("detail").close(); });
  $("detail-copy-json").addEventListener("click", function () {
    var btn = this;
    if (!detailEvent || !navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(JSON.stringify(detailEvent, null, 2)).then(function () {
      btn.classList.add("copied");
      btn.textContent = "✓ Copied";
      setTimeout(function () {
        btn.classList.remove("copied");
        btn.textContent = "Copy JSON";
      }, 1500);
    }).catch(function () { /* ignore */ });
  });
  $("detail").addEventListener("click", function (e) {
    if (e.target === $("detail")) { $("detail").close(); return; }
    var b = e.target.closest("[data-opentrace]");
    if (b) { $("detail").close(); openTrace(b.getAttribute("data-opentrace")); }
  });
  $("detail-body").addEventListener("click", function (e) {
    var copyBtn = e.target.closest("[data-copy-pre]");
    if (copyBtn) {
      var section = copyBtn.closest(".detail-section");
      var pre = section ? section.querySelector("pre") : $("detail-body").querySelector("pre");
      if (pre && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(pre.textContent).then(function () {
          copyBtn.classList.add("copied");
          var old = copyBtn.innerHTML;
          copyBtn.innerHTML = "✓ Copied!";
          setTimeout(function () {
            copyBtn.innerHTML = old;
            copyBtn.classList.remove("copied");
          }, 1500);
        }).catch(function () {});
      }
    }
  });
  $("detail").addEventListener("close", function () {
    if (state.logs.live && state.view === "logs") {
      loadLogs({ silent: true });
    }
  });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && state.logs.live && state.view === "logs") {
      loadLogs({ silent: true });
    }
  });

  /* Errors */
  function loadErrors() {
    var my = ++reqSeq.errors;
    hideBanner("error");
    var list = $("errors-list");
    list.innerHTML = "<p class='meta'>Loading…</p>";
    var win = Number($("e-window").value) || 0;
    var params = { limit: 50 };
    if (win > 0) params.since = Date.now() / 1000 - win;
    api("/errors/top", params).then(function (rows) {
      if (my !== reqSeq.errors) return;
      var total = rows.reduce(function (acc, r) { return acc + (r.count || 0); }, 0);
      $("errors-meta").textContent = rows.length
        ? fmtNum(rows.length) + " error signature" + (rows.length === 1 ? "" : "s") +
          " · " + fmtNum(total) + " occurrence" + (total === 1 ? "" : "s") + ", ranked by count."
        : "";
      if (!rows.length) {
        list.innerHTML = "<div class='empty-state'><p>No errors recorded" +
          (win > 0 ? " in this window" : "") + ". Quiet is good.</p></div>";
        return;
      }
      list.innerHTML = "";
      rows.forEach(function (r) {
        var summary = displayMessage({ type: "error", message: r.last_message || "", data: { signature: r.signature } });
        var b = document.createElement("button");
        b.type = "button";
        b.className = "card";
        b.innerHTML = "<span class='card-top'><span class='count-badge' title='" +
          r.count + " occurrences'>" + r.count + "</span> " +
          "<span class='sig'>" + esc(r.signature) + "</span></span>" +
          (summary ? "<span class='msg' title='" + esc(summary) + "'>" + esc(summary) + "</span>" : "") +
          "<span class='sub'><span>last seen " + esc(fmtTime(r.last_ts)) +
          " (" + esc(fmtAgo(r.last_ts)) + ")</span></span>";
        b.addEventListener("click", function () {
          state.logs = freshLogFilters(state.logs.live);
          state.logs.type = "error";
          state.logs.signature = r.signature;
          $("f-text").value = "";
          $("f-level").value = "";
          $("f-type").value = "error";
          $("f-range").value = "0";
          activateTab("logs");
          // activateTab already issued a silent load when live is on —
          // a second explicit load only doubles requests that can race.
          if (!state.logs.live) loadLogs();
        });
        list.appendChild(b);
      });
    }).catch(function (err) {
      if (my !== reqSeq.errors) return;
      if (err.message !== "unauthorized") showBanner("Could not load errors: " + err.message);
    });
  }

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
    var W = 520, H = 196, L = 36, R = 10, T = 10, B = 28;
    var integer = !!opts.integer;
    var times = opts.times || [];
    var max = Math.max.apply(null, [1].concat(series.map(function (s) {
      return Math.max.apply(null, [0].concat(s.values.filter(function (v) { return v != null; })));
    })));
    // Round the axis up to 4 even steps of 1/2/2.5/5 x 10^k so gridline
    // labels read 0, 2, 4, 6, 8 instead of 0, 1.5, 3, 4.5, 6.
    var step = niceStep(max / 4);
    if (integer) step = Math.max(1, Math.ceil(step));
    max = step * 4;
    var n = (series[0] && series[0].values.length) || 1;
    function x(i) { return L + (i * (W - L - R)) / Math.max(1, n - 1); }
    function y(v) { return H - B - ((v / max) * (H - T - B)); }
    var grid = "";
    for (var g = 0; g <= 4; g++) {
      var gv = (max * g) / 4, gy = y(gv);
      var glabel = integer ? String(Math.round(gv)) : fmtNum(gv);
      grid += "<line x1='" + L + "' y1='" + gy + "' x2='" + (W - R) + "' y2='" + gy +
        "' stroke='currentColor' opacity='0.12'/>" +
        "<text x='2' y='" + (gy + 4) + "' font-size='10' fill='currentColor' opacity='0.6'>" +
        glabel + "</text>";
    }
    var xlabels = "";
    if (times.length) {
      var marks = [0, Math.floor((times.length - 1) / 2), times.length - 1];
      var seen = {};
      marks.forEach(function (i) {
        if (seen[i]) return;
        seen[i] = true;
        var anchor = i === 0 ? "start" : i === times.length - 1 ? "end" : "middle";
        xlabels += "<text x='" + x(i).toFixed(1) + "' y='" + (H - 8) +
          "' font-size='10' fill='currentColor' opacity='0.6' text-anchor='" + anchor + "'>" +
          esc(fmtTimeShort(times[i])) + "</text>";
      });
    }
    var paths = series.map(function (s) {
      // null = no samples in that bucket: break the line instead of
      // drawing a fake drop to zero. Lone points get a dot.
      var runs = [], cur = [];
      s.values.forEach(function (v, i) {
        if (v == null) { if (cur.length) runs.push(cur); cur = []; return; }
        cur.push([x(i), y(v)]);
      });
      if (cur.length) runs.push(cur);
      return runs.map(function (run) {
        if (run.length === 1) {
          return "<circle cx='" + run[0][0].toFixed(1) + "' cy='" + run[0][1].toFixed(1) +
            "' r='2.5' fill='" + s.color + "'/>";
        }
        var pts = run.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); });
        var area = s.fill
          ? "<polygon points='" + run[0][0].toFixed(1) + "," + (H - B) + " " + pts.join(" ") + " " +
            run[run.length - 1][0].toFixed(1) + "," + (H - B) + "' fill='" + s.color + "' opacity='0.1'/>"
          : "";
        return area + "<polyline points='" + pts.join(" ") + "' fill='none' stroke='" + s.color +
          "' stroke-width='2' stroke-linejoin='round' stroke-linecap='round'/>";
      }).join("");
    }).join("");
    var hasData = series.some(function (s) { return s.values.some(function (v) { return v > 0; }); });
    var legend = opts.legendId ? $(opts.legendId) : null;
    if (legend) legend.hidden = !hasData;
    el.innerHTML = hasData
      ? "<svg viewBox='0 0 " + W + " " + H + "' role='img' aria-label='" +
        esc(opts.label || "chart") + "'>" + grid + paths + xlabels +
        "<line class='chart-cross' stroke='currentColor' stroke-opacity='0.35' visibility='hidden'/></svg>"
      : "<p class='chart-empty'>No data in this window yet.</p>";
    if (hasData) bindChartHover(el, series, times, { W: W, L: L, R: R, T: T, B: B, H: H, n: n, x: x, integer: integer });
  }
  function bindChartHover(el, series, times, geo) {
    var svg = el.querySelector("svg");
    var tip = $("chart-tip");
    var cross = svg.querySelector(".chart-cross");
    if (!svg || !tip) return;
    function hide() {
      tip.hidden = true;
      if (cross) cross.setAttribute("visibility", "hidden");
    }
    svg.addEventListener("mouseleave", hide);
    svg.addEventListener("mousemove", function (e) {
      var rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      var vx = ((e.clientX - rect.left) / rect.width) * geo.W;
      var span = (geo.W - geo.L - geo.R) / Math.max(1, geo.n - 1);
      var i = Math.round((vx - geo.L) / span);
      i = Math.max(0, Math.min(geo.n - 1, i));
      var xi = geo.x(i);
      if (cross) {
        cross.setAttribute("x1", xi);
        cross.setAttribute("x2", xi);
        cross.setAttribute("y1", geo.T);
        cross.setAttribute("y2", geo.H - geo.B);
        cross.setAttribute("visibility", "visible");
      }
      var rows = series.map(function (s) {
        var val = s.values[i];
        var shown = val == null ? "—" : geo.integer ? String(Math.round(val)) : fmtNum(val);
        return "<div class='row'><span class='k'>" + esc(s.name || "") +
          "</span><span class='v'>" + esc(shown) + "</span></div>";
      }).join("");
      tip.innerHTML = "<div class='t'>" + esc(times[i] != null ? fmtTimeShort(times[i]) : "") + "</div>" + rows;
      tip.hidden = false;
      var left = e.clientX + 12;
      var top = e.clientY + 12;
      tip.style.left = left + "px";
      tip.style.top = top + "px";
      var box = tip.getBoundingClientRect();
      if (box.right > window.innerWidth) tip.style.left = (e.clientX - box.width - 12) + "px";
      if (box.bottom > window.innerHeight) tip.style.top = (e.clientY - box.height - 12) + "px";
    });
  }
  var lastMetrics = null;
  function renderMetrics(s, series) {
    var times = series.map(function (b) { return b.ts; });
    $("stats").innerHTML =
      stat("Requests", fmtNum(s.count), "") +
      (s.rps >= 1 || !s.count
        ? stat("Throughput", fmtNum(s.rps), "req/s")
        : stat("Throughput", fmtNum(s.rps * 60), "req/min")) +
      stat("Error rate", (s.error_rate * 100).toFixed(1), "%", s.error_rate > 0 ? "danger" : "") +
      stat("Latency p50", fmtNum(s.p50_ms), "ms") +
      stat("Latency p95", fmtNum(s.p95_ms), "ms", s.p95_ms != null && s.p95_ms >= 1000 ? "warn" : "");
    lineChart($("chart-req"), [
      { name: "Requests", values: series.map(function (b) { return b.count; }), color: cssVar("--accent"), fill: true },
      { name: "Errors", values: series.map(function (b) { return b.errors; }), color: cssVar("--danger") },
    ], { times: times, integer: true, label: "Requests and errors", legendId: "legend-req" });
    lineChart($("chart-lat"), [
      { name: "Avg ms", values: series.map(function (b) { return b.avg_ms; }), color: cssVar("--warn"), fill: true },
    ], { times: times, label: "Average latency in milliseconds", legendId: "legend-lat" });
  }
  function loadMetrics() {
    var my = ++reqSeq.metrics;
    hideBanner("error");
    var win = $("m-window").value;
    // One call, one scan of the window (summary + series used to be two).
    api("/metrics", { window: win, buckets: 60 }).then(function (res) {
      if (my !== reqSeq.metrics) return;
      lastMetrics = res;
      renderMetrics(res.summary, res.series);
      $("m-updated").textContent = "Updated " + fmtTimeShort(Date.now() / 1000);
    }).catch(function (err) {
      if (my !== reqSeq.metrics) return;
      if (err.message !== "unauthorized") showBanner("Could not load metrics: " + err.message);
    });
  }
  function setMetricsAuto(on) {
    if (state.metricsTimer) { clearInterval(state.metricsTimer); state.metricsTimer = null; }
    if (!on) return;
    state.metricsTimer = setInterval(function () {
      if (!document.hidden && state.view === "metrics") loadMetrics();
    }, 15000);
  }
  function stat(k, v, u, extra) {
    // extra: "danger" | "warn" | ""
    return "<div class='stat" + (extra ? " " + extra : "") + "'><div class='k'>" + esc(k) + "</div>" +
      "<div class='v'>" + esc(v) + (u ? " <span class='u'>" + esc(u) + "</span>" : "") + "</div></div>";
  }
  $("m-refresh").addEventListener("click", loadMetrics);
  $("m-window").addEventListener("change", loadMetrics);
  $("m-auto").addEventListener("change", function (e) {
    writeLocal("nhl_metrics_auto", e.target.checked ? "1" : "0");
    setMetricsAuto(e.target.checked);
  });

  /* Trace */
  function openTrace(traceId) {
    $("t-id").value = traceId;
    if (state.view === "trace") loadTrace();
    else activateTab("trace");
  }
  function loadRecentTraces() {
    var my = ++reqSeq.trace;
    var list = $("trace-list");
    list.innerHTML = "<p class='meta'>Loading…</p>";
    api("/logs", { limit: 200 }).then(function (res) {
      if (my !== reqSeq.trace) return;
      // Group the newest events by trace; label each trace by its root
      // request (or first event), not by whichever log happened last.
      var groups = {};
      var order = [];
      res.items.forEach(function (e) {
        if (!e.trace_id) return;
        var g = groups[e.trace_id];
        if (!g) {
          g = groups[e.trace_id] = { id: e.trace_id, last: e.ts, label: e, count: 0, failed: false };
          order.push(g);
        }
        g.count++;
        var d = e.data || {};
        if (e.type === "error" || d.status === "error" || Number(d.status) >= 500) g.failed = true;
        if (e.type === "request" && g.label.type !== "request") g.label = e;
        else if (g.label.type !== "request" && e.ts <= g.label.ts) g.label = e;
      });
      var items = order.slice(0, 30);
      if (!items.length) {
        list.innerHTML = "<div class='empty-state'><p>No traces yet.</p>" +
          "<p>Open a trace id from a log row, or wait for traffic.</p></div>";
        return;
      }
      list.innerHTML = "<p class='meta'>Recent traces</p><ul class='recent-traces'>" +
        items.map(function (g) {
          var e = g.label, d = e.data || {};
          var head = e.type === "request"
            ? methodChip(d.method) + " <span class='path'>" + esc(d.path || "") + "</span> " +
              (d.status != null ? statusChip(d.status) : "") +
              (d.duration_ms != null ? " <span class='dur'>" + esc(fmtDur(d.duration_ms)) + "</span>" : "")
            : "<span class='path'>" + esc(displayMessage(e)) + "</span>";
          return "<li><button type='button' class='card trace-card" + (g.failed ? " failed" : "") +
            "' data-trace='" + esc(g.id) + "'>" +
            "<span class='card-top'>" + head + "</span>" +
            "<span class='sub'><span class='mono'>" + esc(g.id) + "</span>" +
            "<span>" + esc(fmtTimeShort(g.last)) + "</span>" +
            "<span>" + g.count + (g.count === 1 ? " event" : " events") + "</span>" +
            (g.failed ? "<span class='failed-note'>has errors</span>" : "") +
            "</span></button></li>";
        }).join("") + "</ul>";
    }).catch(function (err) {
      if (my !== reqSeq.trace) return;
      if (err.message !== "unauthorized") showBanner("Could not load traces: " + err.message);
    });
  }
  // Order trace events as a tree: each event sits under the span it ran
  // inside (spans: parent_span_id; logs/errors: the span active when they
  // were emitted; requests: the upstream W3C parent). Siblings run in time
  // order. Old events without links fall back to hanging off the request.
  function buildTraceTree(events) {
    function byTime(a, b) {
      var d = (Number(a.ts) || 0) - (Number(b.ts) || 0);
      if (d) return d;
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
    var kids = {};
    var roots = [];
    sorted.forEach(function (e) {
      var d = e.data || {};
      var link = e.type === "request" ? d.parent_id : d.parent_span_id;
      var parent = link ? bySpan[link] : null;
      if (parent === e) parent = null;
      if (!parent && rootReq && e !== rootReq && e.type !== "request" && !d.parent_span_id) parent = rootReq;
      if (parent) (kids[parent.id] = kids[parent.id] || []).push(e);
      else roots.push(e);
    });
    var out = [];
    var seen = {};
    function walk(e, depth) {
      if (seen[e.id]) return;
      seen[e.id] = true;
      out.push({ e: e, depth: depth });
      (kids[e.id] || []).forEach(function (k) { walk(k, depth + 1); });
    }
    roots.forEach(function (r) { walk(r, 0); });
    // Anything stuck in a parent cycle still gets shown.
    sorted.forEach(function (e) { if (!seen[e.id]) walk(e, 0); });
    return out;
  }
  function loadTrace() {
    var tid = $("t-id").value.trim();
    var list = $("trace-list");
    if (!tid) { loadRecentTraces(); return; }
    var my = ++reqSeq.trace;
    hideBanner("error");
    list.innerHTML = "<p class='meta'>Loading…</p>";
    api("/traces/" + encodeURIComponent(tid)).then(function (res) {
      if (my !== reqSeq.trace) return;
      if (res.trace_id && res.trace_id !== tid) $("t-id").value = res.trace_id;
      if (!res.events.length) {
        list.innerHTML = "<div class='empty-state'><p>No events found for this trace id.</p></div>";
        return;
      }

      var summary = res.summary || {};
      var totalDur = Number(summary.total_duration_ms || 0);
      var startTs = Number(summary.start_ts || (res.events.length ? res.events[0].ts : 0));

      // Build Trace Summary Header
      var summaryHtml = "<div class='trace-summary-bar'>" +
        "<div class='trace-summary-left'>" +
          "<span class='chip mono'>" + esc(res.trace_id) + "</span>" +
          (totalDur > 0 ? chip(fmtDur(totalDur), "ok") : "") +
          chip(res.events.length + (res.events.length === 1 ? " event" : " events"), "type") +
          (summary.span_count ? chip(summary.span_count + " spans", "span") : "");

      if (summary.has_ai && summary.ai_summary) {
        var ai = summary.ai_summary;
        if (ai.total_tokens) summaryHtml += " " + chip(ai.total_tokens.toLocaleString() + " tokens", "llm");
        if (ai.models && ai.models.length) {
          ai.models.forEach(function (m) { summaryHtml += " " + chip(m, "model"); });
        }
        if (ai.tool_calls_count) summaryHtml += " " + chip(ai.tool_calls_count + " tools", "tool");
      }
      if (summary.error_count) {
        summaryHtml += " " + chip(summary.error_count + " error" + (summary.error_count > 1 ? "s" : ""), "ERROR");
      }
      summaryHtml += "</div>" +
        "<div class='trace-summary-right'>" +
          "<button type='button' class='btn small copy-trace-btn' data-copy-trace='" + esc(res.trace_id) + "'>" +
            COPY_ICON + " Copy trace id" +
          "</button>" +
        "</div>" +
      "</div>";

      var rows = buildTraceTree(res.events);
      var lastEnd = rows.reduce(function (acc, r) {
        var d = r.e.data || {};
        var end = (Number(r.e.ts) - startTs) * 1000 + (Number(d.duration_ms) || 0);
        return Math.max(acc, end);
      }, 0);
      // Never let an event fall off the right edge, even for old data whose
      // summary only knew the request's own duration.
      var scale = Math.max(totalDur, lastEnd, 0.001);

      var waterfallRows = rows.map(function (row) {
        var e = row.e;
        var d = e.data || {};
        var relMs = Math.max(0, (Number(e.ts) - startTs) * 1000);
        var evDur = (d.duration_ms != null) ? Math.max(0, Number(d.duration_ms)) : 0;
        var offsetPct = Math.min(100, (relMs / scale) * 100);
        var widthPct = Math.min(100 - offsetPct, (evDur / scale) * 100);
        var isPoint = evDur <= 0;

        var typeClass = "type-" + (SPAN_KINDS[String(d.span_type || "").toLowerCase()] || (e.type === "span" ? "span" : e.type || "log"));
        if (e.type === "request") typeClass = "type-request";
        else if (e.type === "error") typeClass = "type-error";

        var badge = "";
        var nameText = "";
        if (e.type === "request") {
          badge = (d.status != null ? statusChip(d.status) + " " : "") + methodChip(d.method || "REQ");
          nameText = d.path || displayMessage(e);
        } else if (e.type === "span") {
          badge = spanKindChip(d.span_type);
          nameText = d.name || displayMessage(e);
          if (d.model) nameText += " [" + d.model + "]";
          if (d.total_tokens) nameText += " (" + d.total_tokens + " tok)";
        } else if (e.type === "error") {
          badge = chip("ERROR", "ERROR");
          nameText = displayMessage(e);
        } else {
          badge = e.level ? chip(e.level) : chip(e.type, e.type + " type");
          nameText = displayMessage(e);
        }

        var durLabel = isPoint ? "" : fmtDur(evDur);
        var startLabel = "+" + fmtDur(relMs);
        var labelHtml = "";
        if (durLabel) {
          if (widthPct >= 14) {
            labelHtml = "";
          } else if (offsetPct + widthPct > 82) {
            labelHtml = "<span class='wf-dur-out before' style='right:" + (100 - offsetPct).toFixed(2) + "%'>" + esc(durLabel) + "</span>";
          } else {
            labelHtml = "<span class='wf-dur-out' style='left:" + (offsetPct + widthPct).toFixed(2) + "%'>" + esc(durLabel) + "</span>";
          }
        }
        var bar = isPoint
          ? "<div class='wf-mark " + esc(typeClass) + "' style='left:" + offsetPct.toFixed(2) + "%'></div>"
          : "<div class='wf-bar " + esc(typeClass) + "' style='left:" + offsetPct.toFixed(2) + "%; width:" + widthPct.toFixed(2) + "%;'>" +
              (widthPct >= 14 ? "<span class='wf-dur'>" + esc(durLabel) + "</span>" : "") +
            "</div>";
        var failed = e.type === "error" || d.status === "error" || Number(d.status) >= 500;
        var depth = Math.min(row.depth, 12);

        return "<div class='wf-row" + (failed ? " error" : "") + "' data-id='" + e.id + "' tabindex='0' role='button' aria-label='" +
            esc(nameText + (durLabel ? ", " + durLabel : "") + ", starts " + startLabel) + "'>" +
          "<div class='wf-info' style='--depth:" + depth + "'>" +
            (depth > 0 ? "<span class='wf-tree-elbow' aria-hidden='true'>└</span>" : "") +
            badge +
            "<span class='wf-name' title='" + esc(nameText) + "'>" + esc(nameText) + "</span>" +
          "</div>" +
          "<div class='wf-bar-track' title='Start: " + esc(startLabel) + (durLabel ? " · Duration: " + esc(durLabel) : "") + "'>" +
            bar + labelHtml +
          "</div>" +
        "</div>";
      }).join("");

      var ticks = [0, 0.25, 0.5, 0.75, 1].map(function (f) {
        var cls = f === 0 ? " first" : f === 1 ? " last" : "";
        return "<span class='wf-tick" + cls + "' style='left:" + (f * 100) + "%'>" + esc(fmtDur(scale * f)) + "</span>";
      }).join("");
      var waterfallHtml = "<div class='trace-waterfall'>" +
        "<div class='wf-header'>" +
          "<span>Span / Operation</span>" +
          "<span class='wf-ticks' aria-hidden='true'>" + ticks + "</span>" +
        "</div>" +
        waterfallRows +
      "</div>";

      list.innerHTML = summaryHtml + waterfallHtml;
    }).catch(function (err) {
      if (my !== reqSeq.trace) return;
      if (err.message !== "unauthorized") showBanner("Could not load trace: " + err.message);
    });
  }
  $("trace-form").addEventListener("submit", function (e) { e.preventDefault(); loadTrace(); });
  $("trace-list").addEventListener("click", function (e) {
    var copyTrace = e.target.closest("[data-copy-trace]");
    if (copyTrace) {
      var tid = copyTrace.getAttribute("data-copy-trace");
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(tid).then(function () {
          copyTrace.classList.add("copied");
          var old = copyTrace.innerHTML;
          copyTrace.innerHTML = "✓ Copied!";
          setTimeout(function () {
            copyTrace.innerHTML = old;
            copyTrace.classList.remove("copied");
          }, 1500);
        }).catch(function () {});
      }
      return;
    }
    var t = e.target.closest("[data-trace]");
    if (t) { openTrace(t.getAttribute("data-trace")); return; }
    var item = e.target.closest("[data-id]");
    if (item) openDetail(item.getAttribute("data-id"));
  });
  $("trace-list").addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var item = e.target.closest("[data-id]");
    if (item) { e.preventDefault(); openDetail(item.getAttribute("data-id")); }
  });

  /* Boot */
  $("logout-btn").addEventListener("click", function () {
    fetch(API + "/logout", { method: "POST" }).finally(function () {
      try { sessionStorage.removeItem("nhl_token"); } catch (e) { /* ignore */ }
      state.token = "";
      location.assign(BASE + "/");
    });
  });
  initToken();
  loadHealth();
  var savedLive = readLocal("nhl_live");
  var startLive = savedLive === null ? true : savedLive === "1";
  if (startLive) {
    setLive(true);
  } else {
    loadLogs();
  }
  var autoMetrics = readLocal("nhl_metrics_auto") !== "0";
  $("m-auto").checked = autoMetrics;
  setMetricsAuto(autoMetrics);
  setInterval(function () { if (!document.hidden) loadHealth(); }, 15000);
})();
