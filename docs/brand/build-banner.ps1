# build-banner.ps1
#
# Embeds the three PMT25 card photos into x-banner.svg as base64 data URIs.
# x-banner.svg contains placeholder href values (__CARD_RAYQUAZA__ etc.) that
# this script replaces in-place.  Run after re-pulling the card source images
# in card-src/ to regenerate the self-contained banner.
#
# Card source images come from pokemontcg.io's public CDN
# (https://images.pokemontcg.io/<set_id>/<number>.png).  Pulled by:
#   curl -o card-src/rayquaza.png    https://images.pokemontcg.io/swsh7/218.png
#   curl -o card-src/giratina.png    https://images.pokemontcg.io/swsh11/186.png
#   curl -o card-src/charizard151.png https://images.pokemontcg.io/sv3pt5/199.png

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
# PowerShell's CWD and .NET's CWD are independent on Windows. Sync the .NET CWD
# so relative paths inside [IO.File] calls resolve against $PSScriptRoot too.
[System.IO.Directory]::SetCurrentDirectory($PSScriptRoot)

function Encode-DataUri([string]$relPath) {
  $fullPath = Join-Path $PSScriptRoot $relPath
  $bytes = [IO.File]::ReadAllBytes($fullPath)
  $b64 = [Convert]::ToBase64String($bytes)
  return "data:image/png;base64,$b64"
}

$rayquaza  = Encode-DataUri "card-src\rayquaza.png"
$giratina  = Encode-DataUri "card-src\giratina.png"
$charizard = Encode-DataUri "card-src\charizard151.png"

$svg = Get-Content (Join-Path $PSScriptRoot "x-banner.template.svg") -Raw

$svg = $svg.Replace("__CARD_RAYQUAZA__",  $rayquaza)
$svg = $svg.Replace("__CARD_GIRATINA__",  $giratina)
$svg = $svg.Replace("__CARD_CHARIZARD__", $charizard)

# UTF-8 without BOM so the SVG parses cleanly in browsers and X's rasteriser.
[IO.File]::WriteAllText((Join-Path $PSScriptRoot "x-banner.svg"), $svg, [System.Text.UTF8Encoding]::new($false))

$size = (Get-Item "x-banner.svg").Length
Write-Output "x-banner.svg rebuilt from template with embedded cards ($([math]::Round($size/1024,1)) KB)"
