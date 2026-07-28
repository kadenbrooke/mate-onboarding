-- HIGH FIX H4: widen the no-caller-ID fallback code from 4 to 6 digits.
--
-- A 4-digit code is a 10,000-space token bound to a sender phone with no attempt
-- limit — brute-forceable. We widen the code to 6 digits (1,000,000 space) and add
-- a per-sender inbound code-attempt throttle in the demo-sms edge function
-- (demo_counters scope 'code_attempt'). This migration only widens the column;
-- genPhoneCode()/isPhoneCode() were updated to 6 digits in the app + edge code.
--
-- char(4) -> varchar(6): varchar avoids the fixed-width space-padding of char and
-- comfortably holds the 6-digit code. Idempotent-safe to re-run.
alter table public.demo_sessions
  alter column phone_code type varchar(6);
