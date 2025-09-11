# RFI API Documentation - Text Only

## Overview
The RFI (Request for Information) API provides endpoints for managing text-only RFI records. All RFIs are stored as HTML content in the `tenderRFI` table.

## Base URL
```
http://localhost:3001/api/rfi
```

## Authentication
All endpoints require a valid JWT token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

## Endpoints

### 1. Create Text RFI
**POST** `/api/rfi/:tenderId/text`

Creates a new text-only RFI.

**Parameters:**
- `tenderId` (path) - The tender ID

**Request Body:**
```json
{
  "type": "General Question",
  "content": "<h3>RFI Title</h3><p>RFI content in HTML format</p>"
}
```

**Response:**
```json
{
  "success": true,
  "message": "RFI created successfully",
  "rfiId": 1
}
```

### 2. Get All RFIs
**GET** `/api/rfi/:tenderId`

Retrieves all RFIs for a specific tender.

**Parameters:**
- `tenderId` (path) - The tender ID

**Response:**
```json
{
  "success": true,
  "rfis": [
    {
      "RfiId": 1,
      "TenderID": 1336,
      "FileID": null,
      "AddBy": "John Doe",
      "UploadedOn": "2025-09-05T18:30:00.000Z",
      "Type": "General Question",
      "Content": "<h3>RFI Title</h3><p>RFI content</p>"
    }
  ]
}
```

### 3. Get Specific RFI
**GET** `/api/rfi/:tenderId/:rfiId`

Retrieves a specific RFI.

**Parameters:**
- `tenderId` (path) - The tender ID
- `rfiId` (path) - The RFI ID

**Response:**
```json
{
  "success": true,
  "rfi": {
    "RfiId": 1,
    "TenderID": 1336,
    "FileID": null,
    "AddBy": "John Doe",
    "UploadedOn": "2025-09-05T18:30:00.000Z",
    "Type": "General Question",
    "Content": "<h3>RFI Title</h3><p>RFI content</p>"
  }
}
```

### 4. Update RFI
**PUT** `/api/rfi/:tenderId/:rfiId`

Updates an existing RFI.

**Parameters:**
- `tenderId` (path) - The tender ID
- `rfiId` (path) - The RFI ID

**Request Body:**
```json
{
  "type": "Updated Question",
  "content": "<h3>Updated RFI Title</h3><p>Updated content</p>"
}
```

**Response:**
```json
{
  "success": true,
  "message": "RFI updated successfully"
}
```

### 5. Delete RFI
**DELETE** `/api/rfi/:tenderId/:rfiId`

Deletes an RFI.

**Parameters:**
- `tenderId` (path) - The tender ID
- `rfiId` (path) - The RFI ID

**Response:**
```json
{
  "success": true,
  "message": "RFI deleted successfully"
}
```

## Database Schema

### tenderRFI Table
```sql
RfiId      INT IDENTITY(1,1) PRIMARY KEY
TenderID   INT NOT NULL
FileID     INT NULL
AddBy      NVARCHAR(100) NOT NULL
UploadedOn DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
Type       NVARCHAR(50) NOT NULL
Content    NVARCHAR(MAX) NOT NULL
```

## Example Usage

### Create Q&A Format RFI
```javascript
const response = await fetch('/api/rfi/1336/text', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    type: 'Technical Question',
    content: `
      <div class="rfi-content">
        <h3>Technical Specifications</h3>
        <div class="qa-section">
          <h4>Question:</h4>
          <p>What are the power requirements for the system?</p>
          <h4>Answer:</h4>
          <p>The system requires 220V AC power supply.</p>
        </div>
        <div class="qa-section">
          <h4>Question:</h4>
          <p>What is the expected delivery timeline?</p>
          <h4>Answer:</h4>
          <p>Delivery is expected within 4-6 weeks.</p>
        </div>
      </div>
    `
  })
});
```

## Error Responses

### 400 Bad Request
```json
{
  "error": "Content is required"
}
```

### 401 Unauthorized
```json
{
  "error": "Authentication failed",
  "message": "Invalid token format. Please login again.",
  "redirect": "/login",
  "code": "TOKEN_MALFORMED"
}
```

### 404 Not Found
```json
{
  "error": "RFI not found"
}
```

### 500 Internal Server Error
```json
{
  "error": "Failed to create text RFI"
}
```