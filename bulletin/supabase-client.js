/* ── bulletin · supabase-client.js ─ Supabase client init ── */

const SUPABASE_URL = "https://bktdvniffwtsmyrvajfj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJrdGR2bmlmZnd0c215cnZhamZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjU4MjQsImV4cCI6MjA5MjIwMTgyNH0.4Eti4ciGnUqrVjRyFW_cMnmtNeu1SVIrZBA8yxQxkxY";

window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
	auth: {
		persistSession: true,
		autoRefreshToken: true,
		detectSessionInUrl: true,
		storage: window.localStorage,
	},
});
