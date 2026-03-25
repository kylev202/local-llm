Set oShell = CreateObject("WScript.Shell")
sFolder = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
oShell.CurrentDirectory = sFolder
oShell.Run "cmd /c npm run start", 0, False
