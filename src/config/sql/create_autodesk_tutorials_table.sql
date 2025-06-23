CREATE TABLE PortalAutodeskTutorials (
    id VARCHAR(50) PRIMARY KEY,
    title NVARCHAR(255) NOT NULL,
    subtitle NVARCHAR(255) NOT NULL,
    location NVARCHAR(100) NOT NULL,
    content NVARCHAR(MAX) NOT NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    updated_at DATETIME2 DEFAULT GETDATE()
); 