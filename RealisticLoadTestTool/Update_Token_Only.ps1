################################################################################################################################################################################
# [v0.8 DEAD CODE NOTICE]
# This script writes a token to PBIToken.JSON which the v0.8 HTML NO LONGER READS.
# Running it will succeed silently but the load test will not pick up the refreshed token.
#
# The v0.8 RealisticLoadTest.html uses MSAL.js exclusively for auth (see auth-config.json
# and _Documentation/MSAL-app-registration.md). The legacy PBIToken.json path was removed
# in backlog T5b on 2026-05-05.
#
# This file is kept in the repo only because Run_Load_Test_Only.ps1 + CefSharp/ChromeWriteBack
# still expect it on disk (the multi-window concurrency runner is broken in v0.8 — pending
# v1.0 Playwright replacement). Both this script and ChromeWriteBack/ are scheduled for
# DELETION in v1.0.
# ------------------------------------------------------------------------------------------------------------------------------------------------------
# Script to update the token file in all subfolders since tokens expire after 60 minutes
#------------------------------------------------------------------------------------------------------------------------------------------------------
#
# Expected Result:
# ----------------
# The first run in the current PowerShell session will prompt you to login to Power BI. Subsequent runs will not prompt.
# The script obtains a new token then updates the PBIToken.JSON file in each subfolder of the current working directory.
#
################################################################################################################################################################################
Write-Host "[v0.8 DEAD CODE] Update_Token_Only.ps1 writes a token the HTML no longer reads." -ForegroundColor Red
Write-Host "                The v0.8 RealisticLoadTest.html uses MSAL only — see auth-config.json." -ForegroundColor Red
Write-Host "                This script will be deleted in v1.0." -ForegroundColor Red
Write-Host "" -ForegroundColor Red

#Variables declaration
$destinationDir = ''
$workingDir = $pwd.Path

# Regular expressions to match and update JSON files
$token_regex = '(?<=PBIToken\":\").*?(?=\")'
$accessToken = $null;

#Function implementation to update token file
function UpdateTokenFile
{     
    $tokenJSONFile = Get-Content $(Join-Path $workingDir 'PBIToken.JSON') -raw -ErrorAction SilentlyContinue #gg edited this
    $new_TokenJSONFile = ($tokenJSONFile -replace $token_regex,$accessToken)
    $new_TokenJSONFile | set-content $(Join-Path $destinationDir 'PBIToken.JSON')
}


#verify if current working directory have master files. If not, prompt user for path of the files.
while($masterFilesExists)
{
    if(!(Test-Path -path $(Join-Path $workingDir $htmlFileName)) -and !(Test-Path -path $(Join-Path $workingDir 'PBIReport.JSON')) -and !(Test-Path -path $(Join-Path $workingDir 'PBIToken.JSON')))
    {
        Write-Host "The current working directory ($workingDir) doesn't have the master files required to proceed further." -ForegroundColor Yellow
        $workingDir = Read-Host -Prompt "Enter the directory path having master files"
    }
    else
    {     
     $masterFilesExists = $false   
    }
}


# Get required inputs from user
try
{
    $accessToken = Get-PowerBIAccessToken -AsString | % {$_.replace("Bearer ","").Trim()}
	if ($user.UserName -ne $null)
	{
	    Write-Host "Already signed in as $($user.UserName)"
	}
	else
	{
		Write-Host "Already signed in" #must have signed in with a different window
	}
}
catch
{
    Write-Host "Select Id to authenticate to Power BI" -ForegroundColor Yellow
    $user = Login-PowerBI
    $user
}

foreach ($destinationDir in Get-ChildItem -Path $workingDir -Directory)
{
    if (Test-Path -path $(Join-Path $destinationDir 'PBIToken.JSON'))
    {
        #Function call to update Token file
        UpdateTokenFile
    }
}
