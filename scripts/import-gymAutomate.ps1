# GymAutomate → Level Up Fitness Club member import
# Reads members.xlsx, generates SQL migration for Supabase members table
# Run: powershell -ExecutionPolicy Bypass -File scripts/import-gymAutomate.ps1

param(
    [string]$ExcelPath = "C:\Users\faisa\Downloads\members.xlsx",
    [string]$OutputSql = "supabase\migrations\20260628100000_import_gymAutomate_members.sql"
)

# ─── Helpers ─────────────────────────────────────────────────────────────────

function Format-Phone($raw) {
    $digits = ($raw -replace '\D', '')
    if ($digits.Length -gt 11) { $digits = $digits.Substring(0, 11) }
    if ($digits.Length -le 4) { return $digits }
    return "$($digits.Substring(0,4))-$($digits.Substring(4))"
}

function Parse-PkDate($dateStr) {
    if (-not $dateStr -or $dateStr.Trim() -eq '') { return $null }
    try {
        return [DateTime]::Parse($dateStr).ToString("yyyy-MM-dd")
    } catch {
        return $null
    }
}

function Escape-Sql($val) {
    if ($val -eq $null) { return "NULL" }
    $s = "$val".Replace("'", "''")
    return "'$s'"
}

function Pad-No($no) {
    try { return ([int]($no -replace '[^0-9]', '')).ToString("D4") }
    catch { return "0000" }
}

function Gender-Guess($name) {
    $femaleNames = @("Areeba", "Fatima")
    foreach ($fn in $femaleNames) {
        if ($name -match $fn) { return "Female" }
    }
    return "Male"
}

# ─── Parse Excel ──────────────────────────────────────────────────────────────

Write-Host "Opening Excel file: $ExcelPath"
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $excel.Workbooks.Open($ExcelPath)
$ws = $wb.Sheets.Item(1)
$lastRow = $ws.UsedRange.Rows.Count
Write-Host "Total rows in sheet: $lastRow"

$members = @()
$currentMember = $null

for ($r = 2; $r -le $lastRow; $r++) {
    $c2 = "$($ws.Cells.Item($r, 2).Value2)".Trim()
    $c3 = "$($ws.Cells.Item($r, 3).Value2)".Trim()
    $c5 = "$($ws.Cells.Item($r, 5).Value2)".Trim()

    if ($c2 -match "^Serial Number\s*:\s*(.+)") {
        if ($currentMember -ne $null) { $members += [PSCustomObject]$currentMember }
        $currentMember = @{
            serial_no    = $Matches[1].Trim()
            status       = $c5
            gender       = ""
            full_name    = ""
            membership_no = ""
            join_date    = ""
            expiry_date  = ""
            age          = ""
            phone        = ""
            marital_status = ""
            weight       = ""
            height       = ""
            blood_group  = ""
            cnic         = ""
            disease      = ""
            other_desc   = ""
        }
        if ($c3 -match "^Full Name\s*:\s*(.+)") { $currentMember.full_name = $Matches[1].Trim() }
    } elseif ($currentMember -ne $null) {
        if ($c2 -match "^Membership Number\s*:\s*(.+)") { $currentMember.membership_no = $Matches[1].Trim() }
        if ($c2 -match "^Join Date\s*:\s*(.+)")         { $currentMember.join_date     = $Matches[1].Trim() }
        if ($c2 -match "^Expiry Date\s*:\s*(.+)")       { $currentMember.expiry_date   = $Matches[1].Trim() }
        if ($c3 -match "^Age\s*:\s*(.+)")               { $currentMember.age           = $Matches[1].Trim() }
        if ($c3 -match "^Phone Number\s*:\s*(.+)")      { $currentMember.phone         = $Matches[1].Trim() }
        if ($c3 -match "^Gender\s*:\s*(.+)") {
            $g = $Matches[1].Trim()
            if ($g -ne "" -and $currentMember.gender -eq "") { $currentMember.gender = $g }
        }
        if ($c3 -match "^Marital Status\s*:\s*(.+)")    { $currentMember.marital_status = $Matches[1].Trim() }
        if ($c3 -match "^Weight\s*:\s*(.+)")            { $currentMember.weight        = $Matches[1].Trim() }
        if ($c3 -match "^Height\s*:\s*(.+)")            { $currentMember.height        = $Matches[1].Trim() }
        if ($c3 -match "^Blood Group\s*:\s*(.+)")       { $currentMember.blood_group   = $Matches[1].Trim() }
        if ($c3 -match "^CNIC\s*:\s*(.+)")              { $currentMember.cnic          = $Matches[1].Trim() }
        if ($c3 -match "^Disease\s*:\s*(.+)")           { $currentMember.disease       = $Matches[1].Trim() }
        if ($c3 -match "^Other Description\s*:\s*(.+)") { $currentMember.other_desc   = $Matches[1].Trim() }
    }
}
if ($currentMember -ne $null) { $members += [PSCustomObject]$currentMember }

$wb.Close($false)
$excel.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null

Write-Host "Parsed $($members.Count) members from Excel"

# ─── Transform & Build SQL rows ───────────────────────────────────────────────

$rows = @()
$stats = @{ active = 0; inactive = 0; female = 0; male = 0; noGender = 0 }

foreach ($m in $members) {
    # Gender: assign default for blanks
    $gender = $m.gender
    if (-not $gender -or $gender -eq "") {
        $gender = Gender-Guess($m.full_name)
        $stats.noGender++
        Write-Host "  [GENDER GUESS] $($m.full_name) → $gender"
    }

    # Membership number: prefix + year + old number padded to 4 digits
    $prefix = if ($gender -eq "Female") { "LUF" } else { "LUM" }
    $paddedNo = Pad-No($m.membership_no)
    $joinYear = "2026"
    if ($m.join_date -match "(\d{4})$") { $joinYear = $Matches[1] }
    $newMembershipNo = "$prefix-$joinYear-$paddedNo"

    # Status
    $status = if ($m.status -eq "Active") { "active" } else { "inactive" }
    if ($status -eq "active") { $stats.active++ } else { $stats.inactive++ }
    if ($gender -eq "Female") { $stats.female++ } else { $stats.male++ }

    # Phone
    $phone = Format-Phone($m.phone)

    # CNIC: null if placeholder or invalid (valid CNIC has exactly 13 digits)
    $cnic = $m.cnic
    $cnicDigits = ($cnic -replace '\D', '')
    if ($cnic -eq "" -or $cnicDigits.Length -ne 13 -or $cnicDigits -match '^0+$') { $cnic = $null }

    # Blood group: clear "Unknown"
    $blood = $m.blood_group
    if ($blood -eq "Unknown" -or $blood -eq "") { $blood = $null }

    # Medical notes
    $medNotes = $null
    if ($m.disease -and $m.disease -ne "None" -and $m.disease -ne "") {
        $medNotes = "Disease: $($m.disease)"
        if ($m.other_desc -and $m.other_desc -ne "") {
            $medNotes += ". Details: $($m.other_desc)"
        }
    }

    # Dates
    $joinDate   = Parse-PkDate($m.join_date)
    $expiryDate = Parse-PkDate($m.expiry_date)

    # Age
    $age = $null
    if ($m.age -match '^\d+$') { $age = [int]$m.age }

    # Comment (store old GymAutomate number)
    $comment = "GymAutomate No: $($m.membership_no)"

    # Weight / Height (plain text, as-is)
    $weight = if ($m.weight -and $m.weight -ne "") { $m.weight } else { $null }
    $height = if ($m.height -and $m.height -ne "") { $m.height } else { $null }

    # Marital status
    $marital = if ($m.marital_status -and $m.marital_status -ne "") { $m.marital_status } else { $null }

    # Build VALUES row
    $row = "  ($(Escape-Sql $newMembershipNo), $(Escape-Sql $m.serial_no), $(Escape-Sql $m.full_name),"
    $row += " $(if($age -ne $null){$age}else{'NULL'}), $(Escape-Sql $gender), $(Escape-Sql $marital),"
    $row += " $(Escape-Sql $phone), $(Escape-Sql $cnic), $(Escape-Sql $blood),"
    $row += " $(Escape-Sql $height), $(Escape-Sql $weight), $(Escape-Sql $medNotes),"
    $row += " $(if($joinDate){"'$joinDate'"}else{'NULL'}), $(if($expiryDate){"'$expiryDate'"}else{'NULL'}),"
    $row += " '$status', $(Escape-Sql $comment),"
    $row += " NOW(), NOW())"

    $rows += $row
}

# ─── Write SQL file ───────────────────────────────────────────────────────────

$outputPath = Join-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) "..\$OutputSql"
$outputPath = [System.IO.Path]::GetFullPath($outputPath)

$header = @"
-- =============================================================================
-- GymAutomate → Level Up Fitness Club: Member Data Import
-- Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm")
-- Source: members.xlsx
-- Members: $($members.Count) total ($($stats.active) active, $($stats.inactive) inactive)
-- Gender: $($stats.male) male, $($stats.female) female ($($stats.noGender) gender guessed from name)
-- =============================================================================
-- HOW TO RUN: Paste this entire file into Supabase SQL Editor and click Run
-- SAFE TO RE-RUN: ON CONFLICT (membership_no) DO NOTHING prevents duplicates
-- =============================================================================

INSERT INTO members (
  membership_no, ref_id, full_name,
  age, gender, marital_status,
  phone, cnic, blood_group,
  height, weight, medical_notes,
  joining_date, expiry_date,
  status, comment,
  created_at, updated_at
) VALUES
"@

$footer = @"

ON CONFLICT (membership_no) DO NOTHING;

-- Verification queries (run after import):
-- SELECT COUNT(*) FROM members WHERE deleted_at IS NULL;
-- SELECT gender, status, COUNT(*) FROM members WHERE deleted_at IS NULL GROUP BY gender, status ORDER BY gender, status;
"@

$body = $rows -join ",`n"
$sql = $header + $body + $footer

[System.IO.File]::WriteAllText($outputPath, $sql, [System.Text.Encoding]::UTF8)
Write-Host ""
Write-Host "SQL written to: $outputPath"
Write-Host "  Total INSERT rows: $($rows.Count)"
Write-Host "  Active: $($stats.active) | Inactive: $($stats.inactive)"
Write-Host "  Male: $($stats.male) | Female: $($stats.female)"
