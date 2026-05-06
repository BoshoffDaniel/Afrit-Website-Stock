(function () {
  "use strict";

  function byId(id) { return document.getElementById(id); }
  function debounce(fn, wait) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  window.initDashboard = function () {
    const searchInput = byId("searchInput");
    const categoryFilter = byId("categoryFilter");
    const statusFilter = byId("statusFilter");
    const table = byId("productsTable");
    const pushAllBtn = byId("pushAllBtn");
    const batchWrap = byId("batchPushProgress");
    const batchBar = byId("batchPushBar");
    const batchText = byId("batchPushText");
    if (!table) return;

    const rows = Array.from(table.querySelectorAll("tbody tr"));
    const applyFilters = () => {
      const q = (searchInput.value || "").toLowerCase().trim();
      const c = (categoryFilter.value || "").toLowerCase();
      const s = (statusFilter.value || "").toLowerCase();
      rows.forEach((row) => {
        const hay = `${row.dataset.stock} ${row.dataset.name} ${row.dataset.category}`;
        const qOk = !q || hay.includes(q);
        const cOk = !c || row.dataset.category === c;
        const sOk = !s || (s === "pushed" ? row.dataset.pushed === "1" : row.dataset.status === s);
        row.style.display = qOk && cOk && sOk ? "" : "none";
      });
    };
    searchInput && searchInput.addEventListener("keyup", applyFilters);
    categoryFilter && categoryFilter.addEventListener("change", applyFilters);
    statusFilter && statusFilter.addEventListener("change", applyFilters);

    let pollTimer = null;
    const pollPushProgress = async () => {
      const res = await fetch("/api/push-progress");
      const p = await res.json();
      const total = p.total || 0;
      const done = (p.pushed || 0) + (p.failed || 0);
      const pct = total ? Math.round((done / total) * 100) : 0;
      batchBar.style.width = `${pct}%`;
      batchText.textContent = `Pushed ${p.pushed || 0}, Failed ${p.failed || 0}, Current: ${p.current || "-"}`;
      if (!p.running) {
        clearInterval(pollTimer);
        setTimeout(() => window.location.reload(), 1000);
      }
    };

    if (pushAllBtn) {
      pushAllBtn.addEventListener("click", async () => {
        pushAllBtn.disabled = true;
        batchWrap.classList.remove("hidden");
        const res = await fetch("/api/push-all-to-shopify", { method: "POST" });
        const data = await res.json();
        if (!data.success) {
          batchText.textContent = data.error || "Failed to start batch push";
          pushAllBtn.disabled = false;
          return;
        }
        pollTimer = setInterval(pollPushProgress, 1000);
        pollPushProgress();
      });
    }
  };

  window.initSettingsPage = function () {
    const saveBtn = byId("saveSettingsBtn");
    if (!saveBtn) return;
    const status = byId("settingsStatus");
    const toggle = byId("toggleApiKeyBtn");
    const keyInput = byId("shopify_api_key");
    toggle.addEventListener("click", () => {
      keyInput.type = keyInput.type === "password" ? "text" : "password";
    });

    saveBtn.addEventListener("click", async () => {
      status.textContent = "Saving...";
      const payload = {
        shopify_store_url: byId("shopify_store_url").value,
        shopify_api_key: byId("shopify_api_key").value,
        products_total_target: byId("products_total_target").value,
      };
      const res = await fetch("/settings/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) {
        status.textContent = data.error || "Save failed";
        status.className = "save-status error";
        return;
      }
      status.textContent = data.connected ? "Connected ✓" : `Connection failed: ${data.message}`;
      status.className = data.connected ? "save-status ok" : "save-status error";
    });
  };

  window.initProductPage = function () {
    const page = byId("productPage");
    if (!page) return;
    const data = JSON.parse(byId("productData").textContent);
    const productId = data.id;
    let productStatus = data.status === "done" ? "done" : "pending";
    let photos = Array.isArray(data.photos) ? data.photos.slice() : [];
    let knownInbox = new Set();
    let draggedFilename = null;

    const photoGrid = byId("photoGrid");
    const inboxTray = byId("inboxTray");
    const uploadZone = byId("uploadZone");
    const uploadInput = byId("uploadInput");
    const uploadError = byId("uploadError");
    const saveBtn = byId("saveBtn");
    const saveStatus = byId("saveStatus");
    const prevBtn = byId("prevBtn");
    const nextBtn = byId("nextBtn");
    const statusToggle = byId("statusToggle");
    const autoSaveIndicator = byId("autoSaveIndicator");
    const pushOneBtn = byId("pushOneBtn");
    const pushOneStatus = byId("pushOneStatus");
    const lightbox = createLightbox();

    const fields = ["web_description", "sell_price", "compare_price", "tags", "notes"].map(byId);

    const setSaveStatus = (text, type) => {
      saveStatus.textContent = text;
      saveStatus.className = "save-status" + (type ? ` ${type}` : "");
    };
    const collectPayload = () => ({
      web_description: byId("web_description").value,
      sell_price: byId("sell_price").value,
      compare_price: byId("compare_price").value,
      tags: byId("tags").value,
      notes: byId("notes").value,
      status: productStatus,
      photos: photos.slice(),
    });

    const saveProduct = async (markDoneFlow) => {
      setSaveStatus("Saving...", "");
      const res = await fetch(`/product/${productId}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collectPayload()),
      });
      const data = await res.json();
      if (!data.success) {
        setSaveStatus("Save failed", "error");
        return false;
      }
      setSaveStatus("Saved ✓", "ok");
      if (markDoneFlow && productStatus === "done") {
        document.body.classList.add("flash-green");
        setTimeout(async () => {
          document.body.classList.remove("flash-green");
          const nextRes = await fetch(`/api/next-product?current_id=${productId}&direction=next&filter=pending`);
          const nextData = await nextRes.json();
          if (nextData.id) window.location.href = `/product/${nextData.id}`;
        }, 900);
      }
      return true;
    };

    const renderPhotoGrid = () => {
      photoGrid.innerHTML = "";
      photos.forEach((name, idx) => {
        const el = document.createElement("div");
        el.className = "thumb";
        el.draggable = true;
        el.dataset.filename = name;
        el.innerHTML =
          `${idx === 0 ? '<div class="main-label">★ Main</div>' : ""}` +
          `<img src="/static/uploads/${name}" alt="">` +
          `<button type="button" class="delete-btn">Delete</button>`;
        const imageEl = el.querySelector("img");
        imageEl.addEventListener("click", () => {
          lightbox.open({
            imageSrc: `/static/uploads/${name}`,
            title: name,
            showActions: false,
          });
        });
        photoGrid.appendChild(el);
      });
      bindDnD();
      bindDelete();
    };

    const bindDnD = () => {
      photoGrid.querySelectorAll(".thumb").forEach((thumb) => {
        thumb.addEventListener("dragstart", () => { draggedFilename = thumb.dataset.filename; });
        thumb.addEventListener("dragover", (e) => e.preventDefault());
        thumb.addEventListener("drop", async (e) => {
          e.preventDefault();
          const target = thumb.dataset.filename;
          if (!draggedFilename || draggedFilename === target) return;
          const from = photos.indexOf(draggedFilename);
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

    const bindDelete = () => {
      photoGrid.querySelectorAll(".delete-btn").forEach((btn) => {
        let timer = null;
        btn.addEventListener("click", async () => {
          const name = btn.closest(".thumb").dataset.filename;
          if (btn.dataset.confirm !== "yes") {
            btn.dataset.confirm = "yes";
            btn.textContent = "Sure?";
            timer = setTimeout(() => { btn.dataset.confirm = ""; btn.textContent = "Delete"; }, 2000);
            return;
          }
          clearTimeout(timer);
          const res = await fetch("/api/delete-photo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: name, product_id: productId }),
          });
          const data = await res.json();
          if (data.success) {
            photos = photos.filter((p) => p !== name);
            renderPhotoGrid();
          }
        });
      });
    };

    const addUploadPlaceholder = (name) => {
      const node = document.createElement("div");
      node.className = "thumb uploading";
      node.innerHTML = `<div class="spinner"></div><div class="upload-name">${name}</div>`;
      photoGrid.appendChild(node);
      return node;
    };

    const uploadFiles = async (fileList) => {
      uploadError.textContent = "";
      for (const file of Array.from(fileList)) {
        const ph = addUploadPlaceholder(file.name);
        const fd = new FormData();
        fd.append("photo", file);
        fd.append("product_id", String(productId));
        try {
          const res = await fetch("/api/upload-photo", { method: "POST", body: fd });
          const data = await res.json();
          if (!data.success) throw new Error(data.error || "Upload failed");
          photos.push(data.filename);
          ph.remove();
          renderPhotoGrid();
        } catch (err) {
          ph.remove();
          uploadError.textContent = err.message;
        }
      }
    };

    uploadZone.addEventListener("click", () => uploadInput.click());
    uploadInput.addEventListener("change", (e) => uploadFiles(e.target.files));
    ["dragenter", "dragover"].forEach((evt) => uploadZone.addEventListener(evt, (e) => {
      e.preventDefault(); uploadZone.classList.add("drag-over");
    }));
    ["dragleave", "drop"].forEach((evt) => uploadZone.addEventListener(evt, (e) => {
      e.preventDefault(); uploadZone.classList.remove("drag-over");
    }));
    uploadZone.addEventListener("drop", (e) => uploadFiles(e.dataTransfer.files));

    const beep = () => {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const audio = new Ctx();
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.08;
      osc.connect(gain); gain.connect(audio.destination); osc.start();
      setTimeout(() => { osc.stop(); audio.close(); }, 150);
    };

    const renderInbox = (files) => {
      if (!files.length) {
        inboxTray.innerHTML = `<div class="watching-row"><span class="dot-pulse"></span><span>Watching for new photos...</span></div>`;
        return;
      }
      inboxTray.innerHTML = "";
      files.forEach((name) => {
        const item = document.createElement("div");
        item.className = "inbox-item";
        item.innerHTML = `<div class="inbox-thumb"><img src="/api/inbox-preview/${encodeURIComponent(name)}" alt="${name}"></div>
          <button class="btn btn-green add-btn" data-name="${name}">Add to product</button>
          <button class="btn btn-light skip-btn" data-name="${name}">Skip</button>`;
        const thumb = item.querySelector(".inbox-thumb");
        const thumbImg = item.querySelector(".inbox-thumb img");
        thumbImg.addEventListener("error", () => {
          thumb.innerHTML = `<div class="inbox-thumb-name">${name}</div>`;
        });
        thumb.addEventListener("click", () => {
          lightbox.open({
            imageSrc: `/api/inbox-preview/${encodeURIComponent(name)}`,
            title: name,
            showActions: true,
            onAdd: async () => {
              const res = await fetch("/api/claim-inbox", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filename: name, product_id: productId }),
              });
              const data = await res.json();
              if (data.success) {
                photos.push(data.filename);
                renderPhotoGrid();
                pollInbox();
                lightbox.close();
              }
            },
            onDiscard: async () => {
              await fetch("/api/discard-inbox", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filename: name }),
              });
              pollInbox();
              lightbox.close();
            },
          });
        });
        inboxTray.appendChild(item);
      });
      inboxTray.querySelectorAll(".add-btn").forEach((btn) => btn.addEventListener("click", async () => {
        const res = await fetch("/api/claim-inbox", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: btn.dataset.name, product_id: productId }),
        });
        const data = await res.json();
        if (data.success) { photos.push(data.filename); renderPhotoGrid(); pollInbox(); }
      }));
      inboxTray.querySelectorAll(".skip-btn").forEach((btn) => btn.addEventListener("click", async () => {
        await fetch("/api/discard-inbox", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: btn.dataset.name }),
        });
        pollInbox();
      }));
    };

    const pollInbox = async () => {
      const res = await fetch("/api/check-inbox");
      const data = await res.json();
      const files = data.files || [];
      if (files.some((f) => !knownInbox.has(f))) beep();
      knownInbox = new Set(files);
      renderInbox(files);
    };

    const autoSave = debounce(async () => {
      autoSaveIndicator.classList.add("show");
      await saveProduct(false);
      setTimeout(() => autoSaveIndicator.classList.remove("show"), 800);
    }, 3000);
    fields.forEach((f) => {
      f.addEventListener("input", autoSave);
      f.addEventListener("change", autoSave);
    });

    statusToggle.addEventListener("click", () => {
      productStatus = productStatus === "pending" ? "done" : "pending";
      statusToggle.classList.toggle("done", productStatus === "done");
      statusToggle.classList.toggle("pending", productStatus !== "done");
      statusToggle.textContent = productStatus === "done" ? "DONE ✓" : "PENDING";
      autoSave();
    });

    saveBtn.addEventListener("click", () => saveProduct(true));
    prevBtn.addEventListener("click", async () => { await saveProduct(false); window.location.href = `/product/${prevBtn.dataset.id}`; });
    nextBtn.addEventListener("click", async () => { await saveProduct(false); window.location.href = `/product/${nextBtn.dataset.id}`; });

    if (pushOneBtn) {
      pushOneBtn.addEventListener("click", async () => {
        pushOneBtn.disabled = true;
        pushOneStatus.textContent = "Pushing to Shopify...";
        const res = await fetch(`/api/push-to-shopify/${productId}`, { method: "POST" });
        const data = await res.json();
        if (data.success) {
          pushOneStatus.textContent = "Pushed to Shopify ✓";
          pushOneStatus.className = "save-status ok";
        } else {
          pushOneStatus.textContent = data.error || "Push failed";
          pushOneStatus.className = "save-status error";
          pushOneBtn.disabled = false;
        }
      });
    }

    document.addEventListener("keydown", async (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === "s") { e.preventDefault(); await saveProduct(false); }
      else if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); productStatus = "done"; statusToggle.classList.add("done"); statusToggle.classList.remove("pending"); statusToggle.textContent = "DONE ✓"; await saveProduct(true); }
      else if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); await saveProduct(false); window.location.href = `/product/${nextBtn.dataset.id}`; }
      else if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); await saveProduct(false); window.location.href = `/product/${prevBtn.dataset.id}`; }
    });

    renderPhotoGrid();
    pollInbox();
    setInterval(pollInbox, 2000);
  };

  function createLightbox() {
    const overlay = document.createElement("div");
    overlay.className = "cm-lightbox hidden";
    overlay.innerHTML = `
      <div class="cm-lightbox-backdrop"></div>
      <div class="cm-lightbox-content">
        <button type="button" class="cm-lightbox-close" aria-label="Close">×</button>
        <img class="cm-lightbox-image" alt="">
        <div class="cm-lightbox-caption"></div>
        <div class="cm-lightbox-actions hidden">
          <button type="button" class="btn btn-green cm-lightbox-add">Add to product</button>
          <button type="button" class="btn cm-lightbox-discard">Discard - Retake</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const backdrop = overlay.querySelector(".cm-lightbox-backdrop");
    const closeBtn = overlay.querySelector(".cm-lightbox-close");
    const image = overlay.querySelector(".cm-lightbox-image");
    const caption = overlay.querySelector(".cm-lightbox-caption");
    const actions = overlay.querySelector(".cm-lightbox-actions");
    const addBtn = overlay.querySelector(".cm-lightbox-add");
    const discardBtn = overlay.querySelector(".cm-lightbox-discard");

    let onAdd = null;
    let onDiscard = null;

    const close = () => {
      overlay.classList.add("hidden");
      image.src = "";
      caption.textContent = "";
      onAdd = null;
      onDiscard = null;
    };

    closeBtn.addEventListener("click", close);
    backdrop.addEventListener("click", close);
    document.addEventListener("keydown", (e) => {
      if (!overlay.classList.contains("hidden") && e.key === "Escape") close();
    });

    addBtn.addEventListener("click", async () => {
      if (onAdd) await onAdd();
    });
    discardBtn.addEventListener("click", async () => {
      if (onDiscard) await onDiscard();
    });

    const open = ({ imageSrc, title, showActions, onAdd: addCb, onDiscard: discardCb }) => {
      image.src = imageSrc;
      caption.textContent = title || "";
      actions.classList.toggle("hidden", !showActions);
      onAdd = addCb || null;
      onDiscard = discardCb || null;
      overlay.classList.remove("hidden");
    };

    return { open, close };
  }
})();
