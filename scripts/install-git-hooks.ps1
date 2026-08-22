# Install pre-push hook (Windows). Run from tabaghe-api folder:
#   powershell -ExecutionPolicy Bypass -File scripts/install-git-hooks.ps1

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

git rev-parse --git-dir 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Error "Not a git repository: $Root"
  exit 1
}

git config core.hooksPath .githooks
Write-Host "Git hooks installed (core.hooksPath=.githooks)"
Write-Host "Before each push: build must pass (same as deploy)."
Write-Host "Skip once: `$env:SKIP_PRE_PUSH=1; git push"
