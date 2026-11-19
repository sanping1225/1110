// 設計部待辦（條列式）
// 選單：待規劃案件、待計算數量案件、已完成。
//   待規劃案件每列有兩個勾選：圖面規劃完成、計算書完成；兩個都勾並送出後移到「已完成」。
//   待計算數量案件每列一個勾選：已完成。
// 按「確認送出」一次保存所有變更到 Supabase 的 design_items。
(function () {
  "use strict";

  const TABLE = "design_items";
  const PLAN = "待規劃案件";
  const QTY = "待計算數量案件";
  const DONE_TAB = "已完成";
  const EDIT_TABS = [PLAN, QTY];
  const TITLES = {
    [PLAN]: "待規劃案件",
    [QTY]: "待計算數量案件",
    [DONE_TAB]: "已完成",
  };
  const HINTS = {
    [PLAN]: "每列填一件事；「圖面規劃完成」「計算書完成」兩個都勾並送出後，會移到「已完成」。",
    [QTY]: "每列填一件事；勾選「已完成」並送出後，會移到「已完成」。",
    [DONE_TAB]: "取消勾選並按「確認送出」，可移回原本的項目。",
  };
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
  // items：資料庫裡的資料；edit 開頭的欄位是畫面上尚未送出的修改
  // drafts：各分頁還沒存進資料庫的新列
  let items = [];
  const drafts = {};
  EDIT_TABS.forEach((t) => { drafts[t] = []; });
  let draftSeq = 0;
  let currentTab = PLAN;
  let saving = false;

  function newDraft() {
    draftSeq += 1;
    return { key: "d" + draftSeq, content: "", plan: false, calc: false, done: false };
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
        return "資料表尚未建立：請在 Supabase SQL Editor 依序執行 supabase/design_items.sql、supabase/design_items_v2.sql。";
      case "42703":
      case "PGRST204":
        return "資料表需要更新：請在 Supabase SQL Editor 執行 supabase/design_items_v2.sql。";
      case "23514": return "內容不符合規定（每列 1～500 字）。若剛更新過，請確認已執行 supabase/design_items_v2.sql。";
      case "23502": return "有必填欄位沒有填寫。";
      case "42501": return "沒有權限，請確認已執行 supabase/design_items_v2.sql。";
    }
    if (error.message && /fetch|network/i.test(error.message)) {
      return "連線失敗，請檢查網路後再試一次。";
    }
    return error.message || "請稍後再試。";
  }

  // ---------- 分類與變更 ----------
  // 依「已保存」的狀態決定顯示在哪個分頁（勾選後要按送出才會移動）
  function tabOf(it) {
    return it.done ? DONE_TAB : it.category;
  }

  function itemChanged(it) {
    return it.editContent.trim() !== it.content ||
      it.editPlan !== it.plan_done || it.editCalc !== it.calc_done || it.editDone !== it.done;
  }

  function draftToRow(tab, d) {
    if (tab === QTY) {
      return { category: QTY, content: d.content.trim(), done: d.done, plan_done: false, calc_done: false };
    }
    return { category: PLAN, content: d.content.trim(), done: d.plan && d.calc, plan_done: d.plan, calc_done: d.calc };
  }

  function updateBody(it) {
    const body = { content: it.editContent.trim(), plan_done: it.editPlan, calc_done: it.editCalc };
    // 待規劃案件的 done 由資料庫依兩個勾選自動判斷；這裡也送一樣的值
    body.done = it.category === PLAN ? it.editPlan && it.editCalc : it.editDone;
    return body;
  }

  function pendingChanges() {
    const inserts = [];
    EDIT_TABS.forEach((t) => {
      drafts[t].forEach((d) => { if (d.content.trim()) inserts.push(draftToRow(t, d)); });
    });
    return { inserts, updates: items.filter(itemChanged) };
  }

  function updateSaveStatus() {
    const { inserts, updates } = pendingChanges();
    const n = inserts.length + updates.length;
    saveStatus.textContent = n ? "有 " + n + " 項變更尚未送出" : "沒有未儲存的變更";
    saveStatus.classList.toggle("dirty", n > 0);
  }

  function updateCounts() {
    const counts = { [PLAN]: 0, [QTY]: 0, [DONE_TAB]: 0 };
    items.forEach((it) => { counts[tabOf(it)] += 1; });
    menuEl.querySelectorAll("[data-count]").forEach((el) => {
      el.textContent = String(counts[el.dataset.count]);
    });
  }

  // ---------- 畫面 ----------
  const timeFmt = new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  // opts: { value, placeholder, tag, meta, checks: [{label, get, set}], onInput, isChanged, isStruck }
  function makeRow(opts) {
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
    main.append(input);
    if (opts.meta) {
      const meta = document.createElement("span");
      meta.className = "item-meta";
      meta.textContent = opts.meta;
      main.append(meta);
    }

    const checks = document.createElement("div");
    checks.className = "item-checks";

    function refresh() {
      li.classList.toggle("checked", opts.isStruck());
      li.classList.toggle("changed", opts.isChanged());
      updateSaveStatus();
    }

    input.addEventListener("input", () => { opts.onInput(input.value); refresh(); });

    opts.checks.forEach((c) => {
      const label = document.createElement("label");
      label.className = "done-toggle";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = c.get();
      box.addEventListener("change", () => { c.set(box.checked); refresh(); });
      const text = document.createElement("span");
      text.textContent = c.label;
      label.append(box, text);
      checks.append(label);
    });

    li.classList.toggle("checked", opts.isStruck());
    li.classList.toggle("changed", opts.isChanged());
    li.append(main, checks);
    return { li, input };
  }

  // 依項目決定要顯示哪些勾選
  function planChecks(get, set) {
    return [
      { label: "圖面規劃完成", get: () => get("plan"), set: (v) => set("plan", v) },
      { label: "計算書完成", get: () => get("calc"), set: (v) => set("calc", v) },
    ];
  }

  function draftRow(tab, d) {
    const row = makeRow({
      value: d.content,
      placeholder: "新增一列…",
      checks: tab === QTY
        ? [{ label: "已完成", get: () => d.done, set: (v) => { d.done = v; } }]
        : planChecks((k) => d[k], (k, v) => { d[k] = v; }),
      onInput: (v) => {
        d.content = v;
        // 在最後一列輸入時，自動補一列空白，方便繼續條列
        const list = drafts[tab];
        if (v.trim() && list[list.length - 1] === d) addDraft(tab, false);
      },
      isChanged: () => d.content.trim() !== "",
      isStruck: () => (tab === QTY ? d.done : d.plan && d.calc),
    });
    row.li.classList.add("draft");
    return row;
  }

  function addDraft(tab, focus) {
    const d = newDraft();
    drafts[tab].push(d);
    if (currentTab === tab) {
      const row = draftRow(tab, d);
      listEl.append(row.li);
      if (focus) row.input.focus();
    }
  }

  function itemRow(it, inDoneTab) {
    const isPlan = it.category === PLAN;
    const key = { plan: "editPlan", calc: "editCalc" };
    return makeRow({
      value: it.editContent,
      tag: inDoneTab ? it.category : "",
      meta: inDoneTab && it.done_at ? "完成於 " + timeFmt.format(new Date(it.done_at)) : "",
      checks: isPlan
        ? planChecks((k) => it[key[k]], (k, v) => { it[key[k]] = v; })
        : [{ label: "已完成", get: () => it.editDone, set: (v) => { it.editDone = v; } }],
      onInput: (v) => { it.editContent = v; },
      isChanged: () => itemChanged(it),
      isStruck: () => (isPlan ? it.editPlan && it.editCalc : it.editDone),
    }).li;
  }

  function render() {
    menuEl.querySelectorAll(".menu-item").forEach((b) => {
      const active = b.dataset.tab === currentTab;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", String(active));
    });
    titleEl.textContent = TITLES[currentTab];
    hintEl.textContent = HINTS[currentTab];
    listEl.replaceChildren();

    if (currentTab === DONE_TAB) {
      addRowBtn.hidden = true;
      const done = items.filter((it) => tabOf(it) === DONE_TAB);
      if (!done.length) {
        showMessage(listMsg, "目前沒有已完成的項目。", "info");
        return;
      }
      hideMessage(listMsg);
      done.slice().sort((a, b) => String(b.done_at).localeCompare(String(a.done_at)))
        .forEach((it) => listEl.append(itemRow(it, true)));
      return;
    }

    addRowBtn.hidden = false;
    hideMessage(listMsg);
    items.filter((it) => tabOf(it) === currentTab).forEach((it) => listEl.append(itemRow(it, false)));
    if (!drafts[currentTab].length) drafts[currentTab].push(newDraft());
    drafts[currentTab].forEach((d) => listEl.append(draftRow(currentTab, d).li));
  }

  // ---------- 資料 ----------
  // keepEdits：保留畫面上尚未送出的修改（用於部分送出失敗時）
  async function load(keepEdits) {
    const edits = {};
    if (keepEdits) items.filter(itemChanged).forEach((it) => {
      edits[it.id] = { editContent: it.editContent, editPlan: it.editPlan, editCalc: it.editCalc, editDone: it.editDone };
    });
    reloadBtn.disabled = true;
    saveBtn.disabled = true;
    showMessage(listMsg, "載入中…", "info");
    try {
      const { data, error } = await db
        .from(TABLE)
        .select("id, created_at, category, content, done, done_at, plan_done, calc_done")
        .order("created_at", { ascending: true })
        .limit(1000);
      if (error) throw error;
      items = (data || []).map((it) => ({
        ...it,
        editContent: it.content, editPlan: it.plan_done, editCalc: it.calc_done, editDone: it.done,
        ...(edits[it.id] || {}),
      }));
      if (!keepEdits) EDIT_TABS.forEach((t) => { drafts[t] = []; });
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
    if (updates.some((it) => !it.editContent.trim())) {
      showMessage(listMsg, "已存在的列不能清空；不需要的項目請勾選完成。", "error");
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
        EDIT_TABS.forEach((t) => { drafts[t] = []; });
        insertedOk = true;
      }
      const results = await Promise.all(updates.map((it) =>
        db.from(TABLE).update(updateBody(it)).eq("id", it.id)
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
