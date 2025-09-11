# RFI API Test Commands

## 1. Upload RFI File (creates RFI automatically with AI-processed HTML Q&A)
curl -X POST "http://localhost:3001/api/rfi/1336/upload" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@/path/to/your/rfi/document.pdf" \
  -F "addBy=Test User"

## 2. Create Text-Only RFI (manual HTML content)
curl -X POST "http://localhost:3001/api/rfi/1336/text" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "<div class=\"rfi-content\"><h3>RFI Questions & Information</h3><div class=\"qa-section\"><h4>Question 1:</h4><p>What are the specifications for the concrete mix?</p><h4>Answer:</h4><p>The concrete mix should be C25/30 grade with a minimum cement content of 300kg/m³.</p></div><div class=\"qa-section\"><h4>Question 2:</h4><p>What is the required curing period?</p><h4>Answer:</h4><p>The curing period should be minimum 7 days with proper moisture maintenance.</p></div></div>",
    "addBy": "Test User",
    "type": "Manual Input"
  }'

## 3. Get All RFIs for Tender
curl -X GET "http://localhost:3001/api/rfi/1336" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"

## 4. Get Specific RFI
curl -X GET "http://localhost:3001/api/rfi/1336/1" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"

## 5. Download RFI File
curl -X GET "http://localhost:3001/api/rfi/1336/1/download" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -o "downloaded_file.pdf"

## 6. Delete RFI
curl -X DELETE "http://localhost:3001/api/rfi/1336/1" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"

## Example Response from File Upload:
# {
#   "success": true,
#   "message": "RFI file uploaded and processed successfully",
#   "rfiId": 1,
#   "fileId": 123,
#   "fileName": "rfi_document.pdf"
# }

## Example Response from Text-Only Creation:
# {
#   "success": true,
#   "message": "RFI created successfully",
#   "rfiId": 2
# }

## Example Response from Get RFI:
# {
#   "success": true,
#   "rfi": {
#     "RfiId": 1,
#     "TenderID": 1336,
#     "FileID": 123,
#     "AddBy": "Test User",
#     "UploadedOn": "2025-01-05T18:00:00.000Z",
#     "Type": "File Upload",
#     "Content": "<div class=\"rfi-content\"><h3>RFI Questions & Information</h3><div class=\"qa-section\">...</div></div>",
#     "FileName": "rfi_document.pdf",
#     "ContentType": "application/pdf",
#     "BlobPath": "tenders/1336/rfi/1736092800000_rfi_document.pdf"
#   }
# }
