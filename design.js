// 設計部代辦：讀取清單、勾選完成、新增事項
(function () {
  "use strict";

  const TABLE = "design_todos";

  const listEl = document.getElementById("todo-list");
  const listMsg = document.getElementById("list-message");
  const refreshBtn = document.getElementById("refresh-btn");
  const form = document.getElementById("todo-form");
  const itemInput = document.getElementById("item");
  const addBtn = document.getElementById("add-btn");
  const formMsg = document.getElementById("form-message");

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
    refreshBtn.disabled = true;
    addBtn.disabled = true;
    return;
  }

  const db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  function friendlyError(error) {
    if (!error) return "發生未知錯誤，請稍後再試。";
    switch (error.code) {
      case "23514": return "內容不符合規定（1～100 字）。";
      case "42501": return "沒有權限執行這個動作，請聯絡管理員。";
      case "42P01": return "找不到代辦資料表，請聯絡管理員。";
    }
    if (error.message && /fetch|network/i.test(error.message)) {
      return "連線失敗，請檢查網路後再試一次。";
    }
    return error.message || "請稍後再試。";
  }

  async function toggle(row, checkbox, li) {
    const next = checkbox.checked;
    checkbox.disabled = true;
    hideMessage(listMsg);
    try {
      // 只送 done 欄位；資料庫也只允許改這一欄
      const { error } = await db.from(TABLE).update({ done: next }).eq("id", row.id);
      if (error) throw error;
      row.done = next;
      li.classList.toggle("done", next);
    } catch (err) {
      checkbox.checked = !next; // 失敗就還原勾選狀態
      showMessage(listMsg, "更新失敗：" + friendlyError(err), "error");
    } finally {
      checkbox.disabled = false;
    }
  }

  function renderList(rows) {
    listEl.replaceChildren();
    if (!rows.length) {
      showMessage(listMsg, "目前沒有代辦事項。", "info");
      return;
    }
    hideMessage(listMsg);
    for (const row of rows) {
      const li = document.createElement("li");
      li.className = "todo" + (row.done ? " done" : "");
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = row.done;
      box.addEventListener("change", () => toggle(row, box, li));
      const text = document.createElement("span");
      // 用 textContent，避免內容被當成 HTML 執行
      text.textContent = row.item;
      label.append(box, text);
      li.append(label);
      listEl.append(li);
    }
  }

  async function loadList() {
    refreshBtn.disabled = true;
    if (!listEl.children.length) showMessage(listMsg, "載入中…", "info");
    try {
      const { data, error } = await db
        .from(TABLE)
        .select("id, created_at, item, done")
        .order("created_at", { ascending: true });
      if (error) throw error;
      renderList(data || []);
    } catch (err) {
      showMessage(listMsg, "無法載入清單：" + friendlyError(err), "error");
    } finally {
      refreshBtn.disabled = false;
    }
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    hideMessage(formMsg);
    const item = itemInput.value.trim();
    if (!item) {
      showMessage(formMsg, "請輸入代辦事項。", "error");
      return;
    }
    addBtn.disabled = true;
    try {
      // 只送 item；done 由資料庫預設為未完成
      const { error } = await db.from(TABLE).insert({ item });
      if (error) throw error;
      showMessage(formMsg, "已新增。", "ok");
      form.reset();
      loadList();
    } catch (err) {
      showMessage(formMsg, "新增失敗：" + friendlyError(err), "error");
    } finally {
      addBtn.disabled = false;
    }
  });

  refreshBtn.addEventListener("click", loadList);
  loadList();
})();
