# Etapa 2: triagem da gestão e reservas

Situação: tudo **testado no ambiente de testes** (`serra-smart-teste`). **Nada disso foi aplicado ao sistema real.** Depende da Etapa 1.

## O que esta etapa faz

| Parte | Onde fica | O que faz |
|---|---|---|
| Regras no banco | `supabase/migrations/20261104120000_…sql` | Protocolos (`G-261104-003` para a gestão, `R-261104-012` para reservas), prioridade automática, histórico de quem fez o quê, anexos em pasta privada, vagas por turno, lista de espera e presença. |
| Robô — triagem | `supabase/functions/whatsapp-webhook/triagem.ts` | Reclamação, falar com a gerência, currículo (aceita PDF ou foto), fornecedor, artista, parceria e nota fiscal. Faz 1 a 3 perguntas, uma por vez, e devolve o protocolo. O cliente pode escrever *pular* (nas opcionais) ou *cancelar*. |
| Robô — reservas | `supabase/functions/whatsapp-webhook/reserva.ts` | Entende "amanhã às 20h, 4 pessoas", "sexta 19h para 6" ou "04/11 20:30". Confere dia fechado, antecedência e vagas **antes** de pedir o nome. Turno cheio vira lista de espera. Grupo grande vira "reserva especial" para a gestão. "Minha reserva" mostra as próximas. |
| Ações da equipe | `supabase/functions/gestao-acao/` | Confirmar, recusar (com motivo), lista de espera, cancelar e presença. Avisa o cliente que pediu pelo WhatsApp. Também cria reservas de balcão/telefone e reenvia o aviso à gestão. |
| Painel — Reservas | `gestao/modules/reservas.js` | Lista "Aguardando resposta", dia por dia com barra de lotação por turno, nova reserva de balcão e regras (lugares por turno, grupo grande, antecedência e datas fechadas). |
| Painel — Triagem | `gestao/modules/triagem.js` | Só a gerência vê. Ordena por prioridade e oferece "Assumir", situação, prioridade, anotações internas, arquivos, histórico, "Responder no WhatsApp" e "Encaminhar à gestão". |

## Regras importantes

- **O robô nunca confirma reserva.** Ela só vale depois que alguém da equipe toca em *Confirmar*. Reserva de balcão, criada no painel, já entra confirmada.
- **Reservas do site continuam funcionando como antes** (tabela `contato_publico` e tela antiga) e passam a aparecer também em Reservas. Se algo falhar nessa cópia, o formulário do site não é afetado.
- **Prioridade automática:**

  | Prioridade | Quando |
  |---|---|
  | Urgente | Reclamação ou pedido de gerente que fale em passar mal, alergia, inseto, vidro, cabelo, Procon, polícia, advogado, cobrança indevida etc. O caso também acende o alerta "cliente esperando" na tela de Pedidos. |
  | Alta | Reclamação e reserva especial. |
  | Baixa | Currículo. |
  | Normal | O resto. |

  A gerência pode mudar a prioridade no painel.
- **O número da gestão (98274-3552) nunca é mostrado ao cliente.** O aviso à gestão leva só protocolo, assunto e prioridade, sem nome nem telefone do cliente.
- **Quem vê o quê:** a triagem é só da gerência. Reservas, a gerência e o caixa. A cozinha não vê nenhuma das duas, e isso foi testado.

## Testes feitos (ambiente de testes)

- **Regras de reserva:** dia fechado (domingo), horário fechado (15h), sem antecedência, muito à frente, sem nome, mensagem repetida (gera uma reserva só) e turno cheio (vai para a lista de espera). Grupo grande vai para a gestão, não para a lista de espera. Formulário do site espelhado em Reservas.
- **Conversas de reserva:** completa com botões; faltando só a quantidade ("4"); dia fechado seguido de outro dia; lista de espera; grupo de 25 e 30 pessoas; "minha reserva". O horário "20h 25 pessoas" é lido como 20:00 (erro encontrado e corrigido).
- **Conversas de triagem:** reclamação grave (urgente, com alerta), currículo com PDF anexado, artista com *pular*, gerente seguido de *cancelar* (nada registrado) e "quero falar com o gerente" (não confunde mais com pedido de comida).
- **Painel Reservas:** confirmar, aviso de "avise o cliente" quando o WhatsApp não sai, recusar (sem motivo não faz nada), reserva de balcão para hoje e barra de lotação.
- **Painel Triagem:** abrir, assumir, anotar, tentar aviso automático, configurar o número da gestão e o link "Encaminhar" (sem dados do cliente).
- **Permissões:** quem não está logado não lê nem cria nada direto; quem não é da equipe não decide reservas; a cozinha não vê triagem nem reservas.
- **Etapa 1:** o pedido "2 coca 600" passou a entrar direto, sem perguntar qual Coca. Antes, números de 3 dígitos eram ignorados.

**Ainda não testado:** envio real pelo WhatsApp (avisos ao cliente e à gestão) e download real de arquivos da Meta. Os dois dependem do cadastro na Meta. Sem token, o arquivo fica registrado como "aguardando download".

## O que falta configurar antes de ligar no sistema real

1. **Mensagem modelo na Meta** (categoria Utilidade), por exemplo `aviso_triagem`:
   *"Novo atendimento {{1}} · {{2}} · prioridade {{3}}. Veja os detalhes no painel."*
   Depois de aprovada, informe o nome dela em **Triagem › Aviso à gestão**, junto com o número 62 98274-3552. Enquanto isso, use o botão "Encaminhar à gestão" em cada atendimento.
2. **Regras de reserva** (Reservas › Regras de reserva): lugares no almoço e à noite (em branco = a equipe decide uma a uma), a partir de quantas pessoas é grupo grande (padrão 20), antecedência mínima (padrão 2 h) e datas fechadas.
3. **Avisos ao cliente fora das 24 h:** a Meta só deixa mandar texto livre até 24 h depois da última mensagem do cliente. Se a equipe confirmar uma reserva depois disso, o painel avisa que a mensagem não saiu, e é preciso ligar. Para automatizar, falta uma mensagem modelo de confirmação de reserva. Fica para depois.

## Como colocar no sistema real (quando aprovado)

1. Aplicar a migração `20261104120000_etapa2_triagem_reservas.sql`. Ela cria o bucket privado `triagem` e o gatilho no `contato_publico`.
2. Publicar as funções `whatsapp-webhook` (atualizada) e `gestao-acao` (nova).
3. Publicar o painel (`gestao/`).
4. Fazer uma reserva e uma triagem de teste pelo WhatsApp real e conferir no painel.

## Plano B

- **Reservas pelo robô com problema:** em Reservas › Regras, desmarque "aceitando pedidos de reserva". O robô passa a orientar o cliente a falar com um atendente. O formulário do site continua funcionando.
- **Aviso à gestão não chega:** a Triagem mostra "aviso à gestão FALHOU" ou "não configurado" em cada caso. Use "Encaminhar à gestão (WhatsApp)".
