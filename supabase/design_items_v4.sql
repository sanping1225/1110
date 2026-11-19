-- =====================================================================
-- 設計部待辦 第 4 版：設計人員
-- 前提：已依序執行過 design_items.sql、design_items_v2.sql、design_items_v3.sql。
-- 本檔做的事：
--   新增 designer（設計人員，最多 50 字，可空白），顯示在待規劃案件「未成交原因」後面，
--   並開放網頁新增、修改這個欄位。仍然不能刪除資料。
-- 不會刪除任何資料。可重複執行。
-- 使用方式：整份貼到 Supabase SQL Editor 執行。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 新增欄位
-- ---------------------------------------------------------------------
alter table public.design_items
    add column if not exists designer text;  -- 設計人員


-- ---------------------------------------------------------------------
-- 2. 第 3 層 CHECK：限制文字長度
-- ---------------------------------------------------------------------
alter table public.design_items drop constraint if exists design_items_designer_len;
alter table public.design_items
    add constraint design_items_designer_len
    check (designer is null or char_length(designer) <= 50);


-- ---------------------------------------------------------------------
-- 3. 第 1 層 GRANT：開放新欄位
-- ---------------------------------------------------------------------
grant insert (category, content, done, plan_done, calc_done,
              revision_count, deal_closed, lost_reason, designer)
    on table public.design_items to anon;

grant update (content, done, plan_done, calc_done,
              revision_count, deal_closed, lost_reason, designer)
    on table public.design_items to anon;

-- RLS 政策沿用第 1 版（可讀取、新增、修改；不能刪除），不需變更。


-- ---------------------------------------------------------------------
-- 4. 通知 Supabase API 重新讀取資料表結構
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';
