-- Decisões do alinhamento (03/11): nome do titular do Pix e link da loja no iFood
-- (para endereços fora da área de entrega). Os dois aparecem para o cliente só se estiverem preenchidos.
alter table public.pedido_config
  add column if not exists pix_titular text,
  add column if not exists ifood_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pedido_config_ifood_url_https') then
    alter table public.pedido_config
      add constraint pedido_config_ifood_url_https check (ifood_url is null or ifood_url ~ '^https://');
  end if;
end $$;
