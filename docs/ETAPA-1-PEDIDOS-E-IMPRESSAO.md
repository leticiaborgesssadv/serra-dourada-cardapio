# Etapa 1: pedidos pelo WhatsApp e impressão

Situação: tudo **testado no ambiente de testes** (`serra-smart-teste`). **Nada disso foi aplicado ao sistema real.**

## O que esta etapa faz

| Parte | Onde fica | O que faz |
|---|---|---|
| Regras do pedido | `supabase/migrations/20261103120000_…sql` | Tabelas de pedido, itens, histórico, impressoras e fila de impressão. Preço, horário, disponibilidade e total são calculados **no banco**. O mesmo pedido nunca é gravado duas vezes e a numeração recomeça a cada dia (o dia vira às 6h). |
| Segredos | `supabase/migrations/20261103130000_…sql` | Permite guardar as chaves da Meta no Supabase Vault (criptografadas). |
| Robô do WhatsApp | `supabase/functions/whatsapp-webhook/` | Confere a assinatura da Meta, transfere para atendimento humano e conduz o pedido completo (com botões, listas e texto livre). Expira conversas paradas há mais de 2 h e responde "meu pedido". |
| Ações da equipe | `supabase/functions/pedido-acao/` | Muda o status, cancela (com motivo), reimprime, confere Pix, assume e devolve conversas. Avisa o cliente quando o pedido fica pronto ou é cancelado. |
| Envio manual | `supabase/functions/whatsapp-enviar/` | Quando alguém da equipe responde pelo painel, o robô fica em silêncio nessa conversa. |
| Fila de impressão | `supabase/functions/impressao-agente/` | Entrega as comandas ao programa do PC e recebe o resultado. |
| Programa do PC | `agente-impressao/` | PowerShell (já vem no Windows). Imprime na Epson (ESC/POS, com acentos e corte do papel) ou em fila de texto. Se falhar, a comanda volta para a fila. |
| Painel | `gestao/modules/pedidos.js` e outros | Tela "Pedidos" com atualização ao vivo, bipe de pedido novo, alertas de impressora e de cliente esperando, e botões grandes. A cozinha também vê essa tela. |
| Configuração | `gestao/modules/config-pedidos.js` | Tela "Configurar pedidos" (só gerência): liga e desliga os pedidos, taxa de entrega, tempos e chave Pix; setor, turno e pergunta de cada categoria; itens esgotados; impressoras e chave do programa de impressão. |

## Testes feitos (ambiente de testes)

- 20 casos de regra: horários (almoço, bar depois da meia-noite, domingo), itens por turno, preço falso ignorado, entrega sem taxa, quantidade inválida, troco menor que o total e fora do horário.
- Mensagem duplicada da Meta e duplo toque em "Confirmar": um só pedido.
- Mensagem sem assinatura ou com assinatura errada: recusada (HTTP 401).
- Conversa completa por texto livre: "quero 2 marmitex e uma coca" → detalhe da marmita → escolha da Coca → retirada → dinheiro com troco → confirmação → pedido #003 → "meu pedido".
- Atendimento humano: o robô fica em silêncio. Depois de "Devolver ao robô" no painel, volta a responder.
- Comandas: separadas por impressora (cozinha + caixa com preços; bar só com a bebida), reimpressão numerada e comanda de cancelamento.
- Programa de impressão: modo de teste (arquivo) e modo real com uma impressora inexistente. A falha foi registrada e a comanda voltou para a fila, sem gastar papel.
- Permissões: a cozinha não cancela; ninguém escreve direto no histórico; quem não está logado não vê pedidos.
- Painel: pedido novo apareceu sozinho e "Iniciar preparo" funcionou, sem erros no navegador.
- Tela "Configurar pedidos": entrega sem taxa é recusada; com taxa, o robô passa a oferecer "Entrega (R$ 7,00)". Item marcado como esgotado some do robô, e "coca lata" com a lata esgotada faz o robô **perguntar** em vez de trocar sozinho pela 600 ml. Impressora nova salva e desativada; chave gerada pela tela aceita pelo programa de impressão (chave errada recusada) e depois desligada; pergunta de categoria salva.

**Ainda não testado:** impressão em papel na Epson e envio real pelo WhatsApp, que depende do cadastro na Meta.

**Ainda não feito nesta etapa:** relatório de pedidos por período.

## O que falta configurar antes de ligar no sistema real

Tudo dos itens 1 a 3 e 5 é feito no painel, em **Configurar pedidos**.

1. **Decisões da gestão** (aba "Regras gerais"): ligar os pedidos, taxa e área de entrega (enquanto a taxa estiver vazia, só existe retirada), tempos de preparo, chave Pix, até que horas cada turno aceita pedidos e se o happy hour vale nos pedidos.
2. **Setor de cada categoria** (aba "Setores e horários") e das **impressoras** (aba "Impressoras"). No teste usei: cozinha + churrasqueira + caixa na EPSON TM-T20, e o bar na fila "BAR".
3. **Itens que precisam de pergunta** (sabor, ponto, número de pessoas) e itens que não podem ser pedidos pelo WhatsApp (o self-service, por exemplo).
4. **Meta / WhatsApp Cloud API:** cadastrar `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` e **`WHATSAPP_APP_SECRET`** (novo e obrigatório). Pode ser como variáveis das funções ou no Vault (`select vault.create_secret('<valor>', 'whatsapp_app_secret');`). Sem o App Secret, o robô recusa todas as mensagens, de propósito.
5. **Chave do programa de impressão:** aba "Impressoras" › "Gerar nova chave do programa". A chave aparece uma única vez (o banco guarda só o hash). Ela vai só no `agente.config.json` do PC (esse arquivo não vai para o GitHub).

## Como colocar no sistema real (quando aprovado)

1. Aplicar as duas migrações no banco real.
2. Publicar as funções `whatsapp-webhook`, `pedido-acao`, `whatsapp-enviar` e `impressao-agente`.
3. Publicar o painel (os arquivos de `gestao/`).
4. No PC do caixa: copiar a pasta `agente-impressao`, criar o `agente.config.json` a partir do exemplo e testar com `"modoTeste": true`. Depois mudar para `false` e imprimir **um** pedido de teste. Para iniciar junto com o Windows, coloque um atalho de `iniciar-agente.bat` em `shell:startup`.
5. Ligar `aceitando_pedidos` só depois de um pedido de teste completo, do WhatsApp até o papel.

## Plano B (se algo falhar no meio do serviço)

- **Robô com problema:** no painel, em Configurar pedidos › Regras gerais, toque no botão grande para pausar os pedidos. O robô passa a avisar que os pedidos estão pausados, e a equipe atende pelo WhatsApp normalmente.
- **Impressora parada:** as comandas ficam na fila e saem quando ela voltar. Enquanto isso, a tela "Pedidos" mostra todos os itens para preparar.
- **PC desligado:** o painel mostra "Agente de impressão sem sinal". A cozinha pode trabalhar pela tela "Pedidos" no celular ou tablet.
