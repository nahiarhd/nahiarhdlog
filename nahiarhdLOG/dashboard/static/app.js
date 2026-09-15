/* nahiarhdlog dashboard. Vanilla JS, no dependencies. */
(function () {
  "use strict";

  var BASE = location.pathname.replace(/\/$/, "") || "/";
  if (BASE === "/") BASE = "";
  var API = BASE + "/api";

  var state = {
    token: sessionStorage.getItem("nhl_token") || "",
    view: "logs",
    logs: { text: "", level: "", type: "", signature: "", offset: 0, limit: 50, live: false },
    liveTimer: null,
  };

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
  function displayMessage(e) {
    var raw = String(e.message == null ? "" : e.message);
    var d = e.data || {};
    if (e.type === "error") {
      var last = "";
      var lines = raw.split("\n");
      for (var i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim()) { last = lines[i].trim(); break; }
      }
      if (last && last.indexOf("Traceback (most recent call last)") !== 0) return last;
      return d.signature || d.exc_type || last || raw.split("\n")[0];
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
    if (lvl === "ERROR" || st >= 400) return "sev-err";
    if (lvl === "WARNING") return "sev-warn";
    if (method === "DELETE" || /^\s*Deleted\b/i.test(msg)) return "sev-mut";
    if (method === "PUT" || method === "PATCH" || /^\s*(Updated|Renamed)\b/i.test(msg)) return "sev-upd";
    return "";
  }
  var COPY_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  function fmtNum(n) {
    if (n == null) return "—";
    return Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 });
  }
  function showBanner(msg) {
    var b = $("banner");
    b.textContent = msg;
    b.classList.remove("hidden");
  }
  function hideBanner() { $("banner").classList.add("hidden"); }

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
    var all = Object.assign({}, params || {});
    if (state.token) all.token = state.token;
    var url = API + path + "?" + new URLSearchParams(all).toString();
    return fetch(url, { headers: { Accept: "application/json" } }).then(function (r) {
      if (r.status === 401 || r.status === 403) {
        sessionStorage.removeItem("nhl_token");
        location.assign(BASE + "/");
        throw new Error("unauthorized");
      }
      if (!r.ok) throw new Error("request failed: " + r.status);
      return r.json();
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
    try { localStorage.setItem("nhl_theme", name); } catch (e) { /* ignore */ }
  }
  (function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem("nhl_theme"); } catch (e) { /* ignore */ }
    if (saved) return applyTheme(saved);
    applyTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  })();
  $("theme-toggle").addEventListener("click", function () {
    var cur = document.documentElement.getAttribute("data-theme");
    applyTheme(cur === "dark" ? "light" : "dark");
    if (state.view === "metrics") loadMetrics();
  });

  /* Health */
  function loadHealth() {
    api("/health").then(function (h) {
      $("version").textContent = "v" + h.version;
      $("health-text").textContent = "queue " + h.queued + " · dropped " + h.dropped;
      $("health-dot").className = "dot" + (h.dropped > 0 ? " warn" : " ok");
    }).catch(function () { /* banner owned by view loaders */ });
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
    if (d.duration_ms != null) parts.push("<span class='dur'>" + esc(String(d.duration_ms)) + "ms</span>");
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
  function msgHtml(e) {
    return e.type === "request" ? requestMsgHtml(e) : logMsgHtml(e);
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
    hideBanner();
    var body = $("logs-body");
    if (!silent) {
      body.innerHTML = '<tr class="empty-row"><td colspan="5">Loading…</td></tr>';
    }
    return api("/logs", params).then(function (res) {
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
      if (err.message !== "unauthorized") showBanner("Could not load logs: " + err.message);
    });
  }
  function renderLogsMeta(res) {
    var f = state.logs;
    var start = res.total === 0 ? 0 : res.offset + 1;
    $("logs-meta").innerHTML = "Showing <strong>" + start + "–" +
      (res.offset + res.items.length) + "</strong> of <strong>" + res.total + "</strong>";
    $("page-info").textContent = "Page " + (Math.floor(res.offset / res.limit) + 1);
    $("page-prev").disabled = res.offset <= 0;
    $("page-next").disabled = res.offset + res.items.length >= res.total;
    renderSigChip();
  }
  $("log-filters").addEventListener("submit", function (e) {
    e.preventDefault();
    state.logs.text = $("f-text").value.trim();
    state.logs.level = $("f-level").value;
    state.logs.type = $("f-type").value;
    state.logs.signature = "";
    state.logs.offset = 0;
    loadLogs();
  });
  $("f-clear").addEventListener("click", function () {
    $("f-text").value = "";
    $("f-level").value = "";
    $("f-type").value = "";
    state.logs = { text: "", level: "", type: "", signature: "", offset: 0, limit: 50, live: state.logs.live };
    loadLogs();
  });
  $("sig-chip-clear").addEventListener("click", function () {
    state.logs.signature = "";
    state.logs.offset = 0;
    loadLogs();
  });
  $("page-prev").addEventListener("click", function () {
    setLive(false);
    state.logs.offset = Math.max(0, state.logs.offset - state.logs.limit);
    loadLogs();
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
    if (state.liveTimer) { clearInterval(state.liveTimer); state.liveTimer = null; }
    if (on) {
      state.logs.offset = 0;
      loadLogs();
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
  function openDetail(id) {
    api("/logs/" + id).then(function (e) {
      var d = e.data || {};
      var head, rows = [];
      function add(k, v) {
        if (v === null || v === undefined || v === "") return;
        rows.push("<dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd>");
      }
      if (e.type === "request") {
        head = esc(d.method || "?") + " " + esc(d.path || "?") +
          (d.status != null ? " " + statusChip(d.status) : "");
        add("time", fmtTime(e.ts));
        add("duration", d.duration_ms == null ? null : d.duration_ms + " ms");
        add("query", d.query ? "?" + d.query : null);
        add("client", d.client);
        add("user agent", d.user_agent);
      } else {
        head = msgHtml(e) + (e.level ? " " + chip(e.level) : "");
        add("time", fmtTime(e.ts));
        add("signature", d.signature);
        add("logger", d.logger);
        add("location", d.pathname ? d.pathname + ":" + d.lineno : null);
        if (d.method) add("http", d.method + " " + (d.path || ""));
      }
      $("detail-title").innerHTML = head;
      var traceBtn = e.trace_id
        ? "<p><button type='button' class='btn small' data-opentrace='" + esc(e.trace_id) +
          "'>View full trace</button></p>"
        : "";
      var msg = e.type === "request" ? "" : "<pre>" + esc(e.message) + "</pre>";
      $("detail-body").innerHTML = traceBtn + "<dl class='kv'>" + rows.join("") + "</dl>" + msg;
      $("detail").showModal();
      $("detail-close").focus();
    }).catch(function (err) {
      if (err.message !== "unauthorized") showBanner("Could not load event: " + err.message);
    });
  }
  $("detail-close").addEventListener("click", function () { $("detail").close(); });
  $("detail").addEventListener("click", function (e) {
    if (e.target === $("detail")) { $("detail").close(); return; }
    var b = e.target.closest("[data-opentrace]");
    if (b) { $("detail").close(); openTrace(b.getAttribute("data-opentrace")); }
  });

  /* Errors */
  function loadErrors() {
    hideBanner();
    var list = $("errors-list");
    list.innerHTML = "<p class='meta'>Loading…</p>";
    api("/errors/top", { limit: 50 }).then(function (rows) {
      $("errors-meta").textContent = rows.length
        ? rows.length + " error signature" + (rows.length === 1 ? "" : "s") + ", ranked by count."
        : "";
      if (!rows.length) {
        list.innerHTML = "<div class='empty-state'><p>No errors recorded. Quiet is good.</p></div>";
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
          "<span class='sub'><span>last seen " + esc(fmtTime(r.last_ts)) + "</span></span>";
        b.addEventListener("click", function () {
          setLive(false);
          state.logs = { text: "", level: "", type: "error", signature: r.signature, offset: 0, limit: 50, live: false };
          $("f-text").value = "";
          $("f-level").value = "";
          $("f-type").value = "error";
          activateTab("logs");
          loadLogs();
        });
        list.appendChild(b);
      });
    }).catch(function (err) {
      if (err.message !== "unauthorized") showBanner("Could not load errors: " + err.message);
    });
  }

  /* Metrics */
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function lineChart(el, series, opts) {
    opts = opts || {};
    var W = 520, H = 196, L = 36, R = 10, T = 10, B = 28;
    var integer = !!opts.integer;
    var times = opts.times || [];
    var max = Math.max.apply(null, [1].concat(series.map(function (s) {
      return Math.max.apply(null, [0].concat(s.values));
    })));
    if (integer) max = Math.max(1, Math.ceil(max));
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
      var pts = s.values.map(function (v, i) { return x(i).toFixed(1) + "," + y(v).toFixed(1); });
      return "<polyline points='" + pts.join(" ") + "' fill='none' stroke='" + s.color +
        "' stroke-width='2' stroke-linejoin='round'/>";
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
        var shown = geo.integer ? String(Math.round(val)) : fmtNum(val);
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
  function loadMetrics() {
    hideBanner();
    var window = $("m-window").value;
    Promise.all([
      api("/metrics/summary", { window: window }),
      api("/metrics/series", { window: window, buckets: 60 }),
    ]).then(function (res) {
      var s = res[0], series = res[1];
      var times = series.map(function (b) { return b.ts; });
      $("stats").innerHTML =
        stat("Requests", fmtNum(s.count), "") +
        stat("Error rate", (s.error_rate * 100).toFixed(1), "%", s.error_rate > 0 ? "danger" : "") +
        stat("Latency p50", fmtNum(s.p50_ms), "ms") +
        stat("Latency p95", fmtNum(s.p95_ms), "ms");
      lineChart($("chart-req"), [
        { name: "Requests", values: series.map(function (b) { return b.count; }), color: cssVar("--accent") },
        { name: "Errors", values: series.map(function (b) { return b.errors; }), color: cssVar("--danger") },
      ], { times: times, integer: true, label: "Requests and errors", legendId: "legend-req" });
      lineChart($("chart-lat"), [
        { name: "Avg ms", values: series.map(function (b) { return b.avg_ms || 0; }), color: cssVar("--warn") },
      ], { times: times, label: "Average latency in milliseconds", legendId: "legend-lat" });
    }).catch(function (err) {
      if (err.message !== "unauthorized") showBanner("Could not load metrics: " + err.message);
    });
  }
  function stat(k, v, u, extra) {
    return "<div class='stat" + (extra ? " " + extra : "") + "'><div class='k'>" + esc(k) + "</div>" +
      "<div class='v'>" + esc(v) + (u ? " <span class='u'>" + esc(u) + "</span>" : "") + "</div></div>";
  }
  $("m-refresh").addEventListener("click", loadMetrics);
  $("m-window").addEventListener("change", loadMetrics);

  /* Trace */
  function openTrace(traceId) {
    $("t-id").value = traceId;
    if (state.view === "trace") loadTrace();
    else activateTab("trace");
  }
  function loadRecentTraces() {
    var list = $("trace-list");
    list.innerHTML = "<p class='meta'>Loading…</p>";
    api("/logs", { limit: 50 }).then(function (res) {
      var seen = {};
      var items = [];
      res.items.forEach(function (e) {
        if (!e.trace_id || seen[e.trace_id]) return;
        seen[e.trace_id] = true;
        items.push(e);
      });
      if (!items.length) {
        list.innerHTML = "<div class='empty-state'><p>No traces yet.</p>" +
          "<p>Open a trace id from a log row, or wait for traffic.</p></div>";
        return;
      }
      list.innerHTML = "<p class='meta'>Recent traces</p><ul class='recent-traces'>" +
        items.map(function (e) {
          return "<li><button type='button' class='card' data-trace='" + esc(e.trace_id) + "'>" +
            "<span class='sig'>" + esc(e.trace_id) + "</span>" +
            "<span class='sub'>" + esc(fmtTimeShort(e.ts)) + " · " + esc(displayMessage(e)) + "</span>" +
            "</button></li>";
        }).join("") + "</ul>";
    }).catch(function (err) {
      if (err.message !== "unauthorized") showBanner("Could not load traces: " + err.message);
    });
  }
  function loadTrace() {
    var tid = $("t-id").value.trim();
    var list = $("trace-list");
    if (!tid) { loadRecentTraces(); return; }
    hideBanner();
    list.innerHTML = "<p class='meta'>Loading…</p>";
    api("/traces/" + encodeURIComponent(tid)).then(function (res) {
      if (res.trace_id && res.trace_id !== tid) $("t-id").value = res.trace_id;
      if (!res.events.length) {
        list.innerHTML = "<div class='empty-state'><p>No events found for this trace id.</p></div>";
        return;
      }
      list.innerHTML = "<ol class='timeline'>" + res.events.map(function (e) {
        return "<li class='" + (e.type === "error" ? "error" : "") + "' data-id='" + e.id +
          "' tabindex='0'>" +
          "<span class='t' title='" + esc(fmtTime(e.ts)) + "'>" + esc(fmtTimeShort(e.ts)) + "</span> " +
          chip(e.type, e.type + " type") + " " +
          (e.level ? chip(e.level) + " " : "") +
          "<div class='m'>" + msgHtml(e) + "</div></li>";
      }).join("") + "</ol>";
    }).catch(function (err) {
      if (err.message !== "unauthorized") showBanner("Could not load trace: " + err.message);
    });
  }
  $("trace-form").addEventListener("submit", function (e) { e.preventDefault(); loadTrace(); });
  $("trace-list").addEventListener("click", function (e) {
    var t = e.target.closest("[data-trace]");
    if (t) { openTrace(t.getAttribute("data-trace")); return; }
    var item = e.target.closest("li[data-id]");
    if (item) openDetail(item.getAttribute("data-id"));
  });
  $("trace-list").addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var item = e.target.closest("li[data-id]");
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
  loadLogs();
  setInterval(function () { if (!document.hidden) loadHealth(); }, 15000);
})();
