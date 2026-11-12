// 設計部待辦（條列式）：
// 選單切換三個待辦項目與「已完成」；每個項目逐列填寫、勾選已完成；
// 按「確認送出」一次保存所有變更到 Supabase 的 design_items。
(function () {
  "use strict";

  const TABLE = "design_items";
  const CATEGORIES = ["待規劃案件", "待計算數量案件", "計算書待計算案件"];
  const DONE_TAB = "已完成";
  const MAX_LEN = 500;

  const menuEl = document.getElementById("menu");
  const titleEl = document.getElementById("panel-title");
  const hintEl = document.getElementById("panel-hint");
  const listEl = document.getElementById("item-list");
  const listMsg = document.getElementById("list-message");
  const addRowBtn = document.getElementById("add-row-btn");
  const reloadBtn = document.getElementById("reload-btn");
  const saveBtn = document.getElementById("save-btn");
  const saveStatus = document.getElementById("save-status");

  // ---------- 狀態 ----------
  // items：資料庫裡的資料，每筆另外記錄畫面上的修改（editContent、editDone）
  // drafts：每個項目還沒存進資料庫的新列
  let items = [];
  const drafts = {};
  CATEGORIES.forEach((c) => { drafts[c] = []; });
  let draftSeq = 0;
  let currentTab = CATEGORIES[0];
  let saving = false;

  function newDraft() {
    draftSeq += 1;
    return { key: "d" + draftSeq, content: "", done: false };
  }

  function showMessage(el, text, kind) {
    el.textContent = text;
    el.className = "message " + kind;
    el.hidden = false;
  }

  function hideMessage(el) {
    el.hidden = true;
    el.textContent = "";
  }

  const cfg = window.APP_CONFIG || {};
  if (!window.supabase || !window.supabase.createClient ||
      !cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) {
    showMessage(listMsg, "無法載入 Supabase，請檢查網路或 config.js 後重新整理頁面。", "error");
    saveBtn.disabled = true;
    reloadBtn.disabled = true;
    addRowBtn.disabled = true;
    return;
  }

  const db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  function friendlyError(error) {
    if (!error) return "發生未知錯誤，請稍後再試。";
    switch (error.code) {
      case "PGRST205":
      case "42P01":
        return "資料表尚未建立：請在 Supabase SQL Editor 執行 supabase/design_items.sql。";
      case "23514": return "內容不符合規定（每列 1～500 字）。";
      case "23502": return "有必填欄位沒有填寫。";
      case "42501": return "沒有權限，請確認已執行 supabase/design_items.sql。";
    }
    if (error.message && /fetch|network/i.test(error.message)) {
      return "連線失敗，請檢查網路後再試一次。";
    }
    return error.message || "請稍後再試。";
  }

  // ---------- 變更計算 ----------
  function itemChanged(it) {
    return it.editContent.trim() !== it.content || it.editDone !== it.done;
  }

  function pendingChanges() {
    const inserts = [];
    CATEGORIES.forEach((c) => {
      drafts[c].forEach((d) => {
        const content = d.content.trim();
        if (content) inserts.push({ category: c, content, done: d.done });
      });
    });
    const updates = items.filter(itemChanged);
    return { inserts, updates };
  }

  function updateSaveStatus() {
    const { inserts, updates } = pendingChanges();
    const n = inserts.length + updates.length;
    saveStatus.textContent = n ? "有 " + n + " 項變更尚未送出" : "沒有未儲存的變更";
    saveStatus.classList.toggle("dirty", n > 0);
  }

  function updateCounts() {
    const counts = { [DONE_TAB]: 0 };
    CATEGORIES.forEach((c) => { counts[c] = 0; });
    items.forEach((it) => {
      if (it.done) counts[DONE_TAB] += 1;
      else counts[it.category] += 1;
    });
    menuEl.querySelectorAll("[data-count]").forEach((el) => {
      el.textContent = String(counts[el.dataset.count]);
    });
  }

  // ---------- 畫面 ----------
  const timeFmt = new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  function makeRow(opts) {
    // opts: { value, checked, tag, meta, onInput, onCheck, placeholder }
    const li = document.createElement("li");
    li.className = "item-row";

    const main = document.createElement("div");
    main.className = "item-main";
    if (opts.tag) {
      const tag = document.createElement("span");
      tag.className = "tag task-type";
      tag.textContent = opts.tag;
      main.append(tag);
    }
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = MAX_LEN;
    input.value = opts.value;
    input.placeholder = opts.placeholder || "填寫內容";
    input.setAttribute("aria-label", "內容");
    input.addEventListener("input", () => {
      opts.onInput(input.value);
      li.classList.toggle("changed", opts.isChanged());
      updateSaveStatus();
    });
    main.append(input);
    if (opts.meta) {
      const meta = document.createElement("span");
      meta.className = "item-meta";
      meta.textContent = opts.meta;
      main.append(meta);
    }

    const label = document.createElement("label");
    label.className = "done-toggle";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = opts.checked;
    box.addEventListener("change", () => {
      opts.onCheck(box.checked);
      li.classList.toggle("checked", box.checked);
      li.classList.toggle("changed", opts.isChanged());
      updateSaveStatus();
    });
    const text = document.createElement("span");
    text.textContent = "已完成";
    label.append(box, text);

    li.classList.toggle("checked", opts.checked);
    li.classList.toggle("changed", opts.isChanged());
    li.append(main, label);
    return { li, input };
  }

  function draftRow(category, d) {
    const row = makeRow({
      value: d.content,
      checked: d.done,
      placeholder: "新增一列…",
      onInput: (v) => {
        d.content = v;
        // 在最後一列輸入時，自動補一列空白，方便繼續條列
        const list = drafts[category];
        if (v.trim() && list[list.length - 1] === d) addDraft(category, false);
      },
      onCheck: (v) => { d.done = v; },
      isChanged: () => d.content.trim() !== "",
    });
    row.li.classList.add("draft");
    return row;
  }

  function addDraft(category, focus) {
    const d = newDraft();
    drafts[category].push(d);
    if (currentTab === category) {
      const row = draftRow(category, d);
      listEl.append(row.li);
      if (focus) row.input.focus();
    }
  }

  function itemRow(it, showCategory) {
    return makeRow({
      value: it.editContent,
      checked: it.editDone,
      tag: showCategory ? it.category : "",
      meta: showCategory && it.done_at ? "完成於 " + timeFmt.format(new Date(it.done_at)) : "",
      onInput: (v) => { it.editContent = v; },
      onCheck: (v) => { it.editDone = v; },
      isChanged: () => itemChanged(it),
    }).li;
  }

  function render() {
    menuEl.querySelectorAll(".menu-item").forEach((b) => {
      const active = b.dataset.tab === currentTab;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", String(active));
    });
    titleEl.textContent = currentTab;
    listEl.replaceChildren();

    if (currentTab === DONE_TAB) {
      hintEl.textContent = "取消勾選並按「確認送出」，可移回原本的項目。";
      addRowBtn.hidden = true;
      const done = items.filter((it) => it.done);
      if (!done.length) {
        showMessage(listMsg, "目前沒有已完成的項目。", "info");
        return;
      }
      hideMessage(listMsg);
      done.slice().sort((a, b) => String(b.done_at).localeCompare(String(a.done_at)))
        .forEach((it) => listEl.append(itemRow(it, true)));
      return;
    }

    hintEl.textContent = "每列填一件事；勾選「已完成」並送出後，會移到「已完成」。";
    addRowBtn.hidden = false;
    hideMessage(listMsg);
    items.filter((it) => it.category === currentTab && !it.done)
      .forEach((it) => listEl.append(itemRow(it, false)));
    if (!drafts[currentTab].length) drafts[currentTab].push(newDraft());
    drafts[currentTab].forEach((d) => listEl.append(draftRow(currentTab, d).li));
  }

  // ---------- 資料 ----------
  // keepEdits：保留畫面上尚未送出的修改（用於部分送出失敗時）
  async function load(keepEdits) {
    const edits = {};
    if (keepEdits) items.filter(itemChanged).forEach((it) => {
      edits[it.id] = { editContent: it.editContent, editDone: it.editDone };
    });
    reloadBtn.disabled = true;
    saveBtn.disabled = true;
    showMessage(listMsg, "載入中…", "info");
    try {
      const { data, error } = await db
        .from(TABLE)
        .select("id, created_at, category, content, done, done_at")
        .order("created_at", { ascending: true })
        .limit(1000);
      if (error) throw error;
      items = (data || []).map((it) => ({
        ...it, editContent: it.content, editDone: it.done, ...(edits[it.id] || {}),
      }));
      if (!keepEdits) CATEGORIES.forEach((c) => { drafts[c] = []; });
      updateCounts();
      render();
      updateSaveStatus();
      saveBtn.disabled = false;
    } catch (err) {
      items = [];
      updateCounts();
      listEl.replaceChildren();
      showMessage(listMsg, "無法載入：" + friendlyError(err), "error");
    } finally {
      reloadBtn.disabled = false;
    }
  }

  async function save() {
    if (saving) return;
    const { inserts, updates } = pendingChanges();
    if (!inserts.length && !updates.length) {
      saveStatus.textContent = "沒有需要送出的變更";
      return;
    }
    const emptied = updates.filter((it) => !it.editContent.trim());
    if (emptied.length) {
      showMessage(listMsg, "已存在的列不能清空；不需要的項目請勾選「已完成」。", "error");
      return;
    }

    saving = true;
    saveBtn.disabled = true;
    saveBtn.textContent = "送出中…";
    let insertedOk = false;
    try {
      if (inserts.length) {
        const { error } = await db.from(TABLE).insert(inserts);
        if (error) throw error;
        // 新列已保存，清掉草稿，避免之後重送時重複新增
        CATEGORIES.forEach((c) => { drafts[c] = []; });
        insertedOk = true;
      }
      const results = await Promise.all(updates.map((it) =>
        db.from(TABLE)
          .update({ content: it.editContent.trim(), done: it.editDone })
          .eq("id", it.id)
      ));
      const failed = results.find((r) => r.error);
      if (failed) throw failed.error;

      await load();
      showMessage(listMsg, "已送出並保存（新增 " + inserts.length + " 列，更新 " + updates.length + " 列）。", "ok");
      saveStatus.textContent = "已保存";
    } catch (err) {
      // 新增成功但更新失敗時：重新載入（保留未送出的修改），以免重複新增
      if (insertedOk) await load(true);
      showMessage(listMsg, "送出失敗：" + friendlyError(err), "error");
    } finally {
      saving = false;
      saveBtn.disabled = false;
      saveBtn.textContent = "確認送出";
    }
  }

  // ---------- 事件 ----------
  menuEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".menu-item");
    if (!btn) return;
    currentTab = btn.dataset.tab;
    render();
  });

  addRowBtn.addEventListener("click", () => addDraft(currentTab, true));

  reloadBtn.addEventListener("click", () => {
    const { inserts, updates } = pendingChanges();
    if ((inserts.length || updates.length) &&
        !window.confirm("有尚未送出的變更，重新整理會捨棄這些變更。確定嗎？")) return;
    load();
  });

  saveBtn.addEventListener("click", save);

  // 有未送出的變更時，離開頁面前提醒
  window.addEventListener("beforeunload", (e) => {
    const { inserts, updates } = pendingChanges();
    if (inserts.length || updates.length) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  render();
  load();
})();
