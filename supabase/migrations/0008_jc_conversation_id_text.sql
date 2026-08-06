-- J&C Cultivator quote-outcome fix: lead_postcall.jc_conversation_id must be text.
--
-- BUG: jc_sms_conversations has NO `id` column; its natural key is from_number (text).
-- The quote-outcome menu path stores that from_number into lead_postcall.jc_conversation_id,
-- but the column was declared `uuid` and can never hold a text phone-number key. The
-- cal.com booking path was already written against from_number; only this column's type
-- (and the quoteOutcome.ts references, fixed in the same change) were wrong.
--
-- SAFETY (verified against live prod, ref jeqnvdlfybpmbovywknz, 2026-08-06):
--   * lead_postcall.jc_conversation_id is currently `uuid`.
--   * There is NO foreign key on jc_conversation_id (only lead_id and session_id have FKs),
--     so widening the type touches no constraint.
--   * 0 rows exist with kind='quote', so no existing uuid values need coercion.
-- The ALTER is therefore a clean, data-safe widening.

ALTER TABLE lead_postcall ALTER COLUMN jc_conversation_id TYPE text;
