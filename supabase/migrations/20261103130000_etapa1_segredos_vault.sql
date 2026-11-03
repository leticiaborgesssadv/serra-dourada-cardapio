-- Leitura de segredos do Supabase Vault pelas Edge Functions (chave de serviço apenas).
-- Permite guardar WHATSAPP_APP_SECRET, WHATSAPP_TOKEN etc. criptografados no banco,
-- como alternativa às variáveis da função. Nomes em minúsculas: 'whatsapp_app_secret'.
create or replace function public.ler_segredo(p_nome text)
returns text language sql stable security definer set search_path = public, vault
as $$ select decrypted_secret from vault.decrypted_secrets where name = p_nome limit 1 $$;

revoke execute on function public.ler_segredo(text) from public, anon, authenticated;
grant execute on function public.ler_segredo(text) to service_role;
