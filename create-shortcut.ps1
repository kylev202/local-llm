$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "Local LLM.lnk"
$targetPath = Join-Path $appDir "Local LLM.vbs"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "wscript.exe"
$shortcut.Arguments = "`"$targetPath`""
$shortcut.WorkingDirectory = $appDir
$shortcut.Description = "Launch Local LLM"
$shortcut.Save()

Write-Host "Desktop shortcut created at: $shortcutPath"
