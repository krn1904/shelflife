-- Reminders now live inside the app, per account (the staff and manager home screens and
-- the Today tab badge), so device Web Push is gone: no service worker push, no VAPID keys,
-- no morning daily-digest function. Its subscriptions have nothing left to deliver them.
-- Dropping the table also drops its RLS policies, trigger and indexes.

drop table if exists public.push_subscriptions;
