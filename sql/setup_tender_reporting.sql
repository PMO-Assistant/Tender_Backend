-- Execute this script to create the stored procedure and indexes
-- Run this in your SQL Server Management Studio or database client

-- Step 1: Create the stored procedure
IF OBJECT_ID('sp_GetTenderReportData', 'P') IS NOT NULL
    DROP PROCEDURE sp_GetTenderReportData;
GO

CREATE PROCEDURE sp_GetTenderReportData
    @DateRange NVARCHAR(10) = 'all',
    @Category NVARCHAR(50) = 'all'
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @StartDate DATE;
    DECLARE @EndDate DATE = GETDATE();
    
    -- Calculate start date based on date range
    IF @DateRange = '30d'
        SET @StartDate = DATEADD(DAY, -30, @EndDate);
    ELSE IF @DateRange = '90d'
        SET @StartDate = DATEADD(DAY, -90, @EndDate);
    ELSE IF @DateRange = '6m'
        SET @StartDate = DATEADD(MONTH, -6, @EndDate);
    ELSE IF @DateRange = '1y'
        SET @StartDate = DATEADD(YEAR, -1, @EndDate);
    ELSE
        SET @StartDate = (SELECT MIN(COALESCE(ReturnDate, OpenDate, CreatedAt)) FROM tenderTender WHERE IsDeleted = 0);
    
    -- Get the date range for all months
    DECLARE @FirstDate DATE = @StartDate;
    DECLARE @LastDate DATE = @EndDate;
    
    -- Create a temporary table to hold all months
    CREATE TABLE #AllMonths (
        MonthKey NVARCHAR(7),
        YearMonth DATE
    );
    
    -- Generate all months between start and end date
    DECLARE @CurrentDate DATE = DATEFROMPARTS(YEAR(@FirstDate), MONTH(@FirstDate), 1);
    
    WHILE @CurrentDate <= @LastDate
    BEGIN
        INSERT INTO #AllMonths (MonthKey, YearMonth)
        VALUES (
            FORMAT(@CurrentDate, 'yyyy-MM'),
            @CurrentDate
        );
        
        SET @CurrentDate = DATEADD(MONTH, 1, @CurrentDate);
    END;
    
    -- Build the main query with proper date handling
    SELECT 
        am.MonthKey,
        am.YearMonth,
        COALESCE(SUM(t.Value), 0) AS TotalValue,
        COALESCE(COUNT(t.TenderID), 0) AS TenderCount,
        COALESCE(SUM(CASE WHEN t.Status LIKE '%awarded%' OR t.Status LIKE '%won%' OR t.Status LIKE '%success%' THEN t.Value ELSE 0 END), 0) AS AwardedValue,
        COALESCE(COUNT(CASE WHEN t.Status LIKE '%awarded%' OR t.Status LIKE '%won%' OR t.Status LIKE '%success%' THEN t.TenderID END), 0) AS AwardedCount,
        CASE 
            WHEN COUNT(t.TenderID) > 0 THEN COALESCE(SUM(t.Value), 0) / COUNT(t.TenderID)
            ELSE 0 
        END AS AverageValue
    FROM #AllMonths am
    LEFT JOIN tenderTender t ON 
        FORMAT(COALESCE(t.ReturnDate, t.OpenDate, t.CreatedAt), 'yyyy-MM') = am.MonthKey
        AND t.IsDeleted = 0
        AND (@Category = 'all' OR t.Type = @Category)
        AND (
            @DateRange = 'all' 
            OR COALESCE(t.ReturnDate, t.OpenDate, t.CreatedAt) >= @StartDate
        )
    GROUP BY am.MonthKey, am.YearMonth
    ORDER BY am.YearMonth;
    
    -- Get summary statistics
    SELECT 
        SUM(TotalValue) AS TotalValue,
        SUM(TenderCount) AS TotalTenders,
        SUM(AwardedValue) AS TotalAwardedValue,
        SUM(AwardedCount) AS TotalAwardedTenders,
        CASE 
            WHEN SUM(TenderCount) > 0 THEN SUM(TotalValue) / SUM(TenderCount)
            ELSE 0 
        END AS AverageValue,
        @FirstDate AS FirstTenderDate,
        @LastDate AS LastTenderDate
    FROM (
        SELECT 
            COALESCE(SUM(t.Value), 0) AS TotalValue,
            COALESCE(COUNT(t.TenderID), 0) AS TenderCount,
            COALESCE(SUM(CASE WHEN t.Status LIKE '%awarded%' OR t.Status LIKE '%won%' OR t.Status LIKE '%success%' THEN t.Value ELSE 0 END), 0) AS AwardedValue,
            COALESCE(COUNT(CASE WHEN t.Status LIKE '%awarded%' OR t.Status LIKE '%won%' OR t.Status LIKE '%success%' THEN t.TenderID END), 0) AS AwardedCount
        FROM tenderTender t
        WHERE t.IsDeleted = 0
        AND (@Category = 'all' OR t.Type = @Category)
        AND (
            @DateRange = 'all' 
            OR COALESCE(t.ReturnDate, t.OpenDate, t.CreatedAt) >= @StartDate
        )
    ) AS Summary;
    
    -- Clean up
    DROP TABLE #AllMonths;
END;
GO

-- Step 2: Create indexes for better performance
-- Composite index for date filtering and grouping
CREATE NONCLUSTERED INDEX IX_tenderTender_DateFiltering
ON tenderTender (IsDeleted, Type, Status)
INCLUDE (TenderID, ProjectName, Value, ReturnDate, OpenDate, CreatedAt)
WHERE IsDeleted = 0;

-- Index for date-based queries
CREATE NONCLUSTERED INDEX IX_tenderTender_DateFields
ON tenderTender (ReturnDate, OpenDate, CreatedAt)
INCLUDE (TenderID, Value, Status, Type, IsDeleted)
WHERE IsDeleted = 0;

-- Index for category filtering
CREATE NONCLUSTERED INDEX IX_tenderTender_Category
ON tenderTender (Type, IsDeleted)
INCLUDE (TenderID, Value, Status, ReturnDate, OpenDate, CreatedAt)
WHERE IsDeleted = 0;

-- Index for status-based queries (awarded tenders)
CREATE NONCLUSTERED INDEX IX_tenderTender_Status
ON tenderTender (Status, IsDeleted)
INCLUDE (TenderID, Value, Type, ReturnDate, OpenDate, CreatedAt)
WHERE IsDeleted = 0 AND Status IS NOT NULL;

-- Step 3: Test the stored procedure
-- EXEC sp_GetTenderReportData @DateRange = 'all', @Category = 'all';


