param(
  [string]$RemoteUrl = "https://github.com/PMO-Assistant/Tender_Backend.git",
  [string]$Branch = "main"
)

$ErrorActionPreference = 'Stop'

Write-Host "=== Tender Backend: Clean history and push ===" -ForegroundColor Cyan

# Move to script directory (backend)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# 1) Blob IDs flagged by GitHub push protection (extend as needed)
$ids = @(
  '90a6f724ec9e6d6680b8202676673fae5d417dc1',  # GitHub SSH Private Key
  '05e02fdb8c6815e3640aadca787651bc9e3f4510',  # Azure AD App Secret
  '6d58a82e237c1511c285733f76fa90c4adddd2ef',  # Azure AD App Secret
  '98edc2fdc17d3092769cff3275d5fd6379c2df50',  # Azure AD App Secret
  'd203d9d4d999ca1456346b855c6f20b6a3e3d77e',  # Azure AD App Secret
  'f5cb305a9faff6c2e259851f464674096cbba99b'   # Azure Storage Account Key
)

($ids -join "`n") | Set-Content -Path bad_blobs.txt -NoNewline
Write-Host "Written bad_blobs.txt with $($ids.Count) IDs" -ForegroundColor Yellow

# 2) Ensure git-filter-repo is available via Python module
try {
  Write-Host "Installing/Upgrading git-filter-repo (user scope)..." -ForegroundColor Yellow
  python -m pip install --user --upgrade pip git-filter-repo | Out-Null
} catch {
  Write-Warning "Python pip install failed. Ensure Python is installed and in PATH."
  throw
}

# Add user Scripts path to PATH for this session (common pip user path)
$userScripts = Join-Path $env:APPDATA "Python\Python39\Scripts"
if (Test-Path $userScripts) { $env:Path = "$env:Path;$userScripts" }

# 3) Rewrite history to strip the flagged blobs
Write-Host "Rewriting history with git-filter-repo..." -ForegroundColor Yellow
python -m git_filter_repo --strip-blobs-with-ids bad_blobs.txt --force

# 4) Reindex with .gitignore and commit a marker
Write-Host "Reindexing repository with current .gitignore..." -ForegroundColor Yellow
git rm --cached -r .
git add .
try {
  git commit -m "Purge secrets from history and apply .gitignore" | Out-Null
} catch {
  Write-Host "Nothing to commit (working tree clean)." -ForegroundColor DarkGray
}

# 5) Optional: Map blob IDs to objects for verification
git rev-list --objects --all > all-objects.txt
Write-Host "Verifying that flagged blobs are gone..." -ForegroundColor Yellow
$found = @()
foreach ($id in $ids) {
  $match = Select-String -Path all-objects.txt -Pattern $id -ErrorAction SilentlyContinue
  if ($match) { $found += $id }
}
if ($found.Count -gt 0) {
  Write-Warning "Some blob IDs still present in history: $($found -join ', ')"
  Write-Warning "Add these IDs to bad_blobs.txt and re-run the script."
  exit 1
}

# 6) Push cleaned history
Write-Host "Pushing cleaned history to $RemoteUrl ($Branch) ..." -ForegroundColor Yellow
git remote set-url origin $RemoteUrl
git push -u origin $Branch --force

Write-Host "=== Done. Next: rotate any leaked credentials immediately. ===" -ForegroundColor Green

