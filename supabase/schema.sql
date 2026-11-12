-- =====================================================================
-- 報修登記系統：資料表 repair_requests
-- 用途：同事送出報修；任何人可讀取清單；不能修改或刪除。
-- 安全分三層：
--   1. GRANT：決定 anon 角色「能不能」碰這張表、能碰哪些欄位。
--   2. RLS：決定 anon 能讀寫「哪些資料列」、新增時資料要符合什麼條件。
--   3. CHECK：不管誰寫入（包含後台與 service_role），資料本身都必須合規。
-- 注意：本檔只負責建表與權限，請在 Supabase SQL Editor 中確認後再執行。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 建立資料表與 CHECK 限制（第 3 層）
-- ---------------------------------------------------------------------
-- id：uuid 主鍵，由資料庫自動產生（gen_random_uuid 為 PostgreSQL 內建）。
-- created_at：建立時間，由資料庫自動產生，前端無法指定。
-- 文字欄位先去除前後空白再檢查長度，避免只填空白就送出。
-- category / urgency / status：只允許固定選項。
create table if not exists public.repair_requests (
    id            uuid        primary key default gen_random_uuid(),
    created_at    timestamptz not null default now(),

    -- 報修人姓名：必填，1～50 字。
    reporter_name text        not null
        constraint repair_requests_reporter_name_len
        check (char_length(btrim(reporter_name)) between 1 and 50),

    -- 地點或部門：必填，1～100 字。
    location      text        not null
        constraint repair_requests_location_len
        check (char_length(btrim(location)) between 1 and 100),

    -- 類別：只能是 設備 / 網路 / 環境 / 其他。
    category      text        not null
        constraint repair_requests_category_valid
        check (category in ('設備', '網路', '環境', '其他')),

    -- 問題說明：必填，1～1000 字。
    description   text        not null
        constraint repair_requests_description_len
        check (char_length(btrim(description)) between 1 and 1000),

    -- 緊急程度：只能是 低 / 中 / 高，未填時預設「中」。
    urgency       text        not null default '中'
        constraint repair_requests_urgency_valid
        check (urgency in ('低', '中', '高')),

    -- 處理狀態：只能是 待處理 / 處理中 / 已完成，預設「待處理」。
    status        text        not null default '待處理'
        constraint repair_requests_status_valid
        check (status in ('待處理', '處理中', '已完成'))
);

comment on table public.repair_requests is '報修登記：同事送出的報修案件（示範資料）';

-- 清單通常依建立時間由新到舊排序，建立索引加快查詢。
create index if not exists repair_requests_created_at_idx
    on public.repair_requests (created_at desc);


-- ---------------------------------------------------------------------
-- 第 1 層：GRANT 權限
-- ---------------------------------------------------------------------
-- 先收回所有角色對這張表的全部權限，從「什麼都不能做」開始，
-- 避免殘留的預設權限（例如舊專案的 default privileges）讓表被意外開放。
revoke all on table public.repair_requests from public, anon, authenticated;

-- anon 需要能使用 public schema，才看得到裡面的資料表。
grant usage on schema public to anon;

-- 讀取：anon 可以讀整張表（清單畫面需要）。
grant select on table public.repair_requests to anon;

-- 新增：只開放使用者需要填的欄位。
-- 不包含 id、created_at、status，所以這三欄一定由資料庫預設值產生，
-- 前端即使送出 status 也會被拒絕。
grant insert (reporter_name, location, category, description, urgency)
    on table public.repair_requests to anon;

-- 不授予 update、delete、truncate：anon 無法修改或刪除任何資料。
-- authenticated 角色目前沒有任何權限；之後若做管理員登入，再另外授權。


-- ---------------------------------------------------------------------
-- 第 2 層：RLS 資料列安全
-- ---------------------------------------------------------------------
-- 啟用 RLS 後，沒有政策允許的操作一律拒絕。
alter table public.repair_requests enable row level security;

-- 重複執行本檔時，先移除同名政策再重建。
drop policy if exists "任何人可讀取報修清單" on public.repair_requests;
drop policy if exists "任何人可新增待處理報修" on public.repair_requests;

-- 讀取政策：anon 可以讀取所有資料列。
create policy "任何人可讀取報修清單"
    on public.repair_requests
    for select
    to anon
    using (true);

-- 新增政策：anon 可以新增，但新資料的 status 必須是「待處理」。
-- （GRANT 已不讓 anon 填 status，這裡是第二道防線，
--   以防日後有人誤把 status 欄位的 insert 權限開出去。）
create policy "任何人可新增待處理報修"
    on public.repair_requests
    for insert
    to anon
    with check (status = '待處理');

-- 不建立 update / delete 政策：即使權限被誤開，RLS 仍會擋下修改與刪除。
