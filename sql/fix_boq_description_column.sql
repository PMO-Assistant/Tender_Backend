-- Fix BOQ Description column size issue
-- This script increases the Description column size to accommodate longer BOQ descriptions

-- Step 1: Check current column size
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'tenderBoQ' 
AND COLUMN_NAME = 'Description';

-- Step 2: Increase the Description column size to accommodate longer descriptions
-- Using NVARCHAR(MAX) to handle very long descriptions without truncation
ALTER TABLE tenderBoQ 
ALTER COLUMN Description NVARCHAR(MAX);

-- Step 3: Verify the change
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'tenderBoQ' 
AND COLUMN_NAME = 'Description';

-- Step 4: Check if there are any existing BOQ items with truncated descriptions
SELECT TOP 10
    BoQID,
    Code,
    LEN(Description) as DescriptionLength,
    LEFT(Description, 100) + '...' as DescriptionPreview
FROM tenderBoQ 
WHERE LEN(Description) > 200
ORDER BY LEN(Description) DESC;

-- Step 5: Show table structure for reference
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'tenderBoQ' 
ORDER BY ORDINAL_POSITION;


