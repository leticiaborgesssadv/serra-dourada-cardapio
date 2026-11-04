-- Etapa 2: triagem da gestão (protocolos, prioridade, aviso à gestão, anexos) e reservas com capacidade,
-- aprovação pela equipe, lista de espera e presença.
-- Regra geral: o robô e o site só SOLICITAM. Quem confirma reserva ou resolve atendimento é sempre a equipe.

-- ============================================================
-- 1. Configuração (preenchida pela gestão no painel)
-- ============================================================

create table public.triagem_config (
  estabelecimento_id uuid primary key references public.estabelecimento(id) on delete cascade,
  telefone_gestao text check (telefone_gestao is null or telefone_gestao ~ '^[0-9]{12,13}$'), -- só números, ex.: 5562982743552. Nunca é mostrado ao cliente.
  modelo_aviso text,                       -- nome da mensagem modelo aprovada pela Meta (parâmetros: protocolo, categoria, prioridade)
  modelo_idioma text not null default 'pt_BR',
  avisar_prioridades text[] not null default array['alta', 'urgente'],
  atualizado_em timestamptz not null default now()
);

create table public.reserva_config (
  estabelecimento_id uuid primary key references public.estabelecimento(id) on delete cascade,
  aceitando_reservas boolean not null default true,
  capacidade_almoco int check (capacidade_almoco is null or capacidade_almoco > 0), -- pessoas por turno; vazio = sem limite automático
  capacidade_noite int check (capacidade_noite is null or capacidade_noite > 0),
  limite_grupo int not null default 20 check (limite_grupo between 2 and 300),     -- acima disso vira "reserva especial" para a gestão
  antecedencia_min_horas int not null default 2 check (antecedencia_min_horas between 0 and 168),
  dias_max_antecedencia int not null default 60 check (dias_max_antecedencia between 1 and 365),
  datas_fechadas date[] not null default '{}',
  atualizado_em timestamptz not null default now()
);

-- Numeração de protocolos por prefixo e dia (G-261104-003, R-261104-012). Atômica, sem corrida.
create table public.protocolo_contador (
  prefixo text not null,
  dia date not null,
  ultimo int not null,
  primary key (prefixo, dia)
);

create or replace function public.proximo_protocolo(p_prefixo text)
returns text language plpgsql security definer set search_path = public
as $$
declare
  v_dia date := public.agora_local()::date;
  v_n int;
begin
  insert into public.protocolo_contador (prefixo, dia, ultimo) values (p_prefixo, v_dia, 1)
  on conflict (prefixo, dia) do update set ultimo = public.protocolo_contador.ultimo + 1
  returning ultimo into v_n;
  return p_prefixo || '-' || to_char(v_dia, 'YYMMDD') || '-' || lpad(v_n::text, 3, '0');
end;
$$;

-- ============================================================
-- 2. Triagem da gestão
-- ============================================================

create table public.atendimento_adm (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references public.estabelecimento(id) on delete cascade,
  protocolo text not null unique,
  categoria text not null check (categoria in ('fornecedor', 'curriculo', 'artista', 'parceria', 'reserva_especial', 'reclamacao', 'gerente', 'nota_fiscal', 'outro')),
  prioridade text not null default 'normal' check (prioridade in ('baixa', 'normal', 'alta', 'urgente')),
  status text not null default 'novo' check (status in ('novo', 'em_andamento', 'aguardando_cliente', 'resolvido', 'arquivado')),
  origem text not null default 'whatsapp' check (origem in ('whatsapp', 'site', 'painel')),
  chave_idempotencia text unique,
  conversa_id uuid references public.whatsapp_conversa(id) on delete set null,
  nome text,
  telefone text,
  resumo text,
  dados jsonb not null default '{}',
  responsavel_id uuid references public.funcionario(id) on delete set null,
  aviso_gestao text not null default 'nao_necessario' check (aviso_gestao in ('pendente', 'enviado', 'falhou', 'nao_configurado', 'nao_necessario')),
  aviso_gestao_erro text,
  aviso_gestao_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  resolvido_em timestamptz
);
create index atendimento_adm_abertos on public.atendimento_adm (estabelecimento_id, status, prioridade, criado_em);

create table public.atendimento_adm_evento (
  id uuid primary key default gen_random_uuid(),
  atendimento_id uuid not null references public.atendimento_adm(id) on delete cascade,
  tipo text not null check (tipo in ('criado', 'status', 'prioridade', 'responsavel', 'nota', 'aviso_gestao', 'anexo')),
  de text,
  para text,
  texto text,
  ator text not null default 'equipe' check (ator in ('cliente', 'robo', 'equipe')),
  funcionario_id uuid references public.funcionario(id) on delete set null,
  criado_em timestamptz not null default clock_timestamp()
);
create index atendimento_adm_evento_at on public.atendimento_adm_evento (atendimento_id, criado_em);

-- Arquivos enviados pelo cliente (currículo, portfólio). Ficam num bucket privado, só a gerência abre.
create table public.atendimento_adm_anexo (
  id uuid primary key default gen_random_uuid(),
  atendimento_id uuid not null references public.atendimento_adm(id) on delete cascade,
  meta_media_id text,
  tipo text,
  mime text,
  nome_arquivo text,
  storage_path text,
  status text not null default 'pendente' check (status in ('pendente', 'salvo', 'falhou')),
  erro text,
  criado_em timestamptz not null default now()
);

insert into storage.buckets (id, name, public) values ('triagem', 'triagem', false) on conflict (id) do nothing;
create policy triagem_gerencia_le on storage.objects for select to authenticated
  using (bucket_id = 'triagem' and public.tem_papel(array['gerencia']));

-- Prioridade: base por categoria; sobe para "urgente" quando o relato tem sinais de caso grave.
create or replace function public.prioridade_triagem(p_categoria text, p_texto text)
returns text language sql immutable
as $$
  select case
    when p_categoria in ('reclamacao', 'gerente') and lower(translate(coalesce(p_texto, ''), 'áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ', 'aaaaeeiooouucAAAAEEIOOOUUC'))
      ~ '(intoxica|passou mal|passei mal|passamos mal|hospital|alergi|barata|rato|inseto|bicho|cabelo na|vidro|vigilancia|procon|policia|advogad|processar|agress|assedi|roubo|furto|cobranca indevida|cobrado a mais)'
      then 'urgente'
    when p_categoria in ('reclamacao', 'reserva_especial') then 'alta'
    when p_categoria in ('curriculo') then 'baixa'
    else 'normal'
  end;
$$;

-- Abre um atendimento (robô ou painel). Idempotente pela chave (id da mensagem da Meta).
create or replace function public.abrir_atendimento_adm(p_estab uuid, p_chave text, p_conversa uuid, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_existente public.atendimento_adm;
  v_cat text := p_dados ->> 'categoria';
  v_texto text;
  v_prior text;
  v_cfg public.triagem_config;
  v_avisar boolean;
  v_id uuid;
  v_prot text;
begin
  if p_chave is not null then
    select * into v_existente from public.atendimento_adm where chave_idempotencia = p_chave;
    if v_existente.id is not null then
      return jsonb_build_object('ok', true, 'duplicado', true, 'id', v_existente.id, 'protocolo', v_existente.protocolo, 'prioridade', v_existente.prioridade, 'avisar', false);
    end if;
  end if;
  if v_cat is null or v_cat not in ('fornecedor', 'curriculo', 'artista', 'parceria', 'reserva_especial', 'reclamacao', 'gerente', 'nota_fiscal', 'outro') then
    raise exception 'categoria inválida: %', v_cat;
  end if;

  select string_agg(value, ' ') into v_texto from jsonb_each_text(coalesce(p_dados -> 'dados', '{}'::jsonb));
  v_texto := coalesce(v_texto, '') || ' ' || coalesce(p_dados ->> 'resumo', '');
  v_prior := public.prioridade_triagem(v_cat, v_texto);

  select * into v_cfg from public.triagem_config where estabelecimento_id = p_estab;
  v_avisar := v_prior = any(coalesce(v_cfg.avisar_prioridades, array['alta', 'urgente']));
  v_prot := public.proximo_protocolo('G');

  insert into public.atendimento_adm (estabelecimento_id, protocolo, categoria, prioridade, origem, chave_idempotencia, conversa_id,
    nome, telefone, resumo, dados, aviso_gestao)
  values (p_estab, v_prot, v_cat, v_prior, coalesce(p_dados ->> 'origem', 'whatsapp'), p_chave, p_conversa,
    nullif(left(trim(coalesce(p_dados ->> 'nome', '')), 80), ''), p_dados ->> 'telefone',
    nullif(left(trim(coalesce(p_dados ->> 'resumo', '')), 500), ''), coalesce(p_dados -> 'dados', '{}'::jsonb),
    case when v_avisar then 'pendente' else 'nao_necessario' end)
  returning id into v_id;

  insert into public.atendimento_adm_evento (atendimento_id, tipo, para, ator) values (v_id, 'criado', v_prior, 'cliente');

  -- caso urgente: a conversa aparece no alerta "cliente esperando" do painel (o robô continua respondendo)
  if v_prior = 'urgente' and p_conversa is not null then
    update public.whatsapp_conversa set aguardando_humano_desde = coalesce(aguardando_humano_desde, now()) where id = p_conversa;
  end if;

  return jsonb_build_object('ok', true, 'duplicado', false, 'id', v_id, 'protocolo', v_prot, 'prioridade', v_prior, 'avisar', v_avisar);
end;
$$;

-- Resultado do aviso à gestão (robô ou painel).
create or replace function public.registrar_aviso_gestao(p_id uuid, p_status text, p_erro text default null)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null and not public.tem_papel(array['gerencia']) then raise exception 'Só a gerência acessa a triagem'; end if;
  if p_status not in ('pendente', 'enviado', 'falhou', 'nao_configurado', 'nao_necessario') then raise exception 'status inválido'; end if;
  update public.atendimento_adm set aviso_gestao = p_status, aviso_gestao_erro = left(p_erro, 500),
    aviso_gestao_em = case when p_status = 'enviado' then now() else aviso_gestao_em end, atualizado_em = now()
  where id = p_id;
  insert into public.atendimento_adm_evento (atendimento_id, tipo, para, texto, ator, funcionario_id)
  values (p_id, 'aviso_gestao', p_status, left(p_erro, 300), case when auth.uid() is null then 'robo' else 'equipe' end,
    (select id from public.funcionario where user_id = auth.uid()));
end;
$$;

-- Equipe (só gerência): status, prioridade, assumir e anotações. Tudo vai para o histórico com o nome de quem fez.
create or replace function public.atualizar_atendimento_adm(p_id uuid, p_status text default null, p_prioridade text default null,
  p_assumir boolean default false, p_nota text default null)
returns public.atendimento_adm language plpgsql security definer set search_path = public
as $$
declare
  v_a public.atendimento_adm;
  v_func uuid;
begin
  if not public.tem_papel(array['gerencia']) then raise exception 'Só a gerência acessa a triagem'; end if;
  select id into v_func from public.funcionario where user_id = auth.uid();
  select * into v_a from public.atendimento_adm where id = p_id for update;
  if v_a.id is null then raise exception 'Atendimento não encontrado'; end if;

  if p_status is not null and p_status <> v_a.status then
    if p_status not in ('novo', 'em_andamento', 'aguardando_cliente', 'resolvido', 'arquivado') then raise exception 'status inválido'; end if;
    insert into public.atendimento_adm_evento (atendimento_id, tipo, de, para, funcionario_id) values (p_id, 'status', v_a.status, p_status, v_func);
    update public.atendimento_adm set status = p_status,
      resolvido_em = case when p_status in ('resolvido', 'arquivado') then now() else null end
    where id = p_id;
  end if;
  if p_prioridade is not null and p_prioridade <> v_a.prioridade then
    if p_prioridade not in ('baixa', 'normal', 'alta', 'urgente') then raise exception 'prioridade inválida'; end if;
    insert into public.atendimento_adm_evento (atendimento_id, tipo, de, para, funcionario_id) values (p_id, 'prioridade', v_a.prioridade, p_prioridade, v_func);
    update public.atendimento_adm set prioridade = p_prioridade where id = p_id;
  end if;
  if p_assumir then
    insert into public.atendimento_adm_evento (atendimento_id, tipo, para, funcionario_id)
    values (p_id, 'responsavel', (select nome from public.funcionario where id = v_func), v_func);
    update public.atendimento_adm set responsavel_id = v_func,
      status = case when status = 'novo' then 'em_andamento' else status end
    where id = p_id;
  end if;
  if coalesce(trim(p_nota), '') <> '' then
    insert into public.atendimento_adm_evento (atendimento_id, tipo, texto, funcionario_id) values (p_id, 'nota', left(trim(p_nota), 1000), v_func);
  end if;

  update public.atendimento_adm set atualizado_em = now() where id = p_id returning * into v_a;
  return v_a;
end;
$$;

-- ============================================================
-- 3. Reservas
-- ============================================================

create table public.reserva (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references public.estabelecimento(id) on delete cascade,
  protocolo text not null unique,
  chave_idempotencia text unique,
  origem text not null default 'whatsapp' check (origem in ('whatsapp', 'site', 'painel')),
  conversa_id uuid references public.whatsapp_conversa(id) on delete set null,
  contato_publico_id uuid unique references public.contato_publico(id) on delete set null,
  atendimento_id uuid references public.atendimento_adm(id) on delete set null,
  cliente_nome text not null,
  cliente_telefone text,
  data date not null,
  horario time,            -- o formulário antigo do site pode não mandar horário
  turno text check (turno in ('almoco', 'noite')),
  pessoas int not null check (pessoas between 1 and 300),
  observacao text,
  status text not null default 'pendente'
    check (status in ('pendente', 'confirmada', 'lista_espera', 'recusada', 'cancelada', 'compareceu', 'nao_compareceu')),
  motivo text,
  decidido_por uuid references public.funcionario(id) on delete set null,
  decidido_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index reserva_dia on public.reserva (estabelecimento_id, data, turno, status);
create index reserva_telefone on public.reserva (cliente_telefone, data);

create table public.reserva_evento (
  id uuid primary key default gen_random_uuid(),
  reserva_id uuid not null references public.reserva(id) on delete cascade,
  de text,
  para text not null,
  motivo text,
  ator text not null default 'equipe' check (ator in ('cliente', 'robo', 'equipe', 'site')),
  funcionario_id uuid references public.funcionario(id) on delete set null,
  criado_em timestamptz not null default clock_timestamp()
);

-- Turno de um horário, pelo horário de funcionamento do site. null = fechado.
create or replace function public.turno_da_reserva(p_estab uuid, p_data date, p_horario time)
returns text language plpgsql stable security definer set search_path = public
as $$
declare
  v_h jsonb;
  v_dia jsonb;
  v_abre time;
  v_fecha time;
begin
  select horario_funcionamento into v_h from public.pagina_config where estabelecimento_id = p_estab;
  v_dia := v_h -> extract(dow from p_data)::int::text;
  if v_dia is null or p_horario is null then return null; end if;
  if v_dia -> 'almoco' ->> 'abre' is not null then
    v_abre := (v_dia -> 'almoco' ->> 'abre')::time; v_fecha := (v_dia -> 'almoco' ->> 'fecha')::time;
    if p_horario >= v_abre and p_horario < v_fecha then return 'almoco'; end if;
  end if;
  if v_dia -> 'bar' ->> 'abre' is not null then
    v_abre := (v_dia -> 'bar' ->> 'abre')::time; v_fecha := (v_dia -> 'bar' ->> 'fecha')::time;
    if v_fecha <= v_abre then -- passa da meia-noite (ex.: 16:00 às 00:00)
      if p_horario >= v_abre then return 'noite'; end if;
    elsif p_horario >= v_abre and p_horario < v_fecha then return 'noite';
    end if;
  end if;
  return null;
end;
$$;

-- Lugares ocupados no turno (pendentes contam, para não prometer a mesma vaga duas vezes).
create or replace function public.ocupacao_reserva(p_estab uuid, p_data date, p_turno text)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'capacidade', case p_turno when 'almoco' then c.capacidade_almoco when 'noite' then c.capacidade_noite end,
    'confirmadas', coalesce((select sum(pessoas) from public.reserva r where r.estabelecimento_id = p_estab and r.data = p_data and r.turno = p_turno and r.status in ('confirmada', 'compareceu')), 0),
    'pendentes', coalesce((select sum(pessoas) from public.reserva r where r.estabelecimento_id = p_estab and r.data = p_data and r.turno = p_turno and r.status = 'pendente'), 0),
    'lista_espera', coalesce((select sum(pessoas) from public.reserva r where r.estabelecimento_id = p_estab and r.data = p_data and r.turno = p_turno and r.status = 'lista_espera'), 0))
  from (select 1) x left join public.reserva_config c on c.estabelecimento_id = p_estab;
$$;

-- Confere uma solicitação SEM gravar (o robô usa antes de pedir o nome).
-- Devolve: ok, erros[], turno, especial (grupo grande), lista_espera (sem vaga), ocupacao.
create or replace function public.validar_reserva(p_estab uuid, p_dados jsonb)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_cfg public.reserva_config;
  v_data date := nullif(p_dados ->> 'data', '')::date;
  v_hora time := nullif(p_dados ->> 'horario', '')::time;
  v_pessoas int := nullif(p_dados ->> 'pessoas', '')::int;
  -- site antigo e equipe no balcão não passam pelas regras de data/hora (a equipe decide); o WhatsApp passa
  v_site boolean := coalesce(p_dados ->> 'origem', '') in ('site', 'painel');
  v_sem_hora_ok boolean := coalesce(p_dados ->> 'origem', '') = 'site';
  v_turno text;
  v_erros text[] := '{}';
  v_quando timestamptz;
  v_oc jsonb;
  v_espera boolean := false;
begin
  select * into v_cfg from public.reserva_config where estabelecimento_id = p_estab;
  if v_cfg.estabelecimento_id is null then
    v_cfg.aceitando_reservas := true; v_cfg.limite_grupo := 20; v_cfg.antecedencia_min_horas := 2;
    v_cfg.dias_max_antecedencia := 60; v_cfg.datas_fechadas := '{}';
  end if;

  if not v_cfg.aceitando_reservas and not v_site then v_erros := array_append(v_erros, 'No momento não estamos aceitando reservas por aqui.'); end if;
  if v_data is null then v_erros := array_append(v_erros, 'Falta a data.'); end if;
  if v_hora is null and not v_sem_hora_ok then v_erros := array_append(v_erros, 'Falta o horário.'); end if;
  if v_pessoas is null or v_pessoas < 1 or v_pessoas > 300 then v_erros := array_append(v_erros, 'Quantidade de pessoas inválida.'); end if;

  if v_data is not null then
    v_turno := public.turno_da_reserva(p_estab, v_data, v_hora);
    if v_data = any(v_cfg.datas_fechadas) then
      v_erros := array_append(v_erros, 'Nesse dia não teremos reservas (data fechada).');
    elsif not v_site then
      if v_hora is not null and v_turno is null then
        v_erros := array_append(v_erros, 'Nesse dia e horário estamos fechados.');
      end if;
      v_quando := (v_data + coalesce(v_hora, '00:00'::time)) at time zone 'America/Sao_Paulo';
      if v_quando < now() + make_interval(hours => v_cfg.antecedencia_min_horas) then
        v_erros := array_append(v_erros, format('As reservas precisam ser feitas com pelo menos %s h de antecedência.', v_cfg.antecedencia_min_horas));
      elsif v_data > public.agora_local()::date + v_cfg.dias_max_antecedencia then
        v_erros := array_append(v_erros, format('Aceitamos reservas para até %s dias à frente.', v_cfg.dias_max_antecedencia));
      end if;
    end if;
  end if;

  if v_turno is not null then
    v_oc := public.ocupacao_reserva(p_estab, v_data, v_turno);
    -- grupo grande não vai para a lista de espera: a gestão decide caso a caso
    if (v_oc ->> 'capacidade') is not null and v_pessoas is not null and v_pessoas <= v_cfg.limite_grupo
       and (v_oc ->> 'confirmadas')::int + (v_oc ->> 'pendentes')::int + v_pessoas > (v_oc ->> 'capacidade')::int then
      v_espera := true;
    end if;
  end if;

  return jsonb_build_object('ok', cardinality(v_erros) = 0, 'erros', to_jsonb(v_erros), 'turno', v_turno,
    'especial', coalesce(v_pessoas > v_cfg.limite_grupo, false), 'limite_grupo', v_cfg.limite_grupo,
    'lista_espera', v_espera, 'ocupacao', v_oc);
end;
$$;

-- Grava a solicitação (robô, site ou painel). Idempotente pela chave.
-- Grupo acima do limite: além da reserva, abre um atendimento "reserva especial" para a gestão.
create or replace function public.solicitar_reserva(p_estab uuid, p_chave text, p_conversa uuid, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_existente public.reserva;
  v_val jsonb;
  v_status text;
  v_id uuid;
  v_prot text;
  v_at jsonb;
  v_origem text := coalesce(p_dados ->> 'origem', 'whatsapp');
begin
  if coalesce(trim(p_chave), '') = '' then raise exception 'chave de idempotência obrigatória'; end if;
  select * into v_existente from public.reserva where chave_idempotencia = p_chave;
  if v_existente.id is not null then
    return jsonb_build_object('ok', true, 'duplicado', true, 'id', v_existente.id, 'protocolo', v_existente.protocolo, 'status', v_existente.status);
  end if;
  if coalesce(trim(p_dados ->> 'cliente_nome'), '') = '' then
    return jsonb_build_object('ok', false, 'erros', jsonb_build_array('Falta o nome para a reserva.'));
  end if;

  v_val := public.validar_reserva(p_estab, p_dados);
  if not (v_val ->> 'ok')::boolean then return v_val; end if;

  v_status := case when (v_val ->> 'lista_espera')::boolean then 'lista_espera' else 'pendente' end;
  v_prot := public.proximo_protocolo('R');

  insert into public.reserva (estabelecimento_id, protocolo, chave_idempotencia, origem, conversa_id, contato_publico_id,
    cliente_nome, cliente_telefone, data, horario, turno, pessoas, observacao, status)
  values (p_estab, v_prot, p_chave, v_origem, p_conversa, nullif(p_dados ->> 'contato_publico_id', '')::uuid,
    left(trim(p_dados ->> 'cliente_nome'), 80), p_dados ->> 'cliente_telefone',
    (p_dados ->> 'data')::date, nullif(p_dados ->> 'horario', '')::time, v_val ->> 'turno', (p_dados ->> 'pessoas')::int,
    nullif(left(trim(coalesce(p_dados ->> 'observacao', '')), 300), ''), v_status)
  returning id into v_id;

  insert into public.reserva_evento (reserva_id, para, ator)
  values (v_id, v_status, case v_origem when 'site' then 'site' when 'painel' then 'equipe' else 'cliente' end);

  if (v_val ->> 'especial')::boolean then
    v_at := public.abrir_atendimento_adm(p_estab, 'reserva:' || v_id, p_conversa, jsonb_build_object(
      'categoria', 'reserva_especial', 'origem', v_origem, 'nome', p_dados ->> 'cliente_nome', 'telefone', p_dados ->> 'cliente_telefone',
      'resumo', format('Reserva %s: %s pessoas em %s %s', v_prot, p_dados ->> 'pessoas', to_char((p_dados ->> 'data')::date, 'DD/MM/YYYY'), coalesce(left(p_dados ->> 'horario', 5), '')),
      'dados', jsonb_build_object('Reserva', v_prot, 'Ocasião', coalesce(p_dados ->> 'observacao', ''))));
    update public.reserva set atendimento_id = (v_at ->> 'id')::uuid where id = v_id;
  end if;

  return jsonb_build_object('ok', true, 'duplicado', false, 'id', v_id, 'protocolo', v_prot, 'status', v_status,
    'turno', v_val ->> 'turno', 'especial', (v_val ->> 'especial')::boolean, 'atendimento', v_at);
end;
$$;

-- Equipe: reserva criada no painel (telefone, balcão). Já entra confirmada.
create or replace function public.criar_reserva_painel(p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_estab uuid;
  v_r jsonb;
  v_func uuid;
begin
  if not public.tem_papel(array['gerencia', 'caixa']) then raise exception 'Sem permissão para reservas'; end if;
  select id, estabelecimento_id into v_func, v_estab from public.funcionario where user_id = auth.uid();
  v_r := public.solicitar_reserva(v_estab, 'painel:' || gen_random_uuid(), null, p_dados || jsonb_build_object('origem', 'painel'));
  if (v_r ->> 'ok')::boolean and v_r ->> 'status' = 'pendente' then
    update public.reserva set status = 'confirmada', decidido_por = v_func, decidido_em = now(), atualizado_em = now() where id = (v_r ->> 'id')::uuid;
    insert into public.reserva_evento (reserva_id, de, para, funcionario_id) values ((v_r ->> 'id')::uuid, 'pendente', 'confirmada', v_func);
    v_r := v_r || jsonb_build_object('status', 'confirmada');
  end if;
  return v_r;
end;
$$;

-- Equipe: decide a reserva. Toda mudança fica no histórico com o nome de quem fez.
create or replace function public.decidir_reserva(p_id uuid, p_acao text, p_motivo text default null)
returns public.reserva language plpgsql security definer set search_path = public
as $$
declare
  v_r public.reserva;
  v_para text;
  v_func uuid;
  v_permitidos text[];
begin
  if not public.tem_papel(array['gerencia', 'caixa']) then raise exception 'Sem permissão para reservas'; end if;
  select id into v_func from public.funcionario where user_id = auth.uid();
  select * into v_r from public.reserva where id = p_id for update;
  if v_r.id is null then raise exception 'Reserva não encontrada'; end if;

  case p_acao
    when 'confirmar' then v_para := 'confirmada'; v_permitidos := array['pendente', 'lista_espera'];
    when 'lista_espera' then v_para := 'lista_espera'; v_permitidos := array['pendente'];
    when 'recusar' then v_para := 'recusada'; v_permitidos := array['pendente', 'lista_espera'];
    when 'cancelar' then v_para := 'cancelada'; v_permitidos := array['pendente', 'lista_espera', 'confirmada'];
    when 'compareceu' then v_para := 'compareceu'; v_permitidos := array['confirmada', 'nao_compareceu'];
    when 'nao_compareceu' then v_para := 'nao_compareceu'; v_permitidos := array['confirmada', 'compareceu'];
    else raise exception 'Ação inválida: %', p_acao;
  end case;
  if not v_r.status = any(v_permitidos) then
    raise exception 'Não é possível % uma reserva que está "%"', p_acao, v_r.status;
  end if;
  if p_acao in ('recusar', 'cancelar') and coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo'; end if;
  if p_acao in ('compareceu', 'nao_compareceu') and v_r.data > public.agora_local()::date then
    raise exception 'A presença só pode ser marcada no dia da reserva ou depois';
  end if;

  insert into public.reserva_evento (reserva_id, de, para, motivo, funcionario_id) values (p_id, v_r.status, v_para, nullif(trim(p_motivo), ''), v_func);
  update public.reserva set status = v_para, motivo = coalesce(nullif(trim(p_motivo), ''), motivo),
    decidido_por = v_func, decidido_em = now(), atualizado_em = now()
  where id = p_id returning * into v_r;
  return v_r;
end;
$$;

-- Reservas feitas pelo formulário do site continuam em contato_publico (tela antiga) e passam a aparecer
-- também na tela de Reservas. Se algo der errado aqui, o formulário do site NÃO falha.
create or replace function public.contato_publico_para_reserva()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.data_desejada is not null and new.pessoas is not null then
    begin
      perform public.solicitar_reserva(new.estabelecimento_id, 'site:' || new.id, null, jsonb_build_object(
        'origem', 'site', 'contato_publico_id', new.id, 'cliente_nome', coalesce(nullif(trim(new.nome), ''), 'Cliente do site'),
        'cliente_telefone', regexp_replace(coalesce(new.telefone, ''), '[^0-9]', '', 'g'),
        'data', new.data_desejada, 'horario', new.horario_desejado, 'pessoas', new.pessoas,
        'observacao', left(new.mensagem, 300)));
    exception when others then
      raise warning 'reserva do site não espelhada: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;
create trigger contato_publico_reserva after insert on public.contato_publico
  for each row execute function public.contato_publico_para_reserva();

-- ============================================================
-- 4. Segurança (RLS e permissões)
-- ============================================================

alter table public.triagem_config enable row level security;
alter table public.reserva_config enable row level security;
alter table public.protocolo_contador enable row level security;
alter table public.atendimento_adm enable row level security;
alter table public.atendimento_adm_evento enable row level security;
alter table public.atendimento_adm_anexo enable row level security;
alter table public.reserva enable row level security;
alter table public.reserva_evento enable row level security;

-- triagem: só a gerência vê (tem dados pessoais e assuntos sensíveis)
create policy gerencia_all on public.triagem_config for all to authenticated using (tem_papel(array['gerencia'])) with check (tem_papel(array['gerencia']));
create policy gerencia_select on public.atendimento_adm for select to authenticated using (tem_papel(array['gerencia']));
create policy gerencia_select on public.atendimento_adm_evento for select to authenticated using (tem_papel(array['gerencia']));
create policy gerencia_select on public.atendimento_adm_anexo for select to authenticated using (tem_papel(array['gerencia']));
-- reservas: gerência e caixa leem; alterações só pelas funções
create policy gerencia_all on public.reserva_config for all to authenticated using (tem_papel(array['gerencia'])) with check (tem_papel(array['gerencia']));
create policy equipe_select on public.reserva_config for select to authenticated using (tem_papel(array['gerencia', 'caixa']));
create policy equipe_select on public.reserva for select to authenticated using (tem_papel(array['gerencia', 'caixa']));
create policy equipe_select on public.reserva_evento for select to authenticated using (tem_papel(array['gerencia', 'caixa']));

revoke all on public.triagem_config, public.reserva_config, public.protocolo_contador, public.atendimento_adm,
  public.atendimento_adm_evento, public.atendimento_adm_anexo, public.reserva, public.reserva_evento from anon, authenticated;
grant select, insert, update on public.triagem_config, public.reserva_config to authenticated;
grant select on public.atendimento_adm, public.atendimento_adm_evento, public.atendimento_adm_anexo, public.reserva, public.reserva_evento to authenticated;

revoke execute on function public.proximo_protocolo(text), public.prioridade_triagem(text, text),
  public.abrir_atendimento_adm(uuid, text, uuid, jsonb), public.registrar_aviso_gestao(uuid, text, text),
  public.atualizar_atendimento_adm(uuid, text, text, boolean, text), public.turno_da_reserva(uuid, date, time),
  public.ocupacao_reserva(uuid, date, text), public.validar_reserva(uuid, jsonb), public.solicitar_reserva(uuid, text, uuid, jsonb),
  public.criar_reserva_painel(jsonb), public.decidir_reserva(uuid, text, text), public.contato_publico_para_reserva()
  from public, anon, authenticated;

-- equipe (painel)
grant execute on function public.atualizar_atendimento_adm(uuid, text, text, boolean, text), public.registrar_aviso_gestao(uuid, text, text),
  public.criar_reserva_painel(jsonb), public.decidir_reserva(uuid, text, text), public.ocupacao_reserva(uuid, date, text)
  to authenticated;
-- robô (Edge Functions com a chave de serviço)
grant execute on function public.proximo_protocolo(text), public.prioridade_triagem(text, text),
  public.abrir_atendimento_adm(uuid, text, uuid, jsonb), public.registrar_aviso_gestao(uuid, text, text),
  public.turno_da_reserva(uuid, date, time), public.ocupacao_reserva(uuid, date, text), public.validar_reserva(uuid, jsonb),
  public.solicitar_reserva(uuid, text, uuid, jsonb)
  to service_role;

-- painel em tempo real
alter publication supabase_realtime add table public.reserva, public.atendimento_adm;
