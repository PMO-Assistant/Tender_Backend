# Backend-Frontend Communication Fix

## Changes Made:

### Backend (Heroku):
1. ✅ Updated CORS configuration to use CORS_ORIGIN environment variable
2. ✅ Added comprehensive error handling to prevent crashes
3. ✅ Added CORS debug endpoint for troubleshooting
4. ✅ Enhanced logging for better debugging
5. ✅ Added fallback mechanisms for missing modules

### Frontend (Vercel):
1. ✅ Centralized API configuration in lib/constants.ts
2. ✅ Removed hardcoded API URLs from all components
3. ✅ Added proper error handling for API calls
4. ✅ Enhanced debugging and validation

## Environment Variables Required:

### Backend (Heroku):
- NODE_ENV = production
- SESSION_SECRET = (random string)
- CORS_ORIGIN = https://adcoportal.ie
- FRONTEND_URL = https://adcoportal.ie
- AZURE_REDIRECT_URI = https://adcoportal.ie/auth/callback
- AZURE_POST_LOGOUT_REDIRECT_URI = https://adcoportal.ie/login
- AZURE_TENANT_ID = (your Azure tenant ID)
- AZURE_CLIENT_ID = (your Azure client ID)
- AZURE_CLIENT_SECRET = (your Azure client secret)
- FRONTEND_URI = https://adcoportal.ie

### Frontend (Vercel):
- NEXT_PUBLIC_API_URL = https://adco-contracting-8673be3093c5.herokuapp.com/api
- NEXT_PUBLIC_REDIRECT_URI = https://adcoportal.ie/auth/callback
- NEXT_PUBLIC_POST_LOGOUT_REDIRECT_URI = https://adcoportal.ie
- NEXT_PUBLIC_AZURE_CLIENT_ID = (your Azure client ID)
- NEXT_PUBLIC_AZURE_TENANT_ID = (your Azure tenant ID)

## Test Endpoints:
- Backend Health: https://adco-contracting-8673be3093c5.herokuapp.com/health
- CORS Debug: https://adco-contracting-8673be3093c5.herokuapp.com/cors-debug
- Frontend: https://adcoportal.ie 