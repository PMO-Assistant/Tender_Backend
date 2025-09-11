-- Check current data distribution
-- This will show us how many tenders have ReturnDate vs other dates
SELECT 
    COUNT(*) as total_tenders,
    COUNT(CASE WHEN ReturnDate IS NOT NULL THEN 1 END) as tenders_with_return_date,
    COUNT(CASE WHEN OpenDate IS NOT NULL THEN 1 END) as tenders_with_open_date,
    COUNT(CASE WHEN CreatedAt IS NOT NULL THEN 1 END) as tenders_with_created_at,
    COUNT(CASE WHEN ReturnDate IS NULL AND OpenDate IS NULL AND CreatedAt IS NULL THEN 1 END) as tenders_with_no_dates,
    MIN(ReturnDate) as earliest_return_date,
    MAX(ReturnDate) as latest_return_date,
    MIN(OpenDate) as earliest_open_date,
    MAX(OpenDate) as latest_open_date,
    MIN(CreatedAt) as earliest_created_at,
    MAX(CreatedAt) as latest_created_at
FROM tenderTender 
WHERE IsDeleted = 0;

-- Show sample data to understand the current state
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
ORDER BY TenderID DESC;


