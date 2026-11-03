# Servidor local simples para testar o site e o painel no próprio PC (sem instalar nada).
# Uso: powershell -ExecutionPolicy Bypass -File ferramentas\servidor-local.ps1   -> http://localhost:5180/gestao/?ambiente=teste
param([int]$Porta = 5180, [string]$Raiz = (Split-Path $PSScriptRoot -Parent))
$tipos = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8';
            '.json' = 'application/json; charset=utf-8'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'; '.webmanifest' = 'application/manifest+json' }
$ouvinte = New-Object Net.HttpListener
$ouvinte.Prefixes.Add("http://localhost:$Porta/")
$ouvinte.Start()
Write-Host "Servindo $Raiz em http://localhost:$Porta/  (Ctrl+C para parar)"
while ($ouvinte.IsListening) {
    $ctx = $ouvinte.GetContext()
    try {
        $caminho = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
        $arquivo = Join-Path $Raiz $caminho
        if ((Test-Path $arquivo -PathType Container)) { $arquivo = Join-Path $arquivo 'index.html' }
        $completo = [IO.Path]::GetFullPath($arquivo)
        if (-not $completo.StartsWith([IO.Path]::GetFullPath($Raiz)) -or -not (Test-Path $completo -PathType Leaf)) {
            $ctx.Response.StatusCode = 404
        } else {
            $bytes = [IO.File]::ReadAllBytes($completo)
            $ext = [IO.Path]::GetExtension($completo).ToLower()
            $ctx.Response.ContentType = if ($tipos.ContainsKey($ext)) { $tipos[$ext] } else { 'application/octet-stream' }
            $ctx.Response.Headers.Add('Cache-Control', 'no-store')
            $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
    } catch { $ctx.Response.StatusCode = 500 }
    $ctx.Response.Close()
}
