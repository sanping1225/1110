// Supabase 連線設定
// publishable key 是公開金鑰，本來就會出現在瀏覽器裡，可以放進儲存庫。
// 資料的保護靠資料庫的 GRANT、RLS、CHECK（見 supabase/schema.sql）。
// 絕對不要把 secret 金鑰（sb_secret_ 開頭）或 service_role 金鑰放在這裡。
window.APP_CONFIG = {
  SUPABASE_URL: "https://drizkffucfwvqouenlxs.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_hSQyP317ow-2C0nJGUawYg_Xb-9F7xG",
};
