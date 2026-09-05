/**
 * The expiry engine's rules live in supabase/functions/_shared/ so the scheduled Edge
 * Function can import them without reaching outside its own directory — the Supabase
 * bundler will not follow a path into the app source. Re-exported here so app code and
 * tests keep importing '@/lib/expiry/engine' and there is still exactly one copy of
 * the logic.
 */
export * from '../../../supabase/functions/_shared/engine';
