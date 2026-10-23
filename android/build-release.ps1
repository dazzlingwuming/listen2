$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$signingDirectory = Join-Path $env:LOCALAPPDATA 'Listen2\signing'
$keyStorePath = Join-Path $signingDirectory 'listen2-release.p12'
$passwordPath = Join-Path $signingDirectory 'password.dpapi'
$keyTool = Join-Path $env:JAVA_HOME 'bin\keytool.exe'

# This Windows helper keeps the stable release identity outside every checkout.
# The password is encrypted with the current Windows user's DPAPI key.
if (-not (Test-Path -LiteralPath $keyStorePath)) {
    if (Test-Path -LiteralPath $passwordPath) { throw 'Signing password exists without its keystore; restore the keystore backup.' }
    New-Item -ItemType Directory -Force -Path $signingDirectory | Out-Null
    $signingUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $signingDirectory /inheritance:r /grant:r "${signingUser}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot protect signing directory.' }
    $randomBytes = New-Object byte[] 32
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $random.GetBytes($randomBytes)
    $random.Dispose()
    $env:LISTEN2_KEYSTORE_PASSWORD = [Convert]::ToBase64String($randomBytes)
    & $keyTool -genkeypair -keystore $keyStorePath -storetype PKCS12 -alias listen2-android -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Listen2 Android, O=Listen2, C=CN' -storepass:env LISTEN2_KEYSTORE_PASSWORD -keypass:env LISTEN2_KEYSTORE_PASSWORD
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create the release keystore.' }
    ConvertTo-SecureString $env:LISTEN2_KEYSTORE_PASSWORD -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $passwordPath
}

try {
    $protectedPassword = (Get-Content -LiteralPath $passwordPath -Raw).Trim() | ConvertTo-SecureString
    $credential = New-Object System.Management.Automation.PSCredential('listen2', $protectedPassword)
    $env:LISTEN2_KEYSTORE = $keyStorePath
    $env:LISTEN2_KEYSTORE_PASSWORD = $credential.GetNetworkCredential().Password
    $env:LISTEN2_KEY_ALIAS = 'listen2-android'
    & (Join-Path $PSScriptRoot 'gradlew.bat') --no-daemon --console=plain -p $PSScriptRoot :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease
    if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
    Write-Output 'Signed APK: android/app/build/outputs/apk/release/app-release.apk'
    Write-Output "Signing backup directory: $signingDirectory (private; do not publish)"
}
finally {
    Remove-Item Env:LISTEN2_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:LISTEN2_KEYSTORE -ErrorAction SilentlyContinue
    Remove-Item Env:LISTEN2_KEY_ALIAS -ErrorAction SilentlyContinue
}
