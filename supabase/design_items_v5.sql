-- =====================================================================
-- 設計部待辦 第 5 版：業務人員、架型勾選
-- 前提：已依序執行過 design_items.sql、v2、v3、v4。
-- 本檔做的事（都顯示在待規劃案件）：
--   sales_person   業務人員（最多 50 字，可空白）
--   heavy_rack     重型架（勾選）
--   light_rack     輕型架（勾選）
--   standard_rack  標準架（勾選）
--   system_form    系統模（勾選）
--   並開放網頁新增、修改這些欄位。仍然不能刪除資料。
-- 不會刪除任何資料。可重複執行。
-- 使用方式：整份貼到 Supabase SQL Editor 執行。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 新增欄位
-- ---------------------------------------------------------------------
alter table public.design_items add column if not exists sales_person  text;                          -- 業務人員
alter table public.design_items add column if not exists heavy_rack    boolean not null default false; -- 重型架
alter table public.design_items add column if not exists light_rack    boolean not null default false; -- 輕型架
alter table public.design_items add column if not exists standard_rack boolean not null default false; -- 標準架
alter table public.design_items add column if not exists system_form   boolean not null default false; -- 系統模


-- ---------------------------------------------------------------------
-- 2. 第 3 層 CHECK：限制文字長度
-- ---------------------------------------------------------------------
alter table public.design_items drop constraint if exists design_items_sales_person_len;
alter table public.design_items
    add constraint design_items_sales_person_len
    check (sales_person is null or char_length(sales_person) <= 50);


-- ---------------------------------------------------------------------
-- 3. 第 1 層 GRANT：開放新欄位
-- ---------------------------------------------------------------------
grant insert (category, content, done, plan_done, calc_done,
              revision_count, deal_closed, lost_reason, designer,
              sales_person, heavy_rack, light_rack, standard_rack, system_form)
    on table public.design_items to anon;

grant update (content, done, plan_done, calc_done,
              revision_count, deal_closed, lost_reason, designer,
              sales_person, heavy_rack, light_rack, standard_rack, system_form)
    on table public.design_items to anon;

-- RLS 政策沿用第 1 版（可讀取、新增、修改；不能刪除），不需變更。


-- ---------------------------------------------------------------------
-- 4. 通知 Supabase API 重新讀取資料表結構
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';
