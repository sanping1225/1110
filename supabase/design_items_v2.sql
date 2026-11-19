-- =====================================================================
-- 設計部待辦 第 2 版：圖面規劃完成 / 計算書完成 兩段勾選
-- 前提：已執行過 supabase/design_items.sql（第 1 版）。
-- 本檔做的事：
--   1. 新增兩個欄位：plan_done（圖面規劃完成）、calc_done（計算書完成）。
--   2. 「計算書待計算案件」改成「待規劃案件」的子項目：
--        待規劃案件且圖面規劃已完成、計算書未完成 → 顯示在「計算書待計算案件」。
--      舊的「計算書待計算案件」資料自動轉成：待規劃案件＋圖面規劃已完成。
--   3. 待規劃案件：兩個都勾選才算「已完成」（由資料庫自動判斷）。
--      待計算數量案件：維持一個「已完成」勾選。
-- 不會刪除任何資料。可重複執行。
-- 使用方式：整份貼到 Supabase SQL Editor 執行。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 新增欄位
-- ---------------------------------------------------------------------
alter table public.design_items
    add column if not exists plan_done boolean not null default false;  -- 圖面規劃完成

alter table public.design_items
    add column if not exists calc_done boolean not null default false;  -- 計算書完成


-- ---------------------------------------------------------------------
-- 2. 更新觸發程序：自動維護 done、done_at、updated_at
-- ---------------------------------------------------------------------
-- 待規劃案件：done = 圖面規劃完成 且 計算書完成。
-- 待計算數量案件：done 由網頁的「已完成」勾選決定。
create or replace function public.design_items_set_times()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.category = '待規劃案件' then
        new.done := new.plan_done and new.calc_done;
    end if;

    if tg_op = 'INSERT' then
        new.updated_at := now();
        new.done_at := case when new.done then now() else null end;
    else
        new.created_at := old.created_at;
        new.updated_at := now();
        if new.done and not old.done then
            new.done_at := now();
        elsif not new.done then
            new.done_at := null;
        else
            new.done_at := old.done_at;
        end if;
    end if;
    return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. 轉換舊資料（先移除舊的項目限制，轉換後再加新的限制）
-- ---------------------------------------------------------------------
alter table public.design_items drop constraint if exists design_items_category_valid;

-- 舊的「計算書待計算案件」→ 待規劃案件＋圖面規劃已完成；原本已完成的，計算書也算完成。
update public.design_items
   set category  = '待規劃案件',
       plan_done = true,
       calc_done = done
 where category = '計算書待計算案件';

-- 原本已完成的待規劃案件 → 兩個都算完成。
update public.design_items
   set plan_done = true,
       calc_done = true
 where category = '待規劃案件' and done and not (plan_done and calc_done);

-- 第 3 層 CHECK：項目只剩兩個。
alter table public.design_items
    add constraint design_items_category_valid
    check (category in ('待規劃案件', '待計算數量案件'));


-- ---------------------------------------------------------------------
-- 4. 第 1 層 GRANT：開放新欄位
-- ---------------------------------------------------------------------
-- 新增：項目、內容、是否完成、兩個勾選。
grant insert (category, content, done, plan_done, calc_done)
    on table public.design_items to anon;

-- 修改：內容、是否完成、兩個勾選；仍不能改項目、時間或 id，也不能刪除。
grant update (content, done, plan_done, calc_done)
    on table public.design_items to anon;

-- RLS 政策沿用第 1 版（可讀取、新增、修改；不能刪除），不需變更。


-- ---------------------------------------------------------------------
-- 5. 通知 Supabase API 重新讀取資料表結構
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';
