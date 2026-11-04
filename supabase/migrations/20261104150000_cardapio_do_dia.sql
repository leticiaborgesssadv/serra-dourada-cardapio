-- Cardápio do dia (almoço). A equipe manda pelo próprio WhatsApp do restaurante (app no celular,
-- coexistência) uma mensagem que começa com #cardapio. A Meta entrega a cópia ao robô e ele guarda aqui.
-- Só o robô (chave de serviço) grava; a equipe logada pode ler no painel.
create table if not exists public.cardapio_dia (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references public.estabelecimento(id) on delete cascade,
  data date not null,
  texto text not null check (length(texto) between 1 and 4000),
  wamid text,
  atualizado_em timestamptz not null default now(),
  unique (estabelecimento_id, data)
);

alter table public.cardapio_dia enable row level security;

drop policy if exists cardapio_dia_equipe_le on public.cardapio_dia;
create policy cardapio_dia_equipe_le on public.cardapio_dia
  for select to authenticated
  using (public.tem_papel(array['gerencia', 'cozinha', 'caixa']));
