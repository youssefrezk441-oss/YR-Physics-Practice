-- Hardening applied to production after the additive Grade-2 schema.
alter function private.g2_prevent_event_mutation() set search_path = '';
