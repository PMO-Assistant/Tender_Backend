-- Add hierarchical structure columns to tenderBoQ table
-- This will help organize BOQ items with proper titles, subtitles, and hierarchy

-- Step 1: Check current table structure
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'tenderBoQ' 
ORDER BY ORDINAL_POSITION;

-- Step 2: Add new columns for hierarchical organization
-- Add Title column for main sections (e.g., "STRUCTURAL AND FIRST FIXINGS")
ALTER TABLE tenderBoQ 
ADD Title NVARCHAR(500) NULL;

-- Add Subtitle column for subsections (e.g., "Carassing")
ALTER TABLE tenderBoQ 
ADD Subtitle NVARCHAR(500) NULL;

-- Add HierarchyLevel column to track nesting (0=title, 1=subtitle, 2=item, 3=sub-item)
ALTER TABLE tenderBoQ 
ADD HierarchyLevel INT DEFAULT 2;

-- Add ParentCode column to link items to their parent code
ALTER TABLE tenderBoQ 
ADD ParentCode NVARCHAR(50) NULL;

-- Add SortOrder column for proper ordering within sections
ALTER TABLE tenderBoQ 
ADD SortOrder INT DEFAULT 0;

-- Step 3: Verify the new structure
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'tenderBoQ' 
ORDER BY ORDINAL_POSITION;

-- Step 4: Create index for better performance on hierarchical queries
CREATE NONCLUSTERED INDEX IX_tenderBoQ_Hierarchy
ON tenderBoQ (FileID, HierarchyLevel, ParentCode, SortOrder)
WHERE IsDeleted = 0;

-- Step 5: Show example of how the new structure will work
-- This is just for reference - actual data will be populated by the application
SELECT 
    'Example Structure' as Info,
    'Title: STRUCTURAL AND FIRST FIXINGS' as Title,
    'Subtitle: Carassing' as Subtitle,
    'Code: 107B' as Code,
    'Description: 225 x 44mm joists' as Description,
    'HierarchyLevel: 2' as HierarchyLevel,
    'ParentCode: NULL' as ParentCode,
    'SortOrder: 1' as SortOrder;


