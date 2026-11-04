-- Reserva para um horário que já passou: mensagem clara (antes dizia "pelo menos 0 h de antecedência").
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
      if v_quando < now() then
        -- com antecedência mínima 0, a mensagem "pelo menos 0 h" não faz sentido
        v_erros := array_append(v_erros, 'Esse horário já passou.');
      elsif v_quando < now() + make_interval(hours => v_cfg.antecedencia_min_horas) then
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
