-- Etapa 1: pedidos pelo WhatsApp, fila de impressão por setor e atendimento humano.
-- Regras de preço, horário e disponibilidade ficam AQUI (no banco). O robô e a IA
-- só montam um rascunho; o total é sempre recalculado a partir do cardápio cadastrado.

-- ============================================================
-- 1. Configuração (tudo editável pela gestão; nada inventado)
-- ============================================================

create table public.pedido_config (
  estabelecimento_id uuid primary key references public.estabelecimento(id) on delete cascade,
  aceitando_pedidos boolean not null default false,          -- chave geral
  retirada_ativa boolean not null default true,
  entrega_ativa boolean not null default false,
  taxa_entrega numeric(10,2),                                 -- null = entrega ainda não configurada
  pedido_minimo numeric(10,2) not null default 0,
  tempo_retirada text,
  tempo_entrega text,
  chave_pix text,
  almoco_aceita_ate time,                                     -- null = até o fim do turno
  bar_aceita_ate time,
  happy_hour_em_pedidos boolean not null default false,       -- preço de happy hour em pedidos do WhatsApp
  max_itens_por_pedido int not null default 50 check (max_itens_por_pedido between 1 and 200),
  atualizado_em timestamptz not null default now(),
  constraint entrega_precisa_taxa check (not entrega_ativa or taxa_entrega is not null),
  constraint taxa_nao_negativa check (taxa_entrega is null or taxa_entrega >= 0)
);

-- Em que setor cada categoria é preparada e em que turno pode ser pedida.
create table public.categoria_pedido (
  estabelecimento_id uuid not null references public.estabelecimento(id) on delete cascade,
  categoria text not null,
  setor text not null check (setor in ('cozinha', 'churrasqueira', 'bar', 'caixa')),
  periodo text not null default 'todos' check (periodo in ('almoco', 'bar', 'todos')),
  disponivel_pedido boolean not null default true,
  pergunta text,                                              -- ex.: "Quais carnes e acompanhamentos?"
  ordem int not null default 0,
  primary key (estabelecimento_id, categoria)
);

-- Controle por item, no próprio cardápio do site.
alter table public.cardapio_publico
  add column if not exists esgotado boolean not null default false,
  add column if not exists aceita_pedido boolean not null default true,
  add column if not exists pedido_hora_inicio time,
  add column if not exists pedido_hora_fim time;

-- ============================================================
-- 2. Pedidos
-- ============================================================

create table public.pedido (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references public.estabelecimento(id),
  numero int not null,
  dia_operacao date not null,
  origem text not null default 'whatsapp' check (origem in ('whatsapp', 'painel', 'site')),
  chave_idempotencia text not null unique,
  conversa_id uuid references public.whatsapp_conversa(id) on delete set null,
  cliente_nome text not null,
  cliente_telefone text,
  modalidade text not null check (modalidade in ('retirada', 'entrega')),
  endereco text,
  observacao text,
  pagamento text not null check (pagamento in ('pix', 'cartao', 'dinheiro')),
  troco_para numeric(10,2),
  periodo text,
  subtotal numeric(10,2) not null check (subtotal >= 0),
  taxa_entrega numeric(10,2) not null default 0 check (taxa_entrega >= 0),
  desconto numeric(10,2) not null default 0 check (desconto >= 0),
  total numeric(10,2) not null,
  status text not null default 'confirmado' check (status in ('confirmado', 'em_preparo', 'pronto', 'finalizado', 'cancelado')),
  -- Comprovante enviado pelo cliente NÃO confirma pagamento: só uma pessoa marca como conferido.
  pagamento_status text not null default 'pendente' check (pagamento_status in ('pendente', 'conferido', 'recusado')),
  motivo_cancelamento text,
  criado_em timestamptz not null default now(),
  preparo_em timestamptz,
  pronto_em timestamptz,
  finalizado_em timestamptz,
  cancelado_em timestamptz,
  atualizado_em timestamptz not null default now(),
  unique (estabelecimento_id, dia_operacao, numero),
  constraint entrega_precisa_endereco check (modalidade <> 'entrega' or coalesce(trim(endereco), '') <> ''),
  constraint total_confere check (total = subtotal + taxa_entrega - desconto),
  constraint cancelamento_precisa_motivo check (status <> 'cancelado' or coalesce(trim(motivo_cancelamento), '') <> '')
);
create index pedido_estab_status_idx on public.pedido (estabelecimento_id, status, criado_em desc);
create index pedido_conversa_idx on public.pedido (conversa_id);

create table public.pedido_item (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedido(id) on delete cascade,
  cardapio_id uuid references public.cardapio_publico(id) on delete set null,
  nome text not null,
  categoria text,
  setor text not null,
  quantidade int not null check (quantidade between 1 and 50),
  preco_unitario numeric(10,2) not null check (preco_unitario >= 0),
  valor_total numeric(10,2) not null,
  detalhe text,
  constraint valor_item_confere check (valor_total = preco_unitario * quantidade)
);
create index pedido_item_pedido_idx on public.pedido_item (pedido_id);

-- Histórico de tudo que acontece com o pedido (quem, quando, o quê).
create table public.pedido_evento (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedido(id) on delete cascade,
  tipo text not null,                 -- criado, status, cancelado, reimpressao, pagamento
  de text,
  para text,
  motivo text,
  ator text not null check (ator in ('cliente', 'robo', 'funcionario', 'sistema')),
  user_id uuid references auth.users(id),
  criado_em timestamptz not null default clock_timestamp()   -- hora real de cada ação, mesmo na mesma transação
);
create index pedido_evento_pedido_idx on public.pedido_evento (pedido_id, criado_em);

-- ============================================================
-- 3. Impressoras e fila de impressão
-- ============================================================

create table public.impressora (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references public.estabelecimento(id) on delete cascade,
  nome text not null,                         -- nome amigável ("Cozinha")
  nome_windows text not null,                 -- nome da fila no Windows ("EPSON TM-T20 ReceiptE4")
  setores text[] not null check (setores <@ array['cozinha', 'churrasqueira', 'bar', 'caixa']::text[] and cardinality(setores) > 0),
  modo text not null default 'escpos' check (modo in ('escpos', 'texto')),
  colunas int not null default 48 check (colunas between 24 and 64),
  cortar_papel boolean not null default true,
  acentos boolean not null default true,
  vias int not null default 1 check (vias between 1 and 3),
  ativo boolean not null default true,
  ultimo_contato timestamptz,
  ultimo_erro text,
  criado_em timestamptz not null default now()
);

create table public.impressao_job (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references public.estabelecimento(id),
  pedido_id uuid not null references public.pedido(id) on delete cascade,
  impressora_id uuid references public.impressora(id) on delete set null,
  tipo text not null check (tipo in ('comanda', 'reimpressao', 'cancelamento')),
  via int not null default 1,
  conteudo jsonb not null,                    -- linhas estruturadas; o agente formata para a impressora
  status text not null default 'pendente' check (status in ('pendente', 'imprimindo', 'impresso', 'erro', 'cancelado')),
  tentativas int not null default 0,
  erro text,
  solicitado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  pego_em timestamptz,
  impresso_em timestamptz
);
create index impressao_job_fila_idx on public.impressao_job (estabelecimento_id, status, criado_em);
create unique index impressao_job_unico_idx on public.impressao_job (pedido_id, coalesce(impressora_id, '00000000-0000-0000-0000-000000000000'::uuid), tipo, via);

-- Programa de impressão instalado no PC do restaurante. Guardamos só o hash do token.
create table public.impressao_agente (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references public.estabelecimento(id) on delete cascade,
  nome text not null,
  token_hash text not null unique,
  ativo boolean not null default true,
  ultimo_contato timestamptz,
  criado_em timestamptz not null default now()
);

-- ============================================================
-- 4. Atendimento humano no WhatsApp e status de envio
-- ============================================================

alter table public.whatsapp_conversa
  add column if not exists atendimento_humano_ate timestamptz,
  add column if not exists atendimento_humano_por uuid references auth.users(id),
  add column if not exists aguardando_humano_desde timestamptz;

alter table public.whatsapp_mensagem
  add column if not exists envio_status text check (envio_status in ('enviado', 'falhou', 'nao_configurado')),
  add column if not exists envio_erro text,
  add column if not exists enviado_por uuid references auth.users(id);

-- ============================================================
-- 5. Regras (funções)
-- ============================================================

-- Valor em reais no formato brasileiro: 1234.5 -> "R$ 1.234,50"
create or replace function public.brl(p_valor numeric)
returns text language sql immutable set search_path = public
as $$ select 'R$ ' || translate(to_char(coalesce(p_valor, 0), 'FM999G999G990D00'), ',.', '.,') $$;
-- Hora local do restaurante.
create or replace function public.agora_local(p_ts timestamptz default now())
returns timestamp language sql stable set search_path = public
as $$ select p_ts at time zone 'America/Sao_Paulo' $$;

-- "Dia" do restaurante vira às 6h: o bar que passa da meia-noite continua no mesmo dia.
create or replace function public.dia_operacao(p_ts timestamptz default now())
returns date language sql stable set search_path = public
as $$ select (public.agora_local(p_ts) - interval '6 hours')::date $$;

-- Turno aberto para pedidos agora: 'almoco', 'bar' ou null (fechado).
create or replace function public.periodo_pedido(p_estab uuid, p_ts timestamptz default now())
returns text language plpgsql stable security definer set search_path = public
as $$
declare
  v_local timestamp := public.agora_local(p_ts);
  v_hm time := v_local::time;
  v_dow int := extract(dow from v_local)::int;
  v_ontem int := (extract(dow from v_local)::int + 6) % 7;
  v_horario jsonb;
  v_cfg public.pedido_config;
  v_t jsonb;
  v_abre time;
  v_fecha time;
begin
  select horario_funcionamento into v_horario from public.pagina_config where estabelecimento_id = p_estab;
  select * into v_cfg from public.pedido_config where estabelecimento_id = p_estab;
  if v_horario is null then return null; end if;

  -- almoço
  v_t := v_horario -> v_dow::text -> 'almoco';
  if v_t ->> 'abre' is not null and v_t ->> 'fecha' is not null then
    v_abre := (v_t ->> 'abre')::time;
    v_fecha := coalesce(least((v_t ->> 'fecha')::time, v_cfg.almoco_aceita_ate), (v_t ->> 'fecha')::time);
    if v_hm >= v_abre and v_hm < v_fecha then return 'almoco'; end if;
  end if;

  -- bar (pode passar da meia-noite)
  v_t := v_horario -> v_dow::text -> 'bar';
  if v_t ->> 'abre' is not null and v_t ->> 'fecha' is not null then
    v_abre := (v_t ->> 'abre')::time;
    v_fecha := (v_t ->> 'fecha')::time;
    if v_cfg.bar_aceita_ate is not null and v_cfg.bar_aceita_ate > v_abre then
      if v_hm >= v_abre and v_hm < v_cfg.bar_aceita_ate then return 'bar'; end if;
    elsif v_fecha > v_abre then
      if v_hm >= v_abre and v_hm < v_fecha then return 'bar'; end if;
    else
      if v_hm >= v_abre then return 'bar'; end if;
    end if;
  end if;
  v_t := v_horario -> v_ontem::text -> 'bar';
  if v_t ->> 'abre' is not null and v_t ->> 'fecha' is not null
     and (v_t ->> 'fecha')::time < (v_t ->> 'abre')::time
     and v_hm < (v_t ->> 'fecha')::time
     and (v_cfg.bar_aceita_ate is null or (v_cfg.bar_aceita_ate < (v_t ->> 'abre')::time and v_hm < v_cfg.bar_aceita_ate)) then
    return 'bar';
  end if;

  return null;
end;
$$;

-- Itens que podem ser pedidos agora (turno, horário do item, esgotado, categoria liberada).
create or replace function public.catalogo_pedido_agora(p_estab uuid, p_ts timestamptz default now())
returns table (id uuid, nome text, descricao text, preco numeric, categoria text, grupo text, setor text, pergunta text, ordem int)
language sql stable security definer set search_path = public
as $$
  with p as (select public.periodo_pedido(p_estab, p_ts) as periodo, public.agora_local(p_ts)::time as hm)
  select c.id, c.nome, c.descricao, c.preco, c.categoria, c.grupo, cp.setor, cp.pergunta, c.ordem
  from public.cardapio_publico c
  join public.categoria_pedido cp on cp.estabelecimento_id = c.estabelecimento_id and cp.categoria = c.categoria
  cross join p
  where c.estabelecimento_id = p_estab
    and c.ativo and c.aceita_pedido and not c.esgotado and cp.disponivel_pedido
    and p.periodo is not null
    and (cp.periodo = 'todos' or cp.periodo = p.periodo)
    and (c.pedido_hora_inicio is null or c.pedido_hora_fim is null
         or (c.pedido_hora_inicio <= c.pedido_hora_fim and p.hm >= c.pedido_hora_inicio and p.hm < c.pedido_hora_fim)
         or (c.pedido_hora_inicio > c.pedido_hora_fim and (p.hm >= c.pedido_hora_inicio or p.hm < c.pedido_hora_fim)))
  order by cp.ordem, c.categoria, c.ordem;
$$;

-- Calcula o pedido a partir do rascunho, SEM gravar. Usado para mostrar o resumo ao cliente
-- e, de novo, na hora de confirmar. Os preços vêm sempre do cardápio.
-- p_dados: {itens:[{cardapio_id, quantidade, detalhe}], modalidade, endereco, pagamento, troco_para}
create or replace function public.calcular_pedido(p_estab uuid, p_dados jsonb, p_ts timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_cfg public.pedido_config;
  v_periodo text := public.periodo_pedido(p_estab, p_ts);
  v_erros text[] := '{}';
  v_itens jsonb := '[]'::jsonb;
  v_item jsonb;
  v_cat record;
  v_qtd int;
  v_preco numeric(10,2);
  v_subtotal numeric(10,2) := 0;
  v_taxa numeric(10,2) := 0;
  v_total numeric(10,2);
  v_total_qtd int := 0;
  v_hh record;
  v_hh_ativo boolean := false;
  v_local timestamp := public.agora_local(p_ts);
  v_modalidade text := p_dados ->> 'modalidade';
  v_pagamento text := p_dados ->> 'pagamento';
  v_troco numeric;
begin
  select * into v_cfg from public.pedido_config where estabelecimento_id = p_estab;
  if v_cfg.estabelecimento_id is null or not v_cfg.aceitando_pedidos then
    v_erros := array_append(v_erros, 'No momento não estamos recebendo pedidos pelo WhatsApp.');
  end if;
  if v_periodo is null then
    v_erros := array_append(v_erros, 'Estamos fora do horário de pedidos.');
  end if;

  -- happy hour só vale em pedido se a gestão ligar essa opção
  if v_cfg.happy_hour_em_pedidos then
    select * into v_hh from public.happy_hour where estabelecimento_id = p_estab and ativo;
    v_hh_ativo := v_hh.id is not null
      and extract(dow from v_local)::int = any(v_hh.dias_semana)
      and v_local::time >= v_hh.horario_inicio and v_local::time < v_hh.horario_fim;
  end if;

  if jsonb_typeof(p_dados -> 'itens') <> 'array' or jsonb_array_length(p_dados -> 'itens') = 0 then
    v_erros := array_append(v_erros, 'O pedido está vazio.');
  else
    for v_item in select * from jsonb_array_elements(p_dados -> 'itens') loop
      v_qtd := coalesce((v_item ->> 'quantidade')::int, 0);
      select * into v_cat from public.catalogo_pedido_agora(p_estab, p_ts) c where c.id = (v_item ->> 'cardapio_id')::uuid;
      if v_cat.id is null then
        v_erros := array_append(v_erros, ('Um item do pedido não está disponível agora' ||
          coalesce(' (' || (select nome from public.cardapio_publico where id = (v_item ->> 'cardapio_id')::uuid) || ')', '') || '.'));
        continue;
      end if;
      if v_qtd < 1 or v_qtd > 50 then
        v_erros := array_append(v_erros, ('Quantidade inválida para ' || v_cat.nome || '.'));
        continue;
      end if;
      v_preco := v_cat.preco;
      if v_hh_ativo then
        select coalesce(min((x ->> 'preco_por')::numeric), v_preco) into v_preco
        from jsonb_array_elements(coalesce(v_hh.itens, '[]'::jsonb)) x
        where lower(x ->> 'nome') like lower(v_cat.nome) || '%';
      end if;
      v_total_qtd := v_total_qtd + v_qtd;
      v_subtotal := v_subtotal + v_preco * v_qtd;
      v_itens := v_itens || jsonb_build_object(
        'cardapio_id', v_cat.id, 'nome', v_cat.nome, 'categoria', v_cat.categoria, 'setor', v_cat.setor,
        'quantidade', v_qtd, 'preco_unitario', v_preco, 'valor_total', v_preco * v_qtd,
        'detalhe', nullif(left(trim(coalesce(v_item ->> 'detalhe', '')), 200), ''));
    end loop;
  end if;

  if v_cfg.estabelecimento_id is not null and v_total_qtd > v_cfg.max_itens_por_pedido then
    v_erros := array_append(v_erros, ('O limite é de ' || v_cfg.max_itens_por_pedido || ' itens por pedido. Para pedidos maiores, fale com a equipe.'));
  end if;
  if v_cfg.estabelecimento_id is not null and v_subtotal < v_cfg.pedido_minimo then
    v_erros := array_append(v_erros, ('O pedido mínimo é de ' || public.brl(v_cfg.pedido_minimo) || '.'));
  end if;

  if v_modalidade is not null then
    if v_modalidade = 'retirada' and not coalesce(v_cfg.retirada_ativa, false) then
      v_erros := array_append(v_erros, 'Retirada no local não está disponível agora.');
    elsif v_modalidade = 'entrega' then
      if not coalesce(v_cfg.entrega_ativa, false) or v_cfg.taxa_entrega is null then
        v_erros := array_append(v_erros, 'Entrega não está disponível no momento.');
      elsif coalesce(trim(p_dados ->> 'endereco'), '') = '' then
        v_erros := array_append(v_erros, 'Falta o endereço de entrega.');
      else
        v_taxa := v_cfg.taxa_entrega;
      end if;
    elsif v_modalidade not in ('retirada', 'entrega') then
      v_erros := array_append(v_erros, 'Modalidade inválida.');
    end if;
  end if;

  v_total := v_subtotal + v_taxa;

  if v_pagamento is not null and v_pagamento not in ('pix', 'cartao', 'dinheiro') then
    v_erros := array_append(v_erros, 'Forma de pagamento inválida.');
  end if;
  if v_pagamento = 'dinheiro' and nullif(p_dados ->> 'troco_para', '') is not null then
    v_troco := (p_dados ->> 'troco_para')::numeric;
    if v_troco < v_total then
      v_erros := array_append(v_erros, 'O valor para troco precisa ser maior que o total.');
    end if;
  end if;

  return jsonb_build_object(
    'ok', cardinality(v_erros) = 0,
    'erros', to_jsonb(v_erros),
    'periodo', v_periodo,
    'itens', v_itens,
    'subtotal', v_subtotal,
    'taxa_entrega', v_taxa,
    'desconto', 0,
    'total', v_total,
    'happy_hour_aplicado', v_hh_ativo
  );
end;
$$;

-- Monta as linhas da comanda para uma impressora (só os setores que ela atende).
-- Cada linha: {t: texto, b: negrito, g: grande, c: centralizado} | {s: true} separador | {l, r} duas colunas
create or replace function public.montar_comanda(p_pedido uuid, p_setores text[], p_tipo text, p_via int)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_p public.pedido;
  v_l jsonb := '[]'::jsonb;
  v_it record;
  v_caixa boolean := 'caixa' = any(p_setores);
  v_tem_item boolean := false;
  v_local timestamp;
  v_nome_loja text;
begin
  select * into v_p from public.pedido where id = p_pedido;
  select coalesce(nome_fantasia, nome) into v_nome_loja from public.estabelecimento where id = v_p.estabelecimento_id;
  v_local := public.agora_local(v_p.criado_em);

  v_l := v_l || jsonb_build_object('t', v_nome_loja, 'b', true, 'c', true);
  if p_tipo = 'cancelamento' then
    v_l := v_l || jsonb_build_object('t', '*** PEDIDO CANCELADO ***', 'b', true, 'g', true, 'c', true);
  elsif p_tipo = 'reimpressao' then
    v_l := v_l || jsonb_build_object('t', 'REIMPRESSAO No ' || p_via, 'b', true, 'c', true);
  end if;
  v_l := v_l || jsonb_build_object('t', 'PEDIDO #' || lpad(v_p.numero::text, 3, '0'), 'b', true, 'g', true, 'c', true);
  v_l := v_l || jsonb_build_object('t', coalesce(array_to_string(array(
      select distinct upper(i.setor) from public.pedido_item i where i.pedido_id = p_pedido and i.setor = any(p_setores)
      order by 1), ' + '), '') || case when v_caixa then ' (VIA DO CAIXA)' else '' end, 'c', true);
  v_l := v_l || jsonb_build_object('t', to_char(v_local, 'DD/MM/YYYY HH24:MI') || ' - WhatsApp', 'c', true);
  v_l := v_l || jsonb_build_object('s', true);
  v_l := v_l || jsonb_build_object('t', case v_p.modalidade when 'entrega' then '*** ENTREGA ***' else '*** RETIRADA ***' end, 'b', true, 'g', true, 'c', true);
  v_l := v_l || jsonb_build_object('t', 'Cliente: ' || v_p.cliente_nome, 'b', true);
  if v_p.modalidade = 'entrega' then
    v_l := v_l || jsonb_build_object('t', 'Endereco: ' || v_p.endereco, 'b', true);
  end if;
  if v_caixa and v_p.cliente_telefone is not null then
    v_l := v_l || jsonb_build_object('t', 'Telefone: ' || v_p.cliente_telefone);
  end if;
  v_l := v_l || jsonb_build_object('s', true);

  for v_it in
    select * from public.pedido_item where pedido_id = p_pedido and (v_caixa or setor = any(p_setores)) order by setor, nome
  loop
    v_tem_item := true;
    if v_caixa then
      v_l := v_l || jsonb_build_object('l', v_it.quantidade || 'x ' || v_it.nome
        || case when v_it.setor = any(p_setores) then '' else ' [' || upper(v_it.setor) || ']' end,
        'r', public.brl(v_it.valor_total), 'b', true);
    else
      v_l := v_l || jsonb_build_object('t', v_it.quantidade || 'x ' || v_it.nome, 'b', true, 'g', true);
    end if;
    if v_it.detalhe is not null then
      v_l := v_l || jsonb_build_object('t', '   > ' || v_it.detalhe, 'b', true);
    end if;
  end loop;

  if v_p.observacao is not null then
    v_l := v_l || jsonb_build_object('s', true);
    v_l := v_l || jsonb_build_object('t', 'OBS: ' || v_p.observacao, 'b', true);
  end if;

  if v_caixa then
    v_l := v_l || jsonb_build_object('s', true);
    v_l := v_l || jsonb_build_object('l', 'Subtotal', 'r', public.brl(v_p.subtotal));
    if v_p.taxa_entrega > 0 then
      v_l := v_l || jsonb_build_object('l', 'Taxa de entrega', 'r', public.brl(v_p.taxa_entrega));
    end if;
    v_l := v_l || jsonb_build_object('l', 'TOTAL', 'r', public.brl(v_p.total), 'b', true);
    v_l := v_l || jsonb_build_object('t', 'Pagamento: ' || case v_p.pagamento when 'pix' then 'Pix (CONFERIR antes de liberar)' when 'cartao' then 'Cartao' else 'Dinheiro' end, 'b', true);
    if v_p.troco_para is not null then
      v_l := v_l || jsonb_build_object('t', 'Troco para ' || public.brl(v_p.troco_para) || ' (levar ' || public.brl(v_p.troco_para - v_p.total) || ')', 'b', true);
    end if;
  end if;
  v_l := v_l || jsonb_build_object('s', true);

  if not v_tem_item then return null; end if;
  return v_l;
end;
$$;

-- Cria as comandas na fila: uma por impressora ativa, com os setores que ela atende.
-- Itens de um setor sem impressora geram um job com erro (vira alerta no painel).
create or replace function public.gerar_impressao(p_pedido uuid, p_tipo text, p_user uuid default null)
returns int language plpgsql security definer set search_path = public
as $$
declare
  v_p public.pedido;
  v_imp record;
  v_conteudo jsonb;
  v_via int;
  v_criados int := 0;
  v_setores_sem text[];
begin
  select * into v_p from public.pedido where id = p_pedido;

  for v_imp in select * from public.impressora where estabelecimento_id = v_p.estabelecimento_id and ativo order by nome loop
    select coalesce(max(via), 0) + 1 into v_via from public.impressao_job
      where pedido_id = p_pedido and impressora_id = v_imp.id and tipo = p_tipo;
    if p_tipo = 'comanda' and v_via > 1 then continue; end if;      -- comanda original só uma vez
    v_conteudo := public.montar_comanda(p_pedido, v_imp.setores, p_tipo, v_via);
    if v_conteudo is null then continue; end if;                     -- impressora sem itens deste pedido
    insert into public.impressao_job (estabelecimento_id, pedido_id, impressora_id, tipo, via, conteudo, solicitado_por)
    values (v_p.estabelecimento_id, p_pedido, v_imp.id, p_tipo, v_via, v_conteudo, p_user);
    v_criados := v_criados + 1;
  end loop;

  -- setores do pedido que nenhuma impressora ativa atende
  select array_agg(distinct i.setor) into v_setores_sem
  from public.pedido_item i
  where i.pedido_id = p_pedido
    and not exists (select 1 from public.impressora m where m.estabelecimento_id = v_p.estabelecimento_id and m.ativo and i.setor = any(m.setores));
  if v_setores_sem is not null and p_tipo = 'comanda' then
    insert into public.impressao_job (estabelecimento_id, pedido_id, impressora_id, tipo, via, conteudo, status, erro)
    values (v_p.estabelecimento_id, p_pedido, null, p_tipo, 1, coalesce(public.montar_comanda(p_pedido, v_setores_sem, p_tipo, 1), '[]'::jsonb), 'erro',
            'Nenhuma impressora ativa para o setor: ' || array_to_string(v_setores_sem, ', '))
    on conflict do nothing;
  end if;

  return v_criados;
end;
$$;

-- Grava o pedido confirmado pelo cliente. Idempotente: a mesma chave nunca cria dois pedidos.
create or replace function public.criar_pedido(p_estab uuid, p_chave text, p_conversa uuid, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_existente public.pedido;
  v_calc jsonb;
  v_dia date := public.dia_operacao();
  v_numero int;
  v_id uuid;
  v_item jsonb;
begin
  if coalesce(trim(p_chave), '') = '' then raise exception 'chave de idempotência obrigatória'; end if;

  select * into v_existente from public.pedido where chave_idempotencia = p_chave;
  if v_existente.id is not null then
    return jsonb_build_object('ok', true, 'duplicado', true, 'id', v_existente.id, 'numero', v_existente.numero, 'total', v_existente.total);
  end if;

  if coalesce(trim(p_dados ->> 'cliente_nome'), '') = '' then
    return jsonb_build_object('ok', false, 'erros', jsonb_build_array('Falta o nome do cliente.'));
  end if;
  if p_dados ->> 'modalidade' is null or p_dados ->> 'pagamento' is null then
    return jsonb_build_object('ok', false, 'erros', jsonb_build_array('Faltam modalidade ou forma de pagamento.'));
  end if;

  v_calc := public.calcular_pedido(p_estab, p_dados);
  if not (v_calc ->> 'ok')::boolean then
    return jsonb_build_object('ok', false, 'erros', v_calc -> 'erros');
  end if;

  -- número sequencial por dia, sem corrida entre dois pedidos simultâneos
  perform pg_advisory_xact_lock(hashtext(p_estab::text || v_dia::text));
  select coalesce(max(numero), 0) + 1 into v_numero from public.pedido where estabelecimento_id = p_estab and dia_operacao = v_dia;

  insert into public.pedido (estabelecimento_id, numero, dia_operacao, origem, chave_idempotencia, conversa_id,
    cliente_nome, cliente_telefone, modalidade, endereco, observacao, pagamento, troco_para, periodo,
    subtotal, taxa_entrega, desconto, total)
  values (p_estab, v_numero, v_dia, coalesce(p_dados ->> 'origem', 'whatsapp'), p_chave, p_conversa,
    left(trim(p_dados ->> 'cliente_nome'), 80), p_dados ->> 'cliente_telefone', p_dados ->> 'modalidade',
    nullif(left(trim(coalesce(p_dados ->> 'endereco', '')), 250), ''),
    nullif(left(trim(coalesce(p_dados ->> 'observacao', '')), 300), ''),
    p_dados ->> 'pagamento',
    case when p_dados ->> 'pagamento' = 'dinheiro' then nullif(p_dados ->> 'troco_para', '')::numeric end,
    v_calc ->> 'periodo',
    (v_calc ->> 'subtotal')::numeric, (v_calc ->> 'taxa_entrega')::numeric, 0, (v_calc ->> 'total')::numeric)
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(v_calc -> 'itens') loop
    insert into public.pedido_item (pedido_id, cardapio_id, nome, categoria, setor, quantidade, preco_unitario, valor_total, detalhe)
    values (v_id, (v_item ->> 'cardapio_id')::uuid, v_item ->> 'nome', v_item ->> 'categoria', v_item ->> 'setor',
            (v_item ->> 'quantidade')::int, (v_item ->> 'preco_unitario')::numeric, (v_item ->> 'valor_total')::numeric, v_item ->> 'detalhe');
  end loop;

  insert into public.pedido_evento (pedido_id, tipo, para, ator) values (v_id, 'criado', 'confirmado', 'cliente');
  perform public.gerar_impressao(v_id, 'comanda');

  return jsonb_build_object('ok', true, 'duplicado', false, 'id', v_id, 'numero', v_numero,
    'total', (v_calc ->> 'total')::numeric, 'calculo', v_calc);
end;
$$;

-- Mudança de status pela equipe (painel). Registra quem fez.
create or replace function public.mudar_status_pedido(p_pedido uuid, p_para text, p_motivo text default null)
returns public.pedido language plpgsql security definer set search_path = public
as $$
declare
  v_p public.pedido;
  v_antes text;
  v_permitido boolean;
begin
  if not public.tem_papel(array['gerencia', 'cozinha', 'caixa']) then
    raise exception 'Sem permissão para alterar pedidos';
  end if;
  select * into v_p from public.pedido where id = p_pedido for update;
  if v_p.id is null then raise exception 'Pedido não encontrado'; end if;
  v_antes := v_p.status;

  if p_para = 'cancelado' then
    if not public.tem_papel(array['gerencia', 'caixa']) then raise exception 'Só gerência ou caixa podem cancelar'; end if;
    if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do cancelamento'; end if;
    v_permitido := v_p.status in ('confirmado', 'em_preparo', 'pronto');
  else
    v_permitido := (v_p.status, p_para) in (('confirmado', 'em_preparo'), ('em_preparo', 'pronto'), ('pronto', 'finalizado'), ('confirmado', 'pronto'));
  end if;
  if not v_permitido then raise exception 'Não é possível passar de % para %', v_p.status, p_para; end if;

  update public.pedido set
    status = p_para,
    motivo_cancelamento = case when p_para = 'cancelado' then trim(p_motivo) else motivo_cancelamento end,
    preparo_em = case when p_para = 'em_preparo' then now() else preparo_em end,
    pronto_em = case when p_para = 'pronto' then now() else pronto_em end,
    finalizado_em = case when p_para = 'finalizado' then now() else finalizado_em end,
    cancelado_em = case when p_para = 'cancelado' then now() else cancelado_em end,
    atualizado_em = now()
  where id = p_pedido
  returning * into v_p;

  insert into public.pedido_evento (pedido_id, tipo, de, para, motivo, ator, user_id)
  values (p_pedido, case when p_para = 'cancelado' then 'cancelado' else 'status' end, v_antes, p_para, p_motivo, 'funcionario', auth.uid());

  if p_para = 'cancelado' then
    -- cancela o que ainda não saiu e avisa os setores que já receberam a comanda
    update public.impressao_job set status = 'cancelado' where pedido_id = p_pedido and status = 'pendente';
    if exists (select 1 from public.impressao_job where pedido_id = p_pedido and status in ('impresso', 'imprimindo')) then
      perform public.gerar_impressao(p_pedido, 'cancelamento', auth.uid());
    end if;
  end if;

  return v_p;
end;
$$;

create or replace function public.reimprimir_pedido(p_pedido uuid)
returns int language plpgsql security definer set search_path = public
as $$
declare v_n int;
begin
  if not public.tem_papel(array['gerencia', 'cozinha', 'caixa']) then raise exception 'Sem permissão'; end if;
  v_n := public.gerar_impressao(p_pedido, 'reimpressao', auth.uid());
  insert into public.pedido_evento (pedido_id, tipo, ator, user_id) values (p_pedido, 'reimpressao', 'funcionario', auth.uid());
  return v_n;
end;
$$;

create or replace function public.marcar_pagamento(p_pedido uuid, p_status text)
returns void language plpgsql security definer set search_path = public
as $$
declare v_antes text;
begin
  if not public.tem_papel(array['gerencia', 'caixa']) then raise exception 'Só gerência ou caixa conferem pagamento'; end if;
  if p_status not in ('conferido', 'recusado', 'pendente') then raise exception 'Status inválido'; end if;
  select pagamento_status into v_antes from public.pedido where id = p_pedido for update;
  update public.pedido set pagamento_status = p_status, atualizado_em = now() where id = p_pedido;
  insert into public.pedido_evento (pedido_id, tipo, de, para, ator, user_id) values (p_pedido, 'pagamento', v_antes, p_status, 'funcionario', auth.uid());
end;
$$;

-- Atendimento humano: equipe assume ou devolve a conversa ao robô.
create or replace function public.assumir_conversa(p_conversa uuid, p_minutos int default 60)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.tem_papel(array['gerencia', 'cozinha', 'caixa']) then raise exception 'Sem permissão'; end if;
  update public.whatsapp_conversa
    set atendimento_humano_ate = now() + make_interval(mins => greatest(5, least(p_minutos, 720))),
        atendimento_humano_por = auth.uid(), aguardando_humano_desde = null
  where id = p_conversa;
end;
$$;

create or replace function public.devolver_conversa_robo(p_conversa uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.tem_papel(array['gerencia', 'cozinha', 'caixa']) then raise exception 'Sem permissão'; end if;
  update public.whatsapp_conversa
    set atendimento_humano_ate = null, atendimento_humano_por = null, aguardando_humano_desde = null, contexto = '{}'::jsonb
  where id = p_conversa;
end;
$$;

-- ---------- Agente de impressão (chamado só pela Edge Function, com a chave de serviço) ----------

-- Entrega até p_limite comandas pendentes ao agente e marca como "imprimindo".
-- Comandas presas em "imprimindo" há mais de 2 min voltam para a fila (agente caiu no meio).
create or replace function public.impressao_buscar(p_token text, p_limite int default 5)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_ag public.impressao_agente;
  v_jobs jsonb;
begin
  select * into v_ag from public.impressao_agente
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and ativo;
  if v_ag.id is null then raise exception 'agente não autorizado'; end if;

  update public.impressao_agente set ultimo_contato = now() where id = v_ag.id;
  update public.impressora set ultimo_contato = now() where estabelecimento_id = v_ag.estabelecimento_id and ativo;

  update public.impressao_job set status = 'pendente'
    where estabelecimento_id = v_ag.estabelecimento_id and status = 'imprimindo' and pego_em < now() - interval '2 minutes';

  with escolhidos as (
    select j.id from public.impressao_job j
    where j.estabelecimento_id = v_ag.estabelecimento_id and j.status = 'pendente' and j.impressora_id is not null
    order by j.criado_em
    limit greatest(1, least(p_limite, 20))
    for update skip locked
  ), marcados as (
    update public.impressao_job j set status = 'imprimindo', pego_em = now(), tentativas = j.tentativas + 1
    from escolhidos e where j.id = e.id
    returning j.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'tipo', m.tipo, 'via', m.via, 'conteudo', m.conteudo,
    'impressora', jsonb_build_object('nome', i.nome, 'nome_windows', i.nome_windows, 'modo', i.modo,
      'colunas', i.colunas, 'cortar_papel', i.cortar_papel, 'acentos', i.acentos, 'vias', i.vias))
    order by m.criado_em), '[]'::jsonb)
  into v_jobs
  from marcados m join public.impressora i on i.id = m.impressora_id;

  return v_jobs;
end;
$$;

create or replace function public.impressao_resultado(p_token text, p_job uuid, p_ok boolean, p_erro text default null)
returns void language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_ag public.impressao_agente;
  v_job public.impressao_job;
begin
  select * into v_ag from public.impressao_agente
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and ativo;
  if v_ag.id is null then raise exception 'agente não autorizado'; end if;

  select * into v_job from public.impressao_job where id = p_job and estabelecimento_id = v_ag.estabelecimento_id for update;
  if v_job.id is null then raise exception 'comanda não encontrada'; end if;

  if p_ok then
    update public.impressao_job set status = 'impresso', impresso_em = now(), erro = null where id = p_job;
    update public.impressora set ultimo_erro = null where id = v_job.impressora_id;
  else
    update public.impressao_job
      set status = case when v_job.tentativas >= 5 then 'erro' else 'pendente' end, erro = left(p_erro, 500)
    where id = p_job;
    update public.impressora set ultimo_erro = left(p_erro, 500) where id = v_job.impressora_id;
  end if;
end;
$$;

-- ============================================================
-- 6. Segurança (RLS e permissões)
-- ============================================================

alter table public.pedido_config enable row level security;
alter table public.categoria_pedido enable row level security;
alter table public.pedido enable row level security;
alter table public.pedido_item enable row level security;
alter table public.pedido_evento enable row level security;
alter table public.impressora enable row level security;
alter table public.impressao_job enable row level security;
alter table public.impressao_agente enable row level security;

create policy gerencia_all on public.pedido_config for all to authenticated using (tem_papel(array['gerencia'])) with check (tem_papel(array['gerencia']));
create policy equipe_select on public.pedido_config for select to authenticated using (tem_papel(array['gerencia', 'cozinha', 'caixa']));
create policy gerencia_all on public.categoria_pedido for all to authenticated using (tem_papel(array['gerencia'])) with check (tem_papel(array['gerencia']));
create policy equipe_select on public.categoria_pedido for select to authenticated using (tem_papel(array['gerencia', 'cozinha', 'caixa']));
-- pedidos: equipe só LÊ direto; toda alteração passa pelas funções acima (que registram quem fez)
create policy equipe_select on public.pedido for select to authenticated using (tem_papel(array['gerencia', 'cozinha', 'caixa']));
create policy equipe_select on public.pedido_item for select to authenticated using (tem_papel(array['gerencia', 'cozinha', 'caixa']));
create policy equipe_select on public.pedido_evento for select to authenticated using (tem_papel(array['gerencia', 'cozinha', 'caixa']));
create policy gerencia_all on public.impressora for all to authenticated using (tem_papel(array['gerencia'])) with check (tem_papel(array['gerencia']));
create policy equipe_select on public.impressora for select to authenticated using (tem_papel(array['gerencia', 'cozinha', 'caixa']));
create policy equipe_select on public.impressao_job for select to authenticated using (tem_papel(array['gerencia', 'cozinha', 'caixa']));
create policy gerencia_all on public.impressao_agente for all to authenticated using (tem_papel(array['gerencia'])) with check (tem_papel(array['gerencia']));

revoke all on public.pedido_config, public.categoria_pedido, public.pedido, public.pedido_item, public.pedido_evento,
  public.impressora, public.impressao_job, public.impressao_agente from anon, authenticated;
grant select on public.pedido, public.pedido_item, public.pedido_evento, public.impressao_job to authenticated;
grant select, insert, update, delete on public.pedido_config, public.categoria_pedido, public.impressora, public.impressao_agente to authenticated;

revoke execute on function public.brl(numeric) from public, anon;
revoke execute on function public.agora_local(timestamptz), public.dia_operacao(timestamptz),
  public.periodo_pedido(uuid, timestamptz), public.catalogo_pedido_agora(uuid, timestamptz),
  public.calcular_pedido(uuid, jsonb, timestamptz), public.montar_comanda(uuid, text[], text, int),
  public.gerar_impressao(uuid, text, uuid), public.criar_pedido(uuid, text, uuid, jsonb),
  public.mudar_status_pedido(uuid, text, text), public.reimprimir_pedido(uuid), public.marcar_pagamento(uuid, text),
  public.assumir_conversa(uuid, int), public.devolver_conversa_robo(uuid),
  public.impressao_buscar(text, int), public.impressao_resultado(text, uuid, boolean, text)
  from public, anon, authenticated;

-- equipe (painel)
grant execute on function public.mudar_status_pedido(uuid, text, text), public.reimprimir_pedido(uuid),
  public.marcar_pagamento(uuid, text), public.assumir_conversa(uuid, int), public.devolver_conversa_robo(uuid),
  public.periodo_pedido(uuid, timestamptz), public.catalogo_pedido_agora(uuid, timestamptz)
  to authenticated;
-- robô e agente de impressão (Edge Functions com a chave de serviço)
grant execute on function public.agora_local(timestamptz), public.dia_operacao(timestamptz),
  public.periodo_pedido(uuid, timestamptz), public.catalogo_pedido_agora(uuid, timestamptz),
  public.calcular_pedido(uuid, jsonb, timestamptz), public.montar_comanda(uuid, text[], text, int),
  public.gerar_impressao(uuid, text, uuid), public.criar_pedido(uuid, text, uuid, jsonb),
  public.impressao_buscar(text, int), public.impressao_resultado(text, uuid, boolean, text)
  to service_role;

-- painel em tempo real
alter publication supabase_realtime add table public.pedido, public.impressao_job;
