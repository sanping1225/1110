-- =====================================================================
-- 設計部待辦：一次完成所有設定（第 1 版～第 5 版合併）
-- 不管目前資料庫停在哪一版（甚至還沒建立），整份執行一次就會更新到最新。
-- 內容依序等於：design_items.sql → v2 → v3 → v4 → v5。
-- 不會刪除任何資料。可重複執行。
-- 使用方式：整份貼到 Supabase SQL Editor 執行。
-- =====================================================================



-- #####################################################################
-- ##### 以下內容來自 supabase/design_items.sql
-- #####################################################################

-- =====================================================================
-- 設計部待辦（條列式）：資料表 design_items
-- 用途：三個待辦項目各有自己的條列清單，每一列可填文字、勾選已完成，
--       按「確認送出」後保存。
--   待辦項目：待規劃案件 / 待計算數量案件 / 計算書待計算案件
-- 網頁可以：讀取、新增列、修改文字、勾選或取消已完成。不能刪除。
-- 安全分三層：
--   1. GRANT：anon 只能讀取；新增 category、content、done；
--             修改 content、done。不能刪除。
--   2. RLS：只允許讀取、新增、修改。
--   3. CHECK：項目只能是三個選項，文字限制長度。
-- 使用方式：整份貼到 Supabase SQL Editor 執行即可；可重複執行。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 建立資料表與 CHECK 限制（第 3 層）
-- ---------------------------------------------------------------------
create table if not exists public.design_items (
    id          uuid        primary key default gen_random_uuid(),

    -- 建立時間、最後修改時間：由資料庫自動產生。
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),

    -- 待辦項目：只能是三個選項之一。
    category    text        not null
        constraint design_items_category_valid
        check (category in ('待規劃案件', '待計算數量案件', '計算書待計算案件')),

    -- 條列內容：必填，去除前後空白後 1～500 字。
    content     text        not null
        constraint design_items_content_len
        check (char_length(btrim(content)) between 1 and 500),

    -- 是否已完成，以及完成時間（由觸發程序自動填寫）。
    done        boolean     not null default false,
    done_at     timestamptz
);

comment on table public.design_items is '設計部待辦（條列式）';

-- 清單依建立時間排序，建立索引加快查詢。
create index if not exists design_items_category_created_idx
    on public.design_items (category, created_at);


-- ---------------------------------------------------------------------
-- 自動維護 updated_at 與 done_at
-- ---------------------------------------------------------------------
-- 網頁不能直接寫這兩個欄位，改由資料庫在新增、修改時自動填寫：
--   勾選已完成 → done_at 記錄當下時間；取消已完成 → done_at 清空。
create or replace function public.design_items_set_times()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
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

drop trigger if exists design_items_set_times on public.design_items;
create trigger design_items_set_times
    before insert or update on public.design_items
    for each row execute function public.design_items_set_times();


-- ---------------------------------------------------------------------
-- 第 1 層：GRANT 權限
-- ---------------------------------------------------------------------
-- 先收回所有角色的全部權限，從「什麼都不能做」開始。
revoke all on table public.design_items from public, anon, authenticated;

-- anon 需要能使用 public schema。
grant usage on schema public to anon;

-- 讀取：清單畫面需要。
grant select on table public.design_items to anon;

-- 新增：只能填項目、內容、是否完成；其餘欄位由資料庫產生。
grant insert (category, content, done) on table public.design_items to anon;

-- 修改：只能改內容與是否完成；不能改項目、時間或 id。
grant update (content, done) on table public.design_items to anon;

-- 不授予 delete、truncate：資料不會被刪除。


-- ---------------------------------------------------------------------
-- 第 2 層：RLS 資料列安全
-- ---------------------------------------------------------------------
alter table public.design_items enable row level security;

-- 重複執行本檔時，先移除同名政策再重建。
drop policy if exists "任何人可讀取設計部待辦" on public.design_items;
drop policy if exists "任何人可新增設計部待辦" on public.design_items;
drop policy if exists "任何人可修改設計部待辦" on public.design_items;

create policy "任何人可讀取設計部待辦"
    on public.design_items for select to anon
    using (true);

create policy "任何人可新增設計部待辦"
    on public.design_items for insert to anon
    with check (true);

create policy "任何人可修改設計部待辦"
    on public.design_items for update to anon
    using (true)
    with check (true);

-- 不建立 delete 政策：即使權限被誤開，RLS 仍會擋下刪除。


-- ---------------------------------------------------------------------
-- 搬移舊資料：如果之前已建立 design_tasks，把裡面的資料複製過來
-- ---------------------------------------------------------------------
-- 沿用原本的 id，所以重複執行不會重複複製。舊表不會被刪除。
do $$
begin
    if to_regclass('public.design_tasks') is not null then
        execute $copy$
            insert into public.design_items (id, created_at, category, content)
            select t.id, t.created_at, t.task_type, left(btrim(t.content), 500)
            from public.design_tasks t
            where not exists (select 1 from public.design_items i where i.id = t.id)
        $copy$;
    end if;
end;
$$;


-- ---------------------------------------------------------------------
-- 通知 Supabase API 重新讀取資料表結構
-- ---------------------------------------------------------------------
-- 避免出現「Could not find the table ... in the schema cache」。
notify pgrst, 'reload schema';


-- #####################################################################
-- ##### 以下內容來自 supabase/design_items_v2.sql
-- #####################################################################

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


-- #####################################################################
-- ##### 以下內容來自 supabase/design_items_v3.sql
-- #####################################################################

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


-- #####################################################################
-- ##### 以下內容來自 supabase/design_items_v4.sql
-- #####################################################################

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


-- #####################################################################
-- ##### 以下內容來自 supabase/design_items_v5.sql
-- #####################################################################

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
