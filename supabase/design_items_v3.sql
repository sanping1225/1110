-- =====================================================================
-- 設計部待辦 第 3 版：修改次數、是否成交、未成交原因
-- 前提：已執行過 design_items.sql（第 1 版）與 design_items_v2.sql（第 2 版）。
-- 本檔做的事：
--   新增三個欄位（顯示在待規劃案件「計算書完成」後面）：
--     revision_count  修改次數（0～999，預設 0）
--     deal_closed     是否成交（預設否）
--     lost_reason     未成交原因（最多 200 字，可空白）
--   並開放網頁新增、修改這三個欄位。仍然不能刪除資料。
-- 不會刪除任何資料。可重複執行。
-- 使用方式：整份貼到 Supabase SQL Editor 執行。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 新增欄位
-- ---------------------------------------------------------------------
alter table public.design_items
    add column if not exists revision_count integer not null default 0;  -- 修改次數

alter table public.design_items
    add column if not exists deal_closed boolean not null default false; -- 是否成交

alter table public.design_items
    add column if not exists lost_reason text;                           -- 未成交原因


-- ---------------------------------------------------------------------
-- 2. 第 3 層 CHECK：限制數值範圍與文字長度
-- ---------------------------------------------------------------------
alter table public.design_items drop constraint if exists design_items_revision_count_range;
alter table public.design_items
    add constraint design_items_revision_count_range
    check (revision_count between 0 and 999);

alter table public.design_items drop constraint if exists design_items_lost_reason_len;
alter table public.design_items
    add constraint design_items_lost_reason_len
    check (lost_reason is null or char_length(lost_reason) <= 200);


-- ---------------------------------------------------------------------
-- 3. 第 1 層 GRANT：開放新欄位
-- ---------------------------------------------------------------------
grant insert (category, content, done, plan_done, calc_done,
              revision_count, deal_closed, lost_reason)
    on table public.design_items to anon;

grant update (content, done, plan_done, calc_done,
              revision_count, deal_closed, lost_reason)
    on table public.design_items to anon;

-- RLS 政策沿用第 1 版（可讀取、新增、修改；不能刪除），不需變更。


-- ---------------------------------------------------------------------
-- 4. 通知 Supabase API 重新讀取資料表結構
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';
