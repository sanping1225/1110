// 報修登記：送出表單、讀取最近 20 筆清單
(function () {
  "use strict";

  const TABLE = "repair_requests";
  const LIST_LIMIT = 20;

  const form = document.getElementById("repair-form");
  const submitBtn = document.getElementById("submit-btn");
  const formMsg = document.getElementById("form-message");
  const listEl = document.getElementById("request-list");
  const listMsg = document.getElementById("list-message");
  const refreshBtn = document.getElementById("refresh-btn");
  const descEl = document.getElementById("description");
  const descCount = document.getElementById("desc-count");

  function showMessage(el, text, kind) {
    el.textContent = text;
    el.className = "message " + kind;
    el.hidden = false;
  }

  function hideMessage(el) {
    el.hidden = true;
    el.textContent = "";
  }

  // 檢查 supabase-js 與設定是否都載入成功
  const cfg = window.APP_CONFIG || {};
  if (!window.supabase || !window.supabase.createClient) {
    showMessage(formMsg, "無法載入 Supabase 程式庫，請檢查網路後重新整理頁面。", "error");
    showMessage(listMsg, "無法載入清單。", "error");
    submitBtn.disabled = true;
    refreshBtn.disabled = true;
    return;
  }
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) {
    showMessage(formMsg, "缺少 Supabase 設定，請檢查 config.js。", "error");
    submitBtn.disabled = true;
    refreshBtn.disabled = true;
    return;
  }

  // 這個網頁不需要登入，關閉登入狀態的保存
  const db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // 把資料庫錯誤轉成使用者看得懂的訊息
  function friendlyError(error) {
    if (!error) return "發生未知錯誤，請稍後再試。";
    switch (error.code) {
      case "23514": return "資料不符合規定（選項或字數），請檢查後再送出。";
      case "23502": return "有必填欄位沒有填寫。";
      case "42501": return "沒有權限執行這個動作，請聯絡管理員。";
      case "PGRST205":
      case "42P01": return "找不到報修資料表，請在 Supabase 執行 supabase/schema.sql。";
    }
    if (error.message && /fetch|network/i.test(error.message)) {
      return "連線失敗，請檢查網路後再試一次。";
    }
    return "送出失敗：" + (error.message || "請稍後再試。");
  }

  function selectedValue(name) {
    const el = form.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : "";
  }

  // 前端先檢查一次，資料庫的 CHECK 仍是最後防線
  function readForm() {
    const data = {
      reporter_name: document.getElementById("reporter_name").value.trim(),
      location: document.getElementById("location").value.trim(),
      category: selectedValue("category"),
      description: descEl.value.trim(),
      urgency: selectedValue("urgency") || "中",
    };
    const missing = [];
    if (!data.reporter_name) missing.push("報修人");
    if (!data.location) missing.push("地點或部門");
    if (!data.category) missing.push("類別");
    if (!data.description) missing.push("問題說明");
    return { data, missing };
  }

  descEl.addEventListener("input", function () {
    descCount.textContent = String(descEl.value.length);
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    hideMessage(formMsg);

    const { data, missing } = readForm();
    if (missing.length) {
      showMessage(formMsg, "請填寫：" + missing.join("、"), "error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "送出中…";
    try {
      // 不送 status、id、created_at，由資料庫自動產生
      const { error } = await db.from(TABLE).insert(data);
      if (error) {
        showMessage(formMsg, friendlyError(error), "error");
        return;
      }
      showMessage(formMsg, "已送出報修，謝謝！", "ok");
      form.reset();
      descCount.textContent = "0";
      loadList();
    } catch (err) {
      showMessage(formMsg, friendlyError(err), "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "送出報修";
    }
  });

  const timeFmt = new Intl.DateTimeFormat("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    // 一律用 textContent，避免使用者輸入的內容被當成 HTML 執行
    if (text != null) node.textContent = text;
    return node;
  }

  function renderList(rows) {
    listEl.replaceChildren();
    if (!rows.length) {
      showMessage(listMsg, "目前還沒有報修。", "info");
      return;
    }
    hideMessage(listMsg);
    for (const row of rows) {
      const li = el("li", "request");
      const top = el("div", "request-top");
      top.append(
        el("span", "tag", row.category),
        el("span", "tag urg-" + row.urgency, "緊急：" + row.urgency),
        el("span", "tag", row.status)
      );
      li.append(
        top,
        el("p", "request-desc", row.description),
        el("p", "request-meta",
          row.reporter_name + "｜" + row.location + "｜" + timeFmt.format(new Date(row.created_at)))
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
        .select("id, created_at, reporter_name, location, category, description, urgency, status")
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT);
      if (error) {
        showMessage(listMsg, "無法載入清單：" + friendlyError(error), "error");
        return;
      }
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
