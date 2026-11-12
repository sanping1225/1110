// 設計部待辦：選擇類型、填寫內容、確認送出，並顯示最近 20 筆
(function () {
  "use strict";

  const TABLE = "design_tasks";
  const LIST_LIMIT = 20;
  const TYPES = ["待規劃案件", "待計算數量案件", "計算書待計算案件"];

  const form = document.getElementById("task-form");
  const typeEl = document.getElementById("task_type");
  const contentEl = document.getElementById("content");
  const countEl = document.getElementById("content-count");
  const submitBtn = document.getElementById("submit-btn");
  const formMsg = document.getElementById("form-message");
  const listEl = document.getElementById("task-list");
  const listMsg = document.getElementById("list-message");
  const refreshBtn = document.getElementById("refresh-btn");

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
    showMessage(formMsg, "無法載入 Supabase，請檢查網路或 config.js 後重新整理頁面。", "error");
    submitBtn.disabled = true;
    refreshBtn.disabled = true;
    return;
  }

  const db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // 把資料庫錯誤轉成看得懂的訊息
  function friendlyError(error) {
    if (!error) return "發生未知錯誤，請稍後再試。";
    switch (error.code) {
      case "PGRST205":
      case "42P01":
        return "資料表尚未建立：請在 Supabase SQL Editor 執行 supabase/design_tasks.sql。";
      case "23514": return "資料不符合規定（類型或字數），請檢查後再送出。";
      case "23502": return "有必填欄位沒有填寫。";
      case "42501": return "沒有權限執行這個動作，請確認已執行 supabase/design_tasks.sql。";
    }
    if (error.message && /fetch|network/i.test(error.message)) {
      return "連線失敗，請檢查網路後再試一次。";
    }
    return error.message || "請稍後再試。";
  }

  contentEl.addEventListener("input", function () {
    countEl.textContent = String(contentEl.value.length);
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    hideMessage(formMsg);

    const task_type = typeEl.value;
    const content = contentEl.value.trim();
    const missing = [];
    if (!TYPES.includes(task_type)) missing.push("待辦類型");
    if (!content) missing.push("內容");
    if (missing.length) {
      showMessage(formMsg, "請填寫：" + missing.join("、"), "error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "送出中…";
    try {
      // 只送 task_type 與 content；id、登錄時間由資料庫產生
      const { error } = await db.from(TABLE).insert({ task_type, content });
      if (error) throw error;
      showMessage(formMsg, "已送出並保存：" + task_type, "ok");
      form.reset();
      countEl.textContent = "0";
      loadList();
    } catch (err) {
      showMessage(formMsg, "送出失敗：" + friendlyError(err), "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "確認送出";
    }
  });

  const timeFmt = new Intl.DateTimeFormat("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    // 一律用 textContent，避免內容被當成 HTML 執行
    if (text != null) node.textContent = text;
    return node;
  }

  function renderList(rows) {
    listEl.replaceChildren();
    if (!rows.length) {
      showMessage(listMsg, "目前還沒有登錄。", "info");
      return;
    }
    hideMessage(listMsg);
    for (const row of rows) {
      const li = el("li", "request");
      const top = el("div", "request-top");
      top.append(el("span", "tag task-type", row.task_type));
      li.append(
        top,
        el("p", "request-desc", row.content),
        el("p", "request-meta", timeFmt.format(new Date(row.created_at)))
      );
      listEl.append(li);
    }
  }

  async function loadList() {
    refreshBtn.disabled = true;
    if (!listEl.children.length) showMessage(listMsg, "載入中…", "info");
    try {
      const { data, error } = await db
        .from(TABLE)
        .select("id, created_at, task_type, content")
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT);
      if (error) throw error;
      renderList(data || []);
    } catch (err) {
      showMessage(listMsg, "無法載入清單：" + friendlyError(err), "error");
    } finally {
      refreshBtn.disabled = false;
    }
  }

  refreshBtn.addEventListener("click", loadList);
  loadList();
})();
