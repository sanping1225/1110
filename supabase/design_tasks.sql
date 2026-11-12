-- =====================================================================
-- 設計部待辦登錄：資料表 design_tasks
-- 用途：設計部從選單選擇待辦類型、填寫內容後送出，每筆都會保存。
--   待辦類型：待規劃案件 / 待計算數量案件 / 計算書待計算案件
-- 網頁可以：讀取清單、新增登錄。不能修改、不能刪除。
-- 安全分三層（與 schema.sql 相同做法）：
--   1. GRANT：anon 只能讀取，以及新增 task_type、content 兩個欄位。
--   2. RLS：只允許讀取與新增。
--   3. CHECK：待辦類型只能是三個選項，內容限制長度。
-- 使用方式：整份貼到 Supabase SQL Editor 執行即可；可重複執行。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 建立資料表與 CHECK 限制（第 3 層）
-- ---------------------------------------------------------------------
create table if not exists public.design_tasks (
    id          uuid        primary key default gen_random_uuid(),

    -- 登錄時間：由資料庫自動產生。
    created_at  timestamptz not null default now(),

    -- 待辦類型：只能是三個選項之一。
    task_type   text        not null
        constraint design_tasks_task_type_valid
        check (task_type in ('待規劃案件', '待計算數量案件', '計算書待計算案件')),

    -- 內容：必填，去除前後空白後 1～1000 字。
    content     text        not null
        constraint design_tasks_content_len
        check (char_length(btrim(content)) between 1 and 1000)
);

comment on table public.design_tasks is '設計部待辦登錄';

-- 清單依登錄時間由新到舊排序，建立索引加快查詢。
create index if not exists design_tasks_created_at_idx
    on public.design_tasks (created_at desc);


-- ---------------------------------------------------------------------
-- 第 1 層：GRANT 權限
-- ---------------------------------------------------------------------
-- 先收回所有角色的全部權限，從「什麼都不能做」開始。
revoke all on table public.design_tasks from public, anon, authenticated;

-- anon 需要能使用 public schema。
grant usage on schema public to anon;

-- 讀取：清單畫面需要。
grant select on table public.design_tasks to anon;

-- 新增：只能填待辦類型與內容；id、created_at 由資料庫產生。
grant insert (task_type, content) on table public.design_tasks to anon;

-- 不授予 update、delete、truncate：送出後的資料無法被修改或刪除。


-- ---------------------------------------------------------------------
-- 第 2 層：RLS 資料列安全
-- ---------------------------------------------------------------------
alter table public.design_tasks enable row level security;

-- 重複執行本檔時，先移除同名政策再重建。
drop policy if exists "任何人可讀取設計部待辦" on public.design_tasks;
drop policy if exists "任何人可登錄設計部待辦" on public.design_tasks;

-- 讀取政策：anon 可以讀取所有登錄。
create policy "任何人可讀取設計部待辦"
    on public.design_tasks
    for select
    to anon
    using (true);

-- 新增政策：anon 可以新增；欄位值由 CHECK 把關。
create policy "任何人可登錄設計部待辦"
    on public.design_tasks
    for insert
    to anon
    with check (true);

-- 不建立 update / delete 政策：即使權限被誤開，RLS 仍會擋下。


-- ---------------------------------------------------------------------
-- 通知 Supabase API 重新讀取資料表結構
-- ---------------------------------------------------------------------
-- 避免出現「Could not find the table ... in the schema cache」。
notify pgrst, 'reload schema';
