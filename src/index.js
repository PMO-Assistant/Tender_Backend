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
    console.log(`Request headers:`, {
        'user-agent': req.headers['user-agent'],
        'content-type': req.headers['content-type'],
        'authorization': req.headers['authorization'] ? 'Present' : 'Missing'
    });
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

// Handle OPTIONS requests explicitly
app.options('*', (req, res) => {
    console.log('OPTIONS request received for:', req.path);
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.status(200).end();
});

// ✅ JSON parsing
app.use(express.json());

// ✅ Session middleware
app.use(session(sessionConfig));

// ✅ Public authentication routes
app.use('/api/auth', authRouter);

// ✅ Protected routes using ADCO token validation - with error handling
const protectedRoute = (path, middleware, router) => {
    try {
        if (middleware && typeof middleware === 'function') {
            console.log(`Setting up protected route: ${path} with middleware`);
            app.use(path, middleware, router);
        } else {
            console.warn(`Middleware not available for ${path}, setting up route without middleware`);
            app.use(path, router);
        }
    } catch (error) {
        console.error(`Error setting up protected route ${path}:`, error);
        // Set up basic route without middleware as fallback
        try {
            app.use(path, router);
            console.log(`Fallback route set up for: ${path}`);
        } catch (fallbackError) {
            console.error(`Failed to set up fallback route for ${path}:`, fallbackError);
        }
    }
};

// Set up routes with fallback if middleware is not available
try {
    if (validateAdcoToken) {
        console.log('Setting up routes with authentication middleware');
        protectedRoute('/api/events', validateAdcoToken, eventRoutes);
        protectedRoute('/api/employees', validateAdcoToken, employeeRoutes);
        protectedRoute('/api/assets', validateAdcoToken, assetRoutes);
        protectedRoute('/api/quicklinks', validateAdcoToken, quickLinkRoutes);
        protectedRoute('/api/subcontractors', validateAdcoToken, subcontractorRoutes);
        protectedRoute('/api/calendar', validateAdcoToken, calendarRoutes);
        protectedRoute('/api/erp-tutorials', validateAdcoToken, erpTutorialRoutes);
        protectedRoute('/api/safety-content', validateAdcoToken, safetyContentRoutes);
        protectedRoute('/api/autodesk-tutorials', validateAdcoToken, autodeskTutorialRoutes);
    } else {
        console.warn('validateAdcoToken middleware not available, setting up routes without authentication');
        app.use('/api/events', eventRoutes);
        app.use('/api/employees', employeeRoutes);
        app.use('/api/assets', assetRoutes);
        app.use('/api/quicklinks', quickLinkRoutes);
        app.use('/api/subcontractors', subcontractorRoutes);
        app.use('/api/calendar', calendarRoutes);
        app.use('/api/erp-tutorials', erpTutorialRoutes);
        app.use('/api/safety-content', safetyContentRoutes);
        app.use('/api/autodesk-tutorials', autodeskTutorialRoutes);
    }
} catch (error) {
    console.error('Error setting up routes:', error);
    // Set up basic fallback routes
    app.use('/api/events', (req, res) => res.json({ message: 'Events endpoint' }));
    app.use('/api/employees', (req, res) => res.json({ message: 'Employees endpoint' }));
    app.use('/api/assets', (req, res) => res.json({ message: 'Assets endpoint' }));
    app.use('/api/quicklinks', (req, res) => res.json({ message: 'Quicklinks endpoint' }));
    app.use('/api/subcontractors', (req, res) => res.json({ message: 'Subcontractors endpoint' }));
    app.use('/api/calendar', (req, res) => res.json({ message: 'Calendar endpoint' }));
    app.use('/api/erp-tutorials', (req, res) => res.json({ message: 'ERP Tutorials endpoint' }));
    app.use('/api/safety-content', (req, res) => res.json({ message: 'Safety Content endpoint' }));
    app.use('/api/autodesk-tutorials', (req, res) => res.json({ message: 'Autodesk Tutorials endpoint' }));
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Public test endpoint (no auth required)
app.get('/public-test', (req, res) => {
    res.status(200).json({ 
        message: 'Public endpoint working',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        headers: {
            origin: req.headers.origin,
            userAgent: req.headers['user-agent']
        }
    });
});

// CORS debug endpoint
app.get('/cors-debug', (req, res) => {
    const corsOrigin = process.env.CORS_ORIGIN;
    const frontendUrl = process.env.FRONTEND_URL;
    const allowedOrigins = process.env.ALLOWED_ORIGINS;
    
    // Build the list of allowed origins (same logic as CORS middleware)
    const origins = [];
    const originStrings = [];
    
    if (corsOrigin) {
        origins.push(corsOrigin);
        originStrings.push(corsOrigin);
    }
    
    if (frontendUrl) {
        origins.push(frontendUrl);
        originStrings.push(frontendUrl);
    }
    
    if (allowedOrigins) {
        origins.push(...allowedOrigins.split(',').map(o => o.trim()));
        originStrings.push(...allowedOrigins.split(',').map(o => o.trim()));
    }
    
    if (process.env.NODE_ENV !== 'production') {
        origins.push('http://localhost:3000');
        originStrings.push('http://localhost:3000');
    }
    
    // Add Vercel patterns
    origins.push(/^https:\/\/.*\.vercel\.app$/);
    origins.push(/^https:\/\/.*\.vercel\.com$/);
    originStrings.push('/^https:\\/\\/.*\\.vercel\\.app$/', '/^https:\\/\\/.*\\.vercel\\.com$/');
    
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
            configuredOrigins: originStrings
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
