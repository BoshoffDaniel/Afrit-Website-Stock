(function () {
  "use strict";
  const byId = (id) => document.getElementById(id);
  const escapeHtml = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const debounce = (fn, wait) => {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  };

  function uploadPublicUrl(name, bust) {
    const path = `/static/uploads/${encodeURIComponent(name)}${bust ? `?t=${Date.now()}` : ""}`;
    return typeof window.cmPath === "function" ? window.cmPath(path) : path;
  }

  const parseSaveResponse = async (res) => {
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (!res.ok && !ct.includes("application/json")) {
      const txt = await res.text();
      throw new Error((txt && txt.slice(0, 280).replace(/\s+/g, " ").trim()) || `Request failed (${res.status})`);
    }
    if (!ct.includes("application/json")) {
      const txt = await res.text();
      throw new Error((txt && txt.slice(0, 280).replace(/\s+/g, " ").trim()) || "Server did not return JSON");
    }
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  };

  const CATALOGUE_RETURN_KEY = "cmCatalogueReturn";

  function getCatalogueReturn() {
    try {
      return JSON.parse(sessionStorage.getItem(CATALOGUE_RETURN_KEY) || "null");
    } catch (_e) {
      return null;
    }
  }

  function setCatalogueReturn(obj) {
    try {
      sessionStorage.setItem(CATALOGUE_RETURN_KEY, JSON.stringify(obj || {}));
    } catch (_e) {}
  }

  function currentHubPage() {
    const n = parseInt(new URLSearchParams(window.location.search).get("page") || "1", 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function productIdFromHref(href) {
    const m = String(href || "").match(/\/product\/(\d+)/);
    return m ? m[1] : "";
  }

  function captureCatalogueReturnFromHub(productId) {
    const tbody = byId("hubProductsTbody");
    const categoryFilter = byId("hubCategoryFilter");
    const statusFilter = byId("hubStatusFilter");
    const supplierFilter = byId("hubSupplierFilter");
    const searchInput = byId("hubSearchInput");
    const prev = getCatalogueReturn() || {};
    const listIds = tbody
      ? Array.from(tbody.querySelectorAll("tr[data-id]"))
          .filter((row) => !row.classList.contains("is-filtered-out") && row.style.display !== "none")
          .map((row) => String(row.dataset.id || ""))
          .filter(Boolean)
      : [];
    const pid = productId ? String(productId) : "";
    setCatalogueReturn({
      category: categoryFilter ? categoryFilter.value || "" : "",
      status: statusFilter ? statusFilter.value || "" : "",
      supplier: supplierFilter ? supplierFilter.value || "" : "",
      q: searchInput ? (searchInput.value || "").trim() : "",
      listIds: listIds,
      page: currentHubPage(),
      scrollY: window.scrollY || 0,
      productId: pid || prev.productId || "",
    });
  }

  function buildCatalogueReturnUrl(selectedId, fallbackNextId) {
    const ctx = getCatalogueReturn() || {};
    let highlightId = selectedId || ctx.productId || "";
    if (!highlightId && Array.isArray(ctx.listIds) && ctx.listIds.length && fallbackNextId) {
      highlightId = fallbackNextId;
    }
    const params = new URLSearchParams();
    const page = parseInt(ctx.page, 10);
    if (Number.isFinite(page) && page >= 1) params.set("page", String(page));
    if (highlightId) {
      params.set("highlight", String(highlightId));
      params.set("selected", String(highlightId));
    }
    if (ctx.category) params.set("category", ctx.category);
    if (ctx.status) params.set("status", ctx.status);
    if (ctx.supplier) params.set("supplier", ctx.supplier);
    if (ctx.q) params.set("q", ctx.q);
    const qs = params.toString();
    const path = "/products" + (qs ? "?" + qs : "");
    return typeof window.cmPath === "function" ? window.cmPath(path) : path;
  }

  window.getCatalogueReturn = getCatalogueReturn;
  window.buildCatalogueReturnUrl = buildCatalogueReturnUrl;

  function nextIdInCatalogueReturn(currentId, fallbackNextId) {
    const ctx = getCatalogueReturn();
    if (ctx && Array.isArray(ctx.listIds) && ctx.listIds.length) {
      const ids = ctx.listIds.map(String);
      const i = ids.indexOf(String(currentId));
      if (i >= 0 && i < ids.length - 1) return ids[i + 1];
      if (i === ids.length - 1) return ids[0];
    }
    return fallbackNextId ? String(fallbackNextId) : String(currentId);
  }

  function nextVisibleHubProductId(currentId) {
    const list = byId("hubProductList");
    if (!list) return null;
    const items = Array.from(list.querySelectorAll(".products-grid-item:not(.hidden), .products-list-item:not(.hidden)"));
    if (!items.length) return null;
    const i = items.findIndex((li) => String(li.dataset.id) === String(currentId));
    if (i < 0) return items[0].dataset.id;
    if (i < items.length - 1) return items[i + 1].dataset.id;
    return items[0].dataset.id;
  }

  function hubUrlForProduct(productId) {
    const path = "/product/" + encodeURIComponent(String(productId || ""));
    return typeof window.cmPath === "function" ? window.cmPath(path) : path;
  }

  let adminModalPromiseResolve = null;

  function openAdminModal() {
    const modal = byId("adminModal");
    const pwd = byId("adminModalPassword");
    const err = byId("adminModalError");
    if (!modal || !pwd) return Promise.resolve(false);
    err.classList.add("hidden");
    err.textContent = "";
    pwd.value = "";
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    pwd.focus();
    return new Promise((resolve) => {
      adminModalPromiseResolve = resolve;
    });
  }

  function closeAdminModal(result) {
    const modal = byId("adminModal");
    if (modal) {
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
    }
    if (adminModalPromiseResolve) {
      adminModalPromiseResolve(!!result);
      adminModalPromiseResolve = null;
    }
  }

  function wireAdminModalOnce() {
    const unlock = byId("adminModalUnlock");
    const cancel = byId("adminModalCancel");
    const pwd = byId("adminModalPassword");
    const err = byId("adminModalError");
    if (!unlock || unlock.dataset.wired) return;
    unlock.dataset.wired = "1";
    unlock.addEventListener("click", async () => {
      err.classList.add("hidden");
      const res = await fetch("/api/admin/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwd.value || "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        closeAdminModal(true);
        return;
      }
      err.textContent = data.error || "Incorrect password";
      err.classList.remove("hidden");
    });
    cancel.addEventListener("click", () => closeAdminModal(false));
    byId("adminModal").querySelector(".admin-modal-backdrop").addEventListener("click", () => closeAdminModal(false));
    pwd.addEventListener("keydown", (e) => {
      if (e.key === "Enter") unlock.click();
    });
  }

  window.showAdminUnlock = function () {
    return Promise.resolve(true);
  };

  window.fetchWithAdmin = async function (url, options, retries) {
    const opts = options || {};
    const res = await fetch(url, opts);
    let data = {};
    try {
      data = await res.json();
    } catch (_) {
      data = {};
    }
    return { res, data };
  };

  document.addEventListener("DOMContentLoaded", function () {});

  window.initHeaderPushAll = function () {
    const pushAllBtn = byId("pushAllBtn");
    const batchWrap = byId("batchPushProgress");
    const batchBar = byId("batchPushBar");
    const batchText = byId("batchPushText");
    if (!pushAllBtn || !batchWrap || !batchBar || pushAllBtn.dataset.bound) return;
    pushAllBtn.dataset.bound = "1";
    const poll = async () => {
      const res = await fetch("/api/push-progress");
      const p = await res.json();
      const done = (p.pushed || 0) + (p.failed || 0);
      const pct = p.total ? Math.round((done / p.total) * 100) : 0;
      batchBar.style.width = `${pct}%`;
      batchText.textContent = `Pushed ${p.pushed || 0}, failed ${p.failed || 0}, current ${p.current || "-"}`;
      if (!p.running) setTimeout(() => window.location.reload(), 900);
    };
    pushAllBtn.addEventListener("click", async () => {
      pushAllBtn.disabled = true;
      batchWrap.classList.remove("hidden");
      const res = await fetch("/api/push-all-to-shopify", { method: "POST" });
      const data = await res.json();
      if (!data.success) {
        batchText.textContent = data.error || "Failed to start push";
        pushAllBtn.disabled = false;
        return;
      }
      poll();
      const timer = setInterval(async () => {
        await poll();
        const r = await fetch("/api/push-progress");
        const d = await r.json();
        if (!d.running) clearInterval(timer);
      }, 1000);
    });
  };

  window.initDashboard = function () {
    const table = byId("productsTable");
    if (!table) return;
    const rows = Array.from(table.querySelectorAll("tbody tr"));
    const countEl = byId("resultsCount");
    const doneEl = byId("resultsDone");
    const pendingEl = byId("resultsPending");
    const searchInput = byId("searchInput");
    const categoryFilter = byId("categoryFilter");
    const statusFilter = byId("statusFilter");
    const applyFilters = () => {
      const q = (searchInput.value || "").toLowerCase().trim();
      const c = (categoryFilter.value || "").toLowerCase();
      const s = (statusFilter.value || "").toLowerCase();
      let visible = 0;
      let done = 0;
      let pending = 0;
      rows.forEach((row) => {
        const hay = `${row.dataset.stock} ${row.dataset.name} ${row.dataset.category}`;
        const qOk = !q || hay.includes(q);
        const cOk = !c || (c === "__empty__" ? row.dataset.uncategorised === "1" : row.dataset.category === c);
        const sOk = !s || (s === "pushed" ? row.dataset.pushed === "1" : row.dataset.status === s);
        const show = qOk && cOk && sOk;
        row.style.display = show ? "" : "none";
        if (show) {
          visible += 1;
          if ((row.dataset.status || "").toLowerCase() === "done") done += 1;
          else pending += 1;
        }
      });
      if (countEl) countEl.textContent = String(visible);
      if (doneEl) doneEl.textContent = String(done);
      if (pendingEl) pendingEl.textContent = String(pending);
    };
    searchInput.addEventListener("input", applyFilters);
    categoryFilter.addEventListener("change", applyFilters);
    statusFilter.addEventListener("change", applyFilters);
    applyFilters();
  };

  window.initSettingsPage = function () {
    const gateBtn = byId("openSettingsGateBtn");
    if (gateBtn) {
      const msg = byId("settingsGateMsg");
      gateBtn.addEventListener("click", async () => {
        const ok = await window.showAdminUnlock();
        if (ok) window.location.reload();
        else if (msg) msg.textContent = "Unlock cancelled.";
      });
      return;
    }

    const saveBtn = byId("saveSettingsBtn");
    if (!saveBtn) return;
    const status = byId("settingsStatus");
    const rembgStatus = byId("rembgStatus");
    const groqStatus = byId("groqStatus");
    const anthropicStatus = byId("anthropicStatus");
    const serperImageStatus = byId("serperImageStatus");
    const toggle = (id, target) => byId(id) && byId(id).addEventListener("click", () => {
      const el = byId(target);
      el.type = el.type === "password" ? "text" : "password";
    });
    toggle("toggleApiKeyBtn", "shopify_api_key");
    toggle("toggleGroqKeyBtn", "groq_api_key");
    toggle("toggleAnthropicKeyBtn", "anthropic_api_key");
    toggle("toggleSerperKeyBtn", "serper_api_key");

    const savePayload = () => {
      const payload = {
        shopify_store_url: byId("shopify_store_url") ? byId("shopify_store_url").value : "",
        products_total_target: byId("products_total_target") ? byId("products_total_target").value : "0",
        enhance_on_import: byId("enhance_on_import") ? byId("enhance_on_import").value : "0",
        enhance_service_url: byId("enhance_service_url") ? byId("enhance_service_url").value : "",
        company_name: byId("company_name") ? byId("company_name").value : "",
        catalog_name: byId("catalog_name") ? byId("catalog_name").value : "",
      };
      // Only send API keys when the user typed a new value — blank keeps the saved key.
      const maybeSecret = (id, key) => {
        const el = byId(id);
        if (!el) return;
        const val = (el.value || "").trim();
        if (val) payload[key] = val;
      };
      maybeSecret("shopify_api_key", "shopify_api_key");
      maybeSecret("groq_api_key", "groq_api_key");
      maybeSecret("anthropic_api_key", "anthropic_api_key");
      maybeSecret("serper_api_key", "serper_api_key");
      maybeSecret("enhance_service_token", "enhance_service_token");
      return payload;
    };

    const doSave = async () => {
      const { res, data } = await window.fetchWithAdmin("/settings/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(savePayload()),
      });
      return { res, data };
    };

    const markKeySaved = (id, saved) => {
      const el = byId(id);
      if (!el) return;
      el.dataset.keySet = saved ? "1" : "0";
      if (saved && !(el.value || "").trim()) {
        el.placeholder = "•••••••• (saved — leave blank to keep)";
      }
    };

    const applySaveResult = (data, statusEl) => {
      const el = statusEl || status;
      if (!data.success) {
        if (el) {
          el.textContent = data.error || "Save failed";
          el.className = "save-status error";
        }
        return false;
      }
      document.querySelectorAll(".js-settings-status").forEach((node) => {
        node.textContent = "Saved.";
        node.className = "save-status ok";
      });
      if (status) {
        status.textContent = "Saved settings.";
        status.className = "save-status ok";
      }
      if (data.groq_api_key_set != null) markKeySaved("groq_api_key", !!data.groq_api_key_set);
      if (data.serper_api_key_set != null) markKeySaved("serper_api_key", !!data.serper_api_key_set);
      if (data.shopify_api_key_set != null) markKeySaved("shopify_api_key", !!data.shopify_api_key_set);
      if (data.anthropic_api_key_set != null) markKeySaved("anthropic_api_key", !!data.anthropic_api_key_set);
      if (groqStatus) {
        const hasGroq =
          data.groq_api_key_set != null
            ? !!data.groq_api_key_set
            : (byId("groq_api_key") && byId("groq_api_key").dataset.keySet === "1") ||
              !!(byId("groq_api_key") && byId("groq_api_key").value.trim());
        groqStatus.textContent = hasGroq ? "Ready" : "Not configured";
        groqStatus.className = `status-pill ${hasGroq ? "ready" : "off"}`;
      }
      if (anthropicStatus && byId("anthropic_api_key")) {
        const hasAnthropic =
          data.anthropic_api_key_set != null
            ? !!data.anthropic_api_key_set
            : byId("anthropic_api_key").dataset.keySet === "1" ||
              !!(byId("anthropic_api_key").value || "").trim();
        anthropicStatus.textContent = hasAnthropic ? "Ready" : "Not configured";
        anthropicStatus.className = `status-pill ${hasAnthropic ? "ready" : "off"}`;
      }
      if (serperImageStatus && byId("serper_api_key")) {
        const hasSerper =
          data.serper_api_key_set != null
            ? !!data.serper_api_key_set
            : byId("serper_api_key").dataset.keySet === "1" ||
              !!(byId("serper_api_key").value || "").trim();
        serperImageStatus.textContent = hasSerper ? "Find ready" : "Not configured";
        serperImageStatus.className = `status-pill ${hasSerper ? "ready" : "off"}`;
      }
      // Clear newly typed secrets from the form after save so they aren't re-sent; keep "saved" state.
      ["shopify_api_key", "groq_api_key", "anthropic_api_key", "serper_api_key"].forEach((id) => {
        const field = byId(id);
        if (field && (field.value || "").trim()) field.value = "";
      });
      return true;
    };

    document.querySelectorAll(".js-save-settings").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const localStatus =
          btn.closest(".settings-panel") &&
          btn.closest(".settings-panel").querySelector(".js-settings-status");
        if (localStatus) {
          localStatus.textContent = "Saving...";
          localStatus.className = "save-status";
        } else if (status) {
          status.textContent = "Saving...";
        }
        const { data } = await doSave();
        applySaveResult(data, localStatus || status);
      });
    });

    // LDAP + staff users (Catalog Manager Settings)
    const ldapStatus = byId("ldapStatus");
    const staffStatus = byId("staffUsersStatus");
    const staffLists = document.querySelectorAll(".staff-users-list");

    const ldapPayload = () => {
      const payload = {
        ldap_enabled: byId("ldap_enabled") && byId("ldap_enabled").checked ? "1" : "0",
        ldap_host: byId("ldap_host") ? byId("ldap_host").value : "",
        ldap_port: byId("ldap_port") ? String(byId("ldap_port").value || "389") : "389",
        ldap_base_dn: byId("ldap_base_dn") ? byId("ldap_base_dn").value : "",
        ldap_bind_dn: byId("ldap_bind_dn") ? byId("ldap_bind_dn").value : "",
        ldap_user_filter: byId("ldap_user_filter")
          ? byId("ldap_user_filter").value
          : "(sAMAccountName={username})",
      };
      const pw = byId("ldap_bind_password") ? (byId("ldap_bind_password").value || "").trim() : "";
      if (pw) payload.ldap_bind_password = pw;
      return payload;
    };

    if (byId("saveLdapBtn")) {
      byId("saveLdapBtn").addEventListener("click", async () => {
        if (ldapStatus) {
          ldapStatus.textContent = "Saving…";
          ldapStatus.className = "save-status";
        }
        const { data } = await window.fetchWithAdmin("/settings/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ldapPayload()),
        });
        if (ldapStatus) {
          if (data.success) {
            ldapStatus.textContent = "LDAP settings saved.";
            ldapStatus.className = "save-status ok";
            if (byId("ldap_bind_password")) byId("ldap_bind_password").value = "";
          } else {
            ldapStatus.textContent = data.error || "Save failed";
            ldapStatus.className = "save-status error";
          }
        }
      });
    }

    if (byId("testLdapBtn")) {
      byId("testLdapBtn").addEventListener("click", async () => {
        if (ldapStatus) {
          ldapStatus.textContent = "Testing LDAP…";
          ldapStatus.className = "save-status";
        }
        const { data } = await window.fetchWithAdmin("/api/ldap-test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ldapPayload()),
        });
        if (ldapStatus) {
          if (data.success) {
            ldapStatus.textContent = "✓ " + (data.message || "Connection successful");
            ldapStatus.className = "save-status ok";
          } else {
            ldapStatus.textContent = "✗ " + (data.error || "Connection failed");
            ldapStatus.className = "save-status error";
          }
        }
      });
    }

    const roleLabel = { admin: "Administrator", editor: "Editor", viewer: "Viewer" };
    const normalizeRole = (role) => (role === "reviewer" ? "viewer" : role);

    const bindStaffRowActions = (root) => {
      root.querySelectorAll(".staff-role-select").forEach((sel) => {
        sel.addEventListener("change", async () => {
          await window.fetchWithAdmin(`/api/staff-users/${sel.dataset.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: sel.value }),
          });
          loadStaffUsers();
        });
      });
      root.querySelectorAll(".staff-toggle-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const activate = btn.dataset.active !== "1";
          if (!window.confirm(activate ? "Activate this user?" : "Deactivate this user?")) return;
          await window.fetchWithAdmin(`/api/staff-users/${btn.dataset.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: activate }),
          });
          loadStaffUsers();
        });
      });
    };

    const renderStaffUsers = (users) => {
      if (!staffLists.length) return;
      const byRole = { admin: [], editor: [], viewer: [] };
      (users || []).forEach((u) => {
        const role = normalizeRole(u.role);
        if (!byRole[role]) byRole[role] = [];
        byRole[role].push({ ...u, role });
      });
      staffLists.forEach((listEl) => {
        const role = listEl.dataset.role;
        const group = byRole[role] || [];
        if (!group.length) {
          listEl.innerHTML = `<p class="sub">No ${roleLabel[role] || role}s yet.</p>`;
          return;
        }
        listEl.innerHTML = group
          .map((u) => {
            const roleOpts = ["admin", "editor", "viewer"]
              .map(
                (r) =>
                  `<option value="${r}"${u.role === r ? " selected" : ""}>${roleLabel[r]}</option>`
              )
              .join("");
            const display = u.display_name ? ` · ${u.display_name}` : "";
            const login = u.last_login_at ? `Last login: ${u.last_login_at}` : "Never signed in";
            return `<div class="staff-user-row" style="display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #eee;" data-id="${u.id}">
              <div>
                <div style="font-weight:700;font-size:15px;">${u.username}${display}</div>
                <div class="sub">${login} · LDAP${u.active ? "" : " · <strong style='color:#c62828'>Inactive</strong>"}</div>
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
                <select class="staff-role-select" data-id="${u.id}">${roleOpts}</select>
                <button type="button" class="btn btn-light btn-small staff-toggle-btn" data-id="${u.id}" data-active="${u.active ? "1" : "0"}">${u.active ? "Deactivate" : "Activate"}</button>
              </div>
            </div>`;
          })
          .join("");
        bindStaffRowActions(listEl);
      });
    };

    const loadStaffUsers = async () => {
      if (!staffLists.length) return;
      const { data } = await window.fetchWithAdmin("/api/staff-users");
      if (data.success) renderStaffUsers(data.users || []);
      else {
        staffLists.forEach((el) => {
          el.innerHTML = '<p class="sub" style="color:#c62828;">Could not load staff users.</p>';
        });
      }
    };

    // AD user dropdown (full list from LDAP)
    const adSelect = byId("staffAdSelect");
    const adHint = byId("staffAdHint");
    let adUsersByUsername = {};

    const fillAdUserSelect = (users) => {
      if (!adSelect) return;
      adUsersByUsername = {};
      const opts = ['<option value="">Select AD user…</option>'];
      (users || []).forEach((u) => {
        if (!u || !u.username) return;
        adUsersByUsername[u.username] = u;
        const label = escapeHtml(u.label || `${u.display_name || u.username} (${u.username})`);
        opts.push(`<option value="${escapeHtml(u.username)}">${label}</option>`);
      });
      adSelect.innerHTML = opts.join("");
      if (!(users || []).length) {
        adSelect.innerHTML = '<option value="">No AD users found</option>';
      }
    };

    const loadAdUsers = async () => {
      if (!adSelect) return;
      adSelect.disabled = true;
      adSelect.innerHTML = '<option value="">Loading AD users…</option>';
      if (adHint) adHint.textContent = "";
      try {
        const { data } = await window.fetchWithAdmin("/api/ldap-users?limit=500");
        if (!data.success) {
          adSelect.innerHTML = '<option value="">Could not load AD users</option>';
          if (adHint) adHint.textContent = data.error || "AD lookup failed";
          return;
        }
        fillAdUserSelect(data.users || []);
        if (adHint) {
          const n = (data.users || []).length;
          adHint.textContent = n ? `${n} AD user${n === 1 ? "" : "s"} available` : "No users in LDAP base DN";
        }
      } catch (err) {
        adSelect.innerHTML = '<option value="">Could not load AD users</option>';
        if (adHint) adHint.textContent = (err && err.message) || "AD lookup failed";
      } finally {
        adSelect.disabled = false;
      }
    };

    if (adSelect) loadAdUsers();

    if (byId("staffAddBtn")) {
      byId("staffAddBtn").addEventListener("click", async () => {
        const username = (adSelect && adSelect.value || "").trim();
        const picked = adUsersByUsername[username] || {};
        const displayName = (picked.display_name || username || "").trim();
        const role = (byId("staffAddRole") && byId("staffAddRole").value) || "editor";
        if (!username) {
          window.alert("Select an AD user from the dropdown first.");
          return;
        }
        const { data } = await window.fetchWithAdmin("/api/staff-users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username,
            display_name: displayName,
            role,
          }),
        });
        if (!data.success) {
          window.alert(data.error || "Could not add user");
          return;
        }
        if (adSelect) adSelect.value = "";
        if (staffStatus) {
          staffStatus.textContent = `Added ${username} as ${roleLabel[role] || role}.`;
          staffStatus.className = "save-status ok";
        }
        loadStaffUsers();
      });
    }
    if (staffLists.length) loadStaffUsers();

    const testBtn = byId("testShopifyBtn");
    testBtn.addEventListener("click", async () => {
      status.textContent = "Testing Shopify connection...";
      const { data } = await doSave();
      if (data.connected) {
        status.textContent = "Connected ✓";
        status.className = "save-status ok";
      } else {
        status.textContent = `Failed: ${data.message || data.error || "Unknown error"}`;
        status.className = "save-status error";
      }
    });

    byId("downloadRembgBtn").addEventListener("click", async () => {
      rembgStatus.textContent = "Downloading model...";
      const res = await fetch("/api/rembg-warmup", { method: "POST" });
      const data = await res.json();
      rembgStatus.textContent = data.success ? "Model ready ✓" : (data.error || "Download failed");
      rembgStatus.className = data.success ? "save-status ok" : "save-status error";
    });
  };

  window.initProductsHub = function (opts) {
    wireAdminModalOnce();
    const tab = (opts && opts.tab) || "products";
    if (tab === "categories") {
      const statusEl = byId("categoriesStatus");
      const addBtn = byId("addCategoryBtn");
      const postJson = async (url, body) => window.fetchWithAdmin(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (addBtn) {
        addBtn.addEventListener("click", async () => {
          const { data: st } = await fetch("/api/admin/status").then((r) => r.json());
          if (!st.admin) {
            const ok = await window.showAdminUnlock();
            if (!ok) return;
          }
          const name = window.prompt("New category name:");
          if (!name || !name.trim()) return;
          const { data } = await postJson("/api/categories", { name: name.trim() });
          if (!data.success) {
            statusEl.textContent = data.error || "Failed";
            statusEl.className = "save-status error";
            return;
          }
          window.location.reload();
        });
      }

      document.querySelectorAll(".js-rename-cat").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const { data: st } = await fetch("/api/admin/status").then((r) => r.json());
          if (!st.admin) {
            const ok = await window.showAdminUnlock();
            if (!ok) return;
          }
          const li = btn.closest(".categories-list-item");
          const id = parseInt(li.dataset.id, 10);
          const cur = li.dataset.name || "";
          const name = window.prompt("Rename category", cur);
          if (!name || !name.trim() || name.trim() === cur) return;
          const { data } = await postJson(`/api/categories/${id}`, { action: "rename", name: name.trim() });
          if (!data.success) {
            statusEl.textContent = data.error || "Failed";
            statusEl.className = "save-status error";
            return;
          }
          window.location.reload();
        });
      });

      document.querySelectorAll(".js-delete-cat").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (btn.disabled) return;
          const { data: st } = await fetch("/api/admin/status").then((r) => r.json());
          if (!st.admin) {
            const ok = await window.showAdminUnlock();
            if (!ok) return;
          }
          const li = btn.closest(".categories-list-item");
          const id = parseInt(li.dataset.id, 10);
          if (!window.confirm("Delete this empty category?")) return;
          const { data } = await postJson(`/api/categories/${id}`, { action: "delete" });
          if (!data.success) {
            statusEl.textContent = data.error || "Failed";
            statusEl.className = "save-status error";
            return;
          }
          window.location.reload();
        });
      });
      return;
    }

    const tbody = byId("hubProductsTbody");
    const table = byId("hubProductsTable");
    const searchInput = byId("hubSearchInput");
    const categoryFilter = byId("hubCategoryFilter");
    const statusFilter = byId("hubStatusFilter");
    const supplierFilter = byId("hubSupplierFilter");
    const listHint = byId("hubListHint");
    const filterForm = byId("hubFilterForm");
    const serverPaged = !!(opts && opts.serverPaged);

    const urlParams = new URLSearchParams(window.location.search);
    const urlCat = urlParams.get("category") || "";
    const urlStatus = urlParams.get("status") || "";
    const urlSupplier = urlParams.get("supplier") || "";
    const urlQ = urlParams.get("q") || "";
    if (!serverPaged) {
      if (categoryFilter && urlCat) categoryFilter.value = urlCat;
      if (statusFilter && urlStatus) statusFilter.value = urlStatus;
      if (supplierFilter && urlSupplier) supplierFilter.value = urlSupplier;
      if (searchInput && urlQ) searchInput.value = urlQ;
    }

    let hubSortCol = "stock_code";
    let hubSortDir = "asc";
    let hubRowsCache = null;

    function invalidateHubRowsCache() {
      hubRowsCache = null;
    }

    function getHubRows() {
      if (!tbody) return [];
      if (!hubRowsCache) {
        hubRowsCache = Array.from(tbody.querySelectorAll("tr[data-id]"));
      }
      return hubRowsCache;
    }

    function submitHubFilters() {
      if (!filterForm) return;
      // Drop empty fields so URLs stay clean
      Array.from(filterForm.elements).forEach((el) => {
        if (!el.name) return;
        if (el.tagName === "INPUT" || el.tagName === "SELECT") {
          if (!(el.value || "").trim()) el.disabled = true;
        }
      });
      filterForm.submit();
    }

    function hubThumbCellHtml(thumb, productId) {
      const href = hubUrlForProduct(productId);
      if (thumb) {
        const src =
          typeof window.cmPath === "function"
            ? window.cmPath(`/static/uploads/${encodeURIComponent(thumb)}`)
            : `/static/uploads/${encodeURIComponent(thumb)}`;
        return `<a href="${href}" class="dash-thumb-link"><img class="dash-thumb" src="${src}" alt="" loading="lazy" decoding="async"></a>`;
      }
      return `<a href="${href}" class="dash-thumb-link"><div class="dash-thumb placeholder">📷</div></a>`;
    }

    function hubStatusBadgeHtml(status) {
      const s = (status || "pending").toLowerCase();
      const label =
        s === "approved"
          ? "APPROVED"
          : s === "done"
            ? "DONE"
            : s === "revise"
              ? "REVISE"
              : s.toUpperCase();
      return `<span class="badge badge-${s}">${escapeHtml(label)}</span>`;
    }

    function hubShopifyDotHtml(p) {
      if (p.shopify_pushed) {
        return '<span class="shopify-dot green" title="Pushed to Shopify"></span>';
      }
      if (p.shopify_id) {
        return '<span class="shopify-dot orange" title="Linked on Shopify"></span>';
      }
      return '<span class="shopify-dot grey" title="Not on Shopify"></span>';
    }

    function hubCategoryCellHtml(category) {
      const cat = (category || "").trim();
      if (cat) return escapeHtml(cat);
      return '<span class="badge badge-uncategorised">Uncategorised</span>';
    }

    function hubSupplierCellHtml(supplier) {
      const s = (supplier || "").trim();
      if (!s) return '<span class="is-muted">—</span>';
      return `<span title="${escapeHtml(s)}">${escapeHtml(s)}</span>`;
    }

    function hubEditedCellHtml(editor) {
      const e = (editor || "").trim();
      if (!e) return '<span class="is-muted">—</span>';
      return escapeHtml(e);
    }

    function hubRowHtml(p) {
      const cat = (p.category || "").toLowerCase();
      const unc = (p.category || "").trim() ? "0" : "1";
      const status = (p.status || "pending").toLowerCase();
      const rowClass = `${status === "pending" ? "pending-row" : status === "revise" ? "revise-row" : status === "done" ? "ready-row" : "done-row"}${p.shopify_pushed ? " pushed-row" : ""}`;
      const photoCount = p.photo_count != null ? p.photo_count : 0;
      return `<tr class="${rowClass}"
        data-id="${p.id}"
        data-stock="${escapeHtml((p.stock_code || "").toLowerCase())}"
        data-name="${escapeHtml((p.name || "").toLowerCase())}"
        data-category="${escapeHtml(cat)}"
        data-supplier="${escapeHtml((p.supplier || "").toLowerCase())}"
        data-uncategorised="${unc}"
        data-status="${escapeHtml(status)}"
        data-pushed="${p.shopify_pushed ? "1" : "0"}"
        data-photo-count="${photoCount}"
        data-edited-by="${escapeHtml((p.last_edited_by || "").toLowerCase())}">
        <td>${hubThumbCellHtml(p.thumb, p.id)}</td>
        <td class="mono strong">${escapeHtml(p.stock_code || "")}</td>
        <td class="hub-col-name">${escapeHtml(p.name || "")}</td>
        <td>${hubCategoryCellHtml(p.category)}</td>
        <td class="hub-col-supplier">${hubSupplierCellHtml(p.supplier)}</td>
        <td class="hub-col-num">${photoCount}</td>
        <td>${hubStatusBadgeHtml(status)}</td>
        <td>${hubShopifyDotHtml(p)}</td>
        <td class="hub-col-edited">${hubEditedCellHtml(p.last_edited_by)}</td>
        <td><a class="btn btn-small btn-green open-btn" href="${hubUrlForProduct(p.id)}">Open</a></td>
      </tr>`;
    }

    function renderHubTableRows(items) {
      if (!tbody) return;
      invalidateHubRowsCache();
      if (!items.length) {
        tbody.innerHTML =
          '<tr class="hub-empty-row"><td colspan="10" class="sub">No products match your search. Try different keywords or filters.</td></tr>';
        return;
      }
      tbody.innerHTML = items.map(hubRowHtml).join("");
      invalidateHubRowsCache();
      applyHubSort();
      wireHubTableLinks();
    }

    function hubRowValue(row, col) {
      if (col === "photo_count") {
        return parseInt(row.dataset.photoCount || "0", 10) || 0;
      }
      if (col === "status") {
        return (row.dataset.status || "").toLowerCase();
      }
      if (col === "last_edited_by") {
        return (row.dataset.editedBy || "").toLowerCase();
      }
      if (col === "supplier") {
        return (row.dataset.supplier || "").toLowerCase();
      }
      if (col === "category") {
        return (row.dataset.category || "").toLowerCase();
      }
      if (col === "name") {
        return (row.dataset.name || "").toLowerCase();
      }
      return (row.dataset.stock || "").toLowerCase();
    }

    function applyHubSort() {
      if (!tbody || !table) return;
      const rows = getHubRows();
      if (!rows.length) return;
      const dir = hubSortDir === "desc" ? -1 : 1;
      const col = hubSortCol;
      rows.sort((a, b) => {
        const av = hubRowValue(a, col);
        const bv = hubRowValue(b, col);
        if (col === "photo_count") {
          return (av - bv) * dir;
        }
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });
      const frag = document.createDocumentFragment();
      rows.forEach((row) => frag.appendChild(row));
      tbody.appendChild(frag);
      hubRowsCache = rows;
      table.querySelectorAll(".hub-sortable").forEach((th) => {
        const active = th.dataset.sort === col;
        th.classList.toggle("is-asc", active && hubSortDir === "asc");
        th.classList.toggle("is-desc", active && hubSortDir === "desc");
        th.setAttribute("aria-sort", active ? (hubSortDir === "asc" ? "ascending" : "descending") : "none");
      });
    }

    function updateHubHint(visible, total, pending, ready, revise, approved, pushed, suffix) {
      if (!listHint) return;
      const extra = suffix || "";
      listHint.textContent = `Showing ${visible} products (${pending} pending, ${ready} done, ${revise} revise, ${approved} approved, ${pushed} pushed)${extra}`;
    }

    function countVisibleStats(rows) {
      let pending = 0;
      let ready = 0;
      let revise = 0;
      let approved = 0;
      let pushed = 0;
      rows.forEach((row) => {
        if (row.classList.contains("is-filtered-out")) return;
        const status = (row.dataset.status || "").toLowerCase();
        if (row.dataset.pushed === "1") pushed += 1;
        if (status === "approved") approved += 1;
        else if (status === "done") ready += 1;
        else if (status === "revise") revise += 1;
        else pending += 1;
      });
      return { pending, ready, revise, approved, pushed };
    }

    function applyClientFilters() {
      if (!tbody) return;
      const q = (searchInput.value || "").toLowerCase().trim();
      const c = (categoryFilter.value || "").toLowerCase();
      const s = (statusFilter.value || "").toLowerCase();
      const sup = supplierFilter ? (supplierFilter.value || "").toLowerCase() : "";
      const rows = getHubRows();
      let visible = 0;
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const hay = `${row.dataset.stock || ""} ${row.dataset.name || ""} ${row.dataset.category || ""} ${row.dataset.supplier || ""}`;
        const qOk = !q || hay.includes(q);
        const cOk = !c || (c === "__empty__" ? row.dataset.uncategorised === "1" : row.dataset.category === c);
        const sOk = !s || (s === "pushed" ? row.dataset.pushed === "1" : row.dataset.status === s);
        const supOk = !sup
          ? true
          : sup === "__empty__"
            ? !(row.dataset.supplier || "").trim()
            : row.dataset.supplier === sup;
        const show = qOk && cOk && sOk && supOk;
        row.classList.toggle("is-filtered-out", !show);
        if (show) visible += 1;
      }
      const stats = countVisibleStats(rows);
      const total = parseInt(tbody.dataset.productsTotal || String(rows.length), 10) || rows.length;
      updateHubHint(visible, total, stats.pending, stats.ready, stats.revise, stats.approved, stats.pushed, visible < total ? "" : "");
    }

    function wireHubTableLinks() {
      if (!tbody) return;
      tbody.querySelectorAll('a[href*="/product/"]').forEach((a) => {
        a.addEventListener("click", () => {
          captureCatalogueReturnFromHub(productIdFromHref(a.getAttribute("href")));
        });
      });
    }

    function restoreHubReturnRow() {
      if (!tbody) return;
      const params = new URLSearchParams(window.location.search);
      const ctx = getCatalogueReturn() || {};
      const rawId = params.get("highlight") || params.get("selected") || ctx.productId || "";
      const highlightId = String(rawId).replace(/[^\d]/g, "");
      if (!highlightId) return;
      const urlHasHighlight = !!(params.get("highlight") || params.get("selected"));
      const storedPage = parseInt(ctx.page, 10) || 1;
      if (!urlHasHighlight && storedPage !== currentHubPage()) return;
      const row = tbody.querySelector(`tr[data-id="${highlightId}"]`);
      if (!row) {
        if (ctx.scrollY) window.scrollTo(0, ctx.scrollY);
        return;
      }
      row.classList.add("is-return-highlight");
      row.setAttribute("tabindex", "-1");
      requestAnimationFrame(() => {
        try {
          row.scrollIntoView({ block: "center", behavior: "auto" });
        } catch (_e) {
          row.scrollIntoView(true);
        }
        try {
          row.focus({ preventScroll: true });
        } catch (_e2) {}
      });
      setCatalogueReturn({
        ...ctx,
        productId: highlightId,
        page: currentHubPage(),
        scrollY: window.scrollY || ctx.scrollY || 0,
      });
    }

    if (tbody && searchInput) {
      if (serverPaged && filterForm) {
        const debouncedSubmit = debounce(() => submitHubFilters(), 350);
        searchInput.addEventListener("input", debouncedSubmit);
        searchInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submitHubFilters();
          }
        });
        categoryFilter && categoryFilter.addEventListener("change", submitHubFilters);
        statusFilter && statusFilter.addEventListener("change", submitHubFilters);
        supplierFilter && supplierFilter.addEventListener("change", submitHubFilters);
        wireHubTableLinks();
        captureCatalogueReturnFromHub();
      } else {
        const applyImmediate = () => {
          applyClientFilters();
          captureCatalogueReturnFromHub();
        };
        const applySearchDebounced = debounce(() => {
          applyClientFilters();
          captureCatalogueReturnFromHub();
        }, 120);
        searchInput.addEventListener("input", applySearchDebounced);
        categoryFilter.addEventListener("change", applyImmediate);
        statusFilter.addEventListener("change", applyImmediate);
        if (supplierFilter) supplierFilter.addEventListener("change", applyImmediate);
        wireHubTableLinks();
        if (urlCat || urlStatus || urlSupplier || urlQ) {
          applyImmediate();
        } else {
          applyClientFilters();
          captureCatalogueReturnFromHub();
        }
      }
    }

    if (table) {
      table.querySelectorAll(".hub-sortable").forEach((th) => {
        th.addEventListener("click", () => {
          const col = th.dataset.sort || "stock_code";
          if (hubSortCol === col) {
            hubSortDir = hubSortDir === "asc" ? "desc" : "asc";
          } else {
            hubSortCol = col;
            hubSortDir = "asc";
          }
          applyHubSort();
        });
        th.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            th.click();
          }
        });
        th.setAttribute("tabindex", "0");
        th.setAttribute("role", "button");
      });
      applyHubSort();
    }

    document.querySelectorAll('a[href*="/product/"]').forEach((a) => {
      a.addEventListener("click", () => {
        captureCatalogueReturnFromHub(productIdFromHref(a.getAttribute("href")));
      });
    });

    restoreHubReturnRow();

    document.querySelectorAll(".js-admin-add-product").forEach((a) => {
      a.addEventListener("click", async (e) => {
        const { data } = await fetch("/api/admin/status").then((r) => r.json());
        if (!data.admin) {
          e.preventDefault();
          const ok = await window.showAdminUnlock();
          if (ok) window.location.href = a.getAttribute("href");
        }
      });
    });

    const submit = byId("createProductSubmitBtn");
    if (submit) {
      const err = byId("newProductError");
      submit.addEventListener("click", async () => {
        err.textContent = "";
        const payload = {
          stock_code: byId("new_stock_code").value,
          name: byId("new_name").value,
          category: byId("new_category").value,
          supplier: (byId("new_supplier") && byId("new_supplier").value) || "",
        };
        let { res, data } = await window.fetchWithAdmin("/api/products/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!data.success) {
          err.textContent = data.error || "Could not create product";
          return;
        }
        const nextUrl =
          typeof window.cmPath === "function"
            ? window.cmPath(`/product/${data.id}`)
            : `/product/${data.id}`;
        window.location.href = nextUrl;
      });
    }
  };

  window.initProductPage = function () {
    const page = byId("productPage");
    if (!page) return;
    const data = JSON.parse(byId("productData").textContent);
    const productId = data.id;
    console.log("[initProductPage] load", { productId, PRODUCT_ID: window.PRODUCT_ID });
    const embed = page.dataset.embed === "1";
    if (embed && window.parent && window.parent !== window) {
      if (typeof window.parent.showAdminUnlock === "function") {
        window.showAdminUnlock = window.parent.showAdminUnlock.bind(window.parent);
      }
      if (typeof window.parent.fetchWithAdmin === "function") {
        window.fetchWithAdmin = window.parent.fetchWithAdmin.bind(window.parent);
      }
    }
    let productStatus = ["pending", "done", "approved", "revise"].includes(String(data.status || "").toLowerCase())
      ? String(data.status).toLowerCase()
      : "pending";
    let photos = Array.isArray(data.photos) ? data.photos.slice() : [];
    let reviseChecklist = Array.isArray(data.revise_checklist) ? data.revise_checklist.slice() : [];
    let reviseComments = String(data.revise_comments || "");
    let reviseBy = String(data.revise_by || "");
    let reviseAt = data.revise_at || null;
    let dragged = null;
    let isDirty = false;
    let isSaving = false;
    const lightbox = createLightbox();
    const canEdit = !!byId("saveBtn");

    const markDirty = () => {
      if (!canEdit) return;
      isDirty = true;
    };
    const markClean = () => {
      isDirty = false;
    };

    const syncDataLabels = () => {
      const scEl = byId("stock_code");
      const nmEl = byId("name");
      const catEl = byId("category");
      const supEl = byId("supplier");
      const sc = scEl ? scEl.value : "";
      const nm = nmEl ? nmEl.value : "";
      const cat = catEl ? catEl.value : "";
      const sup = supEl ? supEl.value : "";
      const dh = byId("displayStockHeader");
      const nh = byId("displayNameHeader");
      const ch = byId("displayCategoryHeader");
      if (dh) dh.textContent = sc;
      if (nh) nh.textContent = nm;
      if (ch) ch.textContent = cat;
      data.stock_code = sc;
      data.name = nm;
      data.category = cat;
      data.supplier = sup;
    };

    const by = {
      photoGrid: byId("photoGrid"),
      inboxTray: byId("inboxTray"),
      uploadZone: byId("uploadZone"),
      uploadInput: byId("uploadInput"),
      uploadError: byId("uploadError"),
      saveBtn: byId("saveBtn"),
      saveStatus: byId("saveStatus"),
      prevBtn: byId("prevBtn"),
      nextBtn: byId("nextBtn"),
      statusToggle: byId("statusToggle"),
      doneToggle: byId("doneToggle"),
      pushOneBtn: byId("pushOneBtn"),
      pushOneStatus: byId("pushOneStatus"),
      optionalWrap: byId("optionalFields"),
      optionalToggle: byId("toggleOptionalFields"),
    };

    const setStatusMsg = (msg, type) => {
      if (!by.saveStatus) return;
      by.saveStatus.textContent = msg;
      by.saveStatus.className = `save-status ${type || ""}`.trim();
    };
    const collectPhotosFromDom = () => {
      if (!by.photoGrid) return photos.slice();
      const thumbs = by.photoGrid.querySelectorAll(".thumb");
      const fromDom = Array.from(thumbs).map((t) => t.dataset.filename).filter(Boolean);
      return fromDom.length ? fromDom : photos.slice();
    };

    const collectPayload = () => {
      syncDataLabels();
      const statusEl = byId("statusValue");
      const st = (statusEl && statusEl.value) || productStatus;
      const tagsEl = byId("tags");
      const notesEl = byId("notes");
      return {
        stock_code: (byId("stock_code") && byId("stock_code").value) || "",
        name: (byId("name") && byId("name").value) || "",
        category: (byId("category") && byId("category").value) || "",
        supplier: (byId("supplier") && byId("supplier").value) || "",
        web_description: (byId("web_description") && byId("web_description").value) || "",
        sell_price: (byId("sell_price") && byId("sell_price").value) || "",
        compare_price: (byId("compare_price") && byId("compare_price").value) || "",
        tags: (tagsEl && tagsEl.value) || "",
        notes: (notesEl && notesEl.value) || "",
        status: st,
        shopify_sku: (byId("shopify_sku") && byId("shopify_sku").value) || "",
        photos: collectPhotosFromDom(),
        revise_checklist: reviseChecklist.slice(),
        revise_comments: reviseComments,
      };
    };

    const saveProduct = async (redirectAfter, opts) => {
      const options = opts || {};
      const silent = !!options.silent;
      if (!canEdit) return true;
      if (isSaving) return false;
      isSaving = true;
      const btn = by.saveBtn;
      const defaultText = "Save Product";
      const prevBg = btn ? btn.style.background : "";
      if (btn && !silent) {
        btn.textContent = "Saving...";
        btn.disabled = true;
        setStatusMsg("Saving...", "");
      }
      const payload = collectPayload();
      console.log("[saveProduct] POST /product/%s/save", productId, payload);
      try {
        const res = await fetch(`/product/${productId}/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          keepalive: !!options.keepalive,
        });
        const respData = await parseSaveResponse(res);
        if (!respData.success) {
          if (!silent) {
            setStatusMsg(respData.error || "Save failed", "error");
            if (btn) {
              btn.textContent = "Save Failed";
              btn.style.background = "#dc2626";
              btn.disabled = false;
            }
            alert(`Save failed: ${respData.error || "Unknown error"}`);
          }
          return false;
        }
        photos = Array.isArray(respData.product.photos) ? respData.product.photos.slice() : photos;
        if (respData.product && respData.product.status) {
          productStatus = String(respData.product.status).toLowerCase();
          const hv = byId("statusValue");
          if (hv) hv.value = productStatus;
        }
        if (respData.product) {
          if (Array.isArray(respData.product.revise_checklist)) {
            reviseChecklist = respData.product.revise_checklist.slice();
          }
          if (respData.product.revise_comments != null) {
            reviseComments = String(respData.product.revise_comments || "");
          }
          if (respData.product.revise_by != null) reviseBy = String(respData.product.revise_by || "");
          if (respData.product.revise_at != null) reviseAt = respData.product.revise_at;
        }
        syncStatusUi();
        markClean();
        if (!silent) {
          if (btn) {
            btn.textContent = "Saved ✓";
            btn.style.background = "#2d8a4e";
          }
          setStatusMsg("Saved ✓", "ok");
          document.body.classList.add("flash-green");
          setTimeout(() => document.body.classList.remove("flash-green"), 450);
        }
        console.log("[saveProduct] success");
        if (!silent && btn) {
          setTimeout(() => {
            btn.textContent = defaultText;
            btn.style.background = prevBg;
            btn.disabled = false;
            if (redirectAfter) {
              const url = buildCatalogueReturnUrl(productId);
              if (embed && window.parent && window.parent !== window) window.parent.location.href = url;
              else window.location.href = url;
            }
          }, redirectAfter ? 800 : 1200);
        } else if (redirectAfter) {
          const url = buildCatalogueReturnUrl(productId);
          if (embed && window.parent && window.parent !== window) window.parent.location.href = url;
          else window.location.href = url;
        }
        return true;
      } catch (e) {
        console.error("[saveProduct]", e);
        if (!silent) {
          setStatusMsg(e.message || "Save failed — check your connection.", "error");
          if (btn) {
            btn.textContent = "Save Failed";
            btn.style.background = "#dc2626";
            btn.disabled = false;
          }
          alert(`Save error: ${e.message || "Unknown error"}`);
        }
        return false;
      } finally {
        isSaving = false;
      }
    };

    const saveIfDirty = async (opts) => {
      if (!canEdit || !isDirty) return true;
      return saveProduct(false, opts || { silent: true });
    };

    const pollPhoto = (filename) => {
      const timer = setInterval(async () => {
        const res = await fetch(`/api/photo-status/${encodeURIComponent(filename)}`);
        const pdata = await res.json();
        if (pdata.status === "done") {
          clearInterval(timer);
          renderPhotoGrid();
        }
      }, 1200);
    };

    const deletePhoto = async (name) => {
      const res = await fetch("/api/delete-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: name, product_id: productId }),
      });
      const pdata = await res.json();
      if (pdata.success) {
        photos = photos.filter((p) => p !== name);
        renderPhotoGrid();
      }
    };

    const setMainPhoto = async (name) => {
      const idx = photos.indexOf(name);
      if (idx <= 0) return;
      photos.splice(idx, 1);
      photos.unshift(name);
      renderPhotoGrid();
      await fetch("/api/reorder-photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId, filenames: photos }),
      });
    };

    const openBgEditor = (name) => {
      if (typeof window.openPhotoMaskEditor !== "function") {
        alert("Background editor failed to load. Refresh the page.");
        return;
      }
      window.openPhotoMaskEditor({
        imageUrl: uploadPublicUrl(name, true),
        filename: name,
        productId: productId,
        onSaved: () => renderPhotoGrid(),
      });
    };

    const removePhotoBackground = async (name, btnEl) => {
      if (!canEdit || !name) return false;
      if (!confirm("Remove the background from this photo? You can Undo in the open viewer if needed.")) {
        return false;
      }
      const prevText = btnEl ? btnEl.textContent : "";
      if (btnEl) {
        btnEl.disabled = true;
        btnEl.textContent = "…";
      }
      try {
        const res = await fetch("/api/remove-photo-background", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: name, product_id: productId }),
        });
        const pdata = await res.json();
        if (!pdata.success) {
          alert(pdata.error || "Background removal failed");
          return false;
        }
        renderPhotoGrid();
        return true;
      } catch (e) {
        alert(e.message || "Background removal failed");
        return false;
      } finally {
        if (btnEl) {
          btnEl.disabled = false;
          btnEl.textContent = prevText || "Remove BG";
        }
      }
    };

    const setEnhanceStatus = (text) => {
      const el = byId("upscaleProgress");
      if (el) el.textContent = text || "";
      if (lightbox && typeof lightbox.setStatus === "function") {
        const overlay = document.querySelector(".cm-lightbox:not(.hidden)");
        if (overlay) lightbox.setStatus(text || "");
      }
    };

    const formatRejectMessage = (results) => {
      const rejected = (results || []).filter((r) => r && r.rejected);
      if (!rejected.length) return "";
      return rejected
        .map((r) => {
          const codes = Array.isArray(r.reject_codes) ? r.reject_codes.join(", ") : "";
          const detail = r.reject_detail || r.error || "unusable source";
          return `${r.filename || "photo"}: ${codes ? codes + " — " : ""}${detail}`;
        })
        .join("\n");
    };

    const pollEnhanceJob = async (jobId) => {
      const deadline = Date.now() + 30 * 60 * 1000;
      while (Date.now() < deadline) {
        let res = await fetch("/api/enhance-progress/" + encodeURIComponent(jobId));
        if (res.status === 404) {
          res = await fetch("/api/upscale-progress/" + encodeURIComponent(jobId));
        }
        const data = await res.json();
        if (!data.success && data.error === "Unknown job") {
          throw new Error("Enhance job lost");
        }
        const done = Number(data.done || 0);
        const failed = Number(data.failed || 0);
        const rejected = Number(data.rejected || 0);
        const total = Number(data.total || 0);
        const pct = Math.round(Number(data.percent || 0));
        const current = data.current ? String(data.current) : "";
        const message = data.message ? String(data.message) : "";
        if (data.running) {
          const detail = message && message.length < 80 ? message : `Enhancing ${pct}%`;
          setEnhanceStatus(
            `Enhancing ${done + 1}/${total || "?"} ${current ? "· " + current + " " : ""}(${pct}%) — ${detail}…`
          );
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }
        if (data.error) {
          throw new Error(data.error);
        }
        const skipped = (data.results || []).filter((r) => r && r.skipped).length;
        setEnhanceStatus(
          failed
            ? `Enhanced ${done}/${total} · ${failed} failed${rejected ? ` · ${rejected} rejected` : ""}${skipped ? ` · ${skipped} skipped` : ""}`
            : skipped && !done
              ? `${skipped} skipped`
              : `Enhanced ${done}/${total || done} ✓${skipped ? ` · ${skipped} skipped` : ""}`
        );
        return data;
      }
      throw new Error("Enhance timed out");
    };

    const enhancePhotos = async (names, btnEl) => {
      if (!canEdit) return false;
      const list = (names || []).filter(Boolean);
      if (!list.length) return false;
      const label = list.length === 1 ? "1 photo" : list.length + " photos";
      if (!confirm(`Enhance ${label} via LAN GPU service?`)) {
        return false;
      }
      const prevText = btnEl ? btnEl.textContent : "";
      const batchBtn = byId("enhanceAllBtn");
      if (batchBtn) batchBtn.disabled = true;
      if (btnEl) {
        btnEl.disabled = true;
        btnEl.textContent = "…";
      }
      setEnhanceStatus("Enhancing…");
      try {
        const endpoint = list.length === 1 ? "/api/enhance-photo" : "/api/enhance-photos";
        const body =
          list.length === 1
            ? { filename: list[0], product_id: productId }
            : { filenames: list, product_id: productId };
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const pdata = await res.json();
        if (!pdata.success || !pdata.job_id) {
          throw new Error(pdata.error || "Could not start enhance");
        }
        const progressData = await pollEnhanceJob(pdata.job_id);
        const failed = Number(progressData.failed || 0);
        const done = Number(progressData.done || 0);
        const rejected = Number(progressData.rejected || 0);
        const rejectMsg = formatRejectMessage(progressData.results);
        if (!done && failed) {
          const firstErr =
            (progressData.results || []).find((r) => r && (r.rejected || r.error)) || {};
          if (firstErr.rejected) {
            const msg =
              rejectMsg ||
              firstErr.reject_detail ||
              firstErr.error ||
              "Photo rejected by enhance gate — reshoot";
            setEnhanceStatus(msg);
            alert(msg);
            renderPhotoGrid();
            return false;
          }
          throw new Error(firstErr.error || "Enhance failed on the server");
        }
        if (rejected) {
          alert(
            rejectMsg
              ? `Enhanced ${done}; ${rejected} rejected:\n${rejectMsg}`
              : `Enhanced ${done} photo(s); ${rejected} rejected — reshoot those.`
          );
        } else if (failed) {
          alert(`Enhanced ${done} photo(s); ${failed} failed.`);
        }
        renderPhotoGrid();
        return done > 0;
      } catch (e) {
        setEnhanceStatus("");
        alert(e.message || "Enhance failed");
        throw e;
      } finally {
        if (batchBtn) batchBtn.disabled = false;
        if (btnEl) {
          btnEl.disabled = false;
          btnEl.textContent = prevText || "Enhance";
        }
      }
    };

    const renderPhotoGrid = () => {
      if (!by.photoGrid) return;
      by.photoGrid.innerHTML = "";
      photos.forEach((name, idx) => {
        const el = document.createElement("div");
        el.className = "thumb";
        el.draggable = !!canEdit;
        el.dataset.filename = name;
        el.title = "Click to enlarge";
        el.innerHTML =
          `${idx === 0 ? '<div class="main-label">★ Main</div>' : (canEdit ? '<button type="button" class="main-btn">Set main</button>' : "")}` +
          `<img src="${uploadPublicUrl(name, true)}" alt="">` +
          (canEdit
            ? '<button type="button" class="delete-btn" title="Delete photo">Delete</button>'
            : "");
        const openSavedLightbox = () => {
          lightbox.open({
            imageSrc: uploadPublicUrl(name, true),
            mode: "saved",
            filename: name,
            productId: productId,
            onDelete: canEdit
              ? async () => {
                  await deletePhoto(name);
                  lightbox.close();
                }
              : null,
            onSave: canEdit
              ? () => {
                  renderPhotoGrid();
                  lightbox.close();
                }
              : null,
            onChanged: canEdit ? () => renderPhotoGrid() : null,
            onRemoveBackground: canEdit
              ? async () => {
                  const ok = await removePhotoBackground(name);
                  if (ok) {
                    lightbox.setImage(uploadPublicUrl(name, true));
                    renderPhotoGrid();
                  }
                  return ok;
                }
              : null,
            onEnhance: canEdit
              ? async () => {
                  const ok = await enhancePhotos([name]);
                  if (ok) {
                    lightbox.setImage(uploadPublicUrl(name, true));
                    renderPhotoGrid();
                  }
                  return ok;
                }
              : null,
            onRefineBackground: canEdit
              ? () => {
                  lightbox.close();
                  window.setTimeout(() => openBgEditor(name), 0);
                }
              : null,
          });
        };
        el.addEventListener("click", (e) => {
          if (e.target.closest("button")) return;
          openSavedLightbox();
        });
        const mainBtn = el.querySelector(".main-btn");
        if (mainBtn) mainBtn.addEventListener("click", (e) => { e.stopPropagation(); setMainPhoto(name); });
        const delBtn = el.querySelector(".delete-btn");
        if (delBtn) {
          delBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            await deletePhoto(name);
          });
        }
        by.photoGrid.appendChild(el);
      });
      if (canEdit) bindDrag();
    };

    const bindDrag = () => {
      by.photoGrid.querySelectorAll(".thumb").forEach((thumb) => {
        thumb.addEventListener("dragstart", () => { dragged = thumb.dataset.filename; });
        thumb.addEventListener("dragover", (e) => e.preventDefault());
        thumb.addEventListener("drop", async (e) => {
          e.preventDefault();
          const target = thumb.dataset.filename;
          if (!dragged || dragged === target) return;
          const from = photos.indexOf(dragged);
          const to = photos.indexOf(target);
          const [moved] = photos.splice(from, 1);
          photos.splice(to, 0, moved);
          renderPhotoGrid();
          await fetch("/api/reorder-photos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ product_id: productId, filenames: photos }),
          });
        });
      });
    };

    const uploadFiles = async (fileList) => {
      if (!canEdit) return;
      if (by.uploadError) by.uploadError.textContent = "";
      for (const file of Array.from(fileList || [])) {
        console.log("[upload] file", file.name, file.size);
        const fd = new FormData();
        fd.append("photo", file);
        fd.append("product_id", String(productId));
        const res = await fetch("/api/upload-photo", { method: "POST", body: fd });
        let pdata;
        try {
          pdata = await res.json();
        } catch (parseErr) {
          console.error("[upload] bad JSON", parseErr);
          if (by.uploadError) by.uploadError.textContent = "Upload failed (invalid server response)";
          alert("Upload failed: invalid server response");
          continue;
        }
        console.log("[upload] response", pdata);
        if (!pdata.success) {
          if (by.uploadError) by.uploadError.textContent = pdata.error || "Upload failed";
          alert(`Upload failed: ${pdata.error || "Unknown error"}`);
          continue;
        }
        photos.push(pdata.filename);
        renderPhotoGrid();
        if (pdata.processing) pollPhoto(pdata.filename);
      }
    };

    by.uploadZone && by.uploadZone.addEventListener("click", () => by.uploadInput && by.uploadInput.click());
    if (by.uploadInput) by.uploadInput.addEventListener("change", (e) => uploadFiles(e.target.files));
    if (by.uploadZone) {
      ["dragenter", "dragover"].forEach((evt) => by.uploadZone.addEventListener(evt, (e) => { e.preventDefault(); by.uploadZone.classList.add("drag-over"); }));
      ["dragleave", "drop"].forEach((evt) => by.uploadZone.addEventListener(evt, (e) => { e.preventDefault(); by.uploadZone.classList.remove("drag-over"); }));
      by.uploadZone.addEventListener("drop", (e) => uploadFiles(e.dataTransfer.files));
    }

    const enhanceAllBtn = byId("enhanceAllBtn");
    if (enhanceAllBtn && canEdit) {
      enhanceAllBtn.addEventListener("click", () => {
        if (!photos.length) {
          alert("No photos to enhance");
          return;
        }
        enhancePhotos(photos.slice(), enhanceAllBtn);
      });
    }

    const findBtn = byId("find-btn");
    if (findBtn) {
      let productSnapshot = null;

      const apiUrl = (p) => (typeof window.cmPath === "function" ? window.cmPath(p) : p);

      const getProductIdForWebSearch = () => {
        if (productId) return productId;
        const pathParts = (window.location.pathname || "").split("/").filter(Boolean);
        const idFromPath = pathParts.find((p) => /^\d+$/.test(p));
        if (idFromPath) return idFromPath;
        const pageEl = byId("productPage");
        if (pageEl && pageEl.dataset.productId) return pageEl.dataset.productId;
        const hiddenId = document.querySelector('input[name="id"], #product-id, [data-product-id]');
        if (hiddenId) return hiddenId.value || hiddenId.dataset.productId;
        return null;
      };

      async function takeSnapshot() {
        const pid = getProductIdForWebSearch();
        if (!pid) return;
        try {
          const resp = await fetch(apiUrl(`/api/products/${pid}/snapshot`));
          const data = await resp.json();
          if (data.success) {
            productSnapshot = data.snapshot;
            const undoBtn = byId("undo-btn");
            if (undoBtn) undoBtn.style.display = "inline-flex";
          }
        } catch (e) {
          console.log("Snapshot failed:", e);
        }
      }

      async function undoChanges() {
        if (!productSnapshot) {
          alert("No snapshot available");
          return;
        }
        if (!confirm("Restore product to state before Web Search changes?")) return;
        const pid = getProductIdForWebSearch();
        try {
          const resp = await fetch(apiUrl(`/api/products/${pid}/restore`), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ snapshot: productSnapshot }),
          });
          const data = await resp.json();
          if (data.success) {
            alert("Product restored successfully");
            location.reload();
          } else {
            alert("Restore failed: " + (data.error || "Unknown error"));
          }
        } catch (e) {
          alert("Restore failed: " + (e.message || e));
        }
      }

      window.runWebSearch = async function runWebSearch() {
        const terms = (byId("ws-terms") && byId("ws-terms").value.trim()) || "";
        const siteUrl = (byId("ws-url") && byId("ws-url").value.trim()) || "";
        const company = (byId("ws-company") && byId("ws-company").value.trim()) || "";
        if (!terms) {
          alert("Please enter search terms");
          return;
        }
        const btn = byId("ws-search-btn");
        const resultsDiv = byId("ws-results");
        if (!btn || !resultsDiv) return;
        btn.textContent = "⏳ Searching...";
        btn.disabled = true;
        resultsDiv.innerHTML = "";
        const pid = getProductIdForWebSearch();
        try {
          const resp = await fetch(apiUrl("/api/web-search-images"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              search_terms: terms,
              site_url: siteUrl,
              company_name: company,
              product_id: pid,
            }),
          });
          const data = await resp.json();
          if (data.error) {
            resultsDiv.innerHTML =
              '<div style="color:#dc2626;padding:12px;background:#fef2f2;border-radius:4px;font-size:13px;">❌ ' +
              data.error +
              "</div>";
            return;
          }
          if (!data.images || data.images.length === 0) {
            resultsDiv.innerHTML =
              '<div style="color:#6b7280;padding:20px;text-align:center;font-size:13px;">No images found. Try different search terms or a different supplier URL.</div>';
            return;
          }

          window.wsSelectedUrls = [];
          const groups = {};
          data.images.forEach((img) => {
            const label = img.source_label || "Results";
            if (!groups[label]) groups[label] = [];
            groups[label].push(img);
          });

          let html = "";
          Object.keys(groups).forEach((label) => {
            const images = groups[label];
            html +=
              '<div style="margin-bottom:20px;">' +
              '<div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #f0f2f5;">' +
              label +
              " (" +
              images.length +
              " images)</div>" +
              '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;" class="img-grid">';
            images.forEach((img) => {
              const safeTitle = (img.title || "").replace(/"/g, "&quot;");
              html +=
                '<div class="ws-img-card" data-url="' +
                String(img.url || "").replace(/"/g, "&quot;") +
                '" title="' +
                safeTitle +
                '" style="border:2px solid #eaecef;cursor:pointer;overflow:hidden;background:#ffffff;border-radius:4px;position:relative;transition:border-color 0.15s;aspect-ratio:1;">' +
                '<img src="' +
                String(img.thumbnail || img.url || "").replace(/"/g, "&quot;") +
                '" style="width:100%;height:100%;object-fit:contain;object-position:center;display:block;background:#ffffff;" loading="lazy" />' +
                '<div class="ws-check" style="display:none;position:absolute;top:4px;right:4px;width:20px;height:20px;background:#22c55e;border-radius:50%;color:white;font-size:12px;align-items:center;justify-content:center;font-weight:700;">✓</div>' +
                "</div>";
            });
            html += "</div></div>";
          });

          html +=
            '<div id="ws-save-bar" style="display:none;position:sticky;bottom:0;background:white;padding:12px;border-top:1px solid #eaecef;margin-top:8px;">' +
            '<button type="button" id="ws-save-btn" style="width:100%;background:#22c55e;color:white;border:none;padding:12px;font-size:14px;font-weight:700;cursor:pointer;border-radius:4px;">💾 Save 0 Selected Images to Gallery</button>' +
            "</div>";

          resultsDiv.innerHTML = html;
          resultsDiv.querySelectorAll("img").forEach((imgEl) => {
            imgEl.addEventListener("error", function () {
              const card = this.closest(".ws-img-card");
              if (card) card.style.display = "none";
            });
          });

          window.toggleWsImage = function (card, url) {
            if (!window.wsSelectedUrls) window.wsSelectedUrls = [];
            const idx = window.wsSelectedUrls.indexOf(url);
            const check = card.querySelector(".ws-check");
            if (idx > -1) {
              window.wsSelectedUrls.splice(idx, 1);
              card.style.borderColor = "#eaecef";
              if (check) check.style.display = "none";
            } else {
              window.wsSelectedUrls.push(url);
              card.style.borderColor = "#22c55e";
              if (check) check.style.display = "flex";
            }
            const saveBar = byId("ws-save-bar");
            const saveBtn = byId("ws-save-btn");
            if (!saveBar || !saveBtn) return;
            if (window.wsSelectedUrls.length > 0) {
              saveBar.style.display = "block";
              saveBtn.textContent =
                "💾 Save " + window.wsSelectedUrls.length + " Selected Image(s) to Gallery";
            } else {
              saveBar.style.display = "none";
            }
          };

          resultsDiv.querySelectorAll(".ws-img-card").forEach((card) => {
            card.addEventListener("click", function () {
              window.toggleWsImage(this, this.getAttribute("data-url") || "");
            });
          });

          window.saveWsImages = async function () {
            if (!window.wsSelectedUrls || window.wsSelectedUrls.length === 0) return;
            const saveBtn = byId("ws-save-btn");
            if (!saveBtn) return;
            saveBtn.textContent = "⏳ Saving to gallery...";
            saveBtn.disabled = true;
            let saved = 0;
            let failed = 0;
            for (const url of window.wsSelectedUrls) {
              try {
                const r = await fetch(apiUrl("/api/save-found-image"), {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ url: url, product_id: pid }),
                });
                const result = await r.json();
                if (result.success) saved++;
                else failed++;
              } catch {
                failed++;
              }
            }
            let msg = "";
            if (saved > 0) msg += "✓ " + saved + " image(s) saved to gallery! ";
            if (failed > 0) msg += "⚠️ " + failed + " failed (site blocks downloads).";
            saveBtn.textContent = msg || "Done";
            saveBtn.style.background = "#0f1e2e";
            if (saved > 0) setTimeout(() => location.reload(), 2000);
            else saveBtn.disabled = false;
          };

          const saveBtn = byId("ws-save-btn");
          if (saveBtn) saveBtn.addEventListener("click", () => window.saveWsImages());
        } catch (e) {
          resultsDiv.innerHTML =
            '<div style="color:#dc2626;padding:12px;background:#fef2f2;border-radius:4px;font-size:13px;">❌ Search failed: ' +
            (e.message || e) +
            "</div>";
        } finally {
          btn.textContent = "🔍 Search for Images";
          btn.disabled = false;
        }
      };

      const undoBtn = byId("undo-btn");
      if (undoBtn) undoBtn.addEventListener("click", undoChanges);
      takeSnapshot();

      findBtn.addEventListener("click", function () {
        takeSnapshot();
        const existing = byId("web-search-panel");
        if (existing) {
          existing.remove();
          return;
        }

        const productName = ((byId("name") && byId("name").value) || "").trim();
        const description = ((byId("web_description") && byId("web_description").value) || "").trim();
        const stockCode = ((byId("stock_code") && byId("stock_code").value) || "").trim();

        let defaultTerms = productName;
        if (stockCode) defaultTerms = stockCode + " " + productName;
        if (description && description.length < 200) {
          defaultTerms += " " + description.substring(0, 100);
        }
        defaultTerms = defaultTerms.trim().substring(0, 200);

        const panel = document.createElement("div");
        panel.id = "web-search-panel";
        panel.style.cssText =
          "margin-top:16px;border:1.5px solid #1a6fc4;border-radius:6px;background:white;overflow:hidden;";
        panel.innerHTML =
          '<div style="background:#0f1e2e;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;">' +
          '<span style="color:white;font-weight:700;font-size:14px;">🌐 Web Search for Images</span>' +
          '<button type="button" id="ws-close-btn" style="background:none;border:none;color:rgba(255,255,255,0.7);font-size:20px;cursor:pointer;">×</button>' +
          "</div>" +
          '<div style="padding:20px;">' +
          '<div style="margin-bottom:14px;">' +
          '<label style="display:block;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">SEARCH TERMS <span style="color:#1a6fc4;font-weight:400;text-transform:none;letter-spacing:0;">— edit to refine your search</span></label>' +
          '<textarea id="ws-terms" rows="3" style="width:100%;padding:10px 14px;border:1.5px solid #eaecef;font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box;"></textarea>' +
          "</div>" +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">' +
          "<div>" +
          '<label style="display:block;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">SUPPLIER WEBSITE URL <span style="color:#9ca3af;font-weight:400;text-transform:none;letter-spacing:0;">(optional)</span></label>' +
          '<input type="text" id="ws-url" placeholder="e.g. fowkes.co.za or www.supplier.com" style="width:100%;padding:10px 14px;border:1.5px solid #eaecef;font-size:13px;box-sizing:border-box;" />' +
          '<div style="font-size:10px;color:#9ca3af;margin-top:4px;">Searches this site first for the product</div>' +
          "</div>" +
          "<div>" +
          '<label style="display:block;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">COMPANY / GOOGLE SEARCH <span style="color:#9ca3af;font-weight:400;text-transform:none;letter-spacing:0;">(optional)</span></label>' +
          '<input type="text" id="ws-company" placeholder="e.g. Fowkes Bros or BPW Trailer Parts" style="width:100%;padding:10px 14px;border:1.5px solid #eaecef;font-size:13px;box-sizing:border-box;" />' +
          '<div style="font-size:10px;color:#9ca3af;margin-top:4px;">Finds this company and searches their images</div>' +
          "</div>" +
          "</div>" +
          '<button type="button" id="ws-search-btn" style="width:100%;background:#1a6fc4;color:white;border:none;padding:12px;font-size:14px;font-weight:700;cursor:pointer;border-radius:4px;margin-bottom:16px;">🔍 Search for Images</button>' +
          '<div id="ws-results"></div>' +
          "</div>";

        const container =
          findBtn.closest(".card, .panel, .section, [class*=\"photo\"], [class*=\"image\"]") ||
          findBtn.parentElement;
        container.insertAdjacentElement("afterend", panel);

        const termsEl = byId("ws-terms");
        if (termsEl) termsEl.value = defaultTerms;
        const closeBtn = byId("ws-close-btn");
        if (closeBtn) closeBtn.addEventListener("click", () => panel.remove());
        const searchBtn = byId("ws-search-btn");
        if (searchBtn) searchBtn.addEventListener("click", () => window.runWebSearch());

        setTimeout(() => {
          if (termsEl) termsEl.focus();
        }, 100);
        setTimeout(() => {
          ["ws-url", "ws-company"].forEach((id) => {
            const el = byId(id);
            if (!el) return;
            el.addEventListener("keypress", (e) => {
              if (e.key === "Enter") window.runWebSearch();
            });
          });
        }, 200);
      });
    }

    const claimInbox = async (name) => {
      const res = await fetch("/api/claim-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: name, product_id: productId }),
      });
      const pdata = await res.json();
      console.log("[claim-inbox]", pdata);
      if (pdata.success) {
        photos.push(pdata.filename);
        renderPhotoGrid();
        if (pdata.processing) pollPhoto(pdata.filename);
        refreshInboxAfterClaim();
      }
    };
    const discardInbox = async (name) => {
      await fetch("/api/discard-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: name }),
      });
      refreshInboxAfterClaim();
    };
    const renderInbox = (files) => {
      if (!files.length) {
        by.inboxTray.innerHTML = `<div class="watching-row"><span class="pulse-dot" aria-hidden="true"></span><span>Watching for new photos...</span></div>`;
        return;
      }
      by.inboxTray.innerHTML = "";
      files.forEach((name) => {
        const item = document.createElement("div");
        item.className = "inbox-item";
        item.innerHTML = `<div class="inbox-thumb"><img src="/api/inbox-preview/${encodeURIComponent(name)}" alt=""></div><div class="thumb-processing hidden"><span class="spinner"></span>Processing...</div><button class="btn btn-green add-btn">Add to product</button><button class="btn btn-light skip-btn">Skip</button>`;
        item.querySelector(".inbox-thumb").addEventListener("click", () => {
          lightbox.open({
            imageSrc: `/api/inbox-preview/${encodeURIComponent(name)}`,
            mode: "inbox",
            onAdd: async () => { await claimInbox(name); lightbox.close(); },
            onDiscard: async () => { await discardInbox(name); lightbox.close(); },
          });
        });
        item.querySelector(".add-btn").addEventListener("click", async () => claimInbox(name));
        item.querySelector(".skip-btn").addEventListener("click", async () => discardInbox(name));
        by.inboxTray.appendChild(item);
      });
    };

    function playBeep() {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        const osc = ctx.createOscillator();
        osc.connect(ctx.destination);
        osc.frequency.value = 880;
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      } catch (e) {
        console.log("[playBeep] skipped", e);
      }
    }

    let inboxInterval = null;
    const knownInboxFiles = new Set();
    let inboxSeeded = false;

    const refreshInboxAfterClaim = async () => {
      try {
        const res = await fetch("/api/check-inbox");
        const pdata = await res.json();
        renderInbox(pdata.files || []);
      } catch (e) {
        console.log("[refreshInboxAfterClaim]", e);
      }
    };

    function startInboxPolling() {
      if (inboxInterval) clearInterval(inboxInterval);
      inboxInterval = setInterval(async () => {
        try {
          const response = await fetch("/api/check-inbox");
          const pdata = await response.json();
          const files = pdata.files || [];
          if (pdata.error) console.warn("[check-inbox]", pdata.error);
          if (!inboxSeeded) {
            files.forEach((f) => knownInboxFiles.add(f));
            inboxSeeded = true;
          } else {
            const newFiles = files.filter((f) => !knownInboxFiles.has(f));
            if (newFiles.length > 0) {
              playBeep();
              newFiles.forEach((f) => knownInboxFiles.add(f));
              console.log("[inbox] new files", newFiles);
            }
          }
          renderInbox(files);
        } catch (e) {
          console.log("Inbox poll error:", e);
        }
      }, 2000);
    }

    const REVISE_LABELS = {
      photos: "Photos",
      stock_code: "Stock code",
      name: "Name",
      category: "Category",
      supplier: "Supplier",
      shopify_sku: "Shopify SKU",
      web_description: "Web description",
      sell_price: "Sell price",
      compare_price: "Compare price",
      tags: "Tags",
      notes: "Internal notes",
    };

    const syncReviseBanner = () => {
      const banner = byId("reviseBanner");
      const list = byId("reviseBannerList");
      const commentsEl = byId("reviseBannerComments");
      if (!banner) return;
      const show = productStatus === "revise";
      banner.classList.toggle("hidden", !show);
      if (list) {
        list.innerHTML = "";
        reviseChecklist.forEach((key) => {
          const li = document.createElement("li");
          li.dataset.key = key;
          li.textContent = REVISE_LABELS[key] || key;
          list.appendChild(li);
        });
      }
      if (commentsEl) {
        commentsEl.textContent = reviseComments || "";
        commentsEl.style.display = reviseComments ? "" : "none";
      }
      const title = banner.querySelector(".revise-banner__title");
      if (title) {
        let t = "Needs revision";
        if (reviseBy) t += ` — requested by ${reviseBy}`;
        if (reviseAt) t += ` (${reviseAt})`;
        title.textContent = t;
      }
      const checklistHidden = byId("reviseChecklistValue");
      const commentsHidden = byId("reviseCommentsValue");
      if (checklistHidden) checklistHidden.value = JSON.stringify(reviseChecklist);
      if (commentsHidden) commentsHidden.value = reviseComments;
    };

    const syncStatusUi = () => {
      const hidden = byId("statusValue");
      if (hidden) hidden.value = productStatus;
      if (by.doneToggle) {
        by.doneToggle.classList.toggle("is-pending", productStatus === "pending");
        by.doneToggle.classList.toggle("is-done", productStatus === "done");
        by.doneToggle.classList.toggle("is-approved", productStatus === "approved");
        by.doneToggle.classList.toggle("is-revise", productStatus === "revise");
        by.doneToggle.disabled = productStatus === "approved";
        if (productStatus === "revise") {
          by.doneToggle.textContent = "NEEDS REVISION — fix then mark Done";
          by.doneToggle.title = "Fix the items below, then mark Done for re-approval";
        } else if (productStatus === "done") {
          by.doneToggle.textContent = "DONE ✓ — awaiting approval";
          by.doneToggle.title = "";
        } else if (productStatus === "approved") {
          by.doneToggle.textContent = "DONE ✓ — approved";
          by.doneToggle.title = "Already approved — admin can change approval below";
        } else {
          by.doneToggle.textContent = "MARK AS DONE";
          by.doneToggle.title = "";
        }
      }
      if (by.statusToggle && by.statusToggle.tagName === "BUTTON") {
        by.statusToggle.classList.toggle("approved", productStatus === "approved");
        by.statusToggle.classList.toggle("ready", productStatus === "done");
        by.statusToggle.classList.toggle("pending", productStatus === "pending");
        by.statusToggle.classList.toggle("revise", productStatus === "revise");
        by.statusToggle.classList.remove("done");
        if (productStatus === "approved") by.statusToggle.textContent = "APPROVED ✓";
        else if (productStatus === "revise") by.statusToggle.textContent = "REVISE — awaiting editor";
        else if (productStatus === "done") by.statusToggle.textContent = "DONE — APPROVE";
        else by.statusToggle.textContent = "PENDING — mark Done first";
      } else if (by.statusToggle) {
        by.statusToggle.classList.toggle("approved", productStatus === "approved");
        by.statusToggle.classList.toggle("ready", productStatus === "done");
        by.statusToggle.classList.toggle("pending", productStatus === "pending");
        by.statusToggle.classList.toggle("revise", productStatus === "revise");
        if (productStatus === "approved") by.statusToggle.textContent = "APPROVED ✓";
        else if (productStatus === "revise") by.statusToggle.textContent = "REVISE — awaiting your changes";
        else if (productStatus === "done") by.statusToggle.textContent = "DONE — awaiting admin approval";
        else by.statusToggle.textContent = "PENDING";
      }
      syncReviseBanner();
    };

    const openReviseModal = () => {
      const modal = byId("reviseModal");
      if (!modal) return;
      modal.querySelectorAll('input[name="revise_item"]').forEach((cb) => {
        cb.checked = reviseChecklist.includes(cb.value);
      });
      const commentsInput = byId("reviseCommentsInput");
      if (commentsInput) commentsInput.value = reviseComments || "";
      modal.classList.remove("hidden");
      modal.setAttribute("aria-hidden", "false");
    };

    const closeReviseModal = () => {
      const modal = byId("reviseModal");
      if (!modal) return;
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
    };

    const submitReviseRequest = async () => {
      const modal = byId("reviseModal");
      const checked = modal
        ? Array.from(modal.querySelectorAll('input[name="revise_item"]:checked')).map((el) => el.value)
        : [];
      const commentsInput = byId("reviseCommentsInput");
      const comments = commentsInput ? commentsInput.value.trim() : "";
      if (!checked.length && !comments) {
        alert("Tick at least one item or add a comment.");
        return;
      }
      reviseChecklist = checked;
      reviseComments = comments;
      productStatus = "revise";
      syncStatusUi();
      markDirty();
      const btn = byId("reviseSubmitBtn");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Sending…";
      }
      try {
        const ok = await saveProduct(false);
        if (ok) {
          closeReviseModal();
          setStatusMsg("Sent for revision", "ok");
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Send for revision";
        }
      }
    };

    if (by.doneToggle) {
      by.doneToggle.addEventListener("click", () => {
        if (productStatus === "approved") return;
        const photosNow = collectPhotosFromDom();
        const desc = ((byId("web_description") && byId("web_description").value) || "").trim();
        if (productStatus === "done") {
          productStatus = "pending";
        } else {
          // pending or revise → done
          if (!photosNow.length) {
            alert("Add at least one photo before marking Done.");
            return;
          }
          if (!desc) {
            alert("Enter a web description before marking Done.");
            return;
          }
          productStatus = "done";
        }
        syncStatusUi();
        markDirty();
        console.log("[doneToggle]", productStatus);
      });
    }

    if (by.statusToggle && by.statusToggle.tagName === "BUTTON") {
      by.statusToggle.addEventListener("click", () => {
        if (productStatus === "approved") {
          productStatus = "done";
        } else if (productStatus === "done") {
          productStatus = "approved";
        } else if (productStatus === "revise") {
          alert("Editor must mark Done again after fixing the revision items, then you can approve.");
          return;
        } else {
          alert("Mark the product as Done first (photos + description), then approve.");
          return;
        }
        syncStatusUi();
        markDirty();
        console.log("[statusToggle]", productStatus);
      });
    }

    const reviseBtn = byId("reviseBtn");
    if (reviseBtn) {
      reviseBtn.addEventListener("click", () => openReviseModal());
    }
    const reviseModal = byId("reviseModal");
    if (reviseModal) {
      reviseModal.querySelectorAll("[data-revise-close]").forEach((el) => {
        el.addEventListener("click", closeReviseModal);
      });
      const submitBtn = byId("reviseSubmitBtn");
      if (submitBtn) submitBtn.addEventListener("click", submitReviseRequest);
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && reviseModal && !reviseModal.classList.contains("hidden")) {
          closeReviseModal();
        }
      });
    }
    syncStatusUi();

    if (by.saveBtn) {
      by.saveBtn.addEventListener("click", async () => { await saveProduct(true); });
    }

    const navigateAway = async (url) => {
      const ok = await saveIfDirty({ silent: true });
      if (!ok && isDirty) {
        const leaveAnyway = window.confirm("Could not autosave your changes. Leave this product anyway?");
        if (!leaveAnyway) return;
      }
      const dest = typeof window.cmPath === "function" ? window.cmPath(url) : url;
      if (embed && window.parent && window.parent !== window) window.parent.location.href = dest;
      else window.location.href = dest;
    };

    window.cmProductBeforeLeave = async () => {
      const ok = await saveIfDirty({ silent: true });
      if (!ok && isDirty) {
        return window.confirm("Could not autosave your changes. Leave this product anyway?");
      }
      return true;
    };

    const isCatalogueHubHref = (href) => {
      if (!href) return false;
      try {
        const u = new URL(href, window.location.href);
        const path = u.pathname.replace(/\/+$/, "");
        return /\/products$/.test(path);
      } catch (_e) {
        return /\/products\/?(\?|$)/.test(href) && href.indexOf("/product/") === -1;
      }
    };
    document.querySelectorAll("a[href]").forEach((a) => {
      if (!isCatalogueHubHref(a.getAttribute("href"))) return;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        navigateAway(buildCatalogueReturnUrl(productId));
      });
    });

    window.addEventListener("beforeunload", (e) => {
      if (!canEdit || !isDirty || isSaving) return;
      try {
        const payload = collectPayload();
        fetch(`/product/${productId}/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          keepalive: true,
        });
      } catch (err) {
        console.warn("[beforeunload autosave]", err);
      }
      e.preventDefault();
      e.returnValue = "";
    });

    if (by.prevBtn) {
      by.prevBtn.addEventListener("click", async () => {
        await navigateAway(`/product/${by.prevBtn.dataset.id}`);
      });
    }
    if (by.nextBtn) {
      by.nextBtn.addEventListener("click", async () => {
        await navigateAway(`/product/${by.nextBtn.dataset.id}`);
      });
    }

    [
      "stock_code",
      "name",
      "category",
      "supplier",
      "web_description",
      "sell_price",
      "compare_price",
      "tags",
      "notes",
      "shopify_sku",
    ].forEach((id) => {
      const el = byId(id);
      if (!el) return;
      el.addEventListener("input", markDirty);
      el.addEventListener("change", markDirty);
    });

    if (by.optionalToggle) {
      by.optionalToggle.addEventListener("click", (e) => {
        e.preventDefault();
        by.optionalWrap.classList.toggle("hidden");
        by.optionalToggle.textContent = by.optionalWrap.classList.contains("hidden") ? "Show optional fields" : "Hide optional fields";
      });
    }

    const skuInput = byId("shopify_sku");
    const regenSkuBtn = byId("regenSkuBtn");
    if (regenSkuBtn && skuInput) {
      regenSkuBtn.addEventListener("click", () => {
        syncDataLabels();
        const category = ((byId("category") && byId("category").value) || "").replace(/[^A-Za-z]/g, "");
        const prefix = category ? category.slice(0, 3).toUpperCase() : "GEN";
        const stock = (byId("stock_code") && byId("stock_code").value) || "";
        skuInput.value = `${prefix}-${stock}`;
        markDirty();
      });
    }

    const aiBtn = byId("aiDescBtn");
    const aiStatus = byId("aiDescStatus");
    const aiHint = byId("aiHint");

    if (aiBtn) {
      aiBtn.addEventListener("click", async () => {
        const descEl = byId("web_description");
        const nameEl = byId("name");
        const productName = (nameEl && nameEl.value.trim()) || "";
        if (!productName) {
          alert("Please enter a product name first — AI Write includes it in the description for search.");
          return;
        }
        if (descEl && descEl.value.trim()) {
          const ok = window.confirm(
            "Replace the current web description with AI copy (description, key specifications, and fitment)?"
          );
          if (!ok) return;
        }
        aiBtn.disabled = true;
        aiStatus.textContent = "Generating description, specs & fitment…";
        aiStatus.className = "save-status";
        console.log("[AI] POST generate-description", { product_id: productId });
        try {
          const url =
            typeof window.cmPath === "function"
              ? window.cmPath("/api/generate-description")
              : "/api/generate-description";
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              product_id: productId,
              name: productName,
              category: (byId("category") && byId("category").value.trim()) || "",
              supplier: (byId("supplier") && byId("supplier").value.trim()) || "",
              stock_code: (byId("stock_code") && byId("stock_code").value.trim()) || "",
            }),
          });
          const result = await res.json();
          console.log("[AI] response", res.status, result);
          if (result.success) {
            descEl.value = result.description || "";
            markDirty();
            if (aiHint) {
              aiHint.textContent =
                "AI filled description, key specifications, and fitment — review, then Save. Find uses this text for image search.";
            }
            const via = result.provider === "groq" ? " (via Groq fallback)" : "";
            aiStatus.textContent = `AI product copy ready${via} — please review before saving.`;
            aiStatus.className = "save-status ok";
          } else {
            aiStatus.textContent = result.error || "Generation failed";
            aiStatus.className = "save-status error";
            alert(result.error || "Generation failed");
          }
        } catch (e) {
          console.error("[AI]", e);
          aiStatus.textContent = e.message || "Request failed";
          aiStatus.className = "save-status error";
          alert(`AI description error: ${e.message || "Request failed"}`);
        }
        aiBtn.disabled = false;
      });
    }

    if (by.pushOneBtn) {
      by.pushOneBtn.addEventListener("click", async () => {
        by.pushOneBtn.disabled = true;
        by.pushOneStatus.textContent = "Pushing...";
        const res = await fetch(`/api/push-to-shopify/${productId}`, { method: "POST" });
        const dataRes = await res.json();
        if (dataRes.success) {
          by.pushOneStatus.textContent = "Pushed to Shopify ✓";
          by.pushOneStatus.className = "save-status ok";
        } else {
          by.pushOneStatus.textContent = dataRes.error || "Push failed";
          by.pushOneStatus.className = "save-status error";
          by.pushOneBtn.disabled = false;
        }
      });
    }

    const delBtn = byId("deleteProductBtn");
    const delStatus = byId("deleteProductStatus");
    if (delBtn) {
      delBtn.addEventListener("click", async () => {
        if (!window.confirm("Permanently delete this product?")) return;
        delStatus.textContent = "";
        const { data } = await window.fetchWithAdmin(`/api/products/${productId}`, { method: "DELETE" });
        if (!data.success) {
          delStatus.textContent = data.error || "Delete failed";
          delStatus.className = "save-status error";
          return;
        }
        if (embed && window.parent && window.parent !== window) window.parent.location.href = buildCatalogueReturnUrl(null, null);
        else window.location.href = buildCatalogueReturnUrl(null, null);
      });
    }

    const hv = byId("statusValue");
    if (hv) hv.value = productStatus;

    renderPhotoGrid();
    (async () => {
      try {
        const res = await fetch("/api/check-inbox");
        const pdata = await res.json();
        const files = pdata.files || [];
        if (pdata.error) console.warn("[check-inbox initial]", pdata.error);
        files.forEach((f) => knownInboxFiles.add(f));
        inboxSeeded = true;
        renderInbox(files);
      } catch (e) {
        console.log("[inbox initial]", e);
      }
    })();
    startInboxPolling();
  };

  window.initProductHubPanel = function () {
    const cfgEl = byId("hubPanelConfig");
    const shell = byId("hubProductDetailShell");
    if (!cfgEl || !shell) return;
    const cfg = JSON.parse(cfgEl.textContent);
    let current = cfg.product;
    const categoryNames = new Set(cfg.categoryNames || []);
    const supplierLabels = new Set(cfg.supplierLabels || []);
    const productId = current.id;

    const saveErr = byId("hubPanelSaveError");
    const saveBtn = byId("hubPanelSaveBtn");

    const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    const updateListRow = (p) => {
      const li = document.querySelector(`.products-list-item[data-id="${p.id}"]`);
      if (!li) return;
      const cat = (p.category || "").trim();
      li.dataset.stock = (p.stock_code || "").toLowerCase();
      li.dataset.name = (p.name || "").toLowerCase();
      li.dataset.category = cat.toLowerCase();
      li.dataset.uncategorised = cat ? "0" : "1";
      li.dataset.status = p.status || "pending";
      li.dataset.pushed = p.shopify_pushed ? "1" : "0";
      const codeEl = li.querySelector(".products-list-code");
      const nameEl = li.querySelector(".products-list-name");
      const badges = li.querySelector(".products-list-badges");
      if (codeEl) codeEl.textContent = p.stock_code;
      if (nameEl) nameEl.textContent = p.name;
      if (badges) {
        const catHtml = cat
          ? `<span class="products-list-cat">${esc(cat)}</span>`
          : '<span class="badge badge-uncategorised">Uncategorised</span>';
        badges.innerHTML = `${catHtml}<span class="badge badge-${p.status || "pending"}">${(p.status || "pending").toUpperCase()}</span>`;
      }
    };

    const addHubFilterCategory = (cat) => {
      const n = (cat || "").trim();
      if (!n) return;
      const sel = byId("hubCategoryFilter");
      if (!sel) return;
      const v = n.toLowerCase();
      if (Array.from(sel.options).some((o) => o.value === v)) return;
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = n;
      sel.appendChild(opt);
    };

    const addCategoryToDatalist = (name) => {
      const n = (name || "").trim();
      if (!n || categoryNames.has(n)) return;
      categoryNames.add(n);
      const dl = byId("hubMasterCategoryDatalist");
      if (!dl) return;
      const opt = document.createElement("option");
      opt.value = n;
      dl.appendChild(opt);
    };

    const addSupplierToDatalist = (label) => {
      const n = (label || "").trim();
      if (!n || supplierLabels.has(n)) return;
      supplierLabels.add(n);
      const dl = byId("hubMasterSupplierDatalist");
      if (!dl) return;
      const opt = document.createElement("option");
      opt.value = n;
      dl.appendChild(opt);
    };

    const buildPayload = () => {
      const c = current;
      const sp = c.sell_price;
      const cp = c.compare_price;
      return {
        stock_code: byId("hubEditStockCode").value,
        name: byId("hubEditName").value,
        category: (byId("hubEditCategory").value || "").trim(),
        supplier: byId("hubEditSupplier").value,
        web_description: c.web_description != null ? String(c.web_description) : "",
        sell_price: sp != null && sp !== "" ? String(sp) : "",
        compare_price: cp != null && cp !== "" ? String(cp) : "",
        tags: c.tags != null ? String(c.tags) : "",
        notes: c.notes != null ? String(c.notes) : "",
        status: c.status === "done" ? "done" : "pending",
        shopify_sku: c.shopify_sku != null ? String(c.shopify_sku) : "",
        photos: Array.isArray(c.photos) ? c.photos.slice() : [],
      };
    };

    const syncForm = () => {
      byId("hubEditStockCode").value = current.stock_code || "";
      byId("hubEditName").value = current.name || "";
      byId("hubEditCategory").value = current.category || "";
      const supplier = current.supplier || "";
      byId("hubEditSupplier").value = supplier;
      if (supplier) addSupplierToDatalist(supplier);
    };

    const saveBtnDefault = "Save";

    saveBtn.addEventListener("click", async () => {
      saveErr.classList.add("hidden");
      saveErr.textContent = "";
      saveBtn.disabled = true;
      const prevColor = saveBtn.style.color;
      saveBtn.textContent = "Saving...";
      try {
        const res = await fetch(`/product/${productId}/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload()),
        });
        const data = await parseSaveResponse(res);
        if (!data.success) {
          saveErr.textContent = data.error || "Save failed";
          saveErr.classList.remove("hidden");
          saveBtn.textContent = "Save failed";
          saveBtn.style.color = "#b91c1c";
          setTimeout(() => {
            saveBtn.textContent = saveBtnDefault;
            saveBtn.style.color = prevColor;
          }, 2500);
          return;
        }
        current = data.product;
        syncForm();
        updateListRow(current);
        const nc = (current.category || "").trim();
        if (nc) {
          addCategoryToDatalist(nc);
          addHubFilterCategory(nc);
        }
        captureCatalogueReturnFromHub();
        const nextId = nextVisibleHubProductId(productId);
        saveBtn.textContent = "Saved ✓";
        if (nextId && String(nextId) !== String(productId)) {
          setTimeout(() => {
            window.location.href = hubUrlForProduct(nextId);
          }, 450);
        } else {
          setTimeout(() => { saveBtn.textContent = saveBtnDefault; }, 2000);
        }
        saveErr.textContent = e.message || "Save failed";
        saveErr.classList.remove("hidden");
        saveBtn.textContent = "Save failed";
        saveBtn.style.color = "#b91c1c";
        setTimeout(() => {
          saveBtn.textContent = saveBtnDefault;
          saveBtn.style.color = prevColor;
        }, 2500);
      } finally {
        saveBtn.disabled = false;
      }
    });

    syncForm();
  };

  let cmEnhanceStatusCache = null;
  const cmLoadEnhanceStatus = async () => {
    if (cmEnhanceStatusCache) return cmEnhanceStatusCache;
    try {
      let res = await fetch("/api/enhance-status");
      if (!res.ok) res = await fetch("/api/upscaler-status");
      cmEnhanceStatusCache = await res.json();
    } catch {
      cmEnhanceStatusCache = {};
    }
    return cmEnhanceStatusCache;
  };

  const cmFormatEnhanceHint = (status) => {
    if (!status) return "";
    if (status.available === false) return "GPU service offline";
    if (status.backend || status.service) return "GPU service";
    return status.available ? "GPU service" : "";
  };

  const cmApplyEnhanceHints = async () => {};

  function createLightbox() {
    const overlay = document.createElement("div");
    overlay.className = "cm-lightbox hidden";
    overlay.style.display = "none";
    overlay.innerHTML =
      '<div class="cm-lightbox-backdrop"></div>' +
      '<div class="cm-lightbox-content">' +
      '<button class="cm-lightbox-close" type="button" aria-label="Close">×</button>' +
      '<div class="cm-lightbox-figure"><img class="cm-lightbox-image" alt=""></div>' +
      '<div class="cm-lightbox-actions hidden">' +
      '<button class="btn btn-green cm-remove-bg hidden" type="button">Remove background</button>' +
      '<button class="btn btn-green cm-enhance-btn hidden" type="button">Enhance</button>' +
      '<button class="btn btn-green cm-refine hidden" type="button">✂️ Refine background</button>' +
      '<button class="btn cm-undo hidden" type="button" disabled>Undo</button>' +
      '<button class="btn btn-green cm-save hidden" type="button">Save</button>' +
      '<button class="btn btn-green cm-add" type="button">✓ Add to product</button>' +
      '<button class="btn cm-discard" type="button">✗ Discard - Retake</button>' +
      '<button class="btn cm-delete hidden" type="button">Delete photo</button>' +
      '<div class="cm-lightbox-status" aria-live="polite"></div>' +
      "</div></div>";
    document.body.appendChild(overlay);
    const img = overlay.querySelector(".cm-lightbox-image");
    const actions = overlay.querySelector(".cm-lightbox-actions");
    const statusEl = overlay.querySelector(".cm-lightbox-status");
    const add = overlay.querySelector(".cm-add");
    const discard = overlay.querySelector(".cm-discard");
    const del = overlay.querySelector(".cm-delete");
    const saveBtn = overlay.querySelector(".cm-save");
    const undoBtn = overlay.querySelector(".cm-undo");
    const refine = overlay.querySelector(".cm-refine");
    const removeBg = overlay.querySelector(".cm-remove-bg");
    const enhanceBtn = overlay.querySelector(".cm-enhance-btn");

    let undoStack = [];
    let sessionFilename = "";
    let sessionProductId = 0;
    let dirty = false;

    const close = () => {
      undoStack = [];
      dirty = false;
      sessionFilename = "";
      sessionProductId = 0;
      overlay.classList.add("hidden");
      overlay.style.display = "none";
      updateEditChrome();
    };

    const setStatus = (text) => {
      if (!statusEl) return;
      statusEl.textContent = text || "";
      statusEl.classList.toggle("is-visible", !!text);
    };
    const setImage = (src) => {
      if (!src) return;
      img.src = src;
    };
    const updateEditChrome = () => {
      if (undoBtn) {
        undoBtn.disabled = undoStack.length === 0;
        undoBtn.classList.toggle("is-active", undoStack.length > 0);
      }
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.classList.toggle("is-dirty", dirty);
      }
    };

    const snapshotBeforeEdit = async () => {
      if (!sessionFilename || !img.src) return false;
      try {
        const res = await fetch(img.src, { cache: "no-store" });
        if (!res.ok) throw new Error("Could not read current photo");
        const blob = await res.blob();
        if (!blob || blob.size < 64) throw new Error("Photo snapshot empty");
        undoStack.push({ blob, filename: sessionFilename });
        dirty = true;
        updateEditChrome();
        return true;
      } catch (e) {
        console.warn("lightbox snapshot failed", e);
        return false;
      }
    };

    const restoreUndo = async () => {
      if (!undoStack.length || !sessionFilename || !sessionProductId) return false;
      const prev = undoStack.pop();
      updateEditChrome();
      const form = new FormData();
      form.append("product_id", String(sessionProductId));
      form.append("filename", sessionFilename);
      form.append("photo", prev.blob, sessionFilename || "restore.jpg");
      const res = await fetch("/api/replace-photo", { method: "POST", body: form });
      const data = await res.json();
      if (!data.success) {
        undoStack.push(prev);
        updateEditChrome();
        throw new Error(data.error || "Undo failed");
      }
      dirty = undoStack.length > 0;
      const url =
        (typeof window.cmPath === "function"
          ? window.cmPath("/static/uploads/" + sessionFilename)
          : "/static/uploads/" + sessionFilename) +
        "?t=" +
        Date.now();
      setImage(data.url ? data.url + (data.url.indexOf("?") >= 0 ? "&" : "?") + "t=" + Date.now() : url);
      updateEditChrome();
      return true;
    };

    overlay.querySelector(".cm-lightbox-close").addEventListener("click", close);
    overlay.querySelector(".cm-lightbox-backdrop").addEventListener("click", close);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !overlay.classList.contains("hidden")) close();
    });

    const open = ({
      imageSrc,
      mode,
      filename,
      productId,
      onAdd,
      onDiscard,
      onDelete,
      onSave,
      onChanged,
      onRefineBackground,
      onRemoveBackground,
      onEnhance,
    }) => {
      undoStack = [];
      dirty = false;
      sessionFilename = filename || "";
      sessionProductId = Number(productId || 0) || 0;
      img.src = imageSrc;
      setStatus("");
      actions.classList.remove("hidden");
      removeBg.classList.toggle("hidden", mode !== "saved" || !onRemoveBackground);
      enhanceBtn.classList.toggle("hidden", mode !== "saved" || !onEnhance);
      refine.classList.toggle("hidden", mode !== "saved" || !onRefineBackground);
      add.classList.toggle("hidden", mode !== "inbox");
      discard.classList.toggle("hidden", mode !== "inbox");
      del.classList.toggle("hidden", mode !== "saved" || !onDelete);
      const showSaveUndo = mode === "saved" && !!(onSave || onRemoveBackground || onEnhance);
      undoBtn.classList.toggle("hidden", !showSaveUndo);
      saveBtn.classList.toggle("hidden", !showSaveUndo || !onSave);
      updateEditChrome();

      add.onclick = async () => onAdd && onAdd();
      discard.onclick = async () => onDiscard && onDiscard();
      del.onclick = async () => onDelete && onDelete();
      refine.onclick = async () => onRefineBackground && onRefineBackground();

      saveBtn.onclick = async () => {
        setStatus("Saved");
        if (onSave) await onSave();
        else close();
      };

      undoBtn.onclick = async () => {
        if (!undoStack.length) return;
        undoBtn.disabled = true;
        const prevLabel = undoBtn.textContent;
        undoBtn.textContent = "Undoing…";
        setStatus("Undoing last change…");
        try {
          await restoreUndo();
          setStatus(undoStack.length ? "Undone — more steps available" : "Undone");
          if (onChanged) onChanged();
        } catch (err) {
          setStatus("");
          alert((err && err.message) || "Undo failed");
        } finally {
          undoBtn.textContent = prevLabel || "Undo";
          updateEditChrome();
        }
      };

      enhanceBtn.onclick = async () => {
        if (!onEnhance) return;
        enhanceBtn.disabled = true;
        const prev = enhanceBtn.textContent;
        enhanceBtn.textContent = "Enhancing…";
        setStatus("Enhancing — photo stays open so you can compare…");
        try {
          await snapshotBeforeEdit();
          const ok = await onEnhance();
          if (ok) {
            dirty = true;
            setStatus("Enhanced — Undo or Save when done");
          } else {
            if (undoStack.length) undoStack.pop();
            // Reject/error messages already surfaced by enhancePhotos / status
            if (!statusEl || !statusEl.textContent) setStatus("");
          }
          updateEditChrome();
        } catch (err) {
          if (undoStack.length) undoStack.pop();
          setStatus((err && err.message) || "");
        } finally {
          enhanceBtn.disabled = false;
          enhanceBtn.textContent = prev || "Enhance";
        }
      };
      removeBg.onclick = async () => {
        if (!onRemoveBackground) return;
        removeBg.disabled = true;
        removeBg.textContent = "Removing…";
        setStatus("Removing background — photo stays open…");
        try {
          await snapshotBeforeEdit();
          const ok = await onRemoveBackground();
          if (ok === false) {
            if (undoStack.length) undoStack.pop();
            setStatus("");
          } else {
            dirty = true;
            setStatus("Background removed — Undo or Save when done");
          }
          updateEditChrome();
        } finally {
          removeBg.disabled = false;
          removeBg.textContent = "Remove background";
        }
      };
      overlay.style.display = "flex";
      overlay.classList.remove("hidden");
    };
    return { open, close, setImage, setStatus };
  }
})();
