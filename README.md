# 設計部待辦

設計部的待辦清單網頁（可安裝成 App），資料存在 Supabase。

- 網址：https://sanping1225.github.io/1110/
- 項目：待規劃案件、待計算數量案件、已完成
- 待規劃案件每列：圖面規劃完成、計算書完成、修改次數、已成交、未成交原因、設計人員、業務人員、架型（重型架／輕型架／標準架／系統模）
- 頁面下方有統計：設計案件總數、修改次數總數、設計人員案量、個別業務成交數量、成交率

## 檔案

- `index.html`、`design.js`、`style.css`：網頁本身（`design.html` 只是把舊網址轉到首頁）
- `config.js`：Supabase 網址與 publishable key（公開金鑰）
- `manifest.webmanifest`、`sw.js`、`pwa.js`、`icons/`：安裝成 App 與離線開啟
- `supabase/design_items_all.sql`：建立或更新資料表，整份貼到 Supabase SQL Editor 執行即可（可重複執行、不刪資料）
- `supabase/design_items*.sql`：各版本的更新檔（已合併在 `design_items_all.sql`）
- `supabase/drop_repair_requests.sql`：（選用）刪除舊的報修資料表
