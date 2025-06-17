require("dotenv").config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');

// Add error handling for session config
let sessionConfig;
try {
    sessionConfig = require('./config/session');
} catch (error) {
    console.error('Error loading session config:', error);
    // Fallback to basic session config
    sessionConfig = {
        secret: process.env.SESSION_SECRET || 'fallback-secret-key',
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000,
            sameSite: 'lax'
        }
    };
}

// ✅ Auth router and token middleware
let authRouter, verifyToken, validateAdcoToken;
try {
    const authModule = require('./routes/auth');
    authRouter = authModule.authRouter;
    verifyToken = authModule.verifyToken;
    validateAdcoToken = require('./middleware/validateAdcoToken');
} catch (error) {
    console.error('Error loading auth modules:', error);
    // Create basic auth router as fallback
    authRouter = express.Router();
    authRouter.get('/health', (req, res) => res.json({ status: 'auth-healthy' }));
}

// ✅ Protected API routes - load with error handling
const loadRoute = (routePath, routeName) => {
    try {
        return require(routePath);
    } catch (error) {
        console.error(`Error loading ${routeName}:`, error);
        // Return basic router as fallback
        const router = express.Router();
        router.get('/', (req, res) => res.json({ message: `${routeName} endpoint` }));
        return router;
    }
};

const eventRoutes = loadRoute('./routes/eventRoutes', 'eventRoutes');
const employeeRoutes = loadRoute('./routes/employeeRoutes', 'employeeRoutes');
const assetRoutes = loadRoute('./routes/assetRoutes', 'assetRoutes');
const quickLinkRoutes = loadRoute('./routes/quickLinkRoutes', 'quickLinkRoutes');
const subcontractorRoutes = loadRoute('./routes/subcontractorRoutes', 'subcontractorRoutes');
const calendarRoutes = loadRoute('./routes/calendarRoutes', 'calendarRoutes');
const erpTutorialRoutes = loadRoute('./routes/erpTutorials', 'erpTutorialRoutes');
const safetyContentRoutes = loadRoute('./routes/safetyContent', 'safetyContentRoutes');
const autodeskTutorialRoutes = loadRoute('./routes/autodeskTutorials', 'autodeskTutorialRoutes');

const app = express();

// Enhanced error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Debug logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - Origin: ${req.headers.origin}`);
    next();
});

// ✅ CORS setup
app.use(cors({
    origin: function (origin, callback) {
        // Log all CORS requests for debugging
        console.log('CORS Request from origin:', origin);
        
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) {
            console.log('Allowing request with no origin');
            return callback(null, true);
        }
        
        // Get allowed origins from environment variables
        const corsOrigin = process.env.CORS_ORIGIN;
        const frontendUrl = process.env.FRONTEND_URL;
        const allowedOrigins = process.env.ALLOWED_ORIGINS;
        
        // Build the list of allowed origins
        const origins = [];
        
        // Add CORS_ORIGIN if set
        if (corsOrigin) {
            origins.push(corsOrigin);
        }
        
        // Add FRONTEND_URL if set
        if (frontendUrl) {
            origins.push(frontendUrl);
        }
        
        // Add ALLOWED_ORIGINS if set (comma-separated)
        if (allowedOrigins) {
            origins.push(...allowedOrigins.split(',').map(o => o.trim()));
        }
        
        // Add default localhost for development
        if (process.env.NODE_ENV !== 'production') {
            origins.push('http://localhost:3000');
        }
        
        // Add Vercel patterns for flexibility
        origins.push(/^https:\/\/.*\.vercel\.app$/);
        origins.push(/^https:\/\/.*\.vercel\.com$/);
        
        console.log('Configured allowed origins:', origins);
        
        // Check if origin is allowed
        const isAllowed = origins.some(allowedOrigin => {
            if (typeof allowedOrigin === 'string') {
                return origin === allowedOrigin;
            } else if (allowedOrigin instanceof RegExp) {
                return allowedOrigin.test(origin);
            }
            return false;
        });
        
        if (isAllowed) {
            console.log('CORS: Origin allowed:', origin);
            callback(null, true);
        } else {
            console.log('CORS: Origin blocked:', origin);
            console.log('Allowed origins:', origins);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
}));

// ✅ JSON parsing
app.use(express.json());

// ✅ Session middleware
app.use(session(sessionConfig));

// ✅ Public authentication routes
app.use('/api/auth', authRouter);

// ✅ Protected routes using ADCO token validation - with error handling
const protectedRoute = (path, middleware, router) => {
    try {
        app.use(path, middleware, router);
    } catch (error) {
        console.error(`Error setting up protected route ${path}:`, error);
        // Set up basic route without middleware as fallback
        app.use(path, router);
    }
};

protectedRoute('/api/events', validateAdcoToken, eventRoutes);
protectedRoute('/api/employees', validateAdcoToken, employeeRoutes);
protectedRoute('/api/assets', validateAdcoToken, assetRoutes);
protectedRoute('/api/quicklinks', validateAdcoToken, quickLinkRoutes);
protectedRoute('/api/subcontractors', validateAdcoToken, subcontractorRoutes);
protectedRoute('/api/calendar', validateAdcoToken, calendarRoutes);
protectedRoute('/api/erp-tutorials', validateAdcoToken, erpTutorialRoutes);
protectedRoute('/api/safety-content', validateAdcoToken, safetyContentRoutes);
protectedRoute('/api/autodesk-tutorials', validateAdcoToken, autodeskTutorialRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// CORS debug endpoint
app.get('/cors-debug', (req, res) => {
    const corsOrigin = process.env.CORS_ORIGIN;
    const frontendUrl = process.env.FRONTEND_URL;
    const allowedOrigins = process.env.ALLOWED_ORIGINS;
    
    // Build the list of allowed origins (same logic as CORS middleware)
    const origins = [];
    
    if (corsOrigin) {
        origins.push(corsOrigin);
    }
    
    if (frontendUrl) {
        origins.push(frontendUrl);
    }
    
    if (allowedOrigins) {
        origins.push(...allowedOrigins.split(',').map(o => o.trim()));
    }
    
    if (process.env.NODE_ENV !== 'production') {
        origins.push('http://localhost:3000');
    }
    
    origins.push(/^https:\/\/.*\.vercel\.app$/);
    origins.push(/^https:\/\/.*\.vercel\.com$/);
    
    res.status(200).json({ 
        message: 'CORS debug endpoint',
        origin: req.headers.origin,
        userAgent: req.headers['user-agent'],
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        corsConfiguration: {
            CORS_ORIGIN: corsOrigin,
            FRONTEND_URL: frontendUrl,
            ALLOWED_ORIGINS: allowedOrigins,
            configuredOrigins: origins
        }
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.status(200).json({ 
        message: 'ADCO Backend API is running',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        endpoints: {
            health: '/health',
            auth: '/api/auth',
            events: '/api/events',
            employees: '/api/employees',
            assets: '/api/assets',
            quicklinks: '/api/quicklinks',
            subcontractors: '/api/subcontractors',
            calendar: '/api/calendar',
            erpTutorials: '/api/erp-tutorials',
            safetyContent: '/api/safety-content',
            autodeskTutorials: '/api/autodesk-tutorials'
        }
    });
});

// ✅ Global error handler
app.use((err, req, res, next) => {
    console.error('Global error handler:', err.stack);
    res.status(500).json({ 
        error: 'Something went wrong!',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
});

// ✅ Start server
const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Health check available at: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
    });
});
