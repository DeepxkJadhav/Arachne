[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ScriptArgs
)

& node "$PSScriptRoot\bin\arachne.mjs" @ScriptArgs
