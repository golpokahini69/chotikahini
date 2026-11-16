-- Password reset support for public.users
--
-- The forgot-password / reset-password flow stores a single-use reset token
-- directly on the user row. Without these columns the token update silently
-- fails (supabase-js resolves instead of rejecting, so the `error` field goes
-- unnoticed) and every reset ends in "মেয়াদোত্তীর্ণ পাসওয়ার্ড রিসেট টোকেন".
--
-- `updated_at` is required by code that already writes it to public.users
-- (lib/notify.ts ensureSuperAdminRow, the reset-password and
-- generate-reset-link routes). It was missing, so those updates were also
-- failing silently.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS reset_token TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();


-- Speeds up the token lookup performed on every reset attempt.
CREATE INDEX IF NOT EXISTS idx_users_reset_token ON public.users(reset_token);
