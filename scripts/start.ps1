$ErrorActionPreference = "Stop"

$ProjectDirectory = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectDirectory

python serve.py --open
