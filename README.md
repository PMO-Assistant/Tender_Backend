# ADCO Backend API

## Environment Variables

The following environment variables are required for the backend to function properly:

### Required Variables

- `PORT` - Server port (default: 3001)
- `AZURE_TENANT_ID` - Azure AD tenant ID
- `AZURE_CLIENT_ID` - Azure AD client ID  
- `AZURE_CLIENT_SECRET` - Azure AD client secret
- `AZURE_REDIRECT_URI` - Azure AD redirect URI
- `AZURE_POST_LOGOUT_REDIRECT_URI` - Azure AD post-logout redirect URI
- `FRONTEND_URI` - Frontend application URI

### Optional Variables

- `CORS_ORIGIN` - Frontend URL for CORS (e.g., https://adcoportal.ie)
- `FRONTEND_URL` - Frontend URL for CORS (e.g., https://adcoportal.ie)
- `ALLOWED_ORIGINS` - Comma-separated list of additional allowed origins for CORS
- `CALENDAR_EMAIL` - Email address for calendar access (default: info@adco.ie)
- `CALENDAR_TIMEZONE` - Timezone for calendar events (default: Europe/Dublin)

### Database Configuration

- `DATABASE_URL` - Database connection string
- `SESSION_SECRET` - Session secret for express-session

## API Endpoints

- `GET /health` - Health check endpoint
- `GET /` - API information and available endpoints
- `POST /api/auth/login` - Azure AD login
- `POST /api/auth/refresh-token` - Refresh authentication token
- `GET /api/events` - Get events
- `GET /api/employees` - Get employees
- `GET /api/assets` - Get assets
- `GET /api/quicklinks` - Get quick links
- `GET /api/subcontractors` - Get subcontractors
- `GET /api/calendar/events` - Get calendar events
- `GET /api/erp-tutorials` - Get ERP tutorials
- `GET /api/safety-content` - Get safety content
- `GET /api/autodesk-tutorials` - Get Autodesk tutorials

## CORS Configuration

The backend is configured to allow:
- URLs specified in `CORS_ORIGIN` environment variable
- URLs specified in `FRONTEND_URL` environment variable
- Additional origins specified in `ALLOWED_ORIGINS` environment variable
- Localhost development (http://localhost:3000) in non-production environments
- All Vercel frontend URLs (*.vercel.app, *.vercel.com)

## Authentication

The backend uses Azure AD authentication with MSAL (Microsoft Authentication Library). All protected routes require a valid Azure AD token passed in the Authorization header.

## Deployment

The backend is designed to be deployed on Heroku or similar cloud platforms. Make sure to set all required environment variables in your deployment environment. 