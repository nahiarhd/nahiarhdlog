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

  /* Tabs */
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
  tabs.forEach(function (t) {
    t.addEventListener("click", function () {
      tabs.forEach(function (x) { x.classList.remove("active"); });
      t.classList.add("active");
      document.querySelectorAll(".view").forEach(function (v) { v.classList.remove("active"); });
      state.view = t.getAttribute("data-view");
      $("view-" + state.view).classList.add("active");
      if (state.view === "errors") loadErrors();
      if (state.view === "metrics") loadMetrics();
    });
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
  function loadLogs() {
    var f = state.logs;
    var params = { limit: f.limit, offset: f.offset };
    if (f.text) params.text = f.text;
    if (f.level) params.level = f.level;
    if (f.type) params.type = f.type;
    if (f.signature) params.signature = f.signature;
    hideBanner();
    var body = $("logs-body");
    body.innerHTML = '<tr class="empty-row"><td colspan="5">Loading…</td></tr>';
    return api("/logs", params).then(function (res) {
      var rows = res.items.map(function (e) {
        var traceCell = e.trace_id
          ? '<button type="button" class="link" data-trace="' + esc(e.trace_id) + '">' +
            esc(e.trace_id.slice(0, 12)) + "</button>"
          : "—";
        return "<tr data-id='" + e.id + "' tabindex='0'><td class='time'>" + esc(fmtTime(e.ts)) + "</td>" +
          "<td>" + (e.level ? chip(e.level) : "—") + "</td>" +
          "<td>" + chip(e.type, e.type + " type") + "</td>" +
          "<td class='msg'>" + esc(e.message.split("\n")[0]) + "</td>" +
          "<td class='trace'>" + traceCell + "</td></tr>";
      });
      body.innerHTML = rows.length
        ? rows.join("")
        : '<tr class="empty-row"><td colspan="5">No events match these filters.</td></tr>';
      var start = res.total === 0 ? 0 : res.offset + 1;
      $("logs-meta").innerHTML = "Showing <strong>" + start + "–" +
        (res.offset + res.items.length) + "</strong> of <strong>" + res.total + "</strong>" +
        (f.signature ? " · signature <strong>" + esc(f.signature) + "</strong>" : "");
      $("page-info").textContent = "Page " + (Math.floor(res.offset / res.limit) + 1);
      $("page-prev").disabled = res.offset <= 0;
      $("page-next").disabled = res.offset + res.items.length >= res.total;
    }).catch(function (err) {
      if (err.message !== "unauthorized") showBanner("Could not load logs: " + err.message);
    });
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
    if (state.liveTimer) { clearInterval(state.liveTimer); state.liveTimer = null; }
    if (on) {
      state.logs.offset = 0;
      loadLogs();
      state.liveTimer = setInterval(function () {
        if (!document.hidden && state.view === "logs") loadLogs();
      }, 2000);
    }
  }
  $("f-live").addEventListener("change", function (e) { setLive(e.target.checked); });

  /* Row detail + trace jumps (event delegation) */
  $("logs-body").addEventListener("click", function (e) {
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
        head = (e.type === "error" ? "Error" : "Log") + " #" + e.id +
          (e.level ? " " + chip(e.level) : "");
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
        ? rows.length + " distinct error signatures." : "";
      list.innerHTML = rows.length ? "" : "<p class='meta'>No errors recorded. Quiet is good.</p>";
      rows.forEach(function (r) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "card";
        b.innerHTML = "<span class='count-badge'>" + r.count + "</span> " +
          "<span class='sig'>" + esc(r.signature) + "</span>" +
          "<span class='sub'><span>last seen " + esc(fmtTime(r.last_ts)) + "</span></span>";
        b.addEventListener("click", function () {
          state.logs = { text: "", level: "", type: "error", signature: r.signature, offset: 0, limit: 50, live: false };
          $("f-text").value = "";
          $("f-level").value = "";
          $("f-type").value = "error";
          tabs[0].click();
          loadLogs();
        });
        list.appendChild(b);
      });
    }).catch(function (err) {
      if (err.message !== "unauthorized") showBanner("Could not load errors: " + err.message);
    });
  }

  /* Metrics */
  function lineChart(el, series, opts) {
    opts = opts || {};
    var W = 520, H = 180, P = 30;
    var max = Math.max.apply(null, [1].concat(series.map(function (s) {
      return Math.max.apply(null, [0].concat(s.values));
    })));
    function x(i, n) { return P + (i * (W - P - 8)) / Math.max(1, n - 1); }
    function y(v) { return H - P - ((v / max) * (H - P - 12)); }
    var grid = "";
    for (var g = 0; g <= 4; g++) {
      var gv = (max * g) / 4, gy = y(gv);
      grid += "<line x1='" + P + "' y1='" + gy + "' x2='" + (W - 8) + "' y2='" + gy +
        "' stroke='currentColor' opacity='0.12'/>" +
        "<text x='2' y='" + (gy + 4) + "' font-size='10' fill='currentColor' opacity='0.6'>" +
        fmtNum(gv) + "</text>";
    }
    var paths = series.map(function (s) {
      var pts = s.values.map(function (v, i) { return x(i, s.values.length).toFixed(1) + "," + y(v).toFixed(1); });
      return "<polyline points='" + pts.join(" ") + "' fill='none' stroke='" + s.color +
        "' stroke-width='2' stroke-linejoin='round'/>";
    }).join("");
    var hasData = series.some(function (s) { return s.values.some(function (v) { return v > 0; }); });
    el.innerHTML = hasData
      ? "<svg viewBox='0 0 " + W + " " + H + "' role='img'>" + grid + paths + "</svg>"
      : "<p class='chart-empty'>No data in this window yet.</p>";
  }
  function loadMetrics() {
    hideBanner();
    var window = $("m-window").value;
    Promise.all([
      api("/metrics/summary", { window: window }),
      api("/metrics/series", { window: window, buckets: 60 }),
    ]).then(function (res) {
      var s = res[0], series = res[1];
      $("stats").innerHTML =
        stat("Requests", fmtNum(s.count), "") +
        stat("Error rate", (s.error_rate * 100).toFixed(1), "%") +
        stat("Latency p50", fmtNum(s.p50_ms), "ms") +
        stat("Latency p95", fmtNum(s.p95_ms), "ms");
      lineChart($("chart-req"), [
        { values: series.map(function (b) { return b.count; }), color: "#0f766e" },
        { values: series.map(function (b) { return b.errors; }), color: "#dc2626" },
      ]);
      lineChart($("chart-lat"), [
        { values: series.map(function (b) { return b.avg_ms || 0; }), color: "#b45309" },
      ]);
    }).catch(function (err) {
      if (err.message !== "unauthorized") showBanner("Could not load metrics: " + err.message);
    });
  }
  function stat(k, v, u) {
    return "<div class='stat'><div class='k'>" + esc(k) + "</div>" +
      "<div class='v'>" + esc(v) + (u ? " <span class='u'>" + esc(u) + "</span>" : "") + "</div></div>";
  }
  $("m-refresh").addEventListener("click", loadMetrics);
  $("m-window").addEventListener("change", loadMetrics);

  /* Trace */
  function openTrace(traceId) {
    tabs[3].click();
    $("t-id").value = traceId;
    loadTrace();
  }
  function loadTrace() {
    var tid = $("t-id").value.trim();
    var list = $("trace-list");
    if (!tid) { list.innerHTML = ""; return; }
    hideBanner();
    list.innerHTML = "<p class='meta'>Loading…</p>";
    api("/traces/" + encodeURIComponent(tid)).then(function (res) {
      if (!res.events.length) {
        list.innerHTML = "<p class='meta'>No events found for this trace id.</p>";
        return;
      }
      list.innerHTML = res.events.map(function (e) {
        return "<li class='" + (e.type === "error" ? "error" : "") + "'>" +
          "<span class='t'>" + esc(fmtTime(e.ts)) + "</span> " +
          chip(e.type, e.type + " type") + " " +
          (e.level ? chip(e.level) + " " : "") +
          "<div class='m'>" + esc(e.message.split("\n")[0]) + "</div></li>";
      }).join("");
    }).catch(function (err) {
      if (err.message !== "unauthorized") showBanner("Could not load trace: " + err.message);
    });
  }
  $("trace-form").addEventListener("submit", function (e) { e.preventDefault(); loadTrace(); });

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
