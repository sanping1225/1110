-- =====================================================================
-- 設計部代辦事項：資料表 design_todos
-- 用途：設計部的代辦清單；任何人可讀取、新增事項、勾選完成或取消完成。
-- 不能修改事項文字，也不能刪除。
-- 安全分三層（與 schema.sql 相同做法）：
--   1. GRANT：anon 只能讀取、新增 item 欄位、更新 done 欄位。
--   2. RLS：只允許上述操作；新增時 done 必須是 false。
--   3. CHECK：事項文字長度限制。
-- 注意：本檔只負責建表、權限與初始資料，請在 Supabase SQL Editor 中確認後再執行。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 建立資料表與 CHECK 限制（第 3 層）
-- ---------------------------------------------------------------------
create table if not exists public.design_todos (
    id          uuid        primary key default gen_random_uuid(),
    created_at  timestamptz not null default now(),

    -- 代辦事項內容：必填，去除前後空白後 1～100 字。
    item        text        not null
        constraint design_todos_item_len
        check (char_length(btrim(item)) between 1 and 100),

    -- 是否完成：預設未完成。
    done        boolean     not null default false
);

comment on table public.design_todos is '設計部代辦事項';

-- 清單依建立時間排序，建立索引加快查詢。
create index if not exists design_todos_created_at_idx
    on public.design_todos (created_at);


-- ---------------------------------------------------------------------
-- 第 1 層：GRANT 權限
-- ---------------------------------------------------------------------
-- 先收回所有角色的全部權限，從「什麼都不能做」開始。
revoke all on table public.design_todos from public, anon, authenticated;

-- anon 需要能使用 public schema。
grant usage on schema public to anon;

-- 讀取：清單畫面需要。
grant select on table public.design_todos to anon;

-- 新增：只能填事項內容；id、created_at、done 由資料庫預設值產生。
grant insert (item) on table public.design_todos to anon;

-- 更新：只能改 done 欄位（勾選完成 / 取消完成），不能改事項文字。
grant update (done) on table public.design_todos to anon;

-- 不授予 delete、truncate：anon 無法刪除任何事項。


-- ---------------------------------------------------------------------
-- 第 2 層：RLS 資料列安全
-- ---------------------------------------------------------------------
alter table public.design_todos enable row level security;

-- 重複執行本檔時，先移除同名政策再重建。
drop policy if exists "任何人可讀取設計部代辦" on public.design_todos;
drop policy if exists "任何人可新增未完成代辦" on public.design_todos;
drop policy if exists "任何人可勾選完成狀態"   on public.design_todos;

-- 讀取政策：anon 可以讀取所有事項。
create policy "任何人可讀取設計部代辦"
    on public.design_todos
    for select
    to anon
    using (true);

-- 新增政策：新事項必須是未完成。
-- （GRANT 已不讓 anon 填 done，這裡是第二道防線。）
create policy "任何人可新增未完成代辦"
    on public.design_todos
    for insert
    to anon
    with check (done = false);

-- 更新政策：任何事項都可以切換完成狀態。
-- 能改哪些欄位由 GRANT 限制（只有 done）。
create policy "任何人可勾選完成狀態"
    on public.design_todos
    for update
    to anon
    using (true)
    with check (true);

-- 不建立 delete 政策：即使權限被誤開，RLS 仍會擋下刪除。


-- ---------------------------------------------------------------------
-- 初始資料：設計部的三個代辦事項
-- ---------------------------------------------------------------------
-- 依序錯開 1 毫秒，讓清單維持這個順序。
-- 已經存在同名事項時不會重複新增，所以本檔可以重複執行。
insert into public.design_todos (item, created_at)
select v.item, now() + v.offset_ms * interval '1 millisecond'
from (values
    ('待規劃案件',     0),
    ('待計算數量案件', 1),
    ('計算書待計算案件', 2)
) as v(item, offset_ms)
where not exists (
    select 1 from public.design_todos d where d.item = v.item
);
