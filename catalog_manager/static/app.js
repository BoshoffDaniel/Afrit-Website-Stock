(function () {
  "use strict";
  const byId = (id) => document.getElementById(id);
  const debounce = (fn, wait) => {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  };

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
    wireAdminModalOnce();
    return openAdminModal();
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
    if (res.status === 403 && data.need_admin && retries !== 0) {
      const ok = await window.showAdminUnlock();
      if (ok) return window.fetchWithAdmin(url, opts, 0);
    }
    return { res, data };
  };

  document.addEventListener("DOMContentLoaded", wireAdminModalOnce);

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
        const cOk = !c || row.dataset.category === c;
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
    const toggle = (id, target) => byId(id) && byId(id).addEventListener("click", () => {
      const el = byId(target);
      el.type = el.type === "password" ? "text" : "password";
    });
    toggle("toggleApiKeyBtn", "shopify_api_key");
    toggle("toggleGroqKeyBtn", "groq_api_key");

    const savePayload = () => ({
      shopify_store_url: byId("shopify_store_url").value,
      shopify_api_key: byId("shopify_api_key").value,
      groq_api_key: byId("groq_api_key").value,
      products_total_target: byId("products_total_target").value,
    });

    const doSave = async () => {
      const { res, data } = await window.fetchWithAdmin("/settings/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(savePayload()),
      });
      return { res, data };
    };

    saveBtn.addEventListener("click", async () => {
      status.textContent = "Saving...";
      const { data } = await doSave();
      if (!data.success) {
        status.textContent = data.error || "Save failed";
        status.className = "save-status error";
        return;
      }
      status.textContent = "Saved settings.";
      status.className = "save-status ok";
      const hasGroq = !!(byId("groq_api_key").value || "").trim();
      groqStatus.textContent = hasGroq ? "Ready" : "Not configured";
      groqStatus.className = `status-pill ${hasGroq ? "ready" : "off"}`;
    });

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

    const list = byId("hubProductList");
    const searchInput = byId("hubSearchInput");
    const categoryFilter = byId("hubCategoryFilter");
    const statusFilter = byId("hubStatusFilter");
    if (list && searchInput) {
      const items = Array.from(list.querySelectorAll(".products-list-item"));
      const apply = () => {
        const q = (searchInput.value || "").toLowerCase().trim();
        const c = (categoryFilter.value || "").toLowerCase();
        const s = (statusFilter.value || "").toLowerCase();
        items.forEach((row) => {
          const hay = `${row.dataset.stock} ${row.dataset.name} ${row.dataset.category}`;
          const qOk = !q || hay.includes(q);
          const cOk = !c || row.dataset.category === c;
          const sOk = !s || (s === "pushed" ? row.dataset.pushed === "1" : row.dataset.status === s);
          row.classList.toggle("hidden", !(qOk && cOk && sOk));
        });
      };
      searchInput.addEventListener("input", apply);
      categoryFilter.addEventListener("change", apply);
      statusFilter.addEventListener("change", apply);
      apply();
    }

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
        window.location.href = `/products?selected=${data.id}`;
      });
    }
  };

  window.initProductPage = function () {
    const page = byId("productPage");
    if (!page) return;
    const data = JSON.parse(byId("productData").textContent);
    const productId = data.id;
    const embed = page.dataset.embed === "1";
    if (embed && window.parent && window.parent !== window) {
      if (typeof window.parent.showAdminUnlock === "function") {
        window.showAdminUnlock = window.parent.showAdminUnlock.bind(window.parent);
      }
      if (typeof window.parent.fetchWithAdmin === "function") {
        window.fetchWithAdmin = window.parent.fetchWithAdmin.bind(window.parent);
      }
    }
    let productStatus = data.status === "done" ? "done" : "pending";
    let photos = Array.isArray(data.photos) ? data.photos.slice() : [];
    let dragged = null;
    const lightbox = createLightbox();

    const syncDataLabels = () => {
      const sc = byId("stock_code").value;
      const nm = byId("name").value;
      const cat = byId("category").value;
      const sup = byId("supplier").value;
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
      autoSave: byId("autoSaveIndicator"),
      pushOneBtn: byId("pushOneBtn"),
      pushOneStatus: byId("pushOneStatus"),
      optionalWrap: byId("optionalFields"),
      optionalToggle: byId("toggleOptionalFields"),
    };

    const fields = ["stock_code", "name", "category", "supplier", "web_description", "sell_price", "compare_price", "tags", "notes", "shopify_sku"].map(byId);
    const setStatusMsg = (msg, type) => {
      by.saveStatus.textContent = msg;
      by.saveStatus.className = `save-status ${type || ""}`.trim();
    };
    const collectPayload = () => {
      syncDataLabels();
      return {
        stock_code: byId("stock_code").value,
        name: byId("name").value,
        category: byId("category").value,
        supplier: byId("supplier").value,
        web_description: byId("web_description").value,
        sell_price: byId("sell_price").value,
        compare_price: byId("compare_price").value,
        tags: byId("tags").value,
        notes: byId("notes").value,
        status: productStatus,
        shopify_sku: byId("shopify_sku").value,
        photos: photos.slice(),
      };
    };

    const saveProduct = async (redirectAfter) => {
      setStatusMsg("Saving...");
      const res = await fetch(`/product/${productId}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collectPayload()),
      });
      const respData = await res.json();
      if (!respData.success) {
        setStatusMsg(respData.error || "Save failed", "error");
        return false;
      }
      setStatusMsg("Saved!", "ok");
      document.body.classList.add("flash-green");
      setTimeout(() => document.body.classList.remove("flash-green"), 450);
      if (redirectAfter) {
        setTimeout(() => {
          if (embed) window.parent.location.href = `/products?selected=${productId}`;
          else window.location.href = "/products";
        }, 800);
      }
      return true;
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

    const renderPhotoGrid = () => {
      by.photoGrid.innerHTML = "";
      photos.forEach((name, idx) => {
        const el = document.createElement("div");
        el.className = "thumb";
        el.draggable = true;
        el.dataset.filename = name;
        el.innerHTML = `${idx === 0 ? '<div class="main-label">★ Main</div>' : ""}<img src="/static/uploads/${name}?t=${Date.now()}" alt=""><button type="button" class="delete-btn">Delete</button>`;
        el.querySelector("img").addEventListener("click", () => {
          lightbox.open({
            imageSrc: `/static/uploads/${name}?t=${Date.now()}`,
            mode: "saved",
            onDelete: async () => {
              await deletePhoto(name);
              lightbox.close();
            },
          });
        });
        el.querySelector(".delete-btn").addEventListener("click", async () => deletePhoto(name));
        by.photoGrid.appendChild(el);
      });
      bindDrag();
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
      by.uploadError.textContent = "";
      for (const file of Array.from(fileList)) {
        const fd = new FormData();
        fd.append("photo", file);
        fd.append("product_id", String(productId));
        const res = await fetch("/api/upload-photo", { method: "POST", body: fd });
        const pdata = await res.json();
        if (!pdata.success) {
          by.uploadError.textContent = pdata.error || "Upload failed";
          continue;
        }
        photos.push(pdata.filename);
        renderPhotoGrid();
        if (pdata.processing) pollPhoto(pdata.filename);
      }
    };

    by.uploadZone.addEventListener("click", () => by.uploadInput.click());
    by.uploadInput.addEventListener("change", (e) => uploadFiles(e.target.files));
    ["dragenter", "dragover"].forEach((evt) => by.uploadZone.addEventListener(evt, (e) => { e.preventDefault(); by.uploadZone.classList.add("drag-over"); }));
    ["dragleave", "drop"].forEach((evt) => by.uploadZone.addEventListener(evt, (e) => { e.preventDefault(); by.uploadZone.classList.remove("drag-over"); }));
    by.uploadZone.addEventListener("drop", (e) => uploadFiles(e.dataTransfer.files));

    const claimInbox = async (name) => {
      const res = await fetch("/api/claim-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: name, product_id: productId }),
      });
      const pdata = await res.json();
      if (pdata.success) {
        photos.push(pdata.filename);
        renderPhotoGrid();
        if (pdata.processing) pollPhoto(pdata.filename);
        pollInbox();
      }
    };
    const discardInbox = async (name) => {
      await fetch("/api/discard-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: name }),
      });
      pollInbox();
    };
    const renderInbox = (files) => {
      if (!files.length) {
        by.inboxTray.innerHTML = `<div class="watching-row"><span class="dot-pulse"></span><span>Watching for new photos...</span></div>`;
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
    const pollInbox = async () => {
      const res = await fetch("/api/check-inbox");
      const pdata = await res.json();
      const files = pdata.files || [];
      renderInbox(files);
    };

    const autoSave = debounce(async () => {
      by.autoSave.classList.add("show");
      await saveProduct(false);
      setTimeout(() => by.autoSave.classList.remove("show"), 600);
    }, 2200);
    fields.forEach((f) => {
      if (!f) return;
      f.addEventListener("input", autoSave);
      f.addEventListener("change", autoSave);
    });

    by.statusToggle.addEventListener("click", () => {
      productStatus = productStatus === "pending" ? "done" : "pending";
      by.statusToggle.classList.toggle("done", productStatus === "done");
      by.statusToggle.classList.toggle("pending", productStatus !== "done");
      by.statusToggle.textContent = productStatus === "done" ? "DONE ✓" : "PENDING";
    });
    by.saveBtn.addEventListener("click", async () => { await saveProduct(true); });

    const nav = async (hubHref, prodId) => {
      await saveProduct(false);
      if (embed && hubHref) window.parent.location.href = hubHref;
      else window.location.href = `/product/${prodId}`;
    };
    by.prevBtn.addEventListener("click", async () => nav(by.prevBtn.dataset.hubHref, by.prevBtn.dataset.id));
    by.nextBtn.addEventListener("click", async () => nav(by.nextBtn.dataset.hubHref, by.nextBtn.dataset.id));

    if (by.optionalToggle) {
      by.optionalToggle.addEventListener("click", (e) => {
        e.preventDefault();
        by.optionalWrap.classList.toggle("hidden");
        by.optionalToggle.textContent = by.optionalWrap.classList.contains("hidden") ? "Show optional fields" : "Hide optional fields";
      });
    }

    const skuInput = byId("shopify_sku");
    byId("regenSkuBtn").addEventListener("click", () => {
      syncDataLabels();
      const category = (byId("category").value || "").replace(/[^A-Za-z]/g, "");
      const prefix = category ? category.slice(0, 3).toUpperCase() : "GEN";
      skuInput.value = `${prefix}-${byId("stock_code").value}`;
      autoSave();
    });

    const aiBtn = byId("aiDescBtn");
    const aiStatus = byId("aiDescStatus");
    if (aiBtn) {
      aiBtn.addEventListener("click", async () => {
        aiBtn.disabled = true;
        aiStatus.textContent = "Generating description...";
        const res = await fetch("/api/generate-description", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ product_id: productId }),
        });
        const result = await res.json();
        if (result.success) {
          byId("web_description").value = result.description;
          aiStatus.textContent = "Description generated ✓";
          aiStatus.className = "save-status ok";
          autoSave();
        } else {
          aiStatus.textContent = result.error || "Generation failed";
          aiStatus.className = "save-status error";
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
        if (embed) window.parent.location.href = "/products";
        else window.location.href = "/products";
      });
    }

    renderPhotoGrid();
    pollInbox();
    setInterval(pollInbox, 2000);
  };

  function createLightbox() {
    const overlay = document.createElement("div");
    overlay.className = "cm-lightbox hidden";
    overlay.innerHTML = `<div class="cm-lightbox-backdrop"></div><div class="cm-lightbox-content"><button class="cm-lightbox-close" type="button">×</button><img class="cm-lightbox-image" alt=""><div class="cm-lightbox-actions hidden"><button class="btn btn-green cm-add" type="button">✓ Add to product</button><button class="btn cm-discard" type="button">✗ Discard - Retake</button><button class="btn cm-delete hidden" type="button">Delete photo</button></div></div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.classList.add("hidden");
    const img = overlay.querySelector(".cm-lightbox-image");
    const actions = overlay.querySelector(".cm-lightbox-actions");
    const add = overlay.querySelector(".cm-add");
    const discard = overlay.querySelector(".cm-discard");
    const del = overlay.querySelector(".cm-delete");
    overlay.querySelector(".cm-lightbox-close").addEventListener("click", close);
    overlay.querySelector(".cm-lightbox-backdrop").addEventListener("click", close);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.classList.contains("hidden")) close(); });
    const open = ({ imageSrc, mode, onAdd, onDiscard, onDelete }) => {
      img.src = imageSrc;
      actions.classList.remove("hidden");
      add.classList.toggle("hidden", mode !== "inbox");
      discard.classList.toggle("hidden", mode !== "inbox");
      del.classList.toggle("hidden", mode !== "saved");
      add.onclick = async () => onAdd && onAdd();
      discard.onclick = async () => onDiscard && onDiscard();
      del.onclick = async () => onDelete && onDelete();
      overlay.classList.remove("hidden");
    };
    return { open, close };
  }
})();
