-- Indexes to optimize tender report queries
-- These indexes will significantly improve performance for date-based filtering and grouping

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


