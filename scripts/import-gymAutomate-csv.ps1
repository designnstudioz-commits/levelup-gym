# GymAutomate historical members CSV → Level Up Fitness Club import
# Reads users.csv (2020-2025), generates SQL migration for Supabase members table
# Run: powershell -ExecutionPolicy Bypass -File scripts/import-gymAutomate-csv.ps1

param(
    [string]$CsvPath    = "C:\Users\faisa\Downloads\users.csv",
    [string]$OutputSql  = "supabase\migrations\20260629000001_import_gymAutomate_csv.sql"
)

# ─── Helpers ─────────────────────────────────────────────────────────────────

function Format-Phone($raw) {
    if (-not $raw -or $raw.Trim() -eq '') { return $null }
    $digits = ($raw -replace '\D', '')
    # All-zeros placeholder
    if ($digits -match '^0+$') { return $null }
    # 10-digit without leading 0 (e.g. 3004693347) — add 0
    if ($digits.Length -eq 10 -and $digits[0] -ne '0') { $digits = "0$digits" }
    # Truncate to 11
    if ($digits.Length -gt 11) { $digits = $digits.Substring(0, 11) }
    if ($digits.Length -le 4)  { return $null }
    return "$($digits.Substring(0,4))-$($digits.Substring(4))"
}

function Validate-Cnic($raw) {
    if (-not $raw -or $raw.Trim() -eq '') { return $null }
    $digits = ($raw -replace '\D', '')
    # Must be exactly 13 digits and not all zeros
    if ($digits.Length -ne 13 -or $digits -match '^0+$') { return $null }
    return $raw.Trim()
}

function Clean-BloodGroup($raw) {
    if (-not $raw -or $raw -match '^\s*$' -or $raw -match '^Unknown') { return $null }
    $valid = @('A+','A-','B+','B-','AB+','AB-','O+','O-')
    if ($valid -contains $raw.Trim()) { return $raw.Trim() }
    return $null
}

function Clean-MedNotes($diseaseOther) {
    if (-not $diseaseOther -or $diseaseOther -match '^\s*(none|n\.?a\.?|nil|no|nothing|normal|-)\s*$') { return $null }
    return $diseaseOther.Trim()
}

function Normalize-Gender($raw) {
    if ($raw -match '^f') { return 'Female' }
    return 'Male'
}

function Normalize-Referral($raw) {
    if (-not $raw -or $raw.Trim() -eq '') { return $null }
    switch -Wildcard ($raw.Trim()) {
        'Friends'                           { return 'Friend / Family Referral' }
        'Social Media*'                     { return 'Social Media (Instagram/Facebook)' }
        'Google*'                           { return 'Google Search' }
        'Others'                            { return 'Other' }
        default                             { return $raw.Trim() }
    }
}

function Normalize-MaritalStatus($raw) {
    if ($raw -match '^[Mm]arried') { return 'Married' }
    if ($raw -match '^[Ss]ingle')  { return 'Single' }
    return $null
}

function Get-JoinYear($joinDate) {
    if ($joinDate -match '^(\d{4})-') {
        $yr = [int]$Matches[1]
        if ($yr -ge 2018 -and $yr -le 2030) { return $yr }
    }
    return 2020  # fallback for bad dates
}

function Sql-Val($val) {
    if ($val -eq $null -or "$val" -eq '') { return 'NULL' }
    $s = "$val".Replace("'", "''")
    return "'$s'"
}

function Sql-Num($val) {
    if ($val -eq $null -or "$val" -eq '') { return 'NULL' }
    $n = ($val -replace '[^0-9.]', '')
    if ($n -eq '' -or $n -eq '.') { return 'NULL' }
    return $n
}

function Sql-Date($val) {
    if ($val -eq $null -or $val -eq '') { return 'NULL' }
    if ($val -match '^(\d{4})-(\d{2})-(\d{2})') {
        $yr = [int]$Matches[1]
        if ($yr -ge 2018 -and $yr -le 2030) { return "'$val'" }
    }
    return 'NULL'
}

# ─── Parse CSV ────────────────────────────────────────────────────────────────

Write-Host "Reading CSV: $CsvPath"
$raw = Get-Content $CsvPath -Encoding UTF8
$cleaned = $raw | ForEach-Object { $_ -replace '(?<=;|^)NULL(?=;|$)', '""' }
$tmp = "$env:TEMP\users_import_clean.csv"
$cleaned | Set-Content $tmp -Encoding UTF8
$users = Import-Csv $tmp -Delimiter ";"
Write-Host "Parsed $($users.Count) users from CSV"

# ─── Assign membership numbers (sequential per gender per year) ───────────────
# Sort: by join year ASC, then join_date ASC, then by id ASC
$sorted = $users | Sort-Object { Get-JoinYear $_.join_date }, join_date, { [int]$_.id }

# Counters: year -> gender -> count
$lumCounts = @{}
$lufCounts = @{}

$records = @()
$stats = @{ active = 0; inactive = 0; male = 0; female = 0; skipped = 0 }

foreach ($u in $sorted) {
    # Skip if no name
    if (-not $u.name -or $u.name.Trim() -eq '') { $stats.skipped++; continue }

    $gender    = Normalize-Gender($u.gender)
    $joinYear  = Get-JoinYear($u.join_date)
    $yearStr   = "$joinYear"

    if ($gender -eq 'Female') {
        if (-not $lufCounts.ContainsKey($yearStr)) { $lufCounts[$yearStr] = 0 }
        $lufCounts[$yearStr]++
        $membershipNo = "LUF-$yearStr-$($lufCounts[$yearStr].ToString('D4'))"
        $stats.female++
    } else {
        if (-not $lumCounts.ContainsKey($yearStr)) { $lumCounts[$yearStr] = 0 }
        $lumCounts[$yearStr]++
        $membershipNo = "LUM-$yearStr-$($lumCounts[$yearStr].ToString('D4'))"
        $stats.male++
    }

    $status = if ($u.status -eq '1') { 'active' } else { 'inactive' }
    if ($status -eq 'active') { $stats.active++ } else { $stats.inactive++ }

    $phone    = Format-Phone($u.phone_number)
    $whatsapp = Format-Phone($u.whatsapp)
    $cnic     = Validate-Cnic($u.cnic)
    $blood    = Clean-BloodGroup($u.blood_group)
    $medNotes = Clean-MedNotes($u.disease_other)
    $referral = Normalize-Referral($u.find_levelup)
    $marital  = Normalize-MaritalStatus($u.marital_status)

    # Comment: store old GymAutomate data + referral (no referral_source column in members)
    $comment = "GymAutomate ID: $($u.id)"
    if ($u.membership_number -and $u.membership_number -ne '') {
        $comment += " | Old Mbr No: $($u.membership_number)"
    }
    if ($referral -and $referral -ne '') {
        $comment += " | Referral: $referral"
    }

    # ref_id: store serial number
    $refId = if ($u.serial_number -and $u.serial_number -ne '') { $u.serial_number } else { $null }

    # Address (clean up extra whitespace)
    $addr = if ($u.permanent_address -and $u.permanent_address.Trim() -ne '') { $u.permanent_address.Trim() } else { $null }

    # Age
    $age = $null
    if ($u.age -match '^\d+$' -and [int]$u.age -gt 0 -and [int]$u.age -lt 120) { $age = [int]$u.age }

    # Weight/Height
    $weight = if ($u.weight -and $u.weight.Trim() -ne '' -and $u.weight -ne '0') { $u.weight.Trim() } else { $null }
    $height = if ($u.height -and $u.height.Trim() -ne '' -and $u.height -ne '0-ft') { $u.height.Trim() } else { $null }

    # phone NOT NULL — use placeholder if missing
    $phoneFinal = if ($phone) { $phone } else { '0000-0000000' }

    $records += [PSCustomObject]@{
        membership_no  = $membershipNo
        ref_id         = $refId
        full_name      = $u.name.Trim()
        age            = $age
        gender         = $gender
        marital_status = $marital
        phone          = $phoneFinal
        whatsapp       = $whatsapp
        address        = $addr
        cnic           = $cnic
        blood_group    = $blood
        height         = $height
        weight         = $weight
        medical_notes  = $medNotes
        admission_fee  = $u.admission_fees
        monthly_fee    = $u.monthly_fees
        training_fee   = $u.trainer_fees
        joining_date   = $u.join_date
        expiry_date    = $u.expire_date
        status         = $status
        comment        = $comment
    }
}

Write-Host "Records to insert: $($records.Count) (skipped: $($stats.skipped))"
Write-Host "  Active: $($stats.active) | Inactive: $($stats.inactive)"
Write-Host "  Male: $($stats.male) | Female: $($stats.female)"

# ─── Generate SQL ─────────────────────────────────────────────────────────────

$rows = @()
foreach ($r in $records) {
    $row  = "  ($(Sql-Val $r.membership_no), $(Sql-Val $r.ref_id), $(Sql-Val $r.full_name),"
    $row += " $(if($r.age -ne $null){$r.age}else{'NULL'}), $(Sql-Val $r.gender), $(Sql-Val $r.marital_status),"
    $row += " $(Sql-Val $r.phone), $(Sql-Val $r.whatsapp), $(Sql-Val $r.address),"
    $row += " $(Sql-Val $r.cnic), $(Sql-Val $r.blood_group),"
    $row += " $(Sql-Val $r.height), $(Sql-Val $r.weight),"
    $row += " $(Sql-Val $r.medical_notes),"
    $row += " $(Sql-Num $r.admission_fee), $(Sql-Num $r.monthly_fee), $(Sql-Num $r.training_fee),"
    $row += " $(Sql-Date $r.joining_date), $(Sql-Date $r.expiry_date),"
    $row += " '$($r.status)', $(Sql-Val $r.comment),"
    $row += " NOW(), NOW())"
    $rows += $row
}

$outputPath = Join-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) "..\$OutputSql"
$outputPath = [System.IO.Path]::GetFullPath($outputPath)

$header = @"
-- =============================================================================
-- GymAutomate Historical Members CSV → Level Up Fitness Club
-- Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm")
-- Source: users.csv (GymAutomate full export, 2020-2025)
-- Members: $($records.Count) total ($($stats.active) active, $($stats.inactive) inactive)
-- Gender: $($stats.male) male, $($stats.female) female
-- Membership nos: Sequential per gender per join year (LUM/LUF-YYYY-NNNN)
-- Note: phone='0000-0000000' = placeholder for missing phone numbers
-- =============================================================================
-- HOW TO RUN: Paste into Supabase SQL Editor and click Run
-- SAFE TO RE-RUN: ON CONFLICT (membership_no) DO NOTHING prevents duplicates
-- NOTE: These are SEPARATE from the 100 members in the Excel (2026 batch)
-- =============================================================================

INSERT INTO members (
  membership_no, ref_id, full_name,
  age, gender, marital_status,
  phone, whatsapp, address,
  cnic, blood_group,
  height, weight,
  medical_notes,
  admission_fee, monthly_fee, training_fee,
  joining_date, expiry_date,
  status, comment,
  created_at, updated_at
) VALUES
"@

$footer = @"

ON CONFLICT (membership_no) DO NOTHING;

-- Verification:
-- SELECT COUNT(*) FROM members WHERE deleted_at IS NULL;
-- Expected: ~1147 (1046 CSV + 100 Excel + 1 Gul Afsheen)
--
-- SELECT join_year, gender, COUNT(*) FROM (
--   SELECT EXTRACT(YEAR FROM joining_date)::INT AS join_year, gender FROM members WHERE deleted_at IS NULL
-- ) t GROUP BY join_year, gender ORDER BY join_year, gender;
"@

$body = $rows -join ",`n"
$sql = $header + $body + $footer

[System.IO.File]::WriteAllText($outputPath, $sql, [System.Text.Encoding]::UTF8)
Write-Host ""
Write-Host "SQL written to: $outputPath"
