function getLocalBuildStorageKey() {
  const user = getCurrentUser();
  return user?.id ? `buildmatrix-builds-${user.id}` : "buildmatrix-builds-guest";
}

function getLocalBuilds() {
  return safeJsonParse(localStorage.getItem(getLocalBuildStorageKey()), []) || [];
}

function setLocalBuilds(builds) {
  localStorage.setItem(getLocalBuildStorageKey(), JSON.stringify(builds));
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return "—";
  }
}

function formatMoney(n) {
  const num = Number(n) || 0;
  return "₱" + num.toLocaleString();
}

function summarizeParts(items) {
  const cats = new Map();
  (items || []).forEach((it) => {
    const c = it.category || "other";
    cats.set(c, (cats.get(c) || 0) + 1);
  });

  const sorted = [...cats.entries()].sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, 6).map(([cat, count]) => `${cat.toUpperCase()} ×${count}`);
}

const CAT_ICONS = { cpu:'fa-microchip', gpu:'fa-tv', motherboard:'fa-server', ram:'fa-memory', ssd:'fa-database', hdd:'fa-hdd', psu:'fa-bolt', case:'fa-desktop', monitor:'fa-display', fan:'fa-fan', keyboard:'fa-keyboard', mouse:'fa-mouse' };

function buildCategoryIcons(items) {
  const cats = new Map();
  (items || []).forEach(it => {
    const c = it.category || 'other';
    cats.set(c, (cats.get(c) || 0) + (it.qty || 1));
  });
  return [...cats.entries()].map(([cat, qty]) => {
    const icon = CAT_ICONS[cat] || 'fa-cube';
    return `<div class="build-cat-icon" title="${cat}"><i class="fas ${icon}"></i>${qty > 1 ? `<span class="cat-qty">${qty}</span>` : ''}</div>`;
  }).join('');
}

function buildCard(build) {
  const card = document.createElement("div");
  card.className = "build-card";

  const header = document.createElement("div");
  header.className = "build-card-header";

  const title = document.createElement("div");
  title.className = "build-name";
  title.textContent = build.name || "Untitled Build";

  const date = document.createElement("div");
  date.className = "build-date";
  date.textContent = formatDate(build.createdAt);

  header.appendChild(title);
  header.appendChild(date);

  const meta = document.createElement("div");
  meta.className = "build-meta";

  const partsCount = document.createElement("span");
  partsCount.innerHTML = `<i class="fas fa-tags"></i> ${Array.isArray(build.items) ? build.items.length : 0} parts`;

  const total = document.createElement("span");
  total.innerHTML = `<i class="fas fa-coins"></i> ${formatMoney(build.total)}`;

  meta.appendChild(partsCount);
  meta.appendChild(total);

  const iconsWrap = document.createElement("div");
  iconsWrap.className = "build-category-icons";
  iconsWrap.innerHTML = buildCategoryIcons(build.items);

  const actions = document.createElement("div");
  actions.className = "build-actions";

  const load = document.createElement("a");
  load.className = "btn btn--primary";
  load.href = `index.html?buildId=${encodeURIComponent(build.id)}`;
  load.innerHTML = `<i class="fas fa-play"></i> Load`;

  const rename = document.createElement("button");
  rename.className = "btn btn--ghost";
  rename.type = "button";
  rename.innerHTML = `<i class="fas fa-pen"></i> Rename`;
  rename.addEventListener("click", () => renameBuild(build.id));

  const exportBtn = document.createElement("button");
  exportBtn.className = "btn btn--ghost";
  exportBtn.type = "button";
  exportBtn.innerHTML = `<i class="fas fa-file-export"></i> Export`;
  exportBtn.addEventListener("click", () => exportBuild(build.id));

  const shareBtn = document.createElement("button");
  shareBtn.className = "btn btn--ghost build-share-btn";
  shareBtn.type = "button";
  shareBtn.innerHTML = `<i class="fas fa-share-alt"></i> Share`;
  shareBtn.addEventListener("click", () => shareBuildLink(build));

  const del = document.createElement("button");
  del.className = "btn btn--danger";
  del.type = "button";
  del.innerHTML = `<i class="fas fa-trash"></i> Delete`;
  del.addEventListener("click", () => deleteBuild(build.id));

  actions.appendChild(load);
  actions.appendChild(rename);
  actions.appendChild(exportBtn);
  actions.appendChild(shareBtn);
  actions.appendChild(del);

  card.appendChild(header);
  card.appendChild(meta);
  card.appendChild(iconsWrap);
  card.appendChild(actions);

  return card;
}

let allBuilds = [];
let filteredBuilds = [];

function renderBuilds() {
  const grid = document.getElementById("buildsGrid");
  const empty = document.getElementById("emptyState");
  if (!grid || !empty) return;

  grid.innerHTML = "";

  if (filteredBuilds.length === 0) {
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";
  filteredBuilds.forEach((b) => grid.appendChild(buildCard(b)));
}

function applySearch() {
  const q = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();
  const sort = document.getElementById("sortBuilds")?.value || "date-desc";
  const priceRange = document.getElementById("filterPriceRange")?.value || "all";

  let result = allBuilds.filter(b => !q || (b.name || "").toLowerCase().includes(q));

  if (priceRange !== "all") {
    const [minP, maxP] = priceRange.split("-").map(Number);
    result = result.filter(b => {
      const t = Number(b.total) || 0;
      return t >= minP && t <= maxP;
    });
  }

  result = [...result].sort((a, b) => {
    if (sort === "date-desc") return new Date(b.createdAt) - new Date(a.createdAt);
    if (sort === "date-asc")  return new Date(a.createdAt) - new Date(b.createdAt);
    if (sort === "price-desc") return (Number(b.total)||0) - (Number(a.total)||0);
    if (sort === "price-asc")  return (Number(a.total)||0) - (Number(b.total)||0);
    if (sort === "name-asc")   return (a.name||"").localeCompare(b.name||"");
    return 0;
  });

  filteredBuilds = result;

  const countEl = document.getElementById("bmBuildCount");
  if (countEl) countEl.textContent = result.length
    ? `${result.length} build${result.length !== 1 ? "s" : ""}`
    : "";

  renderBuilds();
}

async function loadBuilds() {
  const user = getCurrentUser();

  if (user) {
    try {
      const data = await apiFetch("/builds", { method: "GET" });
      return data.builds || [];
    } catch (err) {
      console.warn("Failed to fetch builds from backend, using local fallback:", err);
      showToast("Backend unreachable — showing local builds only.", true);
      return getLocalBuilds();
    }
  }

  return getLocalBuilds();
}

async function refresh() {
  allBuilds = await loadBuilds();
  filteredBuilds = [...allBuilds];
  applySearch();
}

async function renameBuild(buildId) {
  const current = allBuilds.find((b) => b.id === buildId);
  if (!current) return;

  const next = prompt("Rename build:", current.name || "Untitled Build");
  if (next === null) return;
  const trimmed = next.trim();
  if (!trimmed) {
    showToast("Name can't be empty.", true);
    return;
  }

  const user = getCurrentUser();
  if (user) {
    try {
      await apiFetch(`/builds/${encodeURIComponent(buildId)}`, {
        method: "PUT",
        body: JSON.stringify({ name: trimmed }),
      });
      showToast("Build renamed!");
      await refresh();
      return;
    } catch (err) {
      console.warn(err);
      showToast("Rename failed (backend).", true);
      return;
    }
  }

  const builds = getLocalBuilds();
  const idx = builds.findIndex((b) => b.id === buildId);
  if (idx === -1) return;
  builds[idx].name = trimmed;
  setLocalBuilds(builds);
  showToast("Build renamed!");
  await refresh();
}

async function deleteBuild(buildId) {
  const current = allBuilds.find((b) => b.id === buildId);
  if (!current) return;

  const name = current.name || "this build";
  if (!confirm(`Delete "${name}"?`)) return;

  const user = getCurrentUser();
  if (user) {
    try {
      await apiFetch(`/builds/${encodeURIComponent(buildId)}`, { method: "DELETE" });
      showToast("Build deleted.");
      await refresh();
      return;
    } catch (err) {
      console.warn(err);
      showToast("Delete failed (backend).", true);
      return;
    }
  }

  const builds = getLocalBuilds().filter((b) => b.id !== buildId);
  setLocalBuilds(builds);
  showToast("Build deleted.");
  await refresh();
}

function shareBuildLink(build) {
  const data = {
    items: (build.items || []).map(i => ({ name: i.name, price: i.price, category: i.category, qty: i.qty || 1 })),
    total: build.total || 0
  };
  const encoded = btoa(encodeURIComponent(JSON.stringify(data)));
  const url = window.location.origin + '/index.html?share=' + encoded;
  navigator.clipboard.writeText(url)
    .then(() => showToast('Share link copied!'))
    .catch(() => { prompt('Copy this share link:', url); });
}

function exportBuild(buildId) {
  const build = allBuilds.find((b) => b.id === buildId);
  if (!build) return;
  const items = build.items || [];
  const total = Number(build.total) || 0;
  const date = new Date(build.createdAt || build.created_at || Date.now()).toLocaleDateString("en-PH", { year:"numeric", month:"long", day:"2-digit" });
  const rows = items.map((item, i) =>
    `<tr><td>${i+1}</td><td>${item.name||"Unknown"}</td><td style="color:#5a8aaa;">${(item.category||"").toUpperCase()}</td><td style="font-weight:800;color:#00D4FF;text-align:right;">&#8369;${(Number(item.price)||0).toLocaleString()}</td></tr>`
  ).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>BuildMatrix - ${build.name}</title>
  <style>body{font-family:Arial,sans-serif;background:#080C14;color:#D8EEFF;padding:32px;}
  .logo{font-size:22px;font-weight:900;color:#00D4FF;border-bottom:2px solid #00D4FF;padding-bottom:16px;margin-bottom:20px;}
  .build-title{font-size:22px;font-weight:900;margin-bottom:4px;}.build-date{font-size:12px;color:#5a8aaa;margin-bottom:20px;}
  table{width:100%;border-collapse:collapse;margin-bottom:24px;}
  th{background:rgba(0,212,255,0.12);color:#00D4FF;padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;}
  td{padding:12px 14px;border-bottom:1px solid #1a2840;font-size:13px;}
  .total-row td{background:rgba(0,212,255,0.08);font-weight:900;font-size:16px;border-top:2px solid #00D4FF;}
  .footer{font-size:11px;color:#2a4560;text-align:center;margin-top:32px;}
  @media print{body{background:white;color:#000;}.logo{color:#0099CC;}th{background:#e0f7ff;color:#0099CC;}td{color:#000;}}</style>
  </head><body>
  <div class="logo">BUILDMATRIX - Ultimate PC Builder Philippines</div>
  <div class="build-title">${build.name||"My Build"}</div>
  <div class="build-date">Generated on ${date}</div>
  <table><thead><tr><th>#</th><th>Component</th><th>Category</th><th style="text-align:right;">Price</th></tr></thead>
  <tbody>${rows}<tr class="total-row"><td colspan="3">TOTAL</td><td style="font-weight:900;color:#00D4FF;text-align:right;">&#8369;${total.toLocaleString()}</td></tr></tbody></table>
  <div class="footer">Generated by BuildMatrix - ${date}</div>
  <script>window.onload=()=>{window.print();}<` + `/script></body></html>`;
  const win = window.open("", "_blank");
  if (win) { win.document.write(html); win.document.close(); }
  showToast("PDF export opened - save as PDF from print dialog!");
}

async function importBuildFromFile(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const obj = JSON.parse(String(reader.result || "{}"));
      if (!obj || typeof obj !== "object") throw new Error("Invalid JSON");
      if (!Array.isArray(obj.items)) throw new Error("Missing items array");

      const normalized = {
        id: obj.id || ((window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now())),
        name: obj.name || "Imported Build",
        createdAt: obj.createdAt || new Date().toISOString(),
        total: obj.total || obj.items.reduce((s, it) => s + (Number(it.price) || 0), 0),
        items: obj.items.map((it) => ({
          name: it.name || "Component",
          price: Number(it.price) || 0,
          category: it.category || "other",
          dataset: it.dataset || {},
        })),
      };

      const user = getCurrentUser();
      if (user) {
        await apiFetch("/builds", {
          method: "POST",
          body: JSON.stringify({ name: normalized.name, total: normalized.total, items: normalized.items }),
        });
        showToast("Build imported to your account!");
        await refresh();
        return;
      }

      const builds = getLocalBuilds();
      builds.unshift(normalized);
      setLocalBuilds(builds);
      showToast("Build imported locally!");
      await refresh();
    } catch (err) {
      console.error(err);
      showToast("Import failed: invalid JSON file", true);
    }
  };
  reader.readAsText(file);
}

async function clearAllBuilds() {
  if (!allBuilds.length) return;
  if (!confirm("Delete ALL builds?")) return;

  const user = getCurrentUser();
  if (user) {
    try {
      for (const b of allBuilds) {
        await apiFetch(`/builds/${encodeURIComponent(b.id)}`, { method: "DELETE" });
      }
      showToast("All builds deleted.");
      await refresh();
      return;
    } catch (err) {
      console.warn(err);
      showToast("Clear-all failed (backend).", true);
      return;
    }
  }

  setLocalBuilds([]);
  showToast("All local builds cleared.");
  await refresh();
}

function initBuildsPage() {
  initDarkModeToggle();

  syncUserFromSession().finally(() => updateAuthUI());

  initUserMenuAutoClose();

  document.getElementById("searchInput")?.addEventListener("input", applySearch);
  document.getElementById("sortBuilds")?.addEventListener("change", applySearch);
  document.getElementById("filterPriceRange")?.addEventListener("change", applySearch);
  document.getElementById("importBtn")?.addEventListener("click", () => {
    document.getElementById("importFile")?.click();
  });
  document.getElementById("importFile")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) importBuildFromFile(file);
    e.target.value = "";
  });
  document.getElementById("clearAllBuildsBtn")?.addEventListener("click", clearAllBuilds);

  refresh();
}

document.addEventListener("DOMContentLoaded", initBuildsPage);