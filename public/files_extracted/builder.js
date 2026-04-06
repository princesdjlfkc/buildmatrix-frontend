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
        console.log("✅ Your reset token:", data.devToken);
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
  console.log('🎯 Filtering category:', category);
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
    if (typeof window.addRecentlyViewed === 'function') window.addRecentlyViewed({ name, price, category });
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
    document.getElementById("fpsPanel").style.display = "none";
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
  if (typeof window.checkBottleneck === 'function') window.checkBottleneck();
  setTimeout(() => { if (typeof window.injectPriceCompareTips === 'function') window.injectPriceCompareTips(); }, 100);
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
} {
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
  const element = document.getElementById("buildSidebar");
  html2canvas(element, { scale: 2, backgroundColor: document.body.classList.contains("dark-mode") ? "#1e1e1e" : "#ffffff", logging: false, allowTaint: false, useCORS: true })
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
  const element = document.getElementById("buildSidebar");
  html2canvas(element, { scale: 2, backgroundColor: document.body.classList.contains("dark-mode") ? "#1e1e1e" : "#ffffff", logging: false, allowTaint: false, useCORS: true })
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

async function initBuilderPage() {
  initDarkModeToggle();
  await syncUserFromSession();
  updateAuthUI();
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
window.filterCategory = filterCategory;
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

// ============ PRODUCT VIEWER WITH WORKING CATEGORIES ============
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
    if (main.querySelector(".products-filterbar")) return;
    const bar = document.createElement("div");
    bar.className = "products-filterbar";
    bar.innerHTML = `<div class="pill" style="flex:1; min-width:260px;"><i class="fas fa-search"></i><input id="bmSearch" type="text" placeholder="Search for products" /></div>
      <div class="pill"><i class="fas fa-filter"></i><select id="bmBrand"><option value="all">All Brands</option></select></div>
      <button class="dark-mode-toggle" id="bmClearFilters" type="button" style="white-space:nowrap;">Clear filters</button>`;
    main.prepend(bar);
    const search = bar.querySelector("#bmSearch");
    const brand = bar.querySelector("#bmBrand");
    const clear = bar.querySelector("#bmClearFilters");
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
    main.innerHTML = `<div><h2 style="margin: 0 0 10px;">${categoryTitle(category)}</h2><div id="bmGrid" class="products-grid"></div></div>`;
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
      const badgeClass = p.tier === "budget" ? "badge-budget" : (p.tier === "performance" ? "badge-performance" : "badge-premium");
      const bmScore = window.getBMScore(p);
      const valueScore = window.getValueScore(p);
      return `<div class="product-card" ${dataAttrs}><div class="product-image"><img src="${img}" alt="" onerror="this.src='assets/placeholder.svg'"/></div>
        <div class="product-info"><h3>${escapeHtml(String(p.name||""))}</h3><p>${escapeHtml(specs)}</p><div class="product-price">₱${price.toLocaleString()}</div>${tier ? `<span class="badge ${badgeClass}">${escapeHtml(tier)}</span>` : ""}
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
  window.filterCategory = function(category) { renderCategoryView(category); };
  window.showAllProducts = function() { renderCategoryView("cpu"); };

  document.addEventListener("DOMContentLoaded", function() {
    setTimeout(() => { renderCategoryView("cpu"); }, 100);
    // Fix category buttons
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
window.runCompare = function() { showToast("Compare feature coming soon!"); };
window.generateAutoBuild = function() { showToast("Auto Build feature coming soon!"); };
window.applyAutoBuild = function() { showToast("Auto Build feature coming soon!"); };
window.swapCompare = function() { showToast("Swap feature coming soon!"); };
window.applyTemplate = function(template) { showToast(`Template: ${template}`); };
window.copyShareLink = function() { showToast("Share link copied!"); };

async function runJavaScore() {
  const listDiv = document.getElementById("compatibilityList");
  const panel = document.getElementById("compatibilityPanel");
  if (!listDiv || !panel) return;
  listDiv.innerHTML = '<div style="color: var(--text-secondary);">⏳ Analyzing build compatibility...</div>';
  panel.style.display = "block";
  const cpu = selectedItems.find(i => i.category === 'cpu');
  const motherboard = selectedItems.find(i => i.category === 'motherboard');
  const gpu = selectedItems.find(i => i.category === 'gpu');
  const psu = selectedItems.find(i => i.category === 'psu');
  const pcCase = selectedItems.find(i => i.category === 'case');
  if (!cpu || !motherboard) { listDiv.innerHTML = '<div style="color: var(--critical);">❌ Please add CPU and Motherboard first</div>'; return; }
  const socketMatch = (cpu.dataset?.socket === motherboard.dataset?.socket);
  const cpuTdp = parseInt(cpu.dataset?.tdp || 0);
  const gpuTdp = parseInt(gpu?.dataset?.tdp || 0);
  const psuWattage = parseInt(psu?.dataset?.wattage || 0);
  const powerOk = (cpuTdp + gpuTdp + 100) <= psuWattage;
  const gpuLength = parseInt(gpu?.dataset?.length || 0);
  const caseMaxLength = parseInt(pcCase?.dataset?.maxGpuLength || 0);
  const gpuFits = gpuLength <= caseMaxLength;
  const url = `/api/java/build-score?socketMatch=${socketMatch}&ramMatch=true&powerOk=${powerOk}&gpuFits=${gpuFits}`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    if (data.success) {
      let resultsHtml = '<div style="margin-bottom: 12px;"><strong>🔍 Build Compatibility Analysis</strong></div>';
      const scoreMatch = data.result.match(/Score: (\d+)\/100/);
      if (scoreMatch) {
        const score = parseInt(scoreMatch[1]);
        let scoreColor = score >= 80 ? 'var(--success)' : score >= 60 ? 'var(--warning)' : 'var(--critical)';
        resultsHtml += `<div class="bm-stat" style="margin-bottom: 12px;"><span><b>Overall Score</b></span><span style="color: ${scoreColor}; font-weight: 900;">${score}/100</span></div>`;
      }
      if (data.result.includes('Breakdown:')) {
        resultsHtml += `<div style="margin: 12px 0 8px 0; font-weight: 600;">📋 Issues Found:</div>`;
        if (!socketMatch) resultsHtml += `<div class="warning-item critical-item"><i class="fas fa-times-circle"></i> <div>❌ CPU socket (${cpu.dataset?.socket}) does not match motherboard (${motherboard.dataset?.socket})</div></div>`;
        if (!powerOk) resultsHtml += `<div class="warning-item critical-item"><i class="fas fa-times-circle"></i> <div>⚡ Power insufficient: ${cpuTdp + gpuTdp + 100}W needed, PSU provides ${psuWattage}W</div></div>`;
        if (!gpuFits && gpuLength > 0 && caseMaxLength > 0) resultsHtml += `<div class="warning-item critical-item"><i class="fas fa-times-circle"></i> <div>📏 GPU length (${gpuLength}mm) exceeds case max (${caseMaxLength}mm)</div></div>`;
      }
      if (socketMatch && powerOk && gpuFits) resultsHtml += `<div style="margin: 12px 0;"><i class="fas fa-check-circle" style="color: var(--success);"></i> ✅ All components are compatible!</div>`;
      resultsHtml += `<div style="margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--border); font-size: 0.85rem; color: var(--text-muted);"><i class="fas fa-info-circle"></i> Java-powered compatibility analysis</div>`;
      listDiv.innerHTML = resultsHtml;
    } else { listDiv.innerHTML = '<div style="color: var(--critical);">❌ Failed to analyze build</div>'; }
  } catch (err) { listDiv.innerHTML = `<div style="color: var(--critical);">❌ Error: ${err.message}</div>`; }
}

async function runJavaBudget() {
  const listDiv = document.getElementById("compatibilityList");
  const panel = document.getElementById("compatibilityPanel");
  if (!listDiv || !panel) return;
  const budget = prompt("Enter your budget for PC build (₱):", "50000");
  if (!budget) return;
  listDiv.innerHTML = '<div style="color: var(--text-secondary);">⏳ Calculating budget allocation...</div>';
  panel.style.display = "block";
  try {
    const response = await fetch(`/api/java/budget?budget=${budget}`);
    const data = await response.json();
    if (data.success) {
      let resultsHtml = '<div style="margin-bottom: 12px;"><strong>💰 Budget Allocation Guide</strong></div>';
      const lines = data.result.split('\n');
      lines.forEach(line => {
        if (line.includes('CPU:')) resultsHtml += `<div class="bm-stat" style="margin-bottom: 8px;"><span><b>🖥️ CPU</b></span><span>${line}</span></div>`;
        else if (line.includes('GPU:')) resultsHtml += `<div class="bm-stat" style="margin-bottom: 8px;"><span><b>🎮 GPU</b></span><span>${line}</span></div>`;
        else if (line.includes('Motherboard:')) resultsHtml += `<div class="bm-stat" style="margin-bottom: 8px;"><span><b>🔧 Motherboard</b></span><span>${line}</span></div>`;
        else if (line.includes('RAM:')) resultsHtml += `<div class="bm-stat" style="margin-bottom: 8px;"><span><b>💾 RAM</b></span><span>${line}</span></div>`;
        else if (line.includes('Storage:')) resultsHtml += `<div class="bm-stat" style="margin-bottom: 8px;"><span><b>💽 Storage</b></span><span>${line}</span></div>`;
        else if (line.includes('PSU:')) resultsHtml += `<div class="bm-stat" style="margin-bottom: 8px;"><span><b>⚡ Power Supply</b></span><span>${line}</span></div>`;
        else if (line.includes('Case:')) resultsHtml += `<div class="bm-stat" style="margin-bottom: 8px;"><span><b>📦 Case</b></span><span>${line}</span></div>`;
      });
      resultsHtml += `<div style="margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--border); font-size: 0.85rem; color: var(--text-muted);"><i class="fas fa-info-circle"></i> Suggested allocation based on PC building best practices</div>`;
      listDiv.innerHTML = resultsHtml;
    } else { listDiv.innerHTML = '<div style="color: var(--critical);">❌ Failed to get budget allocation</div>'; }
  } catch (err) { listDiv.innerHTML = `<div style="color: var(--critical);">❌ Error: ${err.message}</div>`; }
}

window.runJavaScore = runJavaScore;
window.runJavaBudget = runJavaBudget;