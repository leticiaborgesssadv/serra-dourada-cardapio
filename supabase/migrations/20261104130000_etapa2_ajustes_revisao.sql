-- Ajustes encontrados na revisão da Etapa 2.

-- 1. O caixa passa a usar o painel (Pedidos, Reservas e WhatsApp): precisa LER as conversas.
--    Envio e "assumir/devolver" continuam passando pelas funções, que conferem o papel.
create policy caixa_select on public.whatsapp_conversa for select to authenticated using (public.tem_papel(array['caixa']));
create policy caixa_select on public.whatsapp_mensagem for select to authenticated using (public.tem_papel(array['caixa']));

-- 2. Função de prioridade com search_path fixo (alerta de segurança do Supabase).
alter function public.prioridade_triagem(text, text) set search_path = public;
