-- Update tender dates to use proper ReturnDate
-- This script will help populate ReturnDate for tenders that don't have it

-- Step 1: Show tenders that need ReturnDate populated
SELECT 
    TenderID,
    ProjectName,
    ReturnDate,
    OpenDate,
    CreatedAt,
    Value,
    Status,
    Type,
    CASE 
        WHEN ReturnDate IS NOT NULL THEN 'Has ReturnDate'
        WHEN OpenDate IS NOT NULL THEN 'Has OpenDate - can use as ReturnDate'
        WHEN CreatedAt IS NOT NULL THEN 'Has CreatedAt - needs manual review'
        ELSE 'No dates at all - needs manual review'
    END as DateStatus
FROM tenderTender 
WHERE IsDeleted = 0 
AND ReturnDate IS NULL
ORDER BY TenderID DESC;

-- Step 2: Update tenders that have OpenDate but no ReturnDate
-- This assumes OpenDate can be used as ReturnDate for reporting purposes
UPDATE tenderTender 
SET ReturnDate = OpenDate
WHERE IsDeleted = 0 
AND ReturnDate IS NULL 
AND OpenDate IS NOT NULL;

-- Step 3: For tenders with only CreatedAt, we need to decide what to do
-- Option A: Use CreatedAt as ReturnDate (if CreatedAt represents when the tender was due)
-- Option B: Set ReturnDate to NULL and exclude from reports
-- Option C: Set ReturnDate to a calculated date based on business logic

-- For now, let's use CreatedAt as ReturnDate for tenders that have no other dates
-- This can be adjusted based on your business requirements
UPDATE tenderTender 
SET ReturnDate = CreatedAt
WHERE IsDeleted = 0 
AND ReturnDate IS NULL 
AND CreatedAt IS NOT NULL;

-- Step 4: Verify the updates
SELECT 
    COUNT(*) as total_tenders,
    COUNT(CASE WHEN ReturnDate IS NOT NULL THEN 1 END) as tenders_with_return_date,
    COUNT(CASE WHEN ReturnDate IS NULL THEN 1 END) as tenders_without_return_date,
    MIN(ReturnDate) as earliest_return_date,
    MAX(ReturnDate) as latest_return_date
FROM tenderTender 
WHERE IsDeleted = 0;

-- Step 5: Show the final state
SELECT TOP 20
    TenderID,
    ProjectName,
    ReturnDate,
    OpenDate,
    CreatedAt,
    Value,
    Status,
    Type
FROM tenderTender 
WHERE IsDeleted = 0
ORDER BY ReturnDate DESC;


