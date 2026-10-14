/* Online leaderboard configuration (Supabase).
   Leave both values empty to run the game without an online leaderboard.

   - url:     your project URL, e.g. https://abcdxyz.supabase.co
   - anonKey: the project's PUBLIC "anon" / "publishable" key.
              This key is designed to be in browser code - the database is protected by
              Row Level Security and the functions in supabase/schema.sql.
   NEVER put the service_role / secret key here. See README.md for setup. */
window.HEART_HUNT_SUPABASE = {
  url: '',
  anonKey: ''
};
