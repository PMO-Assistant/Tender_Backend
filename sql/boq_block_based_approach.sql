-- Block-based BOQ structure approach
-- This approach treats BOQ as blocks/sections rather than individual lines

-- Step 1: Check current table structure
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'tenderBoQ' 
ORDER BY ORDINAL_POSITION;

-- Step 2: Create a new table for BOQ blocks
CREATE TABLE tenderBoQBlocks (
    BlockID INT IDENTITY(1,1) PRIMARY KEY,
    TenderID INT NOT NULL,
    FileID INT NOT NULL,
    BlockName NVARCHAR(500) NOT NULL,           -- e.g., "CIVIL WORKS", "FIRE SECURITY"
    BlockOrder INT NOT NULL DEFAULT 0,          -- Order of blocks in the document
    Package NVARCHAR(100) NULL,                 -- Assigned package (e.g., "Civil Works", "Fire Security")
    IsDeleted BIT DEFAULT 0,
    CreatedAt DATETIME2(7) DEFAULT GETDATE(),
    UpdatedAt DATETIME2(7) DEFAULT GETDATE()
);

-- Step 3: Modify the existing tenderBoQ table to reference blocks
-- Add BlockID column to link items to their block
ALTER TABLE tenderBoQ 
ADD BlockID INT NULL;

-- Add ItemOrder column for ordering within each block
ALTER TABLE tenderBoQ 
ADD ItemOrder INT DEFAULT 0;

-- Step 4: Create indexes for better performance
CREATE NONCLUSTERED INDEX IX_tenderBoQBlocks_File
ON tenderBoQBlocks (FileID, BlockOrder)
WHERE IsDeleted = 0;

CREATE NONCLUSTERED INDEX IX_tenderBoQ_Block
ON tenderBoQ (FileID, BlockID, ItemOrder)
WHERE IsDeleted = 0;

-- Step 5: Show example structure
SELECT 
    'Example Block Structure' as Info,
    'Block: CIVIL WORKS' as BlockName,
    'BlockOrder: 1' as BlockOrder,
    'Package: Civil Works' as Package;

SELECT 
    'Example Items in Block' as Info,
    'Item 1: 100mm concrete slab' as Item1,
    'Item 2: 200mm foundation' as Item2,
    'Item 3: Excavation works' as Item3;

-- Step 6: Verify the new structure
SELECT 
    'tenderBoQBlocks' as TableName,
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'tenderBoQBlocks' 
ORDER BY ORDINAL_POSITION;

SELECT 
    'tenderBoQ (updated)' as TableName,
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'tenderBoQ' 
ORDER BY ORDINAL_POSITION;


