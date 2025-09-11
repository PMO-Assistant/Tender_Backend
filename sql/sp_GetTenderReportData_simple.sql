-- Simple and fast stored procedure for tender reporting
-- This version is optimized to avoid timeouts
CREATE PROCEDURE sp_GetTenderReportData
    @DateRange NVARCHAR(10) = 'all',
    @Category NVARCHAR(50) = 'all'
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @StartDate DATE;
    DECLARE @EndDate DATE = GETDATE();
    
    -- Calculate start date based on date range (limit to reasonable ranges)
    IF @DateRange = '30d'
        SET @StartDate = DATEADD(DAY, -30, @EndDate);
    ELSE IF @DateRange = '90d'
        SET @StartDate = DATEADD(DAY, -90, @EndDate);
    ELSE IF @DateRange = '6m'
        SET @StartDate = DATEADD(MONTH, -6, @EndDate);
    ELSE IF @DateRange = '1y'
        SET @StartDate = DATEADD(YEAR, -1, @EndDate);
    ELSE
        -- For 'all', limit to last 5 years to avoid timeouts
        SET @StartDate = DATEADD(YEAR, -5, @EndDate);
    
    -- Simple query that groups by month directly
    SELECT 
        FORMAT(COALESCE(t.ReturnDate, t.OpenDate, t.CreatedAt), 'yyyy-MM') AS MonthKey,
        COALESCE(SUM(t.Value), 0) AS TotalValue,
        COUNT(t.TenderID) AS TenderCount,
        COALESCE(SUM(CASE WHEN t.Status LIKE '%awarded%' OR t.Status LIKE '%won%' OR t.Status LIKE '%success%' THEN t.Value ELSE 0 END), 0) AS AwardedValue,
        COUNT(CASE WHEN t.Status LIKE '%awarded%' OR t.Status LIKE '%won%' OR t.Status LIKE '%success%' THEN t.TenderID END) AS AwardedCount,
        CASE 
            WHEN COUNT(t.TenderID) > 0 THEN COALESCE(SUM(t.Value), 0) / COUNT(t.TenderID)
            ELSE 0 
        END AS AverageValue
    FROM tenderTender t
    WHERE t.IsDeleted = 0
    AND (@Category = 'all' OR t.Type = @Category)
    AND COALESCE(t.ReturnDate, t.OpenDate, t.CreatedAt) >= @StartDate
    AND COALESCE(t.ReturnDate, t.OpenDate, t.CreatedAt) IS NOT NULL
    GROUP BY FORMAT(COALESCE(t.ReturnDate, t.OpenDate, t.CreatedAt), 'yyyy-MM')
    ORDER BY MonthKey;
    
    -- Summary statistics
    SELECT 
        COALESCE(SUM(t.Value), 0) AS TotalValue,
        COUNT(t.TenderID) AS TotalTenders,
        COALESCE(SUM(CASE WHEN t.Status LIKE '%awarded%' OR t.Status LIKE '%won%' OR t.Status LIKE '%success%' THEN t.Value ELSE 0 END), 0) AS TotalAwardedValue,
        COUNT(CASE WHEN t.Status LIKE '%awarded%' OR t.Status LIKE '%won%' OR t.Status LIKE '%success%' THEN t.TenderID END) AS TotalAwardedTenders,
        CASE 
            WHEN COUNT(t.TenderID) > 0 THEN COALESCE(SUM(t.Value), 0) / COUNT(t.TenderID)
            ELSE 0 
        END AS AverageValue,
        @StartDate AS FirstTenderDate,
        @EndDate AS LastTenderDate
    FROM tenderTender t
    WHERE t.IsDeleted = 0
    AND (@Category = 'all' OR t.Type = @Category)
    AND COALESCE(t.ReturnDate, t.OpenDate, t.CreatedAt) >= @StartDate
    AND COALESCE(t.ReturnDate, t.OpenDate, t.CreatedAt) IS NOT NULL;
END;


