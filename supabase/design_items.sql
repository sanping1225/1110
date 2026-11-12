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
