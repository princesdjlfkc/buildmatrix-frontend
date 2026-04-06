let currentTotal = 0;
let selectedItems = [];
let currentUserId = null;

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getBuildStorageKey() {
  const user = getCurrentUser();
  return user?.id ? `buildmatrix-builds-${user.id}` : "buildmatrix-builds-guest";
}

function getSavedBuilds() {
  return safeJsonParse(localStorage.getItem(getBuildStorageKey()), []) || [];
}

function setSavedBuilds(builds) {
  localStorage.setItem(getBuildStorageKey(), JSON.stringify(builds));
}

function openAuthModal() {
  const modal = document.getElementById("authModal");
  if (!modal) return;
  modal.style.display = "flex";
  const twofaInput = document.getElementById("twofaInput");
  const login2faCode = document.getElementById("login2faCode");
  if (twofaInput) twofaInput.classList.remove("show");
  if (login2faCode) login2faCode.value = "";
}

function closeAuthModal() {
  const modal = document.getElementById("authModal");
  if (!modal) return;
  modal.style.display = "none";
}

function switchAuthTab(tab) {
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const loginTabBtn = document.getElementById("loginTabBtn");
  const registerTabBtn = document.getElementById("registerTabBtn");
  if (loginForm) loginForm.className = tab === "login" ? "auth-form active" : "auth-form";
  if (registerForm) registerForm.className = tab === "register" ? "auth-form active" : "auth-form";
  if (loginTabBtn) loginTabBtn.className = tab === "login" ? "auth-tab active" : "auth-tab";
  if (registerTabBtn) registerTabBtn.className = tab === "register" ? "auth-tab active" : "auth-tab";
  const twofaInput = document.getElementById("twofaInput");
  if (twofaInput) twofaInput.classList.remove("show");
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById("loginEmail")?.value?.trim();
  const password = document.getElementById("loginPassword")?.value ?? "";
  const twoFactorCode = document.getElementById("login2faCode")?.value?.trim() ?? "";
  try {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, twoFactorCode }),
      credentials: "include",
    });
    const data = await response.json();
    if (data.requires2FA) {
      document.getElementById("twofaInput")?.classList.add("show");
      document.getElementById("login2faCode")?.focus();
      showToast("Please enter your 2FA code");
      return;
    }
    if (data.success) {
      currentUserId = data.user?.id ?? null;
      localStorage.setItem("user", JSON.stringify(data.user));
      updateAuthUI();
      updateIndexAuthUI(data.user);
      closeAuthModal();
      showToast("Login successful!");
      const fields = ["loginEmail", "loginPassword", "login2faCode"];
      fields.forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; });
      document.getElementById("twofaInput")?.classList.remove("show");
    } else {
      showToast(data.error || "Login failed", true);
    }
  } catch (error) {
    console.error("Login error:", error);
    showToast("Connection error - Make sure backend is running on port 5000", true);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById("registerName")?.value?.trim();
  const email = document.getElementById("registerEmail")?.value?.trim();
  const password = document.getElementById("registerPassword")?.value ?? "";
  const confirm = document.getElementById("registerConfirm")?.value ?? "";
  if (password !== confirm) {
    showToast("Passwords do not match", true);
    return;
  }
  try {
    const response = await fetch(`${API_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await response.json();
    if (data.success) {
      showToast("Registration successful! Please login.");
      switchAuthTab("login");
      ["registerName", "registerEmail", "registerPassword", "registerConfirm"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
    } else {
      showToast(data.error || "Registration failed", true);
    }
  } catch (error) {
    console.error("Register error:", error);
    showToast("Connection error - Make sure backend is running on port 5000", true);
  }
}

function openForgotPassword() {
  const modal = document.getElementById("forgotPasswordModal");
  if (!modal) return;
  modal.style.display = "flex";
  document.getElementById("forgotStep1")?.classList.add("active");
  document.getElementById("forgotStep2")?.classList.remove("active");
  ["resetEmail", "resetToken", "newPassword", "confirmPassword"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}

function closeForgotModal() {
  const modal = document.getElementById("forgotPasswordModal");
  if (!modal) return;
  modal.style.display = "none";
  document.getElementById("forgotStep1")?.classList.add("active");
  document.getElementById("forgotStep2")?.classList.remove("active");
}

async function sendResetLink() {
  const email = document.getElementById("resetEmail")?.value?.trim();
  if (!email) {
    showToast("Please enter your email", true);
    return;
  }
  try {
    const response = await fetch(`${API_URL}/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await response.json();
    if (data.success) {
      showToast("Reset link generated! (Dev: check console/token)");
      document.getElementById("forgotStep1")?.classList.remove("active");
      document.getElementById("forgotStep2")?.classList.add("active");
      if (data.devToken) {
        const tokenInput = document.getElementById("resetToken");
        if (tokenInput) tokenInput.value = data.devToken;
      }
    } else {
      showToast(data.error || "Failed to send reset link", true);
    }
  } catch (error) {
    console.error("❌ Forgot password error:", error);
    showToast("Connection error: " + error.message, true);
  }
}

async function resetPassword() {
  const token = document.getElementById("resetToken")?.value?.trim();
  const newPassword = document.getElementById("newPassword")?.value ?? "";
  const confirm = document.getElementById("confirmPassword")?.value ?? "";
  if (!token || !newPassword) {
    showToast("Please fill all fields", true);
    return;
  }
  if (newPassword !== confirm) {
    showToast("Passwords do not match", true);
    return;
  }
  if (newPassword.length < 6) {
    showToast("Password must be at least 6 characters", true);
    return;
  }
  try {
    const response = await fetch(`${API_URL}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword }),
    });
    const data = await response.json();
    if (data.success) {
      showToast("✅ Password reset successfully! Please login.");
      document.getElementById("forgotPasswordModal").style.display = "none";
      openAuthModal();
    } else {
      showToast(data.error || "Failed to reset password", true);
    }
  } catch (error) {
    console.error("❌ Reset password error:", error);
    showToast("Connection error: " + error.message, true);
  }
}

async function open2FASetup() {
  const user = getCurrentUser();
  currentUserId = user?.id ?? null;
  if (!currentUserId) {
    showToast("Please login first", true);
    closeUserMenu();
    return;
  }
  try {
    const response = await fetch(`${API_URL}/2fa/setup`, { method: "POST", credentials: "include" });
    const data = await response.json();
    if (data.success) {
      const qr = document.getElementById("qrCodeContainer");
      const secret = document.getElementById("manualSecret");
      if (qr) qr.innerHTML = `<img src="${data.qrCode}" alt="2FA QR Code">`;
      if (secret) secret.textContent = data.secret;
      const modal = document.getElementById("twofaSetupModal");
      if (modal) modal.style.display = "flex";
      const step1 = document.getElementById("twofaStep1");
      const step2 = document.getElementById("twofaStep2");
      if (step1) step1.style.display = "block";
      if (step2) step2.style.display = "none";
    } else {
      showToast(data.error || "Failed to setup 2FA", true);
    }
  } catch (error) {
    console.error("2FA setup error:", error);
    showToast("Connection error", true);
  }
  closeUserMenu();
}

async function verifyAndEnable2FA() {
  const code = document.getElementById("twofaVerifyCode")?.value?.trim() ?? "";
  if (!code || code.length !== 6) {
    showToast("Please enter a valid 6-digit code", true);
    return;
  }
  try {
    const response = await fetch(`${API_URL}/2fa/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: code }),
      credentials: "include",
    });
    const data = await response.json();
    if (data.success) {
      const step1 = document.getElementById("twofaStep1");
      const step2 = document.getElementById("twofaStep2");
      if (step1) step1.style.display = "none";
      if (step2) step2.style.display = "block";
      const list = document.getElementById("recoveryCodesList");
      if (list) {
        list.innerHTML = data.recoveryCodes.map((c) => `<div class="recovery-code">${escapeHtml(c)}</div>`).join("");
      }
      showToast("2FA enabled successfully!");
    } else {
      showToast(data.error || "Invalid verification code", true);
    }
  } catch (error) {
    console.error("2FA verify error:", error);
    showToast("Connection error", true);
  }
}

function closeTwofaModal() {
  const modal = document.getElementById("twofaSetupModal");
  if (modal) modal.style.display = "none";
}

function renderSection(sectionKey, titleHtml, cardsOrProducts) {
  let cardsHtml = "";
  if (Array.isArray(cardsOrProducts)) {
    const renderer = typeof window.renderProductCard === "function" ? window.renderProductCard : () => "";
    cardsHtml = cardsOrProducts.map(renderer).join("");
  } else {
    cardsHtml = String(cardsOrProducts || "");
  }
  return `
    <section class="product-section" data-section="${escapeHtml(sectionKey)}">
      <h2 class="section-title">${titleHtml}</h2>
      <div class="products-grid">${cardsHtml}</div>
    </section>
  `;
}

function bindAddToBuildButtons() {
  document.querySelectorAll(".add-to-build").forEach((button) => {
    button.onclick = (e) => {
      e.preventDefault();
      addToBuild(button);
    };
  });
}

function syncSelectedCardsUI() {
  selectedItems.forEach((item) => {
    document.querySelectorAll(".product-card").forEach((card) => {
      if (card.dataset.name === item.name) {
        card.classList.add("selected");
        const btn = card.querySelector(".add-to-build");
        if (btn) btn.textContent = "✓ Added";
      }
    });
  });
}

function showAllProducts() {
  const groups = (typeof window.getProductGroups === "function") ? window.getProductGroups() : [];
  let html = "";
  groups.forEach((g) => {
    html += renderSection(g.section, g.title, g.products);
  });
  const main = document.getElementById("mainContent");
  if (main) main.innerHTML = html || "<p style=\"color: var(--text-secondary)\">No products found.</p>";
  bindAddToBuildButtons();
  syncSelectedCardsUI();
}

function filterCategory(category) {
  if (typeof window.renderCategoryView === 'function') {
    window.renderCategoryView(category);
    return;
  }
  const sections = document.querySelectorAll(".product-section");
  if (sections.length) {
    sections.forEach((sec) => {
      sec.style.display = sec.dataset.section === category ? "block" : "none";
    });
  } else {
    showAllProducts();
    setTimeout(() => {
      const newSections = document.querySelectorAll(".product-section");
      newSections.forEach((sec) => {
        sec.style.display = sec.dataset.section === category ? "block" : "none";
      });
    }, 100);
  }
}

function addToBuild(button) {
  const card = button.closest(".product-card");
  if (!card) return;
  const price = parseInt(card.dataset.price || "0", 10);
  const name = card.dataset.name || "Component";
  const category = card.dataset.category || "other";
  const singleOnly = ["cpu", "gpu", "motherboard", "case"];
  const multiQuantity = ["ram", "ssd", "fan"];
  if (singleOnly.includes(category) && !card.classList.contains("selected")) {
    const existing = selectedItems.find((item) => item.category === category);
    if (existing && existing.name !== name) {
      currentTotal -= existing.price * (existing.qty || 1);
      selectedItems = selectedItems.filter((item) => item.category !== category);
      document.querySelectorAll(".product-card").forEach((c) => {
        if (c.dataset.name === existing.name) {
          c.classList.remove("selected");
          const b = c.querySelector(".add-to-build");
          if (b) b.textContent = "+ Add to Build";
        }
      });
      showToast(`Replaced ${category.toUpperCase()}: ${existing.name} → ${name}`);
    }
  }
  if (multiQuantity.includes(category) && card.classList.contains("selected")) {
    const existing = selectedItems.find((item) => item.name === name);
    if (existing) {
      existing.qty = (existing.qty || 1) + 1;
      currentTotal += price;
      showToast(`${name} quantity: ${existing.qty}`);
      updateBuildDisplay();
      return;
    }
  }
  if (card.classList.contains("selected")) {
    const existing = selectedItems.find((item) => item.name === name);
    if (existing && multiQuantity.includes(category) && (existing.qty || 1) > 1) {
      existing.qty = (existing.qty || 1) - 1;
      currentTotal -= price;
      showToast(`${name} quantity: ${existing.qty}`);
      updateBuildDisplay();
      return;
    }
    card.classList.remove("selected");
    currentTotal -= price * (existing?.qty || 1);
    selectedItems = selectedItems.filter((item) => item.name !== name);
    button.textContent = "+ Add to Build";
    showToast(`${name} removed`);
  } else {
    card.classList.add("selected");
    currentTotal += price;
    const datasetCopy = { ...card.dataset };
    selectedItems.push({ name, price, category, dataset: datasetCopy, qty: 1 });
    button.textContent = "✓ Added";
    showToast(`${name} added`);
  }
  updateBuildDisplay();
  updateFPS();
  checkCompatibility();
}

function removeItem(itemName) {
  const item = selectedItems.find((i) => i.name === itemName);
  if (!item) return;
  const qty = item.qty || 1;
  const multiQuantity = ["ram", "ssd", "fan"];
  if (multiQuantity.includes(item.category) && qty > 1) {
    item.qty = qty - 1;
    currentTotal -= item.price;
    showToast(`${item.name} quantity: ${item.qty}`);
    updateBuildDisplay();
    return;
  }
  currentTotal -= item.price * qty;
  selectedItems = selectedItems.filter((i) => i.name !== itemName);
  document.querySelectorAll(".product-card").forEach((card) => {
    if (card.dataset.name === itemName) {
      card.classList.remove("selected");
      const btn = card.querySelector(".add-to-build");
      if (btn) btn.textContent = "+ Add to Build";
    }
  });
  updateBuildDisplay();
  updateFPS();
  checkCompatibility();
}

function clearAllBuild() {
  if (selectedItems.length === 0) return;
  if (confirm("Clear all parts?")) {
    document.querySelectorAll(".product-card.selected").forEach((card) => {
      card.classList.remove("selected");
      const btn = card.querySelector(".add-to-build");
      if (btn) btn.textContent = "+ Add to Build";
    });
    selectedItems = [];
    currentTotal = 0;
    updateBuildDisplay();
    const fpsPanelEl = document.getElementById("fpsPanel"); if (fpsPanelEl) fpsPanelEl.style.display = "none";
    document.getElementById("compatibilityPanel").style.display = "none";
    document.getElementById("clearAllBtn").style.display = "none";
  }
}

function updateBuildDisplay() {
  const total = document.getElementById("totalPrice");
  if (total) total.textContent = "₱" + currentTotal.toLocaleString();
  const selectedParts = document.getElementById("selectedParts");
  const clearBtn = document.getElementById("clearAllBtn");
  if (!selectedParts || !clearBtn) return;

  if (selectedItems.length > 0) {
    const catLabels = { cpu:'Processor', gpu:'Graphics Card', motherboard:'Motherboard', ram:'Memory', ssd:'Storage', psu:'Power Supply', case:'Case', monitor:'Monitor', fan:'Cooling Fan', keyboard:'Keyboard', mouse:'Mouse', hdd:'Hard Drive', other:'Other' };
    const catOrder = ['cpu','gpu','motherboard','ram','ssd','psu','case','monitor','fan','keyboard','mouse','hdd','other'];
    const grouped = {};
    selectedItems.forEach(item => { const k = item.category || 'other'; if (!grouped[k]) grouped[k] = []; grouped[k].push(item); });

    let html = '';
    catOrder.forEach(cat => {
      if (!grouped[cat]) return;
      html += `<div class="build-category-group"><div class="build-group-header">${catLabels[cat] || cat}</div>`;
      grouped[cat].forEach(item => {
        const safeName = escapeHtml(item.name);
        const safeOnclickName = item.name.replace(/'/g, "\\'");
        const qty = item.qty || 1;
        const subtotal = qty * item.price;
        const multiQuantity = ["ram", "ssd", "fan"];
        if (multiQuantity.includes(item.category) && qty > 0) {
          html += `<div class="selected-item">
            <div style="flex:1;">
              <div class="item-name">${safeName}</div>
              <div style="display:flex;align-items:center;gap:8px;margin-top:5px;">
                <button class="qty-btn" onclick="decreaseQty('${safeOnclickName}')" style="background:var(--hover);border:1px solid var(--border);border-radius:8px;padding:4px 10px;cursor:pointer;">-</button>
                <span style="font-weight:600;">×${qty}</span>
                <button class="qty-btn" onclick="increaseQty('${safeOnclickName}')" style="background:var(--hover);border:1px solid var(--border);border-radius:8px;padding:4px 10px;cursor:pointer;">+</button>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-weight:800;color:var(--gold);">₱${subtotal.toLocaleString()}</span>
              <button class="replace-btn" onclick="replacePart('${item.category}')"><i class="fas fa-sync-alt"></i></button>
              <span class="remove-item" onclick="removeItem('${safeOnclickName}')"><i class="fas fa-times"></i></span>
            </div>
          </div>`;
        } else {
          html += `<div class="selected-item">
            <span class="item-name">${safeName}</span>
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-weight:800;color:var(--gold);">₱${subtotal.toLocaleString()}</span>
              <button class="replace-btn" onclick="replacePart('${item.category}')"><i class="fas fa-sync-alt"></i></button>
              <span class="remove-item" onclick="removeItem('${safeOnclickName}')"><i class="fas fa-times"></i></span>
            </div>
          </div>`;
        }
      });
      html += '</div>';
    });
    selectedParts.innerHTML = html;
    clearBtn.style.display = "block";
  } else {
    selectedParts.innerHTML = `<div class="empty-build"><i class="fas fa-tools"></i><h3>No items selected</h3><p>Click "Add to Build" on any product</p></div>`;
    clearBtn.style.display = "none";
  }

  if (typeof window.updateSidebarDots === 'function') window.updateSidebarDots();
  updatePerfScore();
}

function increaseQty(itemName) {
  const item = selectedItems.find(i => i.name === itemName);
  if (item && ["ram", "ssd", "fan"].includes(item.category)) {
    item.qty = (item.qty || 1) + 1;
    currentTotal += item.price;
    updateBuildDisplay();
    showToast(`${item.name} quantity: ${item.qty}`);
  }
}

function decreaseQty(itemName) {
  const item = selectedItems.find(i => i.name === itemName);
  if (item && ["ram", "ssd", "fan"].includes(item.category)) {
    if ((item.qty || 1) > 1) {
      item.qty = (item.qty || 1) - 1;
      currentTotal -= item.price;
      updateBuildDisplay();
      showToast(`${item.name} quantity: ${item.qty}`);
    } else {
      removeItem(itemName);
    }
  }
}

window.increaseQty = increaseQty;
window.decreaseQty = decreaseQty;

function replacePart(category) {
  if (typeof window.filterCategory === 'function') {
    window.filterCategory(category);
    const builderMain = document.querySelector('.builder-main');
    if (builderMain) builderMain.scrollTo({ top: 0, behavior: 'smooth' });
    showToast(`Browse to replace your ${category.toUpperCase()}`);
  }
}
window.replacePart = replacePart;

function updatePerfScore() {
  const panel = document.getElementById('perfScorePanel');
  if (!panel) return;
  const cpu = selectedItems.find(i => i.category === 'cpu');
  const gpu = selectedItems.find(i => i.category === 'gpu');
  if (!cpu && !gpu) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  const cpuPerf = parseInt(cpu?.dataset?.perf || '0', 10);
  const gpuPerf = parseInt(gpu?.dataset?.perf || '0', 10);
  const avgPerf = cpuPerf && gpuPerf ? (cpuPerf + gpuPerf) / 2 : cpuPerf || gpuPerf;
  const gaming = Math.min(100, Math.round(avgPerf * 0.95));
  const prod   = Math.min(100, Math.round(cpuPerf > 0 ? cpuPerf * 0.9 : avgPerf * 0.8));
  const stream = Math.min(100, Math.round(avgPerf * 0.85));
  const setBar = (id, barId, val) => {
    const el = document.getElementById(id); if (el) el.textContent = val + '/100';
    const bar = document.getElementById(barId); if (bar) bar.style.width = val + '%';
  };
  setBar('perfGaming',  'perfGamingBar',  gaming);
  setBar('perfProd',    'perfProdBar',     prod);
  setBar('perfStream',  'perfStreamBar',   stream);
}

function updateFPS() {
  let cpuPerf = 0, gpuPerf = 0;
  const cpu = selectedItems.find((item) => item.category === "cpu");
  const gpu = selectedItems.find((item) => item.category === "gpu");
  if (cpu) cpuPerf = parseInt(cpu.dataset?.perf || "0", 10);
  if (gpu) gpuPerf = parseInt(gpu.dataset?.perf || "0", 10);
  const panel = document.getElementById("fpsPanel");
  const content = document.getElementById("fpsContent");
  if (!panel || !content) return;
  if (cpuPerf === 0 || gpuPerf === 0) {
    panel.style.display = "none";
    return;
  }
  const avgPerf = (cpuPerf + gpuPerf) / 2;
  content.innerHTML = `
    <div class="fps-card"><div>🎯 Valorant</div><div class="fps-value">${Math.round(avgPerf * 2.2)} FPS</div></div>
    <div class="fps-card"><div>🚗 GTA V</div><div class="fps-value">${Math.round(avgPerf * 1.5)} FPS</div></div>
    <div class="fps-card"><div>🌃 Cyberpunk</div><div class="fps-value">${Math.round(avgPerf * 0.9)} FPS</div></div>
  `;
  panel.style.display = "block";
  updatePerfScore();
}

function checkCompatibility() {
  const warnings = [];
  const cpu = selectedItems.find((item) => item.category === "cpu");
  const gpu = selectedItems.find((item) => item.category === "gpu");
  const motherboard = selectedItems.find((item) => item.category === "motherboard");
  const pcCase = selectedItems.find((item) => item.category === "case");
  const psu = selectedItems.find((item) => item.category === "psu");
  if (cpu && motherboard && cpu.dataset?.socket !== motherboard.dataset?.socket) {
    warnings.push({ type: "critical", msg: `❌ Socket mismatch: CPU uses ${cpu.dataset?.socket}, motherboard uses ${motherboard.dataset?.socket}` });
  } else if (cpu && motherboard) {
    warnings.push({ type: "success", msg: `✅ Socket match: ${cpu.dataset?.socket}` });
  }
  if (gpu && pcCase) {
    const gpuLength = parseInt(gpu.dataset?.length || "0", 10);
    const caseMaxLength = parseInt(pcCase.dataset?.maxGpuLength || "0", 10);
    if (gpuLength > 0 && caseMaxLength > 0 && gpuLength > caseMaxLength) {
      warnings.push({ type: "critical", msg: `📏 GPU length (${gpuLength}mm) exceeds case maximum (${caseMaxLength}mm)` });
    } else if (gpu && pcCase) {
      warnings.push({ type: "success", msg: `✅ GPU fits in case (${gpuLength || '?'}mm ≤ ${caseMaxLength || '?'}mm)` });
    }
  }
  if (cpu && gpu && psu) {
    const cpuTdp = parseInt(cpu.dataset?.tdp || "0", 10);
    const gpuTdp = parseInt(gpu.dataset?.tdp || "0", 10);
    const totalTdp = cpuTdp + gpuTdp + 100;
    const psuWattage = parseInt(psu.dataset?.wattage || "0", 10);
    const headroom = psuWattage - totalTdp;
    if (totalTdp > psuWattage) {
      warnings.push({ type: "critical", msg: `⚡ Power insufficient: ${totalTdp}W needed, PSU provides ${psuWattage}W` });
    } else if (headroom < 100) {
      warnings.push({ type: "warning", msg: `⚠️ Power headroom low: ${headroom}W remaining (recommend 100W+ for stability)` });
    } else if (psuWattage > 0) {
      warnings.push({ type: "success", msg: `✅ Power sufficient: ${totalTdp}W used, ${headroom}W headroom` });
    }
  }
  const panel = document.getElementById("compatibilityPanel");
  const list = document.getElementById("compatibilityList");
  if (!panel || !list) return;
  if (warnings.length > 0) {
    list.innerHTML = warnings.map((w) => {
      let icon = "";
      if (w.type === "critical") icon = "fa-times-circle";
      else if (w.type === "warning") icon = "fa-exclamation-triangle";
      else icon = "fa-check-circle";
      return `<div class="warning-item ${w.type === "critical" ? "critical-item" : w.type === "warning" ? "warning-item" : "success-item"}"><i class="fas ${icon}"></i><div>${escapeHtml(w.msg)}</div></div>`;
    }).join("");
    panel.style.display = "block";
    panel.className = `compatibility-panel ${warnings.some((w) => w.type === "critical") ? "compatibility-critical" : ""}`;
  } else if (selectedItems.length > 0) {
    list.innerHTML = `<div class="success-item"><i class="fas fa-check-circle"></i> <div>✅ All checked! Your build looks compatible.</div></div>`;
    panel.style.display = "block";
  } else {
    panel.style.display = "none";
  }
}

function downloadScreenshot() {
  if (selectedItems.length === 0) { showToast("Add items to your build first!", true); return; }
  showToast("Generating screenshot...");
  const element = document.querySelector(".build-panel");
  if (!element) { showToast("Build panel not found", true); return; }
  html2canvas(element, { scale: 2, backgroundColor: document.body.classList.contains("dark-mode") ? "#080C14" : "#ffffff", logging: false, allowTaint: false, useCORS: true })
    .then((canvas) => {
      const link = document.createElement("a");
      link.download = `buildmatrix-build-${Date.now()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      showToast("Screenshot saved!");
    })
    .catch((error) => { console.error("Screenshot error:", error); showToast("Failed to generate screenshot", true); });
}

function downloadPDF() {
  if (selectedItems.length === 0) { showToast("Add items to your build first!", true); return; }
  showToast("Generating PDF...");
  const element = document.querySelector(".build-panel");
  if (!element) { showToast("Build panel not found", true); return; }
  html2canvas(element, { scale: 2, backgroundColor: document.body.classList.contains("dark-mode") ? "#080C14" : "#ffffff", logging: false, allowTaint: false, useCORS: true })
    .then((canvas) => {
      const imgData = canvas.toDataURL("image/png");
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF();
      const imgWidth = 210;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight);
      pdf.save(`buildmatrix-build-${Date.now()}.pdf`);
      showToast("PDF saved!");
    })
    .catch((error) => { console.error("PDF error:", error); showToast("Failed to generate PDF", true); });
}

async function saveCurrentBuild() {
  if (selectedItems.length === 0) { showToast("Add items first before saving!", true); return; }
  const defaultName = `My Build (${new Date().toLocaleDateString()})`;
  const name = prompt("Name your build:", defaultName);
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) { showToast("Build name can't be empty.", true); return; }
  const buildPayload = { name: trimmed, total: currentTotal, items: selectedItems.map((item) => ({ name: item.name, price: item.price, category: item.category, qty: item.qty || 1, dataset: item.dataset || {} })) };
  const user = getCurrentUser();
  if (user) {
    try {
      await apiFetch("/builds", { method: "POST", body: JSON.stringify(buildPayload) });
      showToast("Build saved to your account!");
      return;
    } catch (err) { console.warn("DB save failed:", err); showToast("Backend save failed — saved locally instead.", true); }
  }
  const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
  const build = { id, name: trimmed, createdAt: new Date().toISOString(), total: currentTotal, items: buildPayload.items };
  const builds = getSavedBuilds();
  builds.unshift(build);
  setSavedBuilds(builds);
  showToast("Build saved locally!");
}

function showMyBuilds() { window.location.href = "my-builds.html"; }
function showFavorites() { showToast("Favorites are not included in this version."); closeUserMenu(); }

async function loadBuildFromUrl() {
  const params = new URLSearchParams(window.location.search);

  const shareParam = params.get("share");
  if (shareParam) {
    try {
      const data = JSON.parse(decodeURIComponent(atob(shareParam)));
      if (data && Array.isArray(data.items)) {
        selectedItems = data.items.map(i => ({ name: i.name, price: Number(i.price)||0, category: i.category||'other', qty: i.qty||1, dataset: {} }));
        currentTotal = selectedItems.reduce((s, i) => s + i.price * (i.qty||1), 0);
        updateBuildDisplay(); updateFPS(); checkCompatibility();
        showToast('Shared build loaded!');
        return;
      }
    } catch(e) { console.warn('Invalid share param'); }
  }

  const buildId = params.get("buildId");
  if (!buildId) return;
  const user = getCurrentUser();
  if (user) {
    try {
      const data = await apiFetch(`/builds/${encodeURIComponent(buildId)}`, { method: "GET" });
      const build = data?.build;
      if (build) {
        selectedItems = Array.isArray(build.items) ? build.items : [];
        currentTotal = selectedItems.reduce((sum, item) => sum + (parseInt(item.price || "0", 10) * (item.qty || 1)), 0);
        updateBuildDisplay(); updateFPS(); checkCompatibility();
        showToast(`Loaded: ${build.name}`);
        return;
      }
    } catch (err) { console.warn("Failed to load build from DB:", err); }
  }
  const builds = getSavedBuilds();
  const build = builds.find((b) => b.id === buildId);
  if (!build) { showToast("Build not found.", true); return; }
  selectedItems = Array.isArray(build.items) ? build.items : [];
  currentTotal = selectedItems.reduce((sum, item) => sum + (parseInt(item.price || "0", 10) * (item.qty || 1)), 0);
  updateBuildDisplay(); updateFPS(); checkCompatibility();
  showToast(`Loaded: ${build.name}`);
}

function updateIndexAuthUI(user) {
  const signInBtn        = document.getElementById("signInBtn");
  const signInTopBtn     = document.getElementById("signInTopBtn");
  const userMenuContainer = document.getElementById("userMenuContainer");
  const userNameHeader   = document.getElementById("userNameHeader");
  const adminMenuBtn     = document.getElementById("adminMenuBtn");

  if (!signInBtn && !userMenuContainer) return;

  if (user) {
    if (signInBtn)         signInBtn.style.display        = "none";
    if (signInTopBtn)      signInTopBtn.style.display     = "none";
    if (userMenuContainer) userMenuContainer.style.display = "flex";
    if (userNameHeader)    userNameHeader.textContent      = user.name || "User";
    if (adminMenuBtn) adminMenuBtn.style.display = user.is_admin ? "" : "none";
  } else {
    if (signInBtn)         signInBtn.style.display        = "";
    if (signInTopBtn)      signInTopBtn.style.display     = "";
    if (userMenuContainer) userMenuContainer.style.display = "none";
    if (adminMenuBtn)      adminMenuBtn.style.display      = "none";
  }
}
window.updateIndexAuthUI = updateIndexAuthUI;

function toggleUserMenu() {
  const dd = document.getElementById("userDropdown");
  if (dd) dd.classList.toggle("show");
}

document.addEventListener("click", function(e) {
  const container = document.getElementById("userMenuContainer");
  const dd = document.getElementById("userDropdown");
  if (!container || !dd) return;
  if (!container.contains(e.target)) dd.classList.remove("show");
});

async function initBuilderPage() {
  initDarkModeToggle();
  await syncUserFromSession();
  updateAuthUI();
  const user = getCurrentUser();
  updateIndexAuthUI(user);
  initUserMenuAutoClose();
  showAllProducts();
  updateBuildDisplay();
  await loadBuildFromUrl();
  document.getElementById("closeAuth")?.addEventListener("click", closeAuthModal);
  document.getElementById("closeForgot")?.addEventListener("click", closeForgotModal);
  document.getElementById("closeTwofa")?.addEventListener("click", closeTwofaModal);
  window.addEventListener("click", (e) => {
    const authModal = document.getElementById("authModal");
    const forgotModal = document.getElementById("forgotPasswordModal");
    const twofaModal = document.getElementById("twofaSetupModal");
    if (authModal && e.target === authModal) closeAuthModal();
    if (forgotModal && e.target === forgotModal) closeForgotModal();
    if (twofaModal && e.target === twofaModal) closeTwofaModal();
  });
}

document.addEventListener("DOMContentLoaded", initBuilderPage);

window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.switchAuthTab = switchAuthTab;
window.handleLogin = handleLogin;
window.handleRegister = handleRegister;
window.openForgotPassword = openForgotPassword;
window.sendResetLink = sendResetLink;
window.resetPassword = resetPassword;
window.open2FASetup = open2FASetup;
window.verifyAndEnable2FA = verifyAndEnable2FA;
window.closeTwofaModal = closeTwofaModal;
window.showAllProducts = showAllProducts;
window.addToBuild = addToBuild;
window.removeItem = removeItem;
window.clearAllBuild = clearAllBuild;
window.downloadScreenshot = downloadScreenshot;
window.downloadPDF = downloadPDF;
window.saveCurrentBuild = saveCurrentBuild;
window.showMyBuilds = showMyBuilds;
window.showFavorites = showFavorites;

function bmNum(x) { const n = Number(x); return Number.isFinite(n) ? n : 0; }

window.getBMScore = function(p) {
  if (!p) return 0;
  const cat = String(p.category || "").toLowerCase();
  const meta = (p.meta && typeof p.meta === "object") ? p.meta : {};
  if (meta.benchmark) return Number(meta.benchmark);
  const perf = bmNum(meta.perf);
  if (cat === "cpu") return Math.round(perf * 300);
  if (cat === "gpu") return Math.round(perf * 350);
  return 0;
};

window.getBMLabel = function(p) {
  const cat = String(p?.category || "").toLowerCase();
  if (cat === "cpu") return "BM CPU Score";
  if (cat === "gpu") return "BM GPU Score";
  return "BM Score";
};

window.getValueScore = function(p) {
  const score = window.getBMScore(p);
  const price = bmNum(p.price);
  if (score && price) return Math.round((score / price) * 1000);
  return 0;
};

(function() {
  function getAllProductsSafe() {
    try {
      if (Array.isArray(window.products)) return window.products;
      if (Array.isArray(window.PRODUCTS)) return window.PRODUCTS;
      if (window.products && typeof window.products === "object") return Object.values(window.products).flat().filter(Boolean);
    } catch (e) {}
    return [];
  }

  function inferBrand(p) {
    if (p.brand) return String(p.brand);
    const n = String(p.name || "");
    return n.split(" ")[0] || "Unknown";
  }

  function parseSpecsList(p) {
    const list = [];
    const specs = String(p.specs || "").split(",").map(s => s.trim()).filter(Boolean);
    for (const s of specs) list.push(s);
    const meta = p.meta && typeof p.meta === "object" ? p.meta : {};
    const addMeta = (k, label) => {
      if (meta[k] !== undefined && meta[k] !== null && String(meta[k]).trim() !== "") list.push(`${label}: ${meta[k]}`);
    };
    addMeta("socket", "Socket"); addMeta("tdp", "TDP"); addMeta("vram", "VRAM"); addMeta("chipset", "Chipset");
    addMeta("wattage", "Wattage"); addMeta("capacity", "Capacity"); addMeta("speed", "Speed");
    addMeta("size", "Size"); addMeta("length", "Length"); addMeta("perf", "Perf Score");
    return list.length ? list : ["Specs not listed"];
  }

  const UI = { activeCategory: "cpu", search: "", brand: "all", selectedProductId: null };

  function ensureFilterBar(main) {
    const search = main.querySelector("#bmSearch");
    const brand = main.querySelector("#bmBrand");
    const clear = main.querySelector("#bmClearFilters");
    if (search) { search.value = UI.search; search.addEventListener("input", () => { UI.search = search.value; renderCategoryView(UI.activeCategory); }); }
    if (brand) { brand.value = UI.brand; brand.addEventListener("change", () => { UI.brand = brand.value; renderCategoryView(UI.activeCategory); }); }
    if (clear) { clear.addEventListener("click", () => { UI.search = ""; UI.brand = "all"; UI.selectedProductId = null; renderCategoryView(UI.activeCategory); }); }
  }

  function renderSelectionDetail(product) {
    const panel = document.getElementById("selectionDetail");
    if (!panel) return;
    if (!product) { panel.innerHTML = `<h3>SELECT A PART</h3><p class="sd-note">Click a product card to preview its specifications here.</p>`; return; }
    const img = product.img || product.image || "assets/placeholder.svg";
    const catLabel = String(product.category || "part").toUpperCase();
    const specsList = parseSpecsList(product);
    const specsHTML = specsList.map(s => `<li>${escapeHtml(String(s))}</li>`).join("");
    const bmScore = window.getBMScore(product);
    const valueScore = window.getValueScore(product);
    panel.innerHTML = `<h3>SELECT ${catLabel}</h3><p class="sd-note">Preview specs. Use <b>Add to Build</b> to add it to your build.</p>
      <div class="sd-img"><img src="${img}" alt="" onerror="this.src='assets/placeholder.svg'"/></div>
      <div class="sd-title">${escapeHtml(String(product.name || ""))}</div>
      <div style="font-weight:800; margin: 0 0 8px 0;">₱${Number(product.price||0).toLocaleString()}</div>
      ${(["cpu","gpu"].includes(String(product.category||"").toLowerCase())) ? `<div style="opacity:.9; font-weight:900; margin: 0 0 10px 0;">PassMark: ${bmScore > 0 ? bmScore.toLocaleString() : '—'}</div>
        <div style="opacity:.85; font-weight:800; margin: 0 0 10px 0;">${window.getBMLabel(product)}: ${bmScore.toLocaleString()}</div>
        <div style="opacity:.85; font-weight:800; margin: 0 0 10px 0;">Value Score: ${valueScore.toLocaleString()}</div>` : ``}
      <ul class="sd-specs">${specsHTML}</ul>
      <div class="sd-actions"><button class="save-build-btn" type="button" id="sdAddBtn"><i class="fas fa-plus"></i> Add to Build</button></div>`;
    const addBtn = panel.querySelector("#sdAddBtn");
    if (addBtn) {
      addBtn.addEventListener("click", () => {
        const card = document.querySelector(`.product-card[data-id="${CSS.escape(String(product.id||""))}"]`) || Array.from(document.querySelectorAll(".product-card")).find(c => c.dataset.name === String(product.name||""));
        const b = card ? card.querySelector(".add-to-build") : null;
        if (b) addToBuild(b);
      });
    }
  }

  function buildBrandsForCategory(items) { return Array.from(new Set(items.map(inferBrand))).sort((a,b)=>a.localeCompare(b)); }

  function categoryTitle(cat) {
    const map = { cpu: "PROCESSORS", gpu: "GRAPHICS CARDS", motherboard: "MOTHERBOARDS", ram: "MEMORY (RAM)", ssd: "SSDs", psu: "POWER SUPPLIES", case: "PC CASES", monitor: "MONITORS", fan: "CASE FANS" };
    return map[cat] || cat.toUpperCase();
  }

  function renderCategoryView(category) {
    UI.activeCategory = category;
    const main = document.getElementById("mainContent");
    if (!main) return;
    main.innerHTML = `<div><h2 style="margin: 0 0 10px;">${categoryTitle(category)}</h2><div class="products-filterbar"><div class="pill" style="flex:1;min-width:260px;"><i class="fas fa-search"></i><input id="bmSearch" type="text" placeholder="Search for products"/></div><div class="pill"><i class="fas fa-filter"></i><select id="bmBrand"><option value="all">All Brands</option></select></div><button class="dark-mode-toggle" id="bmClearFilters" type="button" style="white-space:nowrap;">Clear filters</button></div><div id="bmGrid" class="products-grid"></div></div>`;
    ensureFilterBar(main);
    const all = getAllProductsSafe().filter(p => String(p.category).toLowerCase() !== "laptop");
    const items = all.filter(p => String(p.category) === String(category));
    const brandSelect = document.getElementById("bmBrand");
    if (brandSelect) {
      const brands = buildBrandsForCategory(items);
      const current = UI.brand;
      brandSelect.innerHTML = `<option value="all">All Brands</option>` + brands.map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join("");
      if ([...brandSelect.options].some(o => o.value === current)) brandSelect.value = current;
      else { UI.brand = "all"; brandSelect.value = "all"; }
    }
    const q = String(UI.search || "").toLowerCase().trim();
    let filtered = items.slice();
    if (UI.brand !== "all") filtered = filtered.filter(p => inferBrand(p) === UI.brand);
    if (q) filtered = filtered.filter(p => (String(p.name||"")+" "+String(p.specs||"")).toLowerCase().includes(q));
    const grid = document.getElementById("bmGrid");
    if (!grid) return;
    const cards = filtered.map(p => {
      const img = p.img || p.image || "assets/placeholder.svg";
      const price = Number(p.price||0);
      const specs = String(p.specs||"");
      const tier = p.tier ? String(p.tier).toUpperCase() : "";
      const meta = (p.meta && typeof p.meta === "object") ? p.meta : {};
      const dataAttrs = `data-id="${escapeHtml(String(p.id||""))}" data-name="${escapeHtml(String(p.name||""))}" data-price="${price}" data-category="${escapeHtml(String(p.category||"other"))}" data-specs="${escapeHtml(String(p.specs||""))}" data-perf="${escapeHtml(String(meta.perf||""))}" data-socket="${escapeHtml(String(meta.socket||""))}" data-tdp="${escapeHtml(String(meta.tdp||""))}" data-length="${escapeHtml(String(meta.length||""))}" data-maxGpuLength="${escapeHtml(String(meta.gpuMaxLength||meta.maxGpuLength||""))}" data-wattage="${escapeHtml(String(meta.wattage||meta.watts||""))}" data-formFactor="${escapeHtml(String(meta.formFactor||""))}" data-ddr="${escapeHtml(String(meta.ddr||""))}"`;
      const tierStyles = {
        budget:      'display:inline-block;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.06em;margin-bottom:6px;background:rgba(34,197,94,0.15);color:#22C55E;border:1px solid rgba(34,197,94,0.4)',
        performance: 'display:inline-block;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.06em;margin-bottom:6px;background:rgba(59,130,246,0.15);color:#3B82F6;border:1px solid rgba(59,130,246,0.4)',
        highend:     'display:inline-block;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.06em;margin-bottom:6px;background:rgba(0,212,255,0.12);color:#00D4FF;border:1px solid rgba(0,212,255,0.35)',
      };
      const _t = String(p.tier||'').toLowerCase(); const badgeTier = _t === 'budget' ? 'budget' : (_t === 'performance' ? 'performance' : 'highend');
      const badgeStyle = tierStyles[badgeTier];
      const bmScore = window.getBMScore(p);
      const valueScore = window.getValueScore(p);
      return `<div class="product-card" ${dataAttrs}><div class="product-image"><img src="${img}" alt="" onerror="this.src='assets/placeholder.svg'"/></div>
        <div class="product-info"><h3>${escapeHtml(String(p.name||""))}</h3><p>${escapeHtml(specs)}</p><div class="product-price">₱${price.toLocaleString()}</div>${tier ? `<span style="${badgeStyle}">${escapeHtml(tier)}</span>` : ""}
        <div class="rating"><span class="stars">⭐</span><span>${escapeHtml(String(p.rating||""))} (${escapeHtml(String(p.ratingCount||0))})</span></div>
        ${(["cpu","gpu"].includes(String(p.category||"").toLowerCase())) ? `<div class="bm-bench" style="margin: 8px 0 10px; opacity:.9; font-weight:900;">PassMark: ${bmScore > 0 ? bmScore.toLocaleString() : '—'}</div>
          <div style="margin: 8px 0 10px; opacity:.85; font-weight:800;"><span style="opacity:.75; font-weight:700;">${window.getBMLabel(p)}:</span><span> ${bmScore.toLocaleString()}</span></div>
          <div style="margin: 8px 0 10px; opacity:.85; font-weight:800;"><span style="opacity:.75; font-weight:700;">Value Score:</span><span> ${valueScore.toLocaleString()}</span></div>` : ``}
        <button class="add-to-build" type="button" onclick="addToBuild(this)">+ Add to Build</button></div></div>`;
    }).join("");
    grid.innerHTML = cards || `<div style="opacity:.75; padding:12px;">No items found.</div>`;
    grid.querySelectorAll(".product-card").forEach(card => {
      card.addEventListener("click", (e) => {
        if (e.target && e.target.closest && e.target.closest(".add-to-build")) return;
        const id = card.dataset.id || null;
        UI.selectedProductId = id;
        const p = filtered.find(x => String(x.id||"") === String(id)) || filtered.find(x => String(x.name||"") === String(card.dataset.name||""));
        renderSelectionDetail(p);
      });
    });
    renderSelectionDetail(null);
    syncSelectedCardsUI();
    document.querySelectorAll(".category-item").forEach(btn => btn.classList.remove("active"));
    const activeBtn = Array.from(document.querySelectorAll(".category-item")).find(b => (b.getAttribute("onclick")||"").includes(`'${category}'`) || (b.getAttribute("onclick")||"").includes(`"${category}"`));
    if (activeBtn) activeBtn.classList.add("active");
  }

  window.renderCategoryView = renderCategoryView;

  document.addEventListener("DOMContentLoaded", function() {
    setTimeout(() => { renderCategoryView("cpu"); }, 100);
    setTimeout(() => {
      document.querySelectorAll(".category-item").forEach(btn => {
        btn.addEventListener("click", function(e) {
          const onclick = this.getAttribute("onclick");
          if (onclick && onclick.includes("filterCategory")) {
            e.preventDefault();
            const match = onclick.match(/filterCategory\('([^']+)'\)/);
            if (match) renderCategoryView(match[1]);
          }
        });
      });
    }, 200);
  });
})();

window.showOverviewView = function() {
  const main = document.getElementById("mainContent");
  if (!main) return;
  main.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; gap:12px;"><div><h2 style="margin:0;">Overview</h2><div style="opacity:.8; margin-top:4px;">Review your selected parts.</div></div><button class="dark-mode-toggle" type="button" onclick="showAllProducts()"><i class="fas fa-wrench"></i> Back to Builder</button></div>
    <div style="margin-top:20px;">${selectedItems.length > 0 ? `<div class="selected-parts-overview">${selectedItems.map(item => `<div class="ov-item"><div>${escapeHtml(item.name)}</div><div>₱${Number(item.price).toLocaleString()} ${(item.qty && item.qty > 1) ? `x ${item.qty} = ₱${(item.price * item.qty).toLocaleString()}` : ''}</div></div>`).join('')}<div class="ov-total">Total: ₱${currentTotal.toLocaleString()}</div></div>` : '<p>No parts selected yet.</p>'}</div>`;
  const sd = document.getElementById("selectionDetail");
  if (sd) sd.innerHTML = `<h3>OVERVIEW</h3><p class="sd-note">Review your build here.</p>`;
};

window.bmOverviewRemove = function(name) { removeItem(name); window.showOverviewView(); };
window.openCompareModal = function() { document.getElementById("compareModal").style.display = "flex"; };
window.closeCompareModal = function() { document.getElementById("compareModal").style.display = "none"; };
window.openAutoBuildModal = function() { document.getElementById("autoBuildModal").style.display = "flex"; };
window.closeAutoBuildModal = function() { document.getElementById("autoBuildModal").style.display = "none"; };
window.runCompare = function() {
  const type = document.getElementById('compareType')?.value || 'cpu';
  const selA = document.getElementById('compareA');
  const selB = document.getElementById('compareB');
  const result = document.getElementById('compareResult');
  if (!selA || !selB || !result) { showToast('Compare UI not ready'); return; }
  const products = Array.isArray(window.PRODUCTS) ? window.PRODUCTS : [];
  const a = products.find(p => p.name === selA.value);
  const b = products.find(p => p.name === selB.value);
  if (!a || !b) { result.innerHTML = '<p style="color:var(--text-secondary);padding:16px">Select two products to compare.</p>'; return; }
  const fields = [
    ['Price', '₱' + Number(a.price||0).toLocaleString(), '₱' + Number(b.price||0).toLocaleString()],
    ['Tier', a.tier||'—', b.tier||'—'],
    ['Specs', a.specs||'—', b.specs||'—'],
    ['Rating', a.rating ? a.rating.toFixed(1) + ' ★' : '—', b.rating ? b.rating.toFixed(1) + ' ★' : '—'],
  ];
  const meta = a.meta && typeof a.meta==='object' ? a.meta : {};
  Object.keys(meta).forEach(k => {
    const va = meta[k] != null ? meta[k] : '—';
    const vb = (b.meta && b.meta[k] != null) ? b.meta[k] : '—';
    fields.push([k.charAt(0).toUpperCase()+k.slice(1), va, vb]);
  });
  const rows = fields.map(([label, va, vb]) =>
    `<tr><td style="padding:8px 12px;color:var(--text-secondary);font-size:13px;">${label}</td><td style="padding:8px 12px;color:var(--gold);font-size:13px;font-weight:600;">${va}</td><td style="padding:8px 12px;color:var(--gold);font-size:13px;font-weight:600;">${vb}</td></tr>`
  ).join('');
  result.innerHTML = `<table style="width:100%;border-collapse:collapse;margin-top:16px;">
    <thead><tr>
      <th style="padding:10px 12px;text-align:left;color:var(--text-primary);border-bottom:1px solid var(--border);">Spec</th>
      <th style="padding:10px 12px;text-align:left;color:var(--text-primary);border-bottom:1px solid var(--border);">" + a.name + "</th>
      <th style="padding:10px 12px;text-align:left;color:var(--text-primary);border-bottom:1px solid var(--border);">" + b.name + "</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
};
window.generateAutoBuild = async function() {
  const budget = parseInt(document.getElementById('autoBudget')?.value) || 50000;
  const purpose = document.getElementById('autoPurpose')?.value || 'gaming';
  const resultEl = document.getElementById('autoBuildResult');
  if (!resultEl) return;
  resultEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gold)"><i class="fas fa-spinner fa-spin"></i> Generating...</div>';
  const products = Array.isArray(window.PRODUCTS) ? window.PRODUCTS : [];
  const alloc = purpose === 'productivity'
    ? { cpu:0.30, gpu:0.20, ram:0.15, motherboard:0.12, ssd:0.10, psu:0.07, case:0.06 }
    : purpose === 'streaming'
    ? { cpu:0.28, gpu:0.28, ram:0.12, motherboard:0.12, ssd:0.08, psu:0.07, case:0.05 }
    : { cpu:0.22, gpu:0.38, ram:0.10, motherboard:0.12, ssd:0.08, psu:0.06, case:0.04 };
  const pick = (cat, maxPrice) => {
    const pool = products.filter(p => p.category === cat && Number(p.price) <= maxPrice);
    if (!pool.length) return products.filter(p => p.category === cat).sort((a,b) => Number(a.price)-Number(b.price))[0];
    return pool.sort((a, b) => Number(b.price) - Number(a.price))[0];
  };
  const build = []; let total = 0;
  for (const [cat, pct] of Object.entries(alloc)) {
    const item = pick(cat, Math.round(budget * pct));
    if (item) { build.push(item); total += Number(item.price); }
  }
  if (!build.length) { resultEl.innerHTML = '<p style="color:var(--text-secondary)">Could not generate build for this budget.</p>'; return; }
  const rows = build.map(item =>
    `<tr><td style="padding:8px;color:var(--text-secondary);font-size:12px;text-transform:uppercase;">${item.category}</td><td style="padding:8px;color:var(--text-primary);font-size:13px;">${item.name}</td><td style="padding:8px;color:var(--gold);font-size:13px;font-weight:700;">₱${Number(item.price).toLocaleString()}</td></tr>`
  ).join('');
  resultEl.innerHTML = `<table style="width:100%;border-collapse:collapse;margin-top:16px;">
    <thead><tr>
      <th style="padding:8px;text-align:left;color:var(--text-secondary);border-bottom:1px solid var(--border);font-size:12px;">Category</th>
      <th style="padding:8px;text-align:left;color:var(--text-primary);border-bottom:1px solid var(--border);font-size:12px;">Component</th>
      <th style="padding:8px;text-align:left;color:var(--gold);border-bottom:1px solid var(--border);font-size:12px;">Price</th>
    </tr></thead><tbody>${rows}</tbody>
    <tfoot><tr>
      <td colspan="2" style="padding:10px 8px;color:var(--text-primary);font-weight:700;border-top:1px solid var(--border);">TOTAL</td>
      <td style="padding:10px 8px;color:var(--gold);font-weight:700;border-top:1px solid var(--border);">₱${total.toLocaleString()}</td>
    </tfoot></table>
    <button onclick="window._applyAutoBuildFromBuilder()" style="margin-top:14px;width:100%;background:var(--gold);color:#000;border:none;padding:12px;border-radius:8px;font-weight:800;cursor:pointer;font-size:14px;">
      <i class="fas fa-check"></i> Apply This Build
    </button>`;
  window._autoBuildData = build;
};
window._applyAutoBuildFromBuilder = function() {
  const build = window._autoBuildData;
  if (!Array.isArray(build)) return;
  document.querySelectorAll('.product-card.selected').forEach(function(c) {
    c.classList.remove('selected');
    var b = c.querySelector('.add-to-build');
    if (b) b.textContent = '+ Add to Build';
  });
  selectedItems = []; currentTotal = 0;
  build.forEach(function(item) {
    var meta = item.meta || {};
    selectedItems.push({name:item.name, price:Number(item.price), category:item.category, qty:1,
      dataset:{name:item.name, price:String(item.price), category:item.category,
        tdp:String(meta.tdp||''), wattage:String(meta.wattage||''), socket:String(meta.socket||''),
        perf:String(meta.perf||''), length:String(meta.length||''), maxGpuLength:String(meta.gpuMaxLength||meta.maxGpuLength||'')}});
    currentTotal += Number(item.price);
  });
  window.selectedItems = selectedItems; window.currentTotal = currentTotal;
  if (typeof updateBuildDisplay === 'function') updateBuildDisplay();
  if (typeof checkCompatibility === 'function') checkCompatibility();
  if (typeof updateFPS === 'function') updateFPS();
  if (typeof window.closeAutoBuildModal === 'function') window.closeAutoBuildModal();
  if (typeof window.showToast === 'function') window.showToast('Auto build applied!');
};
window.applyAutoBuild = function() { showToast("Auto Build feature coming soon!"); };
window.swapCompare = function() { showToast("Swap feature coming soon!"); };
window.applyTemplate = function(template) { showToast(`Template: ${template}`); };
window.copyShareLink = function() { showToast("Share link copied!"); };

function openJavaToolsModal() {
  let modal = document.getElementById('javaToolsModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'javaToolsModal';
    modal.style.cssText = `
      display:none; position:fixed; top:0; left:0; width:100%; height:100%;
      background:rgba(0,0,0,0.92); backdrop-filter:blur(12px);
      z-index:10000; align-items:center; justify-content:center;
    `;
    modal.innerHTML = `
      <div style="
        background:var(--bg-card); border-radius:24px; width:90%; max-width:560px;
        border:1px solid var(--gold-border); padding:0; overflow:hidden;
        box-shadow:0 0 60px rgba(255,215,0,0.12);
      ">
        <!-- Header -->
        <div style="
          display:flex; align-items:center; justify-content:space-between;
          padding:22px 28px 18px; border-bottom:1px solid var(--border);
          background:linear-gradient(135deg,rgba(255,215,0,0.07),transparent);
        ">
          <div>
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="width:36px;height:36px;background:var(--gold);border-radius:10px;display:flex;align-items:center;justify-content:center;">
                <i class="fas fa-microchip" style="color:#000;font-size:16px;"></i>
              </div>
              <div>
                <div style="font-size:17px;font-weight:800;color:var(--text-primary);">Build Tools</div>
                <div style="font-size:11px;color:var(--text-muted);">Powered by Java logic</div>
              </div>
            </div>
          </div>
          <button onclick="closeJavaToolsModal()" style="
            background:rgba(255,255,255,0.06); border:none; color:var(--text-secondary);
            width:34px; height:34px; border-radius:50%; cursor:pointer; font-size:16px;
            display:flex; align-items:center; justify-content:center;
          ">✕</button>
        </div>

        <!-- Tabs -->
        <div style="display:flex; border-bottom:1px solid var(--border); background:var(--bg-surface);">
          ${[
            ['score',   'fa-chart-line',  'Build Score'],
            ['compat',  'fa-shield-alt',  'Compatibility'],
            ['budget',  'fa-coins',       'Budget Guide'],
            ['price',   'fa-calculator',  'Price Calc'],
          ].map(([id, icon, label], i) => `
            <button id="jtab-${id}" onclick="switchJavaTool('${id}')" style="
              flex:1; padding:12px 4px; border:none; cursor:pointer; font-size:11px;
              font-weight:700; font-family:inherit; letter-spacing:.03em;
              background:${i===0?'rgba(255,215,0,0.1)':'transparent'};
              color:${i===0?'var(--gold)':'var(--text-muted)'};
              border-bottom:${i===0?'2px solid var(--gold)':'2px solid transparent'};
              transition:all .2s; display:flex; flex-direction:column; align-items:center; gap:4px;
            ">
              <i class="fas ${icon}" style="font-size:14px;"></i>${label}
            </button>
          `).join('')}
        </div>

        <!-- Body -->
        <div style="padding:24px 28px; max-height:420px; overflow-y:auto;" id="javaToolBody">
        </div>

        <!-- Footer -->
        <div style="padding:16px 28px; border-top:1px solid var(--border); display:flex; justify-content:flex-end; gap:10px; background:var(--bg-surface);">
          <button id="javaRunBtn" onclick="runCurrentJavaTool()" style="
            background:var(--gold); color:#000; border:none; padding:11px 28px;
            border-radius:40px; font-weight:800; font-size:13px; cursor:pointer;
            font-family:inherit; display:flex; align-items:center; gap:8px;
            transition:transform .15s, box-shadow .15s;
          " onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 6px 20px rgba(255,215,0,0.35)'"
             onmouseout="this.style.transform='';this.style.boxShadow=''">
            <i class="fas fa-play"></i> Run Tool
          </button>
          <button onclick="closeJavaToolsModal()" style="
            background:transparent; color:var(--text-secondary); border:1px solid var(--border);
            padding:11px 20px; border-radius:40px; font-weight:700; font-size:13px;
            cursor:pointer; font-family:inherit;
          ">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) closeJavaToolsModal(); });
  }
  modal.style.display = 'flex';
  window._currentJavaTool = 'score';
  switchJavaTool('score');
}

function closeJavaToolsModal() {
  const m = document.getElementById('javaToolsModal');
  if (m) m.style.display = 'none';
}

function switchJavaTool(tool) {
  window._currentJavaTool = tool;
  const tabs = ['score','compat','budget','price'];
  tabs.forEach(t => {
    const btn = document.getElementById('jtab-' + t);
    if (!btn) return;
    const active = t === tool;
    btn.style.background = active ? 'rgba(255,215,0,0.1)' : 'transparent';
    btn.style.color = active ? 'var(--gold)' : 'var(--text-muted)';
    btn.style.borderBottom = active ? '2px solid var(--gold)' : '2px solid transparent';
  });

  const body = document.getElementById('javaToolBody');
  if (!body) return;

  const runBtn = document.getElementById('javaRunBtn');

  if (tool === 'score') {
    if (runBtn) runBtn.innerHTML = '<i class="fas fa-chart-line"></i> Analyze Build';
    body.innerHTML = `
      <div style="margin-bottom:16px;">
        <div style="font-size:15px;font-weight:800;margin-bottom:6px;color:var(--text-primary);">
          <i class="fas fa-chart-line" style="color:var(--gold);margin-right:8px;"></i>Build Score Calculator
        </div>
        <div style="font-size:12px;color:var(--text-muted);line-height:1.6;">
          Scores your current build across 4 compatibility checks: CPU socket, RAM type, PSU wattage, and GPU clearance. Each issue deducts points from 100.
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
        ${[
          ['Socket Match','socketMatchSel','CPU socket matches motherboard'],
          ['RAM Match','ramMatchSel','RAM type compatible with motherboard'],
          ['Power OK','powerOkSel','PSU wattage is sufficient'],
          ['GPU Fits','gpuFitsSel','GPU fits inside the case'],
        ].map(([label, id, tip]) => `
          <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:12px;">
            <div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:8px;">${label}</div>
            <select id="${id}" style="width:100%;background:var(--bg-darker);border:1px solid var(--border);color:var(--text-primary);padding:6px 10px;border-radius:8px;font-size:12px;font-family:inherit;">
              <option value="1">✅ Yes</option>
              <option value="0">❌ No</option>
            </select>
            <div style="font-size:10px;color:var(--text-muted);margin-top:6px;">${tip}</div>
          </div>
        `).join('')}
      </div>
      <div id="javaScoreResult"></div>
    `;
    _autoFillScoreSelects();

  } else if (tool === 'compat') {
    if (runBtn) runBtn.innerHTML = '<i class="fas fa-shield-alt"></i> Check Compatibility';
    body.innerHTML = `
      <div style="margin-bottom:16px;">
        <div style="font-size:15px;font-weight:800;margin-bottom:6px;color:var(--text-primary);">
          <i class="fas fa-shield-alt" style="color:var(--gold);margin-right:8px;"></i>Compatibility Checker
        </div>
        <div style="font-size:12px;color:var(--text-muted);line-height:1.6;">
          Checks socket pairing, RAM type, and power draw against your PSU wattage.
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px;">
        ${[
          ['CPU Socket','cpuSocketIn','e.g. AM5, LGA1700'],
          ['Motherboard Socket','mbSocketIn','e.g. AM5, LGA1700'],
          ['RAM Type','ramTypeIn','e.g. DDR5, DDR4'],
          ['Motherboard RAM Type','mbRamIn','e.g. DDR5, DDR4'],
          ['CPU TDP (W)','cpuTdpIn','e.g. 105'],
          ['GPU TDP (W)','gpuTdpIn','e.g. 200'],
          ['PSU Wattage (W)','psuWattIn','e.g. 650'],
        ].map(([label, id, ph]) => `
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="width:160px;font-size:12px;font-weight:600;color:var(--text-secondary);flex-shrink:0;">${label}</div>
            <input id="${id}" placeholder="${ph}" style="flex:1;background:var(--bg-darker);border:1px solid var(--border);color:var(--text-primary);padding:8px 12px;border-radius:8px;font-size:12px;font-family:inherit;" />
          </div>
        `).join('')}
      </div>
      <div id="javaCompatResult"></div>
    `;
    _autoFillCompatInputs();

  } else if (tool === 'budget') {
    if (runBtn) runBtn.innerHTML = '<i class="fas fa-coins"></i> Allocate Budget';
    body.innerHTML = `
      <div style="margin-bottom:16px;">
        <div style="font-size:15px;font-weight:800;margin-bottom:6px;color:var(--text-primary);">
          <i class="fas fa-coins" style="color:var(--gold);margin-right:8px;"></i>Budget Allocator
        </div>
        <div style="font-size:12px;color:var(--text-muted);line-height:1.6;">
          Enter your total budget and get a recommended spend breakdown across all major components.
        </div>
      </div>
      <div style="margin-bottom:20px;">
        <label style="font-size:12px;font-weight:700;color:var(--text-secondary);display:block;margin-bottom:8px;">Total Budget (₱)</label>
        <div style="display:flex;align-items:center;gap:0;">
          <div style="background:var(--gold);color:#000;padding:10px 14px;border-radius:10px 0 0 10px;font-weight:800;font-size:14px;">₱</div>
          <input id="budgetInput" type="number" value="50000" min="20000" step="1000"
            style="flex:1;background:var(--bg-darker);border:1px solid var(--border);border-left:none;color:var(--text-primary);padding:10px 14px;border-radius:0 10px 10px 0;font-size:14px;font-weight:700;font-family:inherit;" />
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
          ${[20000,35000,50000,75000,100000].map(v=>`
            <button onclick="document.getElementById('budgetInput').value=${v}" style="
              background:var(--bg-surface);border:1px solid var(--border);color:var(--text-secondary);
              padding:5px 12px;border-radius:20px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;
              transition:all .2s;
            " onmouseover="this.style.borderColor='var(--gold)';this.style.color='var(--gold)'"
               onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text-secondary)'">
              ₱${v.toLocaleString()}
            </button>
          `).join('')}
        </div>
      </div>
      <div id="javaBudgetResult"></div>
    `;

  } else if (tool === 'price') {
    if (runBtn) runBtn.innerHTML = '<i class="fas fa-calculator"></i> Calculate Total';
    const items = (typeof selectedItems !== 'undefined' ? selectedItems : []);
    const rows = items.length
      ? items.map((it, i) => `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <input value="${(it.name||'Component').replace(/"/g,'')}" id="pci-name-${i}"
              style="flex:2;background:var(--bg-darker);border:1px solid var(--border);color:var(--text-primary);padding:7px 10px;border-radius:8px;font-size:12px;font-family:inherit;" />
            <input type="number" value="${it.price||0}" id="pci-price-${i}" min="0"
              style="flex:1;background:var(--bg-darker);border:1px solid var(--border);color:var(--gold);padding:7px 10px;border-radius:8px;font-size:12px;font-weight:700;font-family:inherit;" />
          </div>
        `).join('')
      : `<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px 0;">
           No parts in your build yet. Add components to the builder first, or enter prices manually below.
         </div>
         <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
           <input placeholder="Component name" id="pci-name-0"
             style="flex:2;background:var(--bg-darker);border:1px solid var(--border);color:var(--text-primary);padding:7px 10px;border-radius:8px;font-size:12px;font-family:inherit;" />
           <input type="number" placeholder="Price" id="pci-price-0" min="0"
             style="flex:1;background:var(--bg-darker);border:1px solid var(--border);color:var(--gold);padding:7px 10px;border-radius:8px;font-size:12px;font-weight:700;font-family:inherit;" />
         </div>`;
    body.innerHTML = `
      <div style="margin-bottom:16px;">
        <div style="font-size:15px;font-weight:800;margin-bottom:6px;color:var(--text-primary);">
          <i class="fas fa-calculator" style="color:var(--gold);margin-right:8px;"></i>Price Calculator
        </div>
        <div style="font-size:12px;color:var(--text-muted);line-height:1.6;">
          Edit prices and get a running total. Pre-filled from your current build.
        </div>
      </div>
      <div id="priceRowsWrap" style="max-height:220px;overflow-y:auto;margin-bottom:12px;">${rows}</div>
      <div id="javaPriceResult"></div>
    `;
  }
}

function _autoFillScoreSelects() {
  try {
    const items = typeof selectedItems !== 'undefined' ? selectedItems : [];
    const cpu = items.find(i => i.category === 'cpu');
    const mb  = items.find(i => i.category === 'motherboard');
    const gpu = items.find(i => i.category === 'gpu');
    const psu = items.find(i => i.category === 'psu');
    const cs  = items.find(i => i.category === 'case');
    if (cpu && mb) {
      const sm = cpu.dataset?.socket === mb.dataset?.socket ? '1' : '0';
      const rm = (cpu.dataset?.ramType || mb.dataset?.ramType) ? (cpu.dataset?.ramType === mb.dataset?.ramType ? '1' : '0') : '1';
      document.getElementById('socketMatchSel').value = sm;
      document.getElementById('ramMatchSel').value = rm;
    }
    if (psu && (cpu || gpu)) {
      const totalW = (parseInt(cpu?.dataset?.tdp||0)) + (parseInt(gpu?.dataset?.tdp||0)) + 100;
      const psuW   = parseInt(psu?.dataset?.wattage||0);
      document.getElementById('powerOkSel').value = (psuW > 0 && totalW <= psuW) ? '1' : (psuW === 0 ? '1' : '0');
    }
    if (gpu && cs) {
      const gl = parseInt(gpu.dataset?.length||0);
      const cl = parseInt(cs.dataset?.maxGpuLength||0);
      document.getElementById('gpuFitsSel').value = (gl > 0 && cl > 0) ? (gl <= cl ? '1' : '0') : '1';
    }
  } catch(e) {}
}

function _autoFillCompatInputs() {
  try {
    const items = typeof selectedItems !== 'undefined' ? selectedItems : [];
    const cpu = items.find(i => i.category === 'cpu');
    const mb  = items.find(i => i.category === 'motherboard');
    const ram = items.find(i => i.category === 'ram');
    const gpu = items.find(i => i.category === 'gpu');
    const psu = items.find(i => i.category === 'psu');
    if (cpu?.dataset?.socket) document.getElementById('cpuSocketIn').value = cpu.dataset.socket;
    if (mb?.dataset?.socket)  document.getElementById('mbSocketIn').value  = mb.dataset.socket;
    if (ram?.dataset?.type)   document.getElementById('ramTypeIn').value   = ram.dataset.type;
    if (mb?.dataset?.ramType) document.getElementById('mbRamIn').value     = mb.dataset.ramType;
    if (cpu?.dataset?.tdp)    document.getElementById('cpuTdpIn').value    = cpu.dataset.tdp;
    if (gpu?.dataset?.tdp)    document.getElementById('gpuTdpIn').value    = gpu.dataset.tdp;
    if (psu?.dataset?.wattage) document.getElementById('psuWattIn').value  = psu.dataset.wattage;
  } catch(e) {}
}

function runCurrentJavaTool() {
  const tool = window._currentJavaTool || 'score';
  if (tool === 'score')  _runBuildScore();
  if (tool === 'compat') _runCompatChecker();
  if (tool === 'budget') _runBudgetAllocator();
  if (tool === 'price')  _runPriceCalculator();
}

function _resultBox(html) {
  return `<div style="
    background:var(--bg-surface); border:1px solid var(--border); border-radius:14px;
    padding:16px; margin-top:4px; animation: fadeIn .25s ease;
  ">${html}</div>`;
}

function _statRow(label, value, valueColor) {
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
    <span style="font-size:12px;color:var(--text-secondary);">${label}</span>
    <span style="font-size:13px;font-weight:700;color:${valueColor||'var(--text-primary)'};">${value}</span>
  </div>`;
}

function _runBuildScore() {
  const sm = document.getElementById('socketMatchSel')?.value === '1';
  const rm = document.getElementById('ramMatchSel')?.value === '1';
  const pw = document.getElementById('powerOkSel')?.value === '1';
  const gf = document.getElementById('gpuFitsSel')?.value === '1';

  let score = 100;
  if (!sm) score -= 30;
  if (!rm) score -= 20;
  if (!pw) score -= 25;
  if (!gf) score -= 15;
  score = Math.max(0, score);

  const grade = score>=90?'A+ (Excellent)':score>=80?'A (Great)':score>=70?'B (Good)':score>=60?'C (Fair)':'D (Needs Work)';
  const scoreColor = score>=80?'var(--success)':score>=60?'var(--warning)':'var(--error)';

  const arc = Math.round((score/100)*283);
  const ring = `<svg width="90" height="90" style="display:block;margin:0 auto 12px;">
    <circle cx="45" cy="45" r="38" fill="none" stroke="var(--border)" stroke-width="7"/>
    <circle cx="45" cy="45" r="38" fill="none" stroke="${scoreColor}" stroke-width="7"
      stroke-dasharray="${arc} 283" stroke-dashoffset="71" stroke-linecap="round"
      transform="rotate(-90 45 45)"/>
    <text x="45" y="50" text-anchor="middle" fill="${scoreColor}" font-size="18" font-weight="900" font-family="Inter,sans-serif">${score}</text>
  </svg>`;

  let issues = '';
  if (!sm) issues += `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;color:var(--error);font-size:12px;"><i class="fas fa-times-circle"></i> Socket mismatch <span style="margin-left:auto;color:var(--error);">−30</span></div>`;
  if (!rm) issues += `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;color:var(--error);font-size:12px;"><i class="fas fa-times-circle"></i> RAM type mismatch <span style="margin-left:auto;color:var(--error);">−20</span></div>`;
  if (!pw) issues += `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;color:var(--error);font-size:12px;"><i class="fas fa-times-circle"></i> Insufficient power <span style="margin-left:auto;color:var(--error);">−25</span></div>`;
  if (!gf) issues += `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;color:var(--error);font-size:12px;"><i class="fas fa-times-circle"></i> GPU too long for case <span style="margin-left:auto;color:var(--error);">−15</span></div>`;
  if (!issues) issues = `<div style="color:var(--success);font-size:12px;display:flex;align-items:center;gap:8px;"><i class="fas fa-check-circle"></i> All checks passed!</div>`;

  document.getElementById('javaScoreResult').innerHTML = _resultBox(`
    ${ring}
    <div style="text-align:center;font-size:13px;font-weight:700;color:${scoreColor};margin-bottom:14px;">${grade}</div>
    <div style="border-top:1px solid var(--border);padding-top:12px;">${issues}</div>
    <div style="margin-top:10px;font-size:10px;color:var(--text-muted);"><i class="fas fa-info-circle"></i> Based on BuildScoreCalculator.java</div>
  `);
}

function _runCompatChecker() {
  const cpuSock = (document.getElementById('cpuSocketIn')?.value||'').trim().toUpperCase();
  const mbSock  = (document.getElementById('mbSocketIn')?.value||'').trim().toUpperCase();
  const ramType = (document.getElementById('ramTypeIn')?.value||'').trim().toUpperCase();
  const mbRam   = (document.getElementById('mbRamIn')?.value||'').trim().toUpperCase();
  const cpuTdp  = parseInt(document.getElementById('cpuTdpIn')?.value||0);
  const gpuTdp  = parseInt(document.getElementById('gpuTdpIn')?.value||0);
  const psuW    = parseInt(document.getElementById('psuWattIn')?.value||0);

  const totalW  = cpuTdp + gpuTdp + 100;
  const sockOk  = cpuSock && mbSock  ? cpuSock === mbSock  : null;
  const ramOk   = ramType && mbRam   ? ramType === mbRam   : null;
  const powerOk = psuW > 0 ? totalW <= psuW : null;
  const powerWarn = psuW > 0 && totalW > psuW * 0.8 && totalW <= psuW;

  function row(label, status, detail) {
    const c = status===true?'var(--success)':status===false?'var(--error)':'var(--text-muted)';
    const ic = status===true?'fa-check-circle':status===false?'fa-times-circle':'fa-question-circle';
    return `<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
      <i class="fas ${ic}" style="color:${c};margin-top:2px;flex-shrink:0;"></i>
      <div>
        <div style="font-size:12px;font-weight:700;color:var(--text-primary);">${label}</div>
        <div style="font-size:11px;color:${c};margin-top:2px;">${detail}</div>
      </div>
    </div>`;
  }

  const sockDetail = sockOk===null ? 'Enter both sockets to check' : sockOk ? `✓ Both use ${cpuSock}` : `CPU: ${cpuSock||'?'} vs Motherboard: ${mbSock||'?'}`;
  const ramDetail  = ramOk===null  ? 'Enter both RAM types to check' : ramOk  ? `✓ Both use ${ramType}` : `RAM: ${ramType||'?'} vs Board: ${mbRam||'?'}`;
  const powerDetail= powerOk===null? 'Enter TDPs and PSU wattage' : powerWarn ? `⚠️ Close to limit: ${totalW}W / ${psuW}W` : powerOk ? `✓ ${totalW}W draw, ${psuW}W PSU` : `✗ Need ${totalW}W, PSU only ${psuW}W`;

  document.getElementById('javaCompatResult').innerHTML = _resultBox(`
    ${row('CPU ↔ Motherboard Socket', sockOk, sockDetail)}
    ${row('RAM Type Compatibility',   ramOk,  ramDetail)}
    ${row('Power Draw vs PSU', powerOk===null ? null : (powerWarn ? 'warn' : powerOk), powerDetail)}
    <div style="margin-top:10px;font-size:10px;color:var(--text-muted);"><i class="fas fa-info-circle"></i> Based on CompatibilityChecker.java</div>
  `);
}

function _runBudgetAllocator() {
  const budget = parseFloat(document.getElementById('budgetInput')?.value || 50000);
  if (!budget || budget < 20000) { showToast("Enter a valid budget (min ₱20,000)", true); return; }

  const alloc = {
    'CPU':          { pct: 0.25, icon: 'fa-microchip',  color: '#00D4FF', cat: 'cpu' },
    'GPU':          { pct: 0.35, icon: 'fa-tv',         color: '#3B82F6', cat: 'gpu' },
    'Motherboard':  { pct: 0.12, icon: 'fa-server',     color: '#8B5CF6', cat: 'motherboard' },
    'RAM':          { pct: 0.08, icon: 'fa-memory',     color: '#22C55E', cat: 'ram' },
    'Storage':      { pct: 0.08, icon: 'fa-database',   color: '#F97316', cat: 'ssd' },
    'PSU':          { pct: 0.07, icon: 'fa-bolt',       color: '#EF4444', cat: 'psu' },
    'Case':         { pct: 0.05, icon: 'fa-desktop',    color: '#6B7280', cat: 'case' },
  };

  const products = Array.isArray(window.PRODUCTS) ? window.PRODUCTS : [];

  function getSuggestedProduct(cat, targetAmt) {
    const catProducts = products.filter(p => p.category === cat && p.price);
    if (!catProducts.length) return null;
    const sorted = catProducts.sort((a, b) => Math.abs(a.price - targetAmt) - Math.abs(b.price - targetAmt));
    return sorted[0];
  }

  let rows = '';
  let used = 0;
  Object.entries(alloc).forEach(([name, {pct, icon, color, cat}]) => {
    const amt = budget * pct;
    used += amt;
    const suggested = getSuggestedProduct(cat, amt);
    const suggestedHTML = suggested
      ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;" title="${suggested.name}">
          <i class="fas fa-tag" style="margin-right:3px;"></i>${suggested.name}
        </div>`
      : '';
    rows += `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
      <div style="width:30px;height:30px;background:${color}22;border:1px solid ${color}44;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <i class="fas ${icon}" style="color:${color};font-size:12px;"></i>
      </div>
      <div style="flex:1;min-width:0;">
        <span style="font-size:12px;font-weight:600;color:var(--text-primary);">${name}</span>
        ${suggestedHTML}
      </div>
      <span style="font-size:11px;color:var(--text-muted);flex-shrink:0;">${Math.round(pct*100)}%</span>
      <span style="font-size:13px;font-weight:800;color:${color};flex-shrink:0;">₱${Math.round(amt).toLocaleString()}</span>
    </div>`;
  });

  document.getElementById('javaBudgetResult').innerHTML = _resultBox(`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <span style="font-size:12px;color:var(--text-muted);">Budget: <strong style="color:var(--text-primary);">₱${budget.toLocaleString()}</strong></span>
      <span style="font-size:12px;color:var(--text-muted);">Remaining: <strong style="color:var(--gold);">₱${Math.round(budget-used).toLocaleString()}</strong></span>
    </div>
    ${rows}
    <div style="margin-top:10px;font-size:10px;color:var(--text-muted);"><i class="fas fa-info-circle"></i> Based on BudgetAllocator.java — percentages follow PC building best practices</div>
  `);
}

function _runPriceCalculator() {
  const items = typeof selectedItems !== 'undefined' ? selectedItems : [];
  const count = Math.max(items.length, 1);
  let total = 0;
  const lines = [];

  for (let i = 0; i < count; i++) {
    const nameEl  = document.getElementById(`pci-name-${i}`);
    const priceEl = document.getElementById(`pci-price-${i}`);
    if (!priceEl) continue;
    const price = parseFloat(priceEl.value || 0);
    const name  = nameEl?.value || `Component ${i+1}`;
    if (price > 0) { total += price; lines.push({name, price}); }
  }

  if (!lines.length) { showToast('No prices to calculate.', true); return; }

  const rows = lines.map(l => _statRow(l.name, `₱${l.price.toLocaleString()}`, 'var(--text-primary)')).join('');

  document.getElementById('javaPriceResult').innerHTML = _resultBox(`
    ${rows}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:12px;border-top:2px solid var(--gold-border);">
      <span style="font-size:14px;font-weight:800;color:var(--text-primary);">TOTAL</span>
      <span style="font-size:18px;font-weight:900;color:var(--gold);">₱${total.toLocaleString()}</span>
    </div>
    <div style="margin-top:10px;font-size:10px;color:var(--text-muted);"><i class="fas fa-info-circle"></i> Based on PriceCalculator.java</div>
  `);
}

async function runJavaScore()  { openJavaToolsModal(); }
async function runJavaBudget() { openJavaToolsModal(); switchJavaTool('budget'); }

window.runJavaScore = runJavaScore;
window.runJavaBudget = runJavaBudget;
window.openJavaToolsModal = openJavaToolsModal;
window.closeJavaToolsModal = closeJavaToolsModal;
window.switchJavaTool = switchJavaTool;
window.runCurrentJavaTool = runCurrentJavaTool;

(function() {

  var CYAN = '#00D4FF';
  var CYAN_DARK = '#0099CC';
  var CYAN_DIM = 'rgba(0,212,255,0.08)';
  var CYAN_BORDER = 'rgba(0,212,255,0.2)';

  var STORE_LINKS = {
    'lazada':    'https://www.lazada.com.ph/catalog/?q=',
    'shopee':    'https://shopee.ph/search?keyword=',
    'pcexpress': 'https://www.pc-express.com.ph/index.php?route=product/search&search='
  };

  function esc(str) {
    return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }

  function closeOnBackdrop(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', function(e) { if (e.target === this) this.remove(); });
  }

  window.openPriceLinks = function(name) {
    var old = document.getElementById('bmPriceBuyModal');
    if (old) old.remove();
    var enc = encodeURIComponent(name);
    var stores = [
      { key:'lazada',    label:'Lazada',      bg:'#0F3460', color:'#D8EEFF' },
      { key:'shopee',    label:'Shopee',      bg:'#EE4D2D', color:'#D8EEFF' },
      { key:'pcexpress', label:'PC Express',  bg:'#0a2540', color:CYAN }
    ];
    var btns = stores.map(function(s) {
      return '<a href="' + STORE_LINKS[s.key] + enc + '" target="_blank" rel="noopener" ' +
        'style="display:flex;align-items:center;gap:10px;padding:13px 16px;border-radius:10px;' +
        'background:' + s.bg + ';color:' + s.color + ';text-decoration:none;font-weight:600;' +
        'font-size:14px;margin-bottom:8px;border:1px solid ' + (s.key==='pcexpress' ? CYAN_BORDER : 'transparent') + ';">' +
        '<span style="flex:1;">' + s.label + '</span><span style="opacity:.6;">\u2192</span></a>';
    }).join('');
    var html = bmModal('bmPriceBuyModal', 'Buy: ' + esc(name),
      '<p style="font-size:12px;color:#5a8aaa;margin-bottom:14px;">Click a store to search for this part:</p>' + btns);
    document.body.insertAdjacentHTML('beforeend', html);
    closeOnBackdrop('bmPriceBuyModal');
  };

  var PRICE_CACHE = {};
  window.openPriceHistory = function(name, basePrice) {
    var old = document.getElementById('bmPriceHistoryModal');
    if (old) old.remove();
    if (!PRICE_CACHE[name]) {
      var h = [], p = basePrice * (0.88 + Math.random() * 0.18), now = Date.now();
      for (var i = 11; i >= 0; i--) {
        var d = new Date(now - i * 30 * 24 * 60 * 60 * 1000);
        p = p * (0.97 + Math.random() * 0.07);
        if (Math.random() < 0.15) p *= 0.93;
        h.push({ label: d.toLocaleString('default',{month:'short',year:'2-digit'}), price: Math.round(p) });
      }
      h[h.length-1].price = basePrice;
      PRICE_CACHE[name] = h;
    }
    var history = PRICE_CACHE[name];
    var prices = history.map(function(h){return h.price;});
    var min = Math.min.apply(null,prices), max = Math.max.apply(null,prices), range = max-min||1;
    var W=280, H=80;
    var pts = history.map(function(h,i){ return ((i/(history.length-1))*W)+','+(H-((h.price-min)/range)*H); }).join(' ');
    var dots = history.map(function(h,i){
      var x=(i/(history.length-1))*W, y=H-((h.price-min)/range)*H;
      var col = h.price===min?'#22C55E':(h.price===max?'#EF4444':CYAN);
      return '<circle cx="'+x+'" cy="'+y+'" r="3" fill="'+col+'"/>';
    }).join('');
    var lbls = history.filter(function(_,i){return i%3===0||i===history.length-1;}).map(function(h){
      var i=history.indexOf(h), x=(i/(history.length-1))*W;
      return '<text x="'+x+'" y="'+(H+14)+'" font-size="9" fill="#5a8aaa" text-anchor="middle">'+h.label+'</text>';
    }).join('');
    var change = Math.round(((basePrice-history[0].price)/history[0].price)*100);
    var trendCol = change<=0?'#22C55E':'#EF4444', trendStr=(change<=0?'\u2193':'\u2191')+Math.abs(change)+'%';
    var stats = [
      {label:'Current', val:'\u20b1'+basePrice.toLocaleString(), color:CYAN},
      {label:'Lowest',  val:'\u20b1'+min.toLocaleString(),       color:'#22C55E'},
      {label:'Highest', val:'\u20b1'+max.toLocaleString(),        color:'#EF4444'},
      {label:'Trend',   val:trendStr,                             color:trendCol}
    ].map(function(s){
      return '<div style="background:'+CYAN_DIM+';border:1px solid '+CYAN_BORDER+';border-radius:8px;padding:8px;text-align:center;">' +
        '<div style="font-size:9px;color:#5a8aaa;text-transform:uppercase;margin-bottom:3px;">'+s.label+'</div>' +
        '<div style="font-size:12px;font-weight:700;color:'+s.color+';">'+s.val+'</div></div>';
    }).join('');
    var body = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;">'+stats+'</div>' +
      '<svg viewBox="-10 -5 '+(W+20)+' '+(H+25)+'" width="100%" style="margin-top:4px;">' +
      '<polyline points="'+pts+'" fill="none" stroke="'+CYAN+'" stroke-width="2" stroke-linejoin="round"/>' +
      dots + lbls + '</svg>' +
      '<p style="font-size:10px;color:#2a4560;margin-top:8px;">*Simulated trend based on market patterns</p>';
    document.body.insertAdjacentHTML('beforeend', bmModal('bmPriceHistoryModal','Price History: '+esc(name), body, '380px'));
    closeOnBackdrop('bmPriceHistoryModal');
  };

  var WISHLIST_KEY = 'buildmatrix-wishlist';
  function getWishlist() { try { return JSON.parse(localStorage.getItem(WISHLIST_KEY)||'[]'); } catch(e){ return []; } }
  function saveWishlist(l) { localStorage.setItem(WISHLIST_KEY, JSON.stringify(l)); }

  window.isWishlisted = function(name) { return getWishlist().some(function(i){return i.name===name;}); };

  window.toggleWishlist = function(name, price, category) {
    var list = getWishlist();
    var idx = list.findIndex(function(i){return i.name===name;});
    if (idx > -1) { list.splice(idx,1); saveWishlist(list); showToast(esc(name)+' removed from wishlist'); }
    else { list.push({name:name,price:price,category:category,addedAt:new Date().toISOString(),alertPrice:null}); saveWishlist(list); showToast(esc(name)+' added to wishlist \u2665'); }
    if (typeof window._renderWishlist === 'function') window._renderWishlist();
  };

  window.setAlertPrice = function(name, currentPrice) {
    var val = prompt('Price alert for '+name+'\nCurrent: \u20b1'+Number(currentPrice).toLocaleString()+'\nEnter target \u20b1:', Math.round(currentPrice*0.9));
    if (val===null) return;
    var target = parseInt(val);
    if (isNaN(target)||target<=0) { showToast('Invalid price',true); return; }
    var list = getWishlist();
    var item = list.find(function(i){return i.name===name;});
    if (item) { item.alertPrice=target; saveWishlist(list); showToast('Alert set: \u20b1'+target.toLocaleString()); }
    if (typeof window._renderWishlist==='function') window._renderWishlist();
  };

  window.addWishlistToBuild = function(name) {
    var products = Array.isArray(window.PRODUCTS)?window.PRODUCTS:[];
    var p = products.find(function(x){return x.name===name;});
    if (!p) { showToast('Product not found',true); return; }
    var meta = p.meta||{};
    var existing = selectedItems.find(function(i){return i.name===name;});
    if (existing) { showToast(esc(name)+' already in build'); return; }
    selectedItems.push({ name:p.name, price:p.price, category:p.category, qty:1,
      dataset:{name:p.name,price:String(p.price),category:p.category,
        tdp:String(meta.tdp||''),wattage:String(meta.wattage||''),socket:String(meta.socket||''),
        perf:String(meta.perf||''),length:String(meta.length||''),maxGpuLength:String(meta.maxGpuLength||meta.gpuMaxLength||'')}
    });
    currentTotal += p.price;
    window.selectedItems = selectedItems; window.currentTotal = currentTotal;
    if (typeof updateBuildDisplay==='function') updateBuildDisplay();
    showToast(esc(name)+' added from wishlist');
  };

  window.openWishlistModal = function() {
    var old = document.getElementById('bmWishlistModal');
    if (old) old.remove();
    window._renderWishlist = function() {
      var body = document.querySelector('#bmWishlistModal .bm-wl-body');
      if (!body) return;
      var list = getWishlist();
      if (!list.length) { body.innerHTML='<p style="color:#5a8aaa;padding:20px;text-align:center;">No items saved.<br>Click \u2665 on any product card.</p>'; return; }
      body.innerHTML = list.map(function(item) {
        var alert = item.alertPrice ? '\u20b1'+Number(item.alertPrice).toLocaleString() : 'Not set';
        var n = item.name.replace(/'/g,"\\'");
        return '<div style="display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid rgba(0,212,255,0.08);">' +
          '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:13px;font-weight:600;color:#D8EEFF;margin-bottom:3px;">'+esc(item.name)+'</div>' +
          '<div style="font-size:11px;color:#5a8aaa;margin-bottom:4px;">'+esc(item.category)+' &bull; \u20b1'+Number(item.price).toLocaleString()+'</div>' +
          '<div style="font-size:11px;color:#2a4560;display:flex;align-items:center;gap:6px;">Alert: '+alert+
          ' <button onclick="window.setAlertPrice(\''+n+'\','+item.price+')" style="background:rgba(0,212,255,0.1);border:1px solid rgba(0,212,255,0.25);color:'+CYAN+';font-size:10px;padding:2px 8px;border-radius:4px;cursor:pointer;font-weight:600;">Set</button></div>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">' +
          '<button onclick="window.addWishlistToBuild(\''+n+'\')" style="background:'+CYAN+';color:#000;border:none;padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">+ Build</button>' +
          '<button onclick="window.toggleWishlist(\''+n+'\','+item.price+',\''+esc(item.category)+'\')" style="background:transparent;border:1px solid rgba(0,212,255,0.15);color:#5a8aaa;padding:5px 10px;border-radius:6px;font-size:11px;cursor:pointer;">Remove</button>' +
          '</div></div>';
      }).join('');
    };
    var html = '<div class="bm-price-modal-backdrop" id="bmWishlistModal">' +
      '<div class="bm-price-modal" style="max-width:460px;">' +
      '<div class="bm-price-modal-header">\u2665 Wishlist' +
        '<button onclick="document.getElementById(\'bmWishlistModal\').remove()" class="bm-modal-close">\u00d7</button></div>' +
      '<div class="bm-wl-body bm-price-modal-body"></div>' +
      '</div></div>';
    document.body.insertAdjacentHTML('beforeend', html);
    closeOnBackdrop('bmWishlistModal');
    window._renderWishlist();
  };

  window.openBuildCompareModal = function() {
    var old = document.getElementById('bmBuildCompareModal');
    if (old) old.remove();
    var builds = [];
    try {
      var user = typeof getCurrentUser==='function'?getCurrentUser():null;
      var key = user ? 'buildmatrix-builds-'+user.id : 'buildmatrix-builds-guest';
      builds = JSON.parse(localStorage.getItem(key)||'[]');
      if (!builds.length) builds = JSON.parse(localStorage.getItem('buildmatrix-builds-guest')||'[]');
    } catch(e){}
    var opts = builds.map(function(b){
      return '<option value="'+esc(b.id)+'">'+esc(b.name)+' (\u20b1'+Number(b.total||0).toLocaleString()+')</option>';
    }).join('');
    var selStyle = 'width:100%;background:#0a0f1a;color:#D8EEFF;border:1px solid rgba(0,212,255,0.2);padding:9px 12px;border-radius:8px;font-size:13px;';
    var body = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">' +
      '<div><label style="font-size:12px;color:#5a8aaa;display:block;margin-bottom:6px;">Build A</label>' +
      '<select id="bmCmpA" style="'+selStyle+'"><option value="current">Current Build (\u20b1'+Number(currentTotal).toLocaleString()+')</option>'+opts+'</select></div>' +
      '<div><label style="font-size:12px;color:#5a8aaa;display:block;margin-bottom:6px;">Build B</label>' +
      '<select id="bmCmpB" style="'+selStyle+'">'+(opts||'<option value="">No saved builds</option>')+'</select></div></div>' +
      '<button onclick="window._runBuildCompare()" style="width:100%;background:'+CYAN+';color:#000;border:none;padding:11px;border-radius:8px;font-weight:700;cursor:pointer;margin-bottom:14px;font-size:13px;">Compare</button>' +
      '<div id="bmCmpResult"></div>';
    document.body.insertAdjacentHTML('beforeend', bmModal('bmBuildCompareModal','Compare Builds', body, '700px'));
    closeOnBackdrop('bmBuildCompareModal');
    window._bmBuildsCache = builds;
  };

  window._runBuildCompare = function() {
    var selA = document.getElementById('bmCmpA')?.value;
    var selB = document.getElementById('bmCmpB')?.value;
    var result = document.getElementById('bmCmpResult');
    if (!result) return;
    var builds = window._bmBuildsCache||[];
    function getBuild(id) {
      if (id==='current') return {name:'Current Build', items:window.selectedItems||selectedItems||[], total:currentTotal};
      return builds.find(function(b){return b.id===id;});
    }
    var bA=getBuild(selA), bB=getBuild(selB);
    if (!bA||!bB) { result.innerHTML='<p style="color:#5a8aaa;padding:12px;">Select two builds.</p>'; return; }
    var cats=['cpu','gpu','motherboard','ram','ssd','psu','case','fan','monitor','keyboard','mouse','hdd'];
    var catLabels={cpu:'CPU',gpu:'GPU',motherboard:'Mobo',ram:'RAM',ssd:'SSD',psu:'PSU',case:'Case',fan:'Fan',monitor:'Monitor',keyboard:'KB',mouse:'Mouse',hdd:'HDD'};
    function getItem(build,cat){return (build.items||[]).find(function(i){return i.category===cat;});}
    function estWatts(items){
      var cpu=(items||[]).find(function(i){return i.category==='cpu';}),
          gpu=(items||[]).find(function(i){return i.category==='gpu';});
      return parseInt((cpu&&cpu.dataset&&cpu.dataset.tdp)||0)+parseInt((gpu&&gpu.dataset&&gpu.dataset.tdp)||0)+75;
    }
    var rows = cats.map(function(cat){
      var iA=getItem(bA,cat), iB=getItem(bB,cat);
      if (!iA&&!iB) return '';
      var diff = iA&&iB&&iA.name!==iB.name;
      return '<tr style="background:'+(diff?'rgba(0,212,255,0.04)':'transparent')+';border-bottom:1px solid rgba(0,212,255,0.06);">' +
        '<td style="padding:8px;color:#5a8aaa;font-size:11px;text-transform:uppercase;">'+catLabels[cat]+'</td>' +
        '<td style="padding:8px;font-size:12px;"><div style="color:#D8EEFF;">'+(iA?esc(iA.name):'<span style="color:#2a4560;">—</span>')+'</div>'+(iA?'<div style="color:'+CYAN+';font-size:11px;">\u20b1'+Number(iA.price).toLocaleString()+'</div>':'')+'</td>' +
        '<td style="padding:8px;font-size:12px;"><div style="color:#D8EEFF;">'+(iB?esc(iB.name):'<span style="color:#2a4560;">—</span>')+'</div>'+(iB?'<div style="color:'+CYAN+';font-size:11px;">\u20b1'+Number(iB.price).toLocaleString()+'</div>':'')+'</td>' +
        '</tr>';
    }).join('');
    var tA=Number(bA.total)||0, tB=Number(bB.total)||0;
    var diff = tA-tB, summary = diff===0?'Same price':(diff<0?'Build A is \u20b1'+Math.abs(diff).toLocaleString()+' cheaper':'Build B is \u20b1'+Math.abs(diff).toLocaleString()+' cheaper');
    result.innerHTML = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">' +
      '<thead><tr style="border-bottom:1px solid rgba(0,212,255,0.15);">' +
      '<th style="padding:8px;text-align:left;color:#5a8aaa;font-size:11px;"></th>' +
      '<th style="padding:8px;text-align:left;color:'+CYAN+';font-size:12px;">'+esc(bA.name)+'</th>' +
      '<th style="padding:8px;text-align:left;color:'+CYAN+';font-size:12px;">'+esc(bB.name)+'</th>' +
      '</tr></thead><tbody>'+rows+'</tbody>' +
      '<tfoot><tr style="border-top:2px solid rgba(0,212,255,0.2);">' +
      '<td style="padding:10px 8px;color:#5a8aaa;font-size:12px;">TOTAL</td>' +
      '<td style="padding:10px 8px;color:'+CYAN+';font-weight:700;">\u20b1'+tA.toLocaleString()+'</td>' +
      '<td style="padding:10px 8px;color:'+CYAN+';font-weight:700;">\u20b1'+tB.toLocaleString()+'</td>' +
      '</tr><tr>' +
      '<td style="padding:6px 8px;color:#5a8aaa;font-size:11px;">EST. WATTS</td>' +
      '<td style="padding:6px 8px;color:var(--text-secondary);font-size:11px;">'+estWatts(bA.items)+'W</td>' +
      '<td style="padding:6px 8px;color:var(--text-secondary);font-size:11px;">'+estWatts(bB.items)+'W</td>' +
      '</tr></tfoot></table></div>' +
      '<div style="margin-top:12px;padding:10px 14px;background:rgba(0,212,255,0.08);border-radius:8px;color:'+CYAN+';font-size:13px;font-weight:600;">'+summary+'</div>';
  };

  window.openAIRecommender = function() {
    var old = document.getElementById('bmAIModal');
    if (old) old.remove();
    var inStyle = 'width:100%;background:#0a0f1a;color:#D8EEFF;border:1px solid rgba(0,212,255,0.2);padding:9px 12px;border-radius:8px;font-size:13px;box-sizing:border-box;';
    var body = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">' +
      '<div><label style="font-size:12px;color:#5a8aaa;display:block;margin-bottom:6px;">Budget (\u20b1)</label>' +
      '<input id="aiBudget" type="number" value="50000" min="10000" max="500000" step="1000" style="'+inStyle+'"/></div>' +
      '<div><label style="font-size:12px;color:#5a8aaa;display:block;margin-bottom:6px;">Use Case</label>' +
      '<select id="aiPurpose" style="'+inStyle+'">' +
      '<option value="gaming">Gaming</option><option value="productivity">Productivity</option>' +
      '<option value="streaming">Streaming</option><option value="budget">Budget Build</option>' +
      '</select></div></div>' +
      '<button onclick="window._runAIBuild()" style="width:100%;background:'+CYAN+';color:#000;border:none;padding:12px;border-radius:8px;font-weight:800;cursor:pointer;font-size:14px;margin-bottom:14px;">' +
      '\ud83e\udd16 Generate My Build</button>' +
      '<div id="aiResult"></div>';
    document.body.insertAdjacentHTML('beforeend', bmModal('bmAIModal','\ud83e\udd16 AI Build Recommender', body, '520px'));
    closeOnBackdrop('bmAIModal');
  };

  window._runAIBuild = function() {
    var budget = parseInt(document.getElementById('aiBudget')?.value)||50000;
    var purpose = document.getElementById('aiPurpose')?.value||'gaming';
    var resultEl = document.getElementById('aiResult');
    if (!resultEl) return;
    resultEl.innerHTML = '<div style="text-align:center;padding:20px;color:'+CYAN+'"><i class="fas fa-spinner fa-spin"></i><div style="margin-top:8px;font-size:13px;">Analyzing your requirements...</div></div>';
    var allocs = {
      gaming:       {cpu:0.18,gpu:0.40,ram:0.09,motherboard:0.12,ssd:0.08,psu:0.07,case:0.06},
      productivity: {cpu:0.30,gpu:0.15,ram:0.18,motherboard:0.13,ssd:0.12,psu:0.07,case:0.05},
      streaming:    {cpu:0.25,gpu:0.30,ram:0.13,motherboard:0.12,ssd:0.09,psu:0.07,case:0.04},
      budget:       {cpu:0.22,gpu:0.35,ram:0.10,motherboard:0.12,ssd:0.09,psu:0.07,case:0.05}
    };
    var tips = {
      gaming:'GPU-focused for max FPS. Pair with a high-refresh monitor.',
      productivity:'CPU+RAM heavy for multitasking and video editing.',
      streaming:'Balanced CPU+GPU for gaming and encoding simultaneously.',
      budget:'Best value-per-peso picks within your budget.'
    };
    var alloc = allocs[purpose]||allocs.gaming;
    var products = Array.isArray(window.PRODUCTS)?window.PRODUCTS:[];
    function pickBest(cat, maxPrice) {
      var pool = products.filter(function(p){return p.category===cat&&Number(p.price)<=maxPrice;});
      if (!pool.length) pool = products.filter(function(p){return p.category===cat;});
      if (!pool.length) return null;
      return pool.sort(function(a,b){
        var pa=Number((a.meta&&a.meta.perf)||0), pb=Number((b.meta&&b.meta.perf)||0);
        var sa=pa?(pa/Number(a.price||1))*1000:Number(a.price||0);
        var sb=pb?(pb/Number(b.price||1))*1000:Number(b.price||0);
        return sb-sa;
      })[0];
    }
    setTimeout(function() {
      var build=[], total=0;
      ['cpu','gpu','motherboard','ram','ssd','psu','case'].forEach(function(cat){
        var item=pickBest(cat,Math.round(budget*(alloc[cat]||0.1)));
        if (item){build.push(item);total+=Number(item.price);}
      });
      if (!build.length){resultEl.innerHTML='<p style="color:#5a8aaa;">Could not generate build for this budget.</p>';return;}
      var rows=build.map(function(item){
        var meta=item.meta||{};
        var specs=[meta.socket?'Socket:'+meta.socket:'',meta.tdp?meta.tdp+'W':'',meta.vram?meta.vram+' VRAM':''].filter(Boolean).join(' · ');
        return '<tr style="border-bottom:1px solid rgba(0,212,255,0.06);">' +
          '<td style="padding:9px 8px;color:#5a8aaa;font-size:11px;text-transform:uppercase;white-space:nowrap;">'+esc(item.category)+'</td>' +
          '<td style="padding:9px 8px;"><div style="font-weight:600;color:#D8EEFF;font-size:12px;">'+esc(item.name)+'</div>'+(specs?'<div style="color:#2a4560;font-size:10px;margin-top:2px;">'+esc(specs)+'</div>':'')+'</td>' +
          '<td style="padding:9px 8px;color:'+CYAN+';font-weight:700;font-size:13px;white-space:nowrap;">\u20b1'+Number(item.price).toLocaleString()+'</td>' +
          '</tr>';
      }).join('');
      var remaining=budget-total;
      resultEl.innerHTML =
        '<div style="background:rgba(0,212,255,0.08);border:1px solid rgba(0,212,255,0.15);border-radius:10px;padding:12px 14px;margin-bottom:14px;">' +
        '<div style="font-size:11px;color:'+CYAN+';font-weight:700;margin-bottom:4px;">\ud83e\udd16 AI Recommendation</div>' +
        '<div style="font-size:12px;color:#5a8aaa;">'+esc(tips[purpose]||'')+'</div></div>' +
        '<table style="width:100%;border-collapse:collapse;">' +
        '<thead><tr style="border-bottom:1px solid rgba(0,212,255,0.15);"><th style="padding:8px;text-align:left;color:#5a8aaa;font-size:11px;">TYPE</th><th style="padding:8px;text-align:left;color:#5a8aaa;font-size:11px;">COMPONENT</th><th style="padding:8px;text-align:left;color:#5a8aaa;font-size:11px;">PRICE</th></tr></thead>' +
        '<tbody>'+rows+'</tbody>' +
        '<tfoot><tr style="border-top:2px solid rgba(0,212,255,0.2);">' +
        '<td colspan="2" style="padding:10px 8px;color:#D8EEFF;font-weight:700;">TOTAL</td>' +
        '<td style="padding:10px 8px;color:'+CYAN+';font-weight:700;">\u20b1'+total.toLocaleString()+'</td></tr></tfoot></table>' +
        (remaining>0?'<div style="color:#22C55E;font-size:12px;margin-top:6px;">\u20b1'+remaining.toLocaleString()+' remaining budget</div>':'')+
        '<button onclick="window._applyAIBuild()" style="margin-top:14px;width:100%;background:'+CYAN+';color:#000;border:none;padding:12px;border-radius:8px;font-weight:800;cursor:pointer;font-size:14px;">' +
        '<i class="fas fa-check"></i> Apply This Build</button>';
      window._aiBuildData = build;
    }, 600);
  };

  window._applyAIBuild = function() {
    var build = window._aiBuildData;
    if (!Array.isArray(build)||!build.length){showToast('No AI build to apply',true);return;}
    document.querySelectorAll('.product-card.selected').forEach(function(c){
      c.classList.remove('selected');
      var b=c.querySelector('.add-to-build');
      if(b) b.textContent='+ Add to Build';
    });
    selectedItems=[]; currentTotal=0;
    build.forEach(function(item){
      var meta=item.meta||{};
      selectedItems.push({name:item.name,price:Number(item.price),category:item.category,qty:1,
        dataset:{name:item.name,price:String(item.price),category:item.category,
          tdp:String(meta.tdp||''),wattage:String(meta.wattage||''),socket:String(meta.socket||''),
          perf:String(meta.perf||''),length:String(meta.length||''),maxGpuLength:String(meta.maxGpuLength||meta.gpuMaxLength||'')}});
      currentTotal+=Number(item.price);
    });
    window.selectedItems=selectedItems; window.currentTotal=currentTotal;
    if(typeof updateBuildDisplay==='function') updateBuildDisplay();
    if(typeof checkCompatibility==='function') checkCompatibility();
    if(typeof window.updateWattageBar==='function') window.updateWattageBar();
    var modal=document.getElementById('bmAIModal');
    if(modal) modal.remove();
    showToast('AI build applied!');
  };

  window.openCommunityShowcase = function() {
    var old = document.getElementById('bmCommunityModal');
    if (old) old.remove();
    var BUILDS = [
      {id:'c1',author:'xRyzeN_PH',name:'Budget Gaming Beast',total:38500,votes:142,purpose:'gaming',tier:'budget',items:['AMD Ryzen 5 5600G','RTX 4060','ASUS Prime B450M-A II'],desc:'Best budget 1080p gaming build. Hits 100+ FPS in most titles.'},
      {id:'c2',author:'TechBuildsPH',name:'Content Creator Pro',total:95000,votes:89,purpose:'productivity',tier:'highend',items:['AMD Ryzen 9 7900X','RTX 4080','ASUS ROG Strix X670E'],desc:'Handles 4K video editing, 3D rendering and streaming simultaneously.'},
      {id:'c3',author:'GamingDadPH',name:'Mid-Range Sweet Spot',total:58000,votes:211,purpose:'gaming',tier:'performance',items:['Intel Core i5-13600K','RTX 4070','MSI MAG B660M Mortar'],desc:'Perfect balance of price and performance for 1440p gaming.'},
      {id:'c4',author:'StreamKingPH',name:'Streaming Powerhouse',total:72000,votes:67,purpose:'streaming',tier:'performance',items:['AMD Ryzen 7 5800X','RTX 4070 Ti','MSI MAG B550 TOMAHAWK'],desc:'Zero dropped frames while gaming and streaming at 1080p60.'},
      {id:'c5',author:'PisoPC_Build',name:'Pinaka Mura Max FPS',total:22000,votes:334,purpose:'gaming',tier:'budget',items:['AMD Ryzen 5 5600G','Netac 8GB DDR4','EVM 480GB SSD'],desc:'Ultra-budget APU build for MOBA and esports. Walang GPU needed!'},
      {id:'c6',author:'WorkFromHomePH',name:'WFH Productivity Rig',total:45000,votes:98,purpose:'productivity',tier:'performance',items:['Intel Core i7-12700K','Netac 8GB DDR4','EVM 480GB SSD'],desc:'Fast and quiet for remote work, video calls, and light editing.'}
    ];
    var VOTES = {};
    try { VOTES = JSON.parse(localStorage.getItem('bm-votes')||'{}'); } catch(e){}
    var tierColors = {budget:'#22C55E',performance:'#3B82F6',highend:CYAN};
    var purposeIcons = {gaming:'\ud83c\udfae',productivity:'\ud83d\udcbc',streaming:'\ud83d\udce1'};
    function renderCards(filter) {
      var body = document.querySelector('#bmCommunityModal .bm-cm-body');
      if (!body) return;
      var list = filter==='all'?BUILDS:BUILDS.filter(function(b){return b.purpose===filter||b.tier===filter;});
      if (!list.length){body.innerHTML='<p style="color:#5a8aaa;padding:20px;text-align:center;">No builds match.</p>';return;}
      body.innerHTML = list.map(function(b){
        var voted=VOTES[b.id], votes=b.votes+(voted?1:0), col=tierColors[b.tier]||CYAN;
        return '<div style="background:rgba(0,212,255,0.03);border:1px solid rgba(0,212,255,0.1);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px;">' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
          '<span style="font-size:9px;font-weight:700;letter-spacing:.06em;padding:2px 8px;border-radius:20px;border:1px solid;color:'+col+';border-color:'+col+'40;">'+b.tier.toUpperCase()+'</span>' +
          '<span style="font-size:10px;color:#5a8aaa;">'+(purposeIcons[b.purpose]||'')+' '+b.purpose+'</span></div>' +
          '<div style="font-size:14px;font-weight:700;color:#D8EEFF;">'+esc(b.name)+'</div>' +
          '<div style="font-size:11px;color:#2a4560;">by '+esc(b.author)+'</div>' +
          '<div style="font-size:12px;color:#5a8aaa;line-height:1.4;">'+esc(b.desc)+'</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:4px;">'+b.items.map(function(i){return '<span style="font-size:10px;background:rgba(0,212,255,0.07);color:#5a8aaa;padding:2px 7px;border-radius:4px;border:1px solid rgba(0,212,255,0.1);">'+esc(i)+'</span>';}).join('')+'</div>' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;">' +
          '<span style="font-size:14px;font-weight:700;color:'+CYAN+';">\u20b1'+b.total.toLocaleString()+'</span>' +
          '<button data-id="'+b.id+'" style="background:transparent;border:1px solid '+(voted?'#EF4444':'rgba(0,212,255,0.2)')+';color:'+(voted?'#EF4444':CYAN)+';padding:5px 12px;border-radius:20px;font-size:12px;cursor:pointer;">\u2665 '+votes+'</button>' +
          '</div></div>';
      }).join('');
      body.querySelectorAll('button[data-id]').forEach(function(btn){
        btn.addEventListener('click',function(){
          var id=this.dataset.id;
          if(VOTES[id]) delete VOTES[id]; else VOTES[id]=1;
          localStorage.setItem('bm-votes',JSON.stringify(VOTES));
          renderCards(document.querySelector('#bmCommunityModal .bm-fp.active')?.dataset.filter||'all');
        });
      });
    }
    var filters=['all','gaming','productivity','streaming','budget','performance','highend'];
    var pills=filters.map(function(f){
      return '<button class="bm-fp" data-filter="'+f+'" style="background:rgba(0,212,255,0.04);border:1px solid rgba(0,212,255,0.1);color:#5a8aaa;padding:5px 12px;border-radius:20px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;transition:all 0.15s;">'+f.charAt(0).toUpperCase()+f.slice(1)+'</button>';
    }).join('');
    var body2 = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;" id="bmCmFilters">'+pills+'</div>' +
      '<div class="bm-cm-body" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px;max-height:460px;overflow-y:auto;"></div>';
    document.body.insertAdjacentHTML('beforeend', bmModal('bmCommunityModal','\ud83c\udfc6 Community Showcase', body2, '680px'));
    closeOnBackdrop('bmCommunityModal');
    document.querySelectorAll('#bmCommunityModal .bm-fp').forEach(function(btn){
      btn.addEventListener('click',function(){
        document.querySelectorAll('#bmCommunityModal .bm-fp').forEach(function(b){
          b.style.background='rgba(0,212,255,0.04)';b.style.borderColor='rgba(0,212,255,0.1)';b.style.color='#5a8aaa';
        });
        this.style.background='rgba(0,212,255,0.12)';this.style.borderColor='rgba(0,212,255,0.4)';this.style.color=CYAN;
        renderCards(this.dataset.filter);
      });
    });
    var first=document.querySelector('#bmCommunityModal .bm-fp');
    if(first){first.style.background='rgba(0,212,255,0.12)';first.style.borderColor='rgba(0,212,255,0.4)';first.style.color=CYAN;}
    renderCards('all');
  };

  function bmModal(id, title, bodyHtml, maxWidth) {
    return '<div class="bm-price-modal-backdrop" id="'+id+'">' +
      '<div class="bm-price-modal" style="max-width:'+(maxWidth||'460px')+';width:95%;">' +
      '<div class="bm-price-modal-header">'+esc(title)+
        '<button onclick="document.getElementById(\''+id+'\').remove()" class="bm-modal-close">\u00d7</button></div>' +
      '<div class="bm-price-modal-body">'+bodyHtml+'</div>' +
      '</div></div>';
  }

  var _origUpdate = typeof updateBuildDisplay === 'function' ? updateBuildDisplay : null;
  if (_origUpdate) {
    var _wrappedUpdate = function() {
      _origUpdate.apply(this, arguments);
      window.selectedItems = selectedItems;
      window.currentTotal = currentTotal;
      if (typeof window.updateWattageBar === 'function') window.updateWattageBar();
      if (typeof window.checkBottleneck === 'function') window.checkBottleneck();
    };
    window.updateBuildDisplay = _wrappedUpdate;
    updateBuildDisplay = _wrappedUpdate;
  }

})();
