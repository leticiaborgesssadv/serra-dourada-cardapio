# Simula mensagens da Meta (WhatsApp Cloud API) para o webhook do AMBIENTE DE TESTES.
# Assina cada mensagem com o App Secret de teste, como a Meta faria.
# Uso:
#   .\simular-whatsapp.ps1 -Telefone 5562900000001 -Mensagens 'oi', 'quero 2 marmitex e uma coca'
#   Para tocar um botão/linha: use "id:<id do botão>|<texto do botão>", ex.: 'id:car:fim|Finalizar pedido'
param(
    [string]$Url = 'https://vqnxkknzblcqxnwzuzxf.supabase.co/functions/v1/whatsapp-webhook',
    # App Secret do AMBIENTE DE TESTES (nunca o real). Fica fora do repositório: defina $env:SD_SEGREDO_TESTE.
    [string]$Segredo = $env:SD_SEGREDO_TESTE,
    [string]$Telefone = '5562900000001',
    [string]$Nome = 'Cliente Simulado',
    [string[]]$Mensagens = @('oi'),
    [switch]$SemAssinatura
)
$ErrorActionPreference = 'Stop'
if (-not $Segredo -and -not $SemAssinatura) { throw 'Defina o App Secret de teste: $env:SD_SEGREDO_TESTE = "..." (ou use -SemAssinatura para testar a recusa).' }

function Assinar([string]$corpo) {
    $hmac = New-Object System.Security.Cryptography.HMACSHA256
    $hmac.Key = [Text.Encoding]::UTF8.GetBytes($Segredo)
    $hash = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($corpo))
    'sha256=' + (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
}

foreach ($m in $Mensagens) {
    $wamid = 'wamid.SIMULADO.' + [guid]::NewGuid().ToString('N')
    if ($m.StartsWith('id:')) {
        $partes = $m.Substring(3).Split('|', 2)
        $tipoResposta = if ($partes[0] -match '^(g|i|mais|rem):') { 'list_reply' } else { 'button_reply' }
        $msg = @{ from = $Telefone; id = $wamid; timestamp = [string][DateTimeOffset]::UtcNow.ToUnixTimeSeconds(); type = 'interactive';
                  interactive = @{ type = $tipoResposta; $tipoResposta = @{ id = $partes[0]; title = $partes[1] } } }
    } else {
        $msg = @{ from = $Telefone; id = $wamid; timestamp = [string][DateTimeOffset]::UtcNow.ToUnixTimeSeconds(); type = 'text'; text = @{ body = $m } }
    }
    $payload = @{ object = 'whatsapp_business_account'; entry = @(@{ id = 'TESTE'; changes = @(@{ field = 'messages'; value = @{
        messaging_product = 'whatsapp'; metadata = @{ phone_number_id = 'TESTE' };
        contacts = @(@{ wa_id = $Telefone; profile = @{ name = $Nome } }); messages = @($msg) } }) }) }
    $corpo = $payload | ConvertTo-Json -Depth 12 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($corpo)
    $cab = @{}
    if (-not $SemAssinatura) { $cab['X-Hub-Signature-256'] = Assinar $corpo }
    try {
        $r = Invoke-WebRequest -Uri $Url -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8' -Headers $cab -UseBasicParsing
        "{0,-45} -> HTTP {1} {2}" -f $m, $r.StatusCode, $r.Content
    } catch {
        $codigo = $_.Exception.Response.StatusCode.value__
        "{0,-45} -> HTTP {1} (recusado)" -f $m, $codigo
    }
}
