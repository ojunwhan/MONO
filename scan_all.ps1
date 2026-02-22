# mro_c2c_audio_snap.ps1
# 사용법 예)
#   pwsh ./mro_c2c_audio_snap.ps1 -ProjectDir "C:\work\mro_c2c_audio" -Out ".\mro_c2c_audio_snapshot.json"
#   pwsh ./mro_c2c_audio_snap.ps1 -Out ".\mro_c2c_audio_snapshot.json"       # 현재 폴더 스캔

param(
  [string]$ProjectDir = ".",
  [string]$Out = ".\mro_c2c_audio_snapshot.json",
  [string[]]$ExcludeDirs = @("node_modules",".git","dist","build",".next",".cache",".parcel-cache","coverage","tmp",".vscode",".idea","out"),
  [string[]]$ExcludeExtensions = @(".png",".jpg",".jpeg",".gif",".webp",".ico",".zip",".7z",".mp3",".mp4",".wav",".webm",".ogg",".pdf",".exe",".dll",".bin",".wasm",".pdb",".map")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Resolve-PathClean([string]$p) {
  return (Resolve-Path -LiteralPath $p).Path
}

$root = Resolve-PathClean $ProjectDir
if (-not (Test-Path $root -PathType Container)) { throw "ProjectDir not found: $ProjectDir" }

# 디렉터리 제외 규칙 생성
$excludeDirRegex = ($ExcludeDirs | ForEach-Object { [regex]::Escape($_) }) -join "|"

# 파일 수집
$files = Get-ChildItem -LiteralPath $root -Recurse -File -Force |
  Where-Object {
    $rel = $_.FullName.Substring($root.Length).TrimStart('\','/')
    # 디렉터리 제외
    if ($rel -match "(^|[\\/])($excludeDirRegex)([\\/]|$)") { return $false }
    # 확장자 제외
    if ($ExcludeExtensions -contains $_.Extension.ToLowerInvariant()) { return $false }
    return $true
  }

# 유틸: SHA256
$sha256 = [System.Security.Cryptography.SHA256]::Create()

function Get-HashHex([byte[]]$bytes) {
  ($sha256.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join ""
}

# 파일 메타 + 내용 수집
$resultFiles = @()
foreach ($f in $files) {
  $relPath = ($f.FullName.Substring($root.Length)).TrimStart('\','/')
  $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
  $hash = Get-HashHex $bytes

  # 텍스트/바이너리 판별 시도
  $encoding = "utf8"
  $contentText = $null
  try {
    # UTF8로 시도. 실패 시 catch에서 base64 처리
    $contentText = [System.Text.Encoding]::UTF8.GetString($bytes)
    # 제어문자 과다 시 바이너리로 재분류
    $nonPrintable = ($contentText.ToCharArray() | Where-Object { [int]$_ -lt 9 -or ([int]$_ -ge 14 -and [int]$_ -le 31) }) | Measure-Object | Select-Object -ExpandProperty Count
    if ($nonPrintable -gt 0) { throw "non-printable" }
  }
  catch {
    $encoding = "base64"
    $contentText = [System.Convert]::ToBase64String($bytes)
  }

  $resultFiles += [PSCustomObject]@{
    path      = $relPath
    size      = $f.Length
    mtime     = $f.LastWriteTimeUtc.ToString("o")
    sha256    = $hash
    encoding  = $encoding
    content   = $contentText
  }
}

# 트리 요약 (가볍게)
$tree = $files |
  ForEach-Object {
    ($_.FullName.Substring($root.Length)).TrimStart('\','/')
  } |
  Sort-Object |
  ForEach-Object {
    $_
  }

$meta = [PSCustomObject]@{
  projectName = "mro_c2c_audio"
  root        = $root
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  machine     = $env:COMPUTERNAME
  os          = (Get-CimInstance Win32_OperatingSystem).Caption
  excludes    = [PSCustomObject]@{
    dirs  = $ExcludeDirs
    exts  = $ExcludeExtensions
  }
  counts      = [PSCustomObject]@{
    files = $files.Count
  }
}

$payload = [PSCustomObject]@{
  meta  = $meta
  tree  = $tree
  files = $resultFiles
}

# JSON 출력 (깊이 넉넉히)
$json = $payload | ConvertTo-Json -Depth 100
Set-Content -LiteralPath $Out -Value $json -Encoding UTF8

Write-Host "✅ Snapshot written: $Out"
