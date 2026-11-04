# Decisões do alinhamento (03/11/2026)

Respostas da gestão às perguntas da revisão. Servem de base para configurar o robô e o painel.

## Cardápio e preços
- **Fonte oficial dos preços:** Colibri (PDV). Objetivo: importar os preços do Colibri automaticamente. Falta verificar se o Colibri oferece exportação ou integração oficial. Até lá, vale o cadastro do painel.
- **Fora do pedido pelo WhatsApp:** chopps e drinques (só no salão).
- **"A 4ª é do Serra":** toda segunda-feira; quem toma 3 Spaten ganha a 4ª. Só no salão (o robô divulga, não aplica em pedido).
- **Happy hour:** só no salão (o robô divulga, pedidos usam preço normal).

## Horários
- Último pedido de almoço: **13h45**.
- Domingo: **fechado**.

## Pedidos
- **Entrega:** sim, **sem taxa**, só nas proximidades. A equipe confere o endereço antes de liberar. Distâncias maiores: só pelo iFood (https://www.ifood.com.br/delivery/goiania-go/serra-dourada-bar-e-restaurante-jardim-goias/e950ab6f-540d-49d0-ad9c-038526d864a3).
- **Previsão de entrega:** 30 a 45 minutos.
- **Retirada:** fica pronto em 15 a 20 minutos.
- **Pix:** chave telefone (62) 98473-9158, em nome de MERCEARIA SERRA DOURADA.
- **Impressoras:** três setores: cozinha, bar e churrasqueira (modelos e conexão definidos na instalação).

## Reservas
- **Lugares por turno:** sem limite; a equipe confirma cada reserva.
- **Grupo grande:** a partir de 15 pessoas (vai para a gerência). Sem sinal antecipado.
- **Antecedência mínima:** nenhuma.

## Equipe e atendimento
- **Logins:** só a gestora por enquanto.
- **"Falar com uma pessoa":** responde quem estiver com o celular na cozinha, ou a gestora pelo WhatsApp Web. O robô fica em silêncio até a equipe devolver; se ninguém devolver, volta sozinho em **1 hora**.
- **Apresentação:** "assistente virtual da casa" (sem nome próprio).
- **Link de avaliação Google:** https://g.page/r/CZaydLnugycBEBM/review

## Meta / WhatsApp
- O 62 98239-0476 está no **WhatsApp Business** → caminho: **coexistência** (app e robô juntos no mesmo número). Consequências no robô: pausar sozinho quando a equipe responder pelo celular, e uma palavra combinada para devolver ao robô.
- **Nome de exibição:** Serra Dourada Bar e Restaurante.
- **Documentos para verificação:** com a gestora.
- **Acesso permanente (usuário do sistema):** fazer junto, no dia da coexistência.
- **Modelo de aviso à gerência (aprovado):** "Novo atendimento {{1}} · {{2}} · prioridade {{3}}. Veja os detalhes no painel."
- **Modelo de confirmação de reserva (aprovado):** "Oi, {{1}}! 😊 Que alegria: sua reserva no Serra Dourada está confirmada! Vamos te esperar no dia {{2}}, às {{3}}, com tudo pronto para {{4}} pessoa(s). Se for comemorar algo especial, conta pra gente que a equipe capricha. Seu protocolo é {{5}}. Qualquer mudança, é só responder aqui. Até lá!"

## O que já foi aplicado no ambiente de testes (04/11)
- **Pedidos:** entrega sem taxa (botão "Entrega grátis"), aviso de que a equipe confere o endereço e de que os endereços mais distantes são atendidos pelo iFood; entrega em 30 a 45 min, retirada em 15 a 20 min; chave Pix com o nome do titular; almoço até 13h45; Chopp e Drinks fora dos pedidos. O painel ganhou os campos "Titular da conta Pix" e "Link da loja no iFood" (migração `20261104140000_etapa2_decisoes.sql`).
- **Reservas:** sem limite de lugares, sem antecedência mínima. Grupo grande a partir de 15 pessoas: no painel, o campo agora se chama "acima de quantas pessoas" e está em 14, porque o banco considera "acima de".
- **Atendimento humano:** depois de "atendente", o robô fica 1 hora em silêncio. Com a coexistência, cada resposta da equipe pelo celular renova esse silêncio por 1 hora e aparece no histórico do painel. Se a mensagem da equipe tiver **#robo**, a conversa volta ao robô na hora. Para isso funcionar, o webhook da Meta precisa assinar o campo `smb_message_echoes`.
- **Promoções:** o happy hour e a "A 4ª é do Serra" (segunda, Spaten) aparecem com o aviso "válidas só para consumo no salão". Palavras como "spaten" e "promoção" levam a essa resposta.
- **Avaliação:** o link do Google foi corrigido para o informado.
- **Cardápio do dia:** no WhatsApp do restaurante (98239-0476, app no celular), mande o cardápio começando com **#cardapio** para qualquer conversa, por exemplo a da gestão. O robô guarda como cardápio de hoje e mostra quando o cliente pergunta do almoço ou do cardápio, pergunta por um prato ("tem feijoada hoje?") ou escolhe um item do almoço no pedido. Com **#cardapio+**, acrescenta ao que já foi salvo (carnes numa mensagem e acompanhamentos em outra). A tela Pedidos do painel mostra se o cardápio de hoje chegou. O robô não lê grupos, então o post do grupo sozinho não basta. Migração: `20261104150000_cardapio_do_dia.sql`.
- **Revisão de 04/11:** o robô agora ignora o histórico antigo que a Meta reenvia depois da coexistência (campo `history`), além de mensagens editadas ou apagadas. Reserva para um horário que já passou recebe "Esse horário já passou." e não mais "pelo menos 0 h de antecedência" (migração `20261104160000_reserva_horario_passado.sql`). "O que tem de happy hour hoje" vai para o happy hour. Pedido de chopp ou drinque recebe "só no salão". O aviso de boas-vindas traz o link da política de privacidade, que agora cobre o WhatsApp e tem a seção de exclusão de dados (publicada no site).
- **Não testado:** a conversa completa pelo WhatsApp, porque o teste exige a assinatura da Meta. As regras foram conferidas direto no banco.

## Sistema
- **Supabase:** plano gratuito com aviso de carência encerrada. A gestora vai mandar print de Organização › Usage para entender o limite ultrapassado.
- **Sistema real:** autorizado preparar e aceitar os PRs #12 e #13 (03/11). O robô do sistema real só é trocado depois que o App Secret estiver cadastrado lá.
