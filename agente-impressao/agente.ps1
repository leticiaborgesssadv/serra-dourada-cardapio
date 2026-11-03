# Agente de impressão do Serra Dourada.
# Busca as comandas confirmadas na fila (Supabase) e imprime em cada impressora do Windows.
# Só faz conexões de SAÍDA (não precisa abrir porta no roteador). Se a impressora estiver
# desligada, a comanda volta para a fila e é tentada de novo.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File agente.ps1            (fica rodando)
#   powershell -ExecutionPolicy Bypass -File agente.ps1 -UmaVez    (uma passada, para teste)
param(
    [string]$Config = (Join-Path $PSScriptRoot 'agente.config.json'),
    [switch]$UmaVez
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

if (-not (Test-Path $Config)) { throw "Arquivo de configuração não encontrado: $Config (copie agente.config.exemplo.json)" }
$cfg = Get-Content -Raw -Encoding UTF8 $Config | ConvertFrom-Json
$intervalo = if ($cfg.intervaloSegundos) { [int]$cfg.intervaloSegundos } else { 3 }
$pastaLog = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force $pastaLog | Out-Null

function Log([string]$msg) {
    $linha = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $msg
    Write-Host $linha
    Add-Content -Path (Join-Path $pastaLog ('agente-{0:yyyy-MM-dd}.log' -f (Get-Date))) -Value $linha -Encoding UTF8
}

# ---------- envio RAW para a fila do Windows ----------
if (-not ('RawPrintSD' -as [type])) {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class RawPrintSD {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFO {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }
    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr handle);
    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern int StartDocPrinter(IntPtr handle, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO info);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr handle, byte[] data, int count, out int written);
    public static void Send(string printer, byte[] data, string doc) {
        IntPtr h;
        if (!OpenPrinter(printer, out h, IntPtr.Zero))
            throw new Exception("Impressora '" + printer + "' nao encontrada no Windows (erro " + Marshal.GetLastWin32Error() + ")");
        try {
            DOCINFO info = new DOCINFO();
            info.pDocName = doc;
            info.pDataType = "RAW";
            if (StartDocPrinter(h, 1, info) == 0) throw new Exception("Falha ao iniciar impressao (erro " + Marshal.GetLastWin32Error() + ")");
            try {
                StartPagePrinter(h);
                int written;
                if (!WritePrinter(h, data, data.Length, out written)) throw new Exception("Falha ao enviar dados (erro " + Marshal.GetLastWin32Error() + ")");
                EndPagePrinter(h);
            } finally { EndDocPrinter(h); }
        } finally { ClosePrinter(h); }
    }
}
"@
}

# ---------- texto -> bytes da impressora ----------
# Acentos do português na tabela PC850 (ESC t 2) das térmicas Epson. Dicionário sensível a maiúsculas.
$CP850 = New-Object 'System.Collections.Generic.Dictionary[char,byte]'
$pares = @{ 0xE1=0xA0; 0xE0=0x85; 0xE2=0x83; 0xE3=0xC6; 0xE9=0x82; 0xEA=0x88; 0xED=0xA1; 0xF3=0xA2; 0xF4=0x93; 0xF5=0xE4; 0xFA=0xA3; 0xFC=0x81; 0xE7=0x87;
            0xC1=0xB5; 0xC0=0xB7; 0xC2=0xB6; 0xC3=0xC7; 0xC9=0x90; 0xCA=0xD2; 0xCD=0xD6; 0xD3=0xE0; 0xD4=0xE2; 0xD5=0xE5; 0xDA=0xE9; 0xC7=0x80; 0xBA=0xA7; 0xAA=0xA6 }
foreach ($k in $pares.Keys) { $CP850[[char][int]$k] = [byte]$pares[$k] }

function SemAcento([string]$t) {
    $n = $t.Normalize([Text.NormalizationForm]::FormD)
    -join ($n.ToCharArray() | Where-Object { [Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne 'NonSpacingMark' })
}

function Codificar([string]$texto, [bool]$acentos) {
    $saida = New-Object System.Collections.Generic.List[byte]
    foreach ($ch in $texto.ToCharArray()) {
        $c = [int]$ch
        if ($c -ge 32 -and $c -lt 127) { $saida.Add([byte]$c); continue }
        if ($acentos -and $CP850.ContainsKey($ch)) { $saida.Add($CP850[$ch]); continue }
        if ($ch -eq [char]0x2014 -or $ch -eq [char]0x2013) { $saida.Add([byte]45); continue }   # travessão -> hífen
        foreach ($b in (SemAcento ([string]$ch)).ToCharArray()) { if ([int]$b -ge 32 -and [int]$b -lt 127) { $saida.Add([byte][int]$b) } }
    }
    return ,$saida.ToArray()
}

function Quebrar([string]$texto, [int]$largura) {
    $linhas = New-Object System.Collections.Generic.List[string]
    $atual = ''
    foreach ($p in ($texto -split '\s+' | Where-Object { $_ -ne '' })) {
        while ($p.Length -gt $largura) {
            if ($atual) { $linhas.Add($atual); $atual = '' }
            $linhas.Add($p.Substring(0, $largura)); $p = $p.Substring($largura)
        }
        if (-not $atual) { $atual = $p }
        elseif ($atual.Length + 1 + $p.Length -le $largura) { $atual += ' ' + $p }
        else { $linhas.Add($atual); $atual = $p }
    }
    if ($atual) { $linhas.Add($atual) }
    if ($linhas.Count -eq 0) { $linhas.Add('') }
    return ,$linhas.ToArray()
}

# Transforma as linhas estruturadas da comanda em: lista de {texto, b, g, c} já quebradas na largura certa.
function Diagramar($conteudo, [int]$cols) {
    $saida = New-Object System.Collections.Generic.List[object]
    foreach ($l in $conteudo) {
        if ($l.s) { $saida.Add(@{ t = ('-' * $cols); b = $false; g = $false; c = $false }); continue }
        $b = [bool]$l.b; $g = [bool]$l.g; $c = [bool]$l.c
        $larg = if ($g) { [int][math]::Floor($cols / 2) } else { $cols }
        if ($null -ne $l.l) {
            $dir = [string]$l.r
            $partes = Quebrar ([string]$l.l) ([math]::Max(8, $larg - $dir.Length - 1))
            for ($i = 0; $i -lt $partes.Count; $i++) {
                if ($i -lt $partes.Count - 1) { $saida.Add(@{ t = $partes[$i]; b = $b; g = $g; c = $false }) }
                else { $saida.Add(@{ t = ($partes[$i] + (' ' * [math]::Max(1, $larg - $partes[$i].Length - $dir.Length)) + $dir); b = $b; g = $g; c = $false }) }
            }
            continue
        }
        # mantém o recuo do início da linha (ex.: "   > detalhe do item")
        $recuo = ([regex]::Match([string]$l.t, '^\s*')).Value
        foreach ($t in (Quebrar ([string]$l.t) ($larg - $recuo.Length))) { $saida.Add(@{ t = ($recuo + $t); b = $b; g = $g; c = $c }) }
    }
    return ,$saida.ToArray()
}

function MontarBytes($job) {
    $imp = $job.impressora
    $cols = [int]$imp.colunas
    $acentos = [bool]$imp.acentos
    $linhas = Diagramar $job.conteudo $cols
    $bytes = New-Object System.Collections.Generic.List[byte]
    $previa = New-Object System.Text.StringBuilder
    if ($imp.modo -eq 'escpos') {
        $bytes.AddRange([byte[]](0x1B, 0x40))                         # reinicia
        if ($acentos) { $bytes.AddRange([byte[]](0x1B, 0x74, 2)) }    # tabela PC850
        foreach ($l in $linhas) {
            $bytes.AddRange([byte[]](0x1B, 0x61, [byte]([int]$l.c)))  # alinhamento
            $bytes.AddRange([byte[]](0x1B, 0x45, [byte]([int]$l.b)))  # negrito
            $bytes.AddRange([byte[]](0x1D, 0x21, $(if ($l.g) { 0x11 } else { 0x00 })))  # tamanho dobrado
            $bytes.AddRange((Codificar $l.t $acentos))
            $bytes.Add(0x0A)
            $larg = if ($l.g) { [int][math]::Floor($cols / 2) } else { $cols }
            $txt = if ($l.c) { (' ' * [math]::Max(0, [math]::Floor(($larg - $l.t.Length) / 2))) + $l.t } else { $l.t }
            [void]$previa.AppendLine($txt)
        }
        $bytes.AddRange([byte[]](0x1B, 0x61, 0, 0x1B, 0x45, 0, 0x1D, 0x21, 0))
        if ($imp.cortar_papel) { $bytes.AddRange([byte[]](0x1D, 0x56, 0x41, 0x04)) } else { $bytes.AddRange([byte[]](0x1B, 0x64, 6)) }
    } else {
        foreach ($l in $linhas) {
            $larg = if ($l.g) { [int][math]::Floor($cols / 2) } else { $cols }
            $txt = if ($l.c) { (' ' * [math]::Max(0, [math]::Floor(($larg - $l.t.Length) / 2))) + $l.t } else { $l.t }
            $bytes.AddRange((Codificar $txt $false)); $bytes.AddRange([byte[]](0x0D, 0x0A))
            [void]$previa.AppendLine($txt)
        }
        $bytes.AddRange([byte[]](0x0D, 0x0A, 0x0D, 0x0A, 0x0D, 0x0A, 0x0D, 0x0A, 0x0D, 0x0A, 0x0C))
    }
    return @{ bytes = $bytes.ToArray(); previa = $previa.ToString() }
}

# ---------- conversa com o servidor ----------
function Chamar($corpo) {
    $json = $corpo | ConvertTo-Json -Depth 5 -Compress
    $r = Invoke-WebRequest -Method Post -Uri $cfg.url -Headers @{ 'x-agente-token' = $cfg.token } -ContentType 'application/json; charset=utf-8' `
        -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 20 -UseBasicParsing
    # lê a resposta sempre como UTF-8 (o PowerShell 5.1 às vezes assume outra codificação e estraga os acentos)
    $leitor = New-Object IO.StreamReader($r.RawContentStream, [Text.Encoding]::UTF8)
    $r.RawContentStream.Position = 0
    return ($leitor.ReadToEnd() | ConvertFrom-Json)
}

function ProcessarFila {
    $resp = Chamar @{ acao = 'buscar'; limite = 5 }
    foreach ($job in $resp.jobs) {
        $rotulo = "{0} via {1} -> {2}" -f $job.tipo, $job.via, $job.impressora.nome_windows
        try {
            $m = MontarBytes $job
            $vias = [math]::Max(1, [int]$job.impressora.vias)
            for ($v = 1; $v -le $vias; $v++) {
                if ($cfg.modoTeste) {
                    $pasta = if ($cfg.pastaTeste) { $cfg.pastaTeste } else { Join-Path $PSScriptRoot 'saida-teste' }
                    New-Item -ItemType Directory -Force $pasta | Out-Null
                    $base = Join-Path $pasta ('{0:HHmmss}-{1}-{2}' -f (Get-Date), $job.tipo, ($job.impressora.nome -replace '[^\w]', '_'))
                    [IO.File]::WriteAllBytes("$base.bin", $m.bytes)
                    [IO.File]::WriteAllText("$base.txt", $m.previa, (New-Object Text.UTF8Encoding $true))
                } else {
                    [RawPrintSD]::Send([string]$job.impressora.nome_windows, $m.bytes, 'Serra Dourada - comanda')
                }
            }
            Chamar @{ acao = 'resultado'; job = $job.id; ok = $true } | Out-Null
            Log "IMPRESSO   $rotulo$(if ($cfg.modoTeste) { ' (modo teste: arquivo)' })"
        } catch {
            $erro = $_.Exception.Message
            Log "FALHOU     $rotulo :: $erro"
            try { Chamar @{ acao = 'resultado'; job = $job.id; ok = $false; erro = $erro } | Out-Null } catch { Log "Não consegui avisar a falha: $($_.Exception.Message)" }
        }
    }
    return @($resp.jobs).Count
}

Log "Agente iniciado. Servidor: $($cfg.url) | modo teste: $([bool]$cfg.modoTeste)"
do {
    try {
        [void](ProcessarFila)
    } catch {
        Log "Sem conexão com o servidor: $($_.Exception.Message) (tento de novo em $intervalo s)"
    }
    if ($UmaVez) { break }
    Start-Sleep -Seconds $intervalo
} while ($true)
