# 🧪 Lusha API Test Commands

## Prerequisites
1. Backend running on `http://localhost:3001`
2. Valid backend token (get from frontend localStorage)
3. Lusha API key configured in backend `.env` file

## Test Commands

### 1. Test by Email (Direct API call)
```bash
# Replace YOUR_TOKEN with actual backend token
curl -X GET "http://localhost:3001/api/contact/lusha?email=john.doe@microsoft.com" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

### 2. Test by Contact ID
```bash
# Replace YOUR_TOKEN and CONTACT_ID with actual values
curl -X GET "http://localhost:3001/api/contact/123/lusha" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

### 3. Test with PowerShell (Windows)
```powershell
# Test by email
$token = "YOUR_TOKEN_HERE"
$email = "john.doe@microsoft.com"
Invoke-RestMethod -Uri "http://localhost:3001/api/contact/lusha?email=$email" -Headers @{"Authorization"="Bearer $token"}

# Test by contact ID
$contactId = "123"
Invoke-RestMethod -Uri "http://localhost:3001/api/contact/$contactId/lusha" -Headers @{"Authorization"="Bearer $token"}
```

## Expected Responses

### Success Response
```json
{
  "found": true,
  "creditCharged": 1,
  "data": {
    "firstName": "John",
    "lastName": "Doe",
    "email": "john.doe@microsoft.com",
    "company": "Microsoft",
    "title": "Software Engineer",
    "location": "Seattle, WA",
    "linkedin": "https://linkedin.com/in/johndoe"
  }
}
```

### Rate Limit Response (429)
```json
{
  "statusCode": 429,
  "message": "Daily API rate limit exceeded. Limit: 25 calls per day. Reset in 81671 seconds.",
  "timestamp": "2025-08-29T17:51:45.469Z"
}
```

### Authentication Error (401)
```json
{
  "message": "Unauthorized: invalid Lusha API key"
}
```

## Test Emails to Try
- `john.doe@microsoft.com`
- `sarah.smith@google.com`
- `mike.johnson@apple.com`
- `test@example.com` (will likely fail)

## ⚠️ Important Notes
- **Each API call costs 1 credit** regardless of result
- **Test with real emails** to avoid wasting credits
- **Check your Lusha dashboard** for remaining credits
- **Rate limits apply** (usually 25 calls per day for free tier)







