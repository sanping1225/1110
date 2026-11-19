// 設計部待辦（條列式）
// 選單：待規劃案件、待計算數量案件、已完成。
//   待規劃案件每列有兩個勾選：圖面規劃完成、計算書完成；兩個都勾並送出後移到「已完成」。
//     另有：修改次數、是否成交（已成交）、未成交原因、設計人員。
// 頁面最下方顯示統計（設計案件總數等）。
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
  const REASON_MAX = 200;
  const REV_MAX = 999;
  const DESIGNER_MAX = 50;

  const menuEl = document.getElementById("menu");
  const titleEl = document.getElementById("panel-title");
  const hintEl = document.getElementById("panel-hint");
  const listEl = document.getElementById("item-list");
  const listMsg = document.getElementById("list-message");
  const addRowBtn = document.getElementById("add-row-btn");
  const reloadBtn = document.getElementById("reload-btn");
  const saveBtn = document.getElementById("save-btn");
  const saveStatus = document.getElementById("save-status");
  const statsTotalEl = document.getElementById("stats-total");
  const statsListEl = document.getElementById("stats-list");
  const designerListEl = document.getElementById("designer-list");

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
    return { key: "d" + draftSeq, content: "", plan: false, calc: false, done: false, rev: 0, deal: false, reason: "", designer: "" };
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
        return "資料表需要更新：請在 Supabase SQL Editor 執行 supabase/design_items_v4.sql（若尚未執行 v2、v3，請先依序執行）。";
      case "23514": return "內容不符合規定（每列 1～500 字、修改次數 0～999、未成交原因最多 200 字、設計人員最多 50 字）。";
      case "23502": return "有必填欄位沒有填寫。";
      case "42501": return "沒有權限，請確認已執行 supabase/design_items_v4.sql。";
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

  // 未成交原因、設計人員：空白存成 null
  function reasonValue(v) {
    const t = (v || "").trim();
    return t ? t : null;
  }

  function itemChanged(it) {
    return it.editContent.trim() !== it.content ||
      it.editPlan !== it.plan_done || it.editCalc !== it.calc_done || it.editDone !== it.done ||
      it.editRev !== it.revision_count || it.editDeal !== it.deal_closed ||
      reasonValue(it.editReason) !== reasonValue(it.lost_reason) ||
      reasonValue(it.editDesigner) !== reasonValue(it.designer);
  }

  function draftToRow(tab, d) {
    if (tab === QTY) {
      return { category: QTY, content: d.content.trim(), done: d.done, plan_done: false, calc_done: false };
    }
    return {
      category: PLAN, content: d.content.trim(), done: d.plan && d.calc, plan_done: d.plan, calc_done: d.calc,
      revision_count: d.rev, deal_closed: d.deal, lost_reason: reasonValue(d.reason),
      designer: reasonValue(d.designer),
    };
  }

  function updateBody(it) {
    const body = { content: it.editContent.trim(), plan_done: it.editPlan, calc_done: it.editCalc };
    // 待規劃案件的 done 由資料庫依兩個勾選自動判斷；這裡也送一樣的值
    body.done = it.category === PLAN ? it.editPlan && it.editCalc : it.editDone;
    if (it.category === PLAN) {
      body.revision_count = it.editRev;
      body.deal_closed = it.editDeal;
      body.lost_reason = reasonValue(it.editReason);
      body.designer = reasonValue(it.editDesigner);
    }
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

  // ---------- 統計 ----------
  // 依已保存的資料計算（不含尚未送出的變更）
  function renderStats() {
    const plan = items.filter((it) => it.category === PLAN);
    const qty = items.filter((it) => it.category === QTY);
    const doneCount = (list) => list.filter((it) => it.done).length;
    statsTotalEl.textContent = String(items.length);

    // 每列：[名稱, 件數, 補充說明]
    const split = (list) => "進行中 " + (list.length - doneCount(list)) + "・已完成 " + doneCount(list);
    const rows = [
      ["待規劃案件", plan.length + " 件", split(plan)],
      ["待計算數量案件", qty.length + " 件", split(qty)],
      ["已成交", plan.filter((it) => it.deal_closed).length + " 件", ""],
    ];
    const byDesigner = new Map();
    plan.forEach((it) => {
      const name = (it.designer || "").trim() || "（未填）";
      byDesigner.set(name, (byDesigner.get(name) || 0) + 1);
    });
    [...byDesigner.entries()]
      // 件數多的在前；「（未填）」固定放最後
      .sort((a, b) => (a[0] === "（未填）") - (b[0] === "（未填）") || b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hant"))
      .forEach(([name, n]) => rows.push(["設計人員：" + name, n + " 件"]));

    statsListEl.replaceChildren();
    rows.forEach(([k, v, sub]) => {
      const dt = document.createElement("dt");
      dt.textContent = k;
      if (sub) {
        const small = document.createElement("span");
        small.className = "stats-sub";
        small.textContent = sub;
        dt.append(small);
      }
      const dd = document.createElement("dd");
      dd.textContent = v;
      statsListEl.append(dt, dd);
    });

    // 設計人員輸入建議
    designerListEl.replaceChildren();
    [...byDesigner.keys()].filter((n) => n !== "（未填）").forEach((n) => {
      const opt = document.createElement("option");
      opt.value = n;
      designerListEl.append(opt);
    });
  }

  // ---------- 畫面 ----------
  const timeFmt = new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  // opts: { value, placeholder, tag, meta, checks: [{label, get, set}], extras: {get, set} | null,
  //         onInput, isChanged, isStruck }
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

    const syncs = []; // 勾選改變時要同步更新的畫面（例如已成交時停用未成交原因）
    function refresh() {
      li.classList.toggle("checked", opts.isStruck());
      li.classList.toggle("changed", opts.isChanged());
      syncs.forEach((f) => f());
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

    let extrasEl = null;
    if (opts.extras) {
      const x = opts.extras;
      extrasEl = document.createElement("div");
      extrasEl.className = "item-extras";

      // 修改次數：− 數字 +
      const rev = document.createElement("div");
      rev.className = "rev-field";
      const revLabel = document.createElement("span");
      revLabel.className = "rev-label";
      revLabel.textContent = "修改次數";
      const minus = document.createElement("button");
      minus.type = "button";
      minus.className = "secondary stepper";
      minus.textContent = "−";
      minus.setAttribute("aria-label", "修改次數減 1");
      const num = document.createElement("input");
      num.type = "number";
      num.min = "0";
      num.max = String(REV_MAX);
      num.inputMode = "numeric";
      num.className = "rev-input";
      num.setAttribute("aria-label", "修改次數");
      num.value = String(x.get("rev"));
      const plus = document.createElement("button");
      plus.type = "button";
      plus.className = "secondary stepper";
      plus.textContent = "+";
      plus.setAttribute("aria-label", "修改次數加 1");
      function setRev(v) {
        const n = Math.max(0, Math.min(REV_MAX, Number.isFinite(v) ? Math.trunc(v) : 0));
        x.set("rev", n);
        num.value = String(n);
        refresh();
      }
      minus.addEventListener("click", () => setRev(x.get("rev") - 1));
      plus.addEventListener("click", () => setRev(x.get("rev") + 1));
      num.addEventListener("change", () => setRev(parseInt(num.value, 10)));
      rev.append(revLabel, minus, num, plus);

      // 已成交
      const dealLabel = document.createElement("label");
      dealLabel.className = "done-toggle";
      const dealBox = document.createElement("input");
      dealBox.type = "checkbox";
      dealBox.checked = x.get("deal");
      dealBox.addEventListener("change", () => { x.set("deal", dealBox.checked); refresh(); });
      const dealText = document.createElement("span");
      dealText.textContent = "已成交";
      dealLabel.append(dealBox, dealText);

      // 未成交原因（已成交時停用）
      const reason = document.createElement("input");
      reason.type = "text";
      reason.maxLength = REASON_MAX;
      reason.className = "reason-input";
      reason.placeholder = "未成交原因";
      reason.setAttribute("aria-label", "未成交原因");
      reason.value = x.get("reason") || "";
      reason.addEventListener("input", () => { x.set("reason", reason.value); refresh(); });
      syncs.push(() => { reason.disabled = x.get("deal"); });

      // 設計人員（可從曾經輸入過的名字中挑選）
      const designer = document.createElement("input");
      designer.type = "text";
      designer.maxLength = DESIGNER_MAX;
      designer.className = "designer-input";
      designer.placeholder = "設計人員";
      designer.setAttribute("aria-label", "設計人員");
      designer.setAttribute("list", "designer-list");
      designer.autocomplete = "off";
      designer.value = x.get("designer") || "";
      designer.addEventListener("input", () => { x.set("designer", designer.value); refresh(); });

      extrasEl.append(rev, dealLabel, reason, designer);
    }

    li.classList.toggle("checked", opts.isStruck());
    li.classList.toggle("changed", opts.isChanged());
    syncs.forEach((f) => f());
    li.append(main, checks);
    if (extrasEl) li.append(extrasEl);
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
      extras: tab === QTY ? null : { get: (k) => d[k], set: (k, v) => { d[k] = v; } },
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
    const key = { plan: "editPlan", calc: "editCalc", rev: "editRev", deal: "editDeal", reason: "editReason", designer: "editDesigner" };
    return makeRow({
      value: it.editContent,
      tag: inDoneTab ? it.category : "",
      meta: inDoneTab && it.done_at ? "完成於 " + timeFmt.format(new Date(it.done_at)) : "",
      checks: isPlan
        ? planChecks((k) => it[key[k]], (k, v) => { it[key[k]] = v; })
        : [{ label: "已完成", get: () => it.editDone, set: (v) => { it.editDone = v; } }],
      extras: isPlan ? { get: (k) => it[key[k]], set: (k, v) => { it[key[k]] = v; } } : null,
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
      edits[it.id] = {
        editContent: it.editContent, editPlan: it.editPlan, editCalc: it.editCalc, editDone: it.editDone,
        editRev: it.editRev, editDeal: it.editDeal, editReason: it.editReason, editDesigner: it.editDesigner,
      };
    });
    reloadBtn.disabled = true;
    saveBtn.disabled = true;
    showMessage(listMsg, "載入中…", "info");
    try {
      const { data, error } = await db
        .from(TABLE)
        .select("id, created_at, category, content, done, done_at, plan_done, calc_done, revision_count, deal_closed, lost_reason, designer")
        .order("created_at", { ascending: true })
        .limit(1000);
      if (error) throw error;
      items = (data || []).map((it) => ({
        ...it,
        editContent: it.content, editPlan: it.plan_done, editCalc: it.calc_done, editDone: it.done,
        editRev: it.revision_count, editDeal: it.deal_closed, editReason: it.lost_reason || "",
        editDesigner: it.designer || "",
        ...(edits[it.id] || {}),
      }));
      if (!keepEdits) EDIT_TABS.forEach((t) => { drafts[t] = []; });
      updateCounts();
      renderStats();
      render();
      updateSaveStatus();
      saveBtn.disabled = false;
    } catch (err) {
      items = [];
      updateCounts();
      renderStats();
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
