## fnm environment issue
```shell
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
```

## PowerShell Environment Sync

```shell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
```