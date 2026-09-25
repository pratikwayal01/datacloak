/* ═══════════════════════════════════════════
   DEMO DATA
═══════════════════════════════════════════ */
let DEMO_ENTRIES = [
  { synth: "Alexandra.Chen@acme.io",  cat: "email", original: "jane.doe@gmail.com",      site: "app.stripe.com"   },
  { synth: "Marcus Rivera",            cat: "name",  original: "John Smith",               site: "app.stripe.com"   },
  { synth: "+1 (555) 029-4401",        cat: "phone", original: "+1 (415) 882-3390",        site: "checkout.acme.io" },
  { synth: "4532 •••• •••• 7281",      cat: "card",  original: "4111 1111 1111 1234",      site: "checkout.acme.io" },
  { synth: "192.168.42.7",             cat: "ip",    original: "203.0.113.52",             site: "admin.acme.io"    },
  { synth: "EMP-90234",                cat: "id",    original: "SSN 123-45-6789",           site: "hr.acme.io"       },
];

let LOGS = [
  { level: "info",    time: "09:41:02", msg: "Extension initialized on app.stripe.com" },
  { level: "success", time: "09:41:03", msg: "Detected 2 PII matches (email, name)" },
  { level: "warn",    time: "09:41:04", msg: "Outgoing POST may contain card data" },
  { level: "success", time: "09:41:04", msg: "Replaced card with synthetic before send" },
  { level: "info",    time: "09:41:09", msg: "User navigated to checkout.acme.io" },
  { level: "data",    time: "09:41:10", msg: "vault.size = 4  session.count = 4" },
  { level: "error",   time: "09:41:14", msg: "Pattern 'SSN' matched but no replacement rule" },
  { level: "success", time: "09:41:14", msg: "Fallback synthetic applied: EMP-90234" },
];

const NET_ROWS = [
  { method:"POST", url:"/api/checkout",   status:200, ms:142 },
  { method:"GET",  url:"/api/session",    status:200, ms:38  },
  { method:"POST", url:"/api/profile",    status:200, ms:91  },
  { method:"POST", url:"/api/payment",    status:422, ms:201 },
  { method:"GET",  url:"/api/vault-sync", status:200, ms:56  },
  { method:"PUT",  url:"/api/user",       status:200, ms:78  },
];

const STORAGE_DATA = [
  ["dc:vault",        JSON.stringify(DEMO_ENTRIES).slice(0,60)+"…"],
  ["dc:settings",     '{"autoDetect":true,"blur":true,"sensitivity":"low"}'],
  ["dc:session_id",   "sess_8fXq2mYpRt"],
  ["dc:allowlist",    '["localhost","staging.acme.io"]'],
  ["dc:mode",         "auto"],
];

const PATTERNS = [
  { label:"Email",   regex: "/[a-zA-Z0-9+_.-]+@[a-z0-9.-]+/g",                 hits: 2, on: true  },
  { label:"Phone",   regex: "/\\+?[\\d\\s().-]{7,}/g",                           hits: 1, on: true  },
  { label:"Card",    regex: "/\\b(?:\\d[ -]?){13,16}\\b/g",                      hits: 1, on: true  },
  { label:"SSN",     regex: "/\\b\\d{3}[- ]?\\d{2}[- ]?\\d{4}\\b/g",            hits: 1, on: true  },
  { label:"Name",    regex: "/\\b[A-Z][a-z]+ [A-Z][a-z]+\\b/g",                 hits: 1, on: true  },
  { label:"IP",      regex: "/\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b/g",              hits: 1, on: true  },
  { label:"Address", regex: "/\\d{1,5}\\s[A-Z][a-zA-Z ]+(?:St|Ave|Rd|Dr)/g",   hits: 0, on: false },
];

/* ═══════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════ */
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2000);
}

function copyText(text) {
  navigator.clipboard.writeText(text).catch(() => {});
  toast("Copied to clipboard");
}

/* ═══════════════════════════════════════════
   TAB ROUTING
═══════════════════════════════════════════ */
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
  });
});

/* ═══════════════════════════════════════════
   VAULT PANEL
═══════════════════════════════════════════ */
let revealed = new Set();
let activeFilter = "all";
let searchQ = "";

function renderVault() {
  const vault = document.getElementById("dc-vault");
  const empty = document.getElementById("dc-empty");

  vault.querySelectorAll(".vault-row").forEach(n => n.remove());

  const filtered = DEMO_ENTRIES.filter(e => {
    const matchCat  = activeFilter === "all" || e.cat === activeFilter;
    const matchText = !searchQ || e.synth.toLowerCase().includes(searchQ) || e.cat.includes(searchQ);
    return matchCat && matchText;
  });

  if (filtered.length === 0) { empty.style.display = ""; return; }
  empty.style.display = "none";

  filtered.forEach((entry, i) => {
    const row = document.createElement("div");
    row.className = "vault-row";

    const chip = document.createElement("span");
    chip.className = "cat-chip " + entry.cat;
    chip.textContent = entry.cat;

    const synth = document.createElement("span");
    synth.className = "synth-text";
    synth.textContent = entry.synth;
    synth.title = entry.synth;

    // peek button
    const peekBtn = document.createElement("button");
    peekBtn.className = "icon-btn" + (revealed.has(i) ? " reveal-active" : "");
    peekBtn.title = revealed.has(i) ? "Hide original" : "Peek original";
    peekBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1 5.5C2.3 3 3.8 2 5.5 2s3.2 1 4.5 3.5C8.7 8 7.2 9 5.5 9S2.3 8 1 5.5Z" stroke="currentColor" stroke-width="1.2"/><circle cx="5.5" cy="5.5" r="1.5" fill="currentColor"/></svg>`;
    if (revealed.has(i)) {
      synth.innerHTML = `<span class="blurred" style="filter:none">${entry.original}</span>`;
    }
    peekBtn.addEventListener("click", () => {
      if (revealed.has(i)) revealed.delete(i); else revealed.add(i);
      renderVault();
    });

    // copy button
    const copyBtn = document.createElement("button");
    copyBtn.className = "icon-btn";
    copyBtn.title = "Copy synthetic";
    copyBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 11 11" fill="none"><rect x="1" y="3" width="7" height="8" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M3 3V2a1 1 0 011-1h5a1 1 0 011 1v6a1 1 0 01-1 1H9" stroke="currentColor" stroke-width="1.2"/></svg>`;
    copyBtn.addEventListener("click", () => copyText(entry.synth));

    const actions = document.createElement("div");
    actions.className = "row-actions";
    actions.append(peekBtn, copyBtn);

    row.append(chip, synth, actions);
    vault.appendChild(row);
  });

  // stats
  const types = new Set(DEMO_ENTRIES.map(e => e.cat)).size;
  document.getElementById("stat-total").textContent   = DEMO_ENTRIES.length;
  document.getElementById("stat-session").textContent = DEMO_ENTRIES.length;
  document.getElementById("stat-types").textContent   = types;
  document.getElementById("vault-badge").textContent  = DEMO_ENTRIES.length;
}

document.getElementById("dc-search").addEventListener("input", e => {
  searchQ = e.target.value.toLowerCase();
  renderVault();
});

document.querySelectorAll(".cat-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".cat-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeFilter = btn.dataset.cat;
    renderVault();
  });
});

document.getElementById("dc-clear").addEventListener("click", () => {
  DEMO_ENTRIES = [];
  revealed.clear();
  renderVault();
  document.getElementById("vault-badge").textContent = "0";
});

document.getElementById("dc-export").addEventListener("click", () => {
  const data = JSON.stringify({ generated: new Date().toISOString(), entries: DEMO_ENTRIES }, null, 2);
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([data], {type:"application/json"})),
    download: "datacloak-audit.json"
  });
  a.click();
  toast("Exported audit JSON");
});

document.getElementById("dc-copy-all").addEventListener("click", () => {
  const map = Object.fromEntries(DEMO_ENTRIES.map(e => [e.synth, e.original]));
  copyText(JSON.stringify(map, null, 2));
});

renderVault();

/* ═══════════════════════════════════════════
   MODE TOGGLE
═══════════════════════════════════════════ */
let modeOn = true;
document.getElementById("dc-mode-toggle").addEventListener("click", () => {
  modeOn = !modeOn;
  const pill  = document.getElementById("dc-mode-toggle");
  const label = document.getElementById("dc-mode-label");
  pill.classList.toggle("off", !modeOn);
  label.textContent = modeOn ? "Auto" : "Off";
  toast(modeOn ? "DataCloak enabled" : "DataCloak paused");
});

/* ═══════════════════════════════════════════
   SETTINGS
═══════════════════════════════════════════ */
// Risk buttons
document.querySelectorAll(".risk-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".risk-btn").forEach(b => b.className = "risk-btn");
    btn.classList.add("active-" + btn.dataset.risk);
  });
});

// Allowlist
document.getElementById("s-allowlist-add").addEventListener("click", () => {
  const input = document.getElementById("s-allowlist-input");
  const val = input.value.trim();
  if (!val) return;
  const tag = document.createElement("span");
  tag.className = "allowlist-tag";
  tag.innerHTML = `${val} <button title="Remove">×</button>`;
  tag.querySelector("button").addEventListener("click", () => tag.remove());
  document.getElementById("allowlist-tags").appendChild(tag);
  input.value = "";
});

// Existing tags remove
document.querySelectorAll(".allowlist-tag button").forEach(btn => {
  btn.addEventListener("click", () => btn.closest(".allowlist-tag").remove());
});

document.getElementById("s-save").addEventListener("click", () => toast("Settings saved"));
document.getElementById("s-reset").addEventListener("click", () => toast("Reset to defaults"));

/* ═══════════════════════════════════════════
   DEV TOOLS — sub-tabs
═══════════════════════════════════════════ */
document.querySelectorAll(".dev-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".dev-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".dev-panel-inner").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("dpanel-" + btn.dataset.dtab).classList.add("active");
  });
});

/* ── Console ──────────────────────────────── */
function renderConsole() {
  const out = document.getElementById("console-out");
  out.innerHTML = LOGS.map(l => `
    <div class="log-line">
      <span class="log-time">${l.time}</span>
      <span class="log-${l.level}">${l.msg}</span>
    </div>`).join("");
  out.scrollTop = out.scrollHeight;
}

const CMDS = {
  help:  () => addLog("info",    "Commands: help, clear, vault.list, vault.clear, settings.dump, version"),
  clear: () => { LOGS = []; renderConsole(); },
  "vault.list":    () => addLog("data", "vault → " + JSON.stringify(DEMO_ENTRIES.map(e => e.synth))),
  "vault.clear":   () => { DEMO_ENTRIES = []; renderVault(); addLog("success", "Vault cleared"); },
  "settings.dump": () => addLog("data", 'settings → {"autoDetect":true,"blur":true,"sensitivity":"low"}'),
  version:         () => addLog("info", "DataCloak v1.0.0  build 2024-09-25"),
};

function addLog(level, msg) {
  const now = new Date();
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map(n => String(n).padStart(2,"0")).join(":");
  LOGS.push({ level, time, msg });
  renderConsole();
}

document.getElementById("console-input").addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  const val = e.target.value.trim();
  if (!val) return;
  addLog("data", "> " + val);
  if (CMDS[val]) CMDS[val]();
  else addLog("error", `Unknown command: "${val}". Type 'help'.`);
  e.target.value = "";
});

document.getElementById("dev-clear-log").addEventListener("click", () => {
  LOGS = [];
  renderConsole();
});

document.getElementById("dev-copy-log").addEventListener("click", () => {
  const text = LOGS.map(l => `[${l.time}] [${l.level.toUpperCase()}] ${l.msg}`).join("\n");
  copyText(text);
});

renderConsole();

/* ── Network ────────────────────────────── */
function renderNetwork() {
  const list = document.getElementById("network-list");
  list.innerHTML = NET_ROWS.map(r => {
    const sc = r.status >= 400 ? "err" : r.status >= 300 ? "warn" : "ok";
    const mc = r.method === "POST" ? "POST" : r.method === "PUT" ? "PUT" : r.method === "DELETE" ? "DEL" : "GET";
    return `<div class="net-row">
      <span class="net-method ${r.method}">${mc}</span>
      <span class="net-url">${r.url}</span>
      <span class="net-status ${sc}">${r.status}</span>
      <span class="net-time">${r.ms}ms</span>
    </div>`;
  }).join("");
}
renderNetwork();

/* ── Storage ────────────────────────────── */
function renderStorage() {
  const tbody = document.querySelector("#storage-table tbody");
  tbody.innerHTML = STORAGE_DATA.map(([k, v]) =>
    `<tr><td>${k}</td><td>${v}</td></tr>`
  ).join("");
}
renderStorage();

/* ── Patterns ───────────────────────────── */
function renderPatterns() {
  const list = document.getElementById("patterns-list");
  list.innerHTML = PATTERNS.map((p, i) => `
    <div class="pattern-row">
      <span class="pattern-label">${p.label}</span>
      <span class="pattern-regex">${p.regex}</span>
      <span class="pattern-hits">${p.hits}</span>
      <label class="toggle-wrap pattern-toggle" style="width:28px;height:16px">
        <input type="checkbox" ${p.on ? "checked" : ""} data-pidx="${i}">
        <span class="toggle-track" style="border-radius:8px"></span>
      </label>
    </div>`).join("");

  list.querySelectorAll("input[data-pidx]").forEach(inp => {
    inp.addEventListener("change", () => {
      PATTERNS[inp.dataset.pidx].on = inp.checked;
      toast(`${PATTERNS[inp.dataset.pidx].label} pattern ${inp.checked ? "enabled" : "disabled"}`);
    });
  });
}
renderPatterns();

/* ── About links ─────────────────────────── */
["link-changelog","link-docs","link-github","link-feedback"].forEach(id => {
  document.getElementById(id).addEventListener("click", e => {
    e.preventDefault();
    toast("Would open in new tab");
  });
});
