/* ── bulletin · supabase-client.js ─ Supabase client init ── */

const SUPABASE_URL = "https://bktdvniffwtsmyrvajfj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJrdGR2bmlmZnd0c215cnZhamZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjU4MjQsImV4cCI6MjA5MjIwMTgyNH0.4Eti4ciGnUqrVjRyFW_cMnmtNeu1SVIrZBA8yxQxkxY";

const PROJECT_REF = "bktdvniffwtsmyrvajfj";
const DEFAULT_SUPABASE_STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;
const LEGACY_CUSTOM_STORAGE_KEY = "bulletin.supabase.auth.token";

try {
	const hasDefaultSession = !!localStorage.getItem(DEFAULT_SUPABASE_STORAGE_KEY);
	const legacySession = localStorage.getItem(LEGACY_CUSTOM_STORAGE_KEY);
	if (!hasDefaultSession && legacySession) {
		localStorage.setItem(DEFAULT_SUPABASE_STORAGE_KEY, legacySession);
	}
} catch (err) {
	// Ignore storage access failures.
}

window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
	auth: {
		persistSession: true,
		autoRefreshToken: true,
		detectSessionInUrl: true,
		storage: window.localStorage,
	},
});
