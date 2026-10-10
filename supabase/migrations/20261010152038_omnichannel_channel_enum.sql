-- Enum expansion must commit before the new values are used by later migrations.
ALTER TYPE public.conversation_channel ADD VALUE IF NOT EXISTS 'instagram';
ALTER TYPE public.conversation_channel ADD VALUE IF NOT EXISTS 'messenger';
ALTER TYPE public.conversation_channel ADD VALUE IF NOT EXISTS 'web';
