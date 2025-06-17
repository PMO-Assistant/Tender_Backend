# Heroku Deployment Guide

## Prerequisites

1. **Heroku CLI** (optional but recommended for debugging)
2. **Git repository** connected to Heroku
3. **Environment variables** configured in Heroku

## Deployment Steps

### 1. Create Heroku App (if not already created)
```bash
heroku create your-app-name
```

### 2. Set Environment Variables
Go to your Heroku dashboard → Settings → Config Vars and add:

#### Required Variables:
- `NODE_ENV` = `production`
- `PORT` = (Heroku sets this automatically)
- `SESSION_SECRET` = (your secret key)

#### Azure AD Variables:
- `AZURE_TENANT_ID` = (your Azure tenant ID)
- `AZURE_CLIENT_ID` = (your Azure client ID)
- `AZURE_CLIENT_SECRET` = (your Azure client secret)
- `AZURE_REDIRECT_URI` = (your Azure redirect URI)
- `AZURE_POST_LOGOUT_REDIRECT_URI` = (your Azure post-logout redirect URI)
- `FRONTEND_URI` = (your frontend URL)

#### CORS Variables:
- `FRONTEND_URL` = (your Vercel frontend URL)
- `ALLOWED_ORIGINS` = (comma-separated list of additional origins)

#### Optional Variables:
- `CALENDAR_EMAIL` = (default: info@adco.ie)
- `CALENDAR_TIMEZONE` = (default: Europe/Dublin)

### 3. Deploy to Heroku
```bash
git add .
git commit -m "Deploy to Heroku"
git push heroku main
```

### 4. Check Deployment Status
```bash
heroku logs --tail
```

## Troubleshooting

### Common Issues:

#### 1. App Crashes on Startup
**Symptoms:** App shows as "crashed" in Heroku dashboard

**Solutions:**
- Check logs: `heroku logs --tail`
- Verify all required environment variables are set
- Ensure `NODE_ENV=production` is set
- Check if database connection is required (app now has fallbacks)

#### 2. Database Connection Errors
**Symptoms:** Errors about SQL Server connection

**Solutions:**
- The app now uses memory store as fallback when database is unavailable
- If you need database, ensure all DB_* environment variables are set
- Consider using Heroku Postgres if you need a database

#### 3. CORS Errors
**Symptoms:** Frontend can't connect to backend

**Solutions:**
- Verify `FRONTEND_URL` is set correctly
- Check `ALLOWED_ORIGINS` includes your frontend URL
- Ensure Vercel URLs are allowed (regex patterns are included)

#### 4. Authentication Issues
**Symptoms:** Azure AD login fails

**Solutions:**
- Verify all Azure AD environment variables are set
- Check that redirect URIs match your Heroku app URL
- Ensure Azure AD app is configured correctly

### Debugging Commands:

```bash
# View real-time logs
heroku logs --tail

# View recent logs
heroku logs

# Check app status
heroku ps

# Restart app
heroku restart

# Check environment variables
heroku config

# Open app in browser
heroku open
```

### Health Check Endpoints:

- `https://your-app.herokuapp.com/health` - Basic health check
- `https://your-app.herokuapp.com/` - API information

### Performance Monitoring:

- Use Heroku's built-in monitoring
- Check dyno usage in dashboard
- Monitor response times and error rates

## Environment Variables Checklist

Before deploying, ensure these are set in Heroku:

- [ ] `NODE_ENV=production`
- [ ] `SESSION_SECRET` (random string)
- [ ] `AZURE_TENANT_ID`
- [ ] `AZURE_CLIENT_ID`
- [ ] `AZURE_CLIENT_SECRET`
- [ ] `AZURE_REDIRECT_URI`
- [ ] `AZURE_POST_LOGOUT_REDIRECT_URI`
- [ ] `FRONTEND_URI`
- [ ] `FRONTEND_URL`
- [ ] `ALLOWED_ORIGINS` (optional)

## Post-Deployment Verification

1. **Health Check**: Visit `https://your-app.herokuapp.com/health`
2. **API Info**: Visit `https://your-app.herokuapp.com/`
3. **Frontend Connection**: Test from your Vercel frontend
4. **Authentication**: Test Azure AD login flow
5. **CORS**: Verify no CORS errors in browser console

## Support

If issues persist:
1. Check Heroku logs for specific error messages
2. Verify all environment variables are correctly set
3. Test locally with same environment variables
4. Check Azure AD configuration matches Heroku URLs 