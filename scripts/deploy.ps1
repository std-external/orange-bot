<#
.SYNOPSIS
  橘波特（orange-bot）自部署脚本 —— Windows 版，只接 QQ 官方 bot（koishi）这一条线。

.DESCRIPTION
  做四件事：装 dsh、克隆/更新 orange-bot 并构建插件、把插件挂进 profile、
  把必填配置问出来写进 $DSH_HOME\.env（不进 git）。
  不 sudo、不装系统包、不改你已有的配置、不打印任何密钥。

  执行策略拦住了就先开一个窗口跑：
    Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
  然后：
    .\deploy.ps1 --go

.PARAMETER Go
  交互模式，一步步问你（密钥输入不回显）。
.PARAMETER Yes
  无人值守；必须同时给全 --llm-base-url / --llm-key / --satori-token 等参数。
#>
[CmdletBinding()]
param(
  [switch]$Go,
  [switch]$Yes,
  [string]$Dir = (Join-Path $HOME 'orange-bot'),
  [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }),
  [string]$LlmBaseUrl = '',
  [string]$LlmKey = '',
  [string]$SatoriToken = '',
  [string]$AppId = '',
  [string]$AppSecret = '',
  [string]$BotToken = '',
  [switch]$SkipKoishi,
  [switch]$Help
)

$ErrorActionPreference = 'Stop'
$RepoUrl = if ($env:ORANGE_REPO_URL) { $env:ORANGE_REPO_URL } else { 'https://github.com/std-microblock/orange-bot' }
$PluginName = 'dsh-plugin-orange'
$Profile = 'web'

function Say([string]$msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Warn([string]$msg) { Write-Host "! $msg" -ForegroundColor Yellow }
function Die([string]$msg) { Write-Host "error: $msg" -ForegroundColor Red; exit 1 }

function Show-Usage {
  @'
橘波特自部署脚本（Windows，只接 QQ 官方 bot）

  .\deploy.ps1              打印本用法，什么都不做
  .\deploy.ps1 -Go          交互式一步步来（推荐第一次用）
  .\deploy.ps1 -Yes ...     无人值守，缺的必填项用参数给，缺一个就报 MISSING_CREDENTIAL

参数
  -Go                    交互模式：每步会问你，密钥输入不回显
  -Yes                   无人值守；必须同时给下面的必填参数
  -Dir <路径>            orange-bot 检出目录（默认 ~\orange-bot）
  -DshHome <路径>        dsh 的家目录（默认 $env:DSH_HOME 或 ~\.dsh）
  -LlmBaseUrl <url>      OpenAI 兼容端点，例如 https://api.deepseek.com/v1
  -LlmKey <key>          该端点的 key
  -SatoriToken <串>      koishi 侧 Satori 服务的 token（自己编，两边一致）
  -AppId <id>            q.qq.com 机器人 AppID
  -AppSecret <secret>    机器人 AppSecret
  -BotToken <token>      机器人 Token
  -SkipKoishi            不问 AppID/Secret/Token

做完的下一步（脚本最后也会再打一遍）：
  1. 去 q.qq.com 建机器人拿 AppID / AppSecret / Token
  2. 把脚本生成的 koishi 插件片段贴进 koishi 的配置并启动 koishi
  3. 群主/管理员把机器人拉进群
  4. 群里 @它 说一句，面板「响应记录」里看它为什么醒
'@
}

if ($Help -or (-not $Go -and -not $Yes)) { Show-Usage; exit 0 }

function Read-Plain([string]$prompt, [string]$default) {
  if ($default) { $v = Read-Host "$prompt [$default]" } else { $v = Read-Host $prompt }
  if ([string]::IsNullOrEmpty($v)) { return $default }
  return $v
}

function Read-Secret([string]$prompt, [string]$default) {
  if ($Yes) { return $default }
  $secure = Read-Host $prompt -AsSecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  if ([string]::IsNullOrEmpty($plain)) { return $default }
  return $plain
}

function Need([string]$label, [string]$value) {
  if ([string]::IsNullOrEmpty($value)) {
    Die "MISSING_CREDENTIAL: 缺 $label（-Yes 模式必须用参数给全，或者先跑 -Go 交互一遍）"
  }
  return $value
}

function Write-Utf8NoBom([string]$path, [string]$text) {
  $dir = Split-Path -Parent $path
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $utf8)
}

# ---------- 1. Node ----------
Say '检查 Node（要 ^22.19 或 >=24）'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Die '没找到 node。装 Node 24 LTS（https://nodejs.org/ 的 Windows 安装包），装完重开一个 PowerShell 再跑本脚本。'
}
$nodeVersion = (& node -v).TrimStart('v')
$ok = & node -p 'const [a,b]=process.versions.node.split(".").map(Number); (a===22&&b>=19)||a>=24 ? "1":"0"'
if ($ok -ne '1') { Die "Node v$nodeVersion 太老：要 ^22.19 或 >=24（插件用 node:sqlite）" }
Say "Node v$nodeVersion OK"

# ---------- 2. dsh ----------
if (-not (Get-Command dsh -ErrorAction SilentlyContinue)) {
  Say '安装 @deepseek-ai/dsh'
  & npm install -g '@deepseek-ai/dsh'
  if ($LASTEXITCODE -ne 0) { Die '全局安装失败；检查 npm 前缀权限（npm config get prefix）' }
  $env:Path = "$env:Path;$env:APPDATA\npm"
}
if (-not (Get-Command dsh -ErrorAction SilentlyContinue)) {
  Die '装完还是找不到 dsh：把 %APPDATA%\npm 加进 PATH 后重开一个窗口'
}
Say 'dsh 已就绪'

# ---------- 3. clone / 更新 ----------
if (Test-Path (Join-Path $Dir '.git')) {
  Say "更新 $Dir"
  & git -C $Dir fetch --depth 1 origin main
  & git -C $Dir merge --ff-only FETCH_HEAD | Out-Null
} else {
  Say "克隆 orange-bot 到 $Dir"
  & git clone --depth 1 $RepoUrl $Dir
  if ($LASTEXITCODE -ne 0) { Die 'git clone 失败；先装 Git for Windows 并确认 git 在 PATH 里' }
}
$PluginDir = Join-Path (Join-Path $Dir 'packages') $PluginName
if (-not (Test-Path (Join-Path $PluginDir 'package.json'))) { Die "没找到 $PluginDir\package.json，仓库结构变了？" }

# ---------- 4. 装依赖并构建 ----------
Say '安装插件依赖并构建（npm install 会顺手跑一次 build）'
Push-Location $PluginDir
try {
  & npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Die 'npm install 失败，看上面的报错' }
} finally { Pop-Location }
if (-not (Test-Path (Join-Path $PluginDir 'lib/index.js'))) { Die '构建没产出 lib\index.js' }

# ---------- 5. 挂进 profile ----------
Say "准备 dsh profile：$DshHome\profiles\$Profile"
$env:DSH_HOME = $DshHome
& dsh --profile $Profile --dump-config | Out-Null
$ProfileDir = Join-Path (Join-Path $DshHome 'profiles') $Profile
$ProfilePkg = Join-Path $ProfileDir 'package.json'
if (-not (Test-Path $ProfilePkg)) { Die "profile 没生成：$ProfilePkg 不存在" }

$pkg = Get-Content -Raw $ProfilePkg | ConvertFrom-Json
if (-not $pkg.dependencies) { $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) -Force }
$link = 'link:' + ($PluginDir -replace '\\', '/')
$pkg.dependencies | Add-Member -NotePropertyName $PluginName -NotePropertyValue $link -Force
if (-not $pkg.dsh) { $pkg | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{}) -Force }
if (-not $pkg.dsh.profile) { $pkg.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{}) -Force }
$bundles = @()
if ($pkg.dsh.profile.bundles) { $bundles = @($pkg.dsh.profile.bundles) }
if ($bundles -notcontains $PluginName) { $bundles += $PluginName }
$pkg.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue $bundles -Force
if (-not $pkg.dsh.profile.patchReload) {
  $pkg.dsh.profile | Add-Member -NotePropertyName patchReload -NotePropertyValue 'live' -Force
}
Write-Utf8NoBom $ProfilePkg ($pkg | ConvertTo-Json -Depth 20)
Say "profile 已挂上 $PluginName"

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Say '没有 pnpm，试 corepack 开一下'
  & corepack enable 2>$null
  if ($LASTEXITCODE -ne 0 -or -not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    & npm install -g pnpm
  }
}
Push-Location $ProfileDir
try { & pnpm install --silent } finally { Pop-Location }

# ---------- 6. 必填配置 ----------
$PatchFile = Join-Path $PluginDir 'cordis.patch.yml'
if (-not (Test-Path $PatchFile)) { Die "没找到 $PatchFile" }
$EnvFile = Join-Path $DshHome '.env'

# 变量名不写死：从插件自带的配置层里读，插件改名脚本也跟着走。
$matches = [regex]::Matches((Get-Content -Raw $PatchFile), 'process\.env\.([A-Z][A-Z0-9]*_[A-Z0-9_]*)')
$envNames = @()
foreach ($m in $matches) { if ($envNames -notcontains $m.Groups[1].Value) { $envNames += $m.Groups[1].Value } }
if ($envNames.Count -eq 0) { Die '配置层里没读到任何变量名' }

$existing = @{}
if (Test-Path $EnvFile) {
  foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^\s*([A-Z][A-Z0-9_]*)\s*=') { $existing[$Matches[1]] = $line }
  }
}

$lines = New-Object System.Collections.Generic.List[string]
if (-not (Test-Path $EnvFile) -or (Get-Item $EnvFile).Length -eq 0) {
  $lines.Add('# 橘波特自部署配置（deploy.ps1 生成；dsh 启动时会自动加载本文件）')
}
Say "收集必填配置（写进 $EnvFile，不进 git）"
foreach ($name in $envNames) {
  if ($name -match '_(DATA|WORKSPACE)$') { continue }
  if ($existing.ContainsKey($name)) { Say "已有 $name，保留不动"; $lines.Add($existing[$name]); continue }

  $value = ''
  if ($name -like '*CROSSGRAM*ENDPOINT') {
    $value = 'http://127.0.0.1:9/satori'          # 只接官方 bot：这条路不接
  } elseif ($name -like '*CROSSGRAM*') {
    $value = 'placeholder'
  } elseif ($name -like '*BASE_URL') {
    $default = if ($LlmBaseUrl) { $LlmBaseUrl } else { 'https://api.deepseek.com/v1' }
    $value = if ($Yes) { $default } else { Read-Plain $name $default }
  } elseif ($name -like '*ENDPOINT') {
    if ($name -like '*KOISHI*') { $value = Read-Plain $name 'http://127.0.0.1:5140/satori' }
    else { $value = 'http://127.0.0.1:9/satori' }
  } elseif ($name -match '_(TOKEN|KEY)$') {
    if ($name -like '*KOISHI*') {
      $default = $SatoriToken
      $value = if ($Yes) { $default } else { Read-Secret $name $default }
      $value = Need $name $value
    } else { $value = 'placeholder' }
  } else {
    $value = if ($Yes) { '' } else { Read-Plain $name '' }
  }
  $lines.Add("$name=$value")
  Say "写入 $name"
}
Write-Utf8NoBom $EnvFile (($lines -join "`n") + "`n")

# ---------- 7. koishi 侧 ----------
$Fragment = Join-Path $DshHome 'koishi-plugins.yml'
if ($SkipKoishi) {
  Warn '跳过 AppID/Secret/Token；之后自己照 scripts/README.md 填 koishi.yml'
} else {
  $id = if ($Yes) { $AppId } else { Read-Plain 'QQ_APP_ID' $AppId }
  $sec = if ($Yes) { $AppSecret } else { Read-Secret 'QQ_APP_SECRET' $AppSecret }
  $tok = if ($Yes) { $BotToken } else { Read-Secret 'QQ_BOT_TOKEN' $BotToken }
  $id = Need 'QQ_APP_ID' $id
  $sec = Need 'QQ_APP_SECRET' $sec
  $tok = Need 'QQ_BOT_TOKEN' $tok
  $satori = ''
  foreach ($name in $envNames) {
    if ($name -like '*KOISHI*' -and $name -match '_(TOKEN|KEY)$') {
      $hit = $lines | Where-Object { $_ -like "$name=*" } | Select-Object -First 1
      if ($hit) { $satori = $hit.Substring($hit.IndexOf('=') + 1) }
    }
  }
  $fragmentText = @"
# 把下面这段并进 koishi 的配置（koishi.yml 的 plugins: 下），端口要和 profile 里的
# koishi endpoint 对上；orange-bridge 的 token 必须和 $EnvFile 里那个一致。
port: 5140
plugins:
  adapter-qq:
    id: $id
    secret: $sec
    token: $tok
    type: private
    protocol: websocket
    sandbox: true
  server-satori:
    path: /satori
    token: $satori
  orange-bridge:
    path: /satori/orange
    token: $satori
"@
  Write-Utf8NoBom $Fragment $fragmentText
  Say "koishi 插件片段写到 $Fragment（含密钥）"
}

# ---------- 8. 收尾 ----------
Write-Host @"

==> 装好了。剩下的按顺序：

  1. 去 q.qq.com 建机器人 → 应用管理 → 机器人，拿 AppID / AppSecret / Token
     （要改值就删掉 $EnvFile 里对应那行再跑一次本脚本）
  2. koishi：把 $Fragment 的内容并进 koishi 配置，然后启动 koishi
  3. 群主或群管理员把机器人拉进测试群（沙箱阶段只在自己群能测）
  4. 起 dsh：  dsh web
     日志里会打印带 token 的面板地址，侧栏出现「🍊 Orange Bot」
  5. 面板里把 admins 填成 qq:<你的 openid>，把测试群加白名单，先开 dry run
  6. 群里 @它 说一句，去面板「响应记录」看它这次为什么醒

  这台机器不需要公网 IP：koishi 往 q.qq.com 连，dsh 往 koishi 连，都是出站。
"@
