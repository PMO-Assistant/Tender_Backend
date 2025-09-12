const express = require('express');
const app = express();
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
require('dotenv').config();

console.log('🔧 Starting server...');

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS configuration
const allowedOrigins = [
  'http://localhost:3000',
  'https://localhost:3000',
  'https://tender-frontend-git-main-adco-contractings-projects.vercel.app',
  process.env.FRONTEND_URL,
  process.env.NEXT_PUBLIC_FRONTEND_URL
].filter(Boolean); // Remove undefined values

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    console.log('🚫 CORS blocked origin:', origin);
    console.log('✅ Allowed origins:', allowedOrigins);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

console.log('✅ Basic middleware loaded');

// Test route
app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is working!' });
});

// Health check route
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'Backend server is running'
  });
});

// Import middleware
const { authenticateToken } = require('./middleware/auth');
const { 
  hasAnyPermission,
  requireContactPermission,
  requireCompanyPermission,
  requireAIPermission,
  requireFilePermission,
  requireTaskPermission,
  requireAdminPermission
} = require('./middleware/permissions');

// Load routes with proper authentication and permissions
try {
  console.log('🔄 Loading auth routes...');
  const authRoutes = require('./routes/auth');
  app.use('/api/auth', authRoutes);
  console.log('✅ Auth routes loaded');
} catch (error) {
  console.error('❌ Error loading auth routes:', error.message);
}

try {
  console.log('🔄 Loading company routes...');
  const companyRoutes = require('./routes/company');
  app.use('/api/company', authenticateToken, requireCompanyPermission, companyRoutes);
  console.log('✅ Company routes loaded');
} catch (error) {
  console.error('❌ Error loading company routes:', error.message);
}

try {
  console.log('🔄 Loading notification routes...');
  const notificationRoutes = require('./routes/notification');
  app.use('/api/notification', authenticateToken, hasAnyPermission, notificationRoutes);
  console.log('✅ Notification routes loaded');
} catch (error) {
  console.error('❌ Error loading notification routes:', error.message);
}

try {
  console.log('🔄 Loading company name routes...');
  const companyNameRoutes = require('./routes/companyName');
  app.use('/api/company-name', authenticateToken, requireCompanyPermission, companyNameRoutes);
  console.log('✅ Company name routes loaded');
} catch (error) {
  console.error('❌ Error loading company name routes:', error.message);
}

try {
  console.log('🔄 Loading contact routes...');
  const contactRoutes = require('./routes/contact');
  app.use('/api/contact', authenticateToken, requireContactPermission, contactRoutes);
  console.log('✅ Contact routes loaded');
} catch (error) {
  console.error('❌ Error loading contact routes:', error.message);
}

// (Hunter proxy removed)

try {
  console.log('🔄 Loading contact history routes...');
  const contactHistoryRoutes = require('./routes/contactHistory');
  app.use('/api/contact-history', authenticateToken, requireContactPermission, contactHistoryRoutes);
  console.log('✅ Contact history routes loaded');
} catch (error) {
  console.error('❌ Error loading contact history routes:', error.message);
}

try {
  console.log('🔄 Loading tender routes...');
  const tenderRoutes = require('./routes/tender');
  app.use('/api/tender', authenticateToken, hasAnyPermission, tenderRoutes);
  console.log('✅ Tender routes loaded');
} catch (error) {
  console.error('❌ Error loading tender routes:', error.message);
}

try {
      console.log('🔄 Loading tender contact routes...');
    const tenderContactRoutes = require('./routes/tenderContact');
    app.use('/api/tender-contact', authenticateToken, hasAnyPermission, tenderContactRoutes);
    console.log('✅ Tender contact routes loaded');
} catch (error) {
  console.error('❌ Error loading tender contact routes:', error.message);
}

try {
  console.log('🔄 Loading tender form field routes...');
  const tenderFormFieldRoutes = require('./routes/tenderFormField');
  app.use('/api/tender-form-field', authenticateToken, hasAnyPermission, tenderFormFieldRoutes);
  console.log('✅ Tender form field routes loaded');
} catch (error) {
  console.error('❌ Error loading tender form field routes:', error.message);
}

try {
  console.log('🔄 Loading file comment routes...');
  const fileCommentRoutes = require('./routes/fileComment');
  app.use('/api/file-comment', authenticateToken, requireFilePermission, fileCommentRoutes);
  console.log('✅ File comment routes loaded');
} catch (error) {
  console.error('❌ Error loading file comment routes:', error.message);
}

try {
  console.log('🔄 Loading blob routes...');
  const blobRoutes = require('./routes/blob');
  app.use('/api/blob', authenticateToken, requireFilePermission, blobRoutes);
  console.log('✅ Blob routes loaded');
} catch (error) {
  console.error('❌ Error loading blob routes:', error.message);
}

try {
  console.log('🔄 Loading mistral routes...');
  const mistralRoutes = require('./routes/mistralAI');
  app.use('/api/ai', authenticateToken, requireAIPermission, mistralRoutes);
  console.log('✅ Mistral routes loaded');
} catch (error) {
  console.error('❌ Error loading mistral routes:', error.message);
}

try {
  console.log('🔄 Loading task routes...');
  const taskRoutes = require('./routes/task');
  app.use('/api/task', authenticateToken, requireTaskPermission, taskRoutes);
  console.log('✅ Task routes loaded');
} catch (error) {
  console.error('❌ Error loading task routes:', error.message);
}

try {
  console.log('🔄 Loading task attachment routes...');
  const taskAttachmentRoutes = require('./routes/taskAttachment');
  app.use('/api/task-attachments', authenticateToken, requireTaskPermission, taskAttachmentRoutes);
  console.log('✅ Task attachment routes loaded');
} catch (error) {
  console.error('❌ Error loading task attachment routes:', error.message);
}

try {
  console.log('🔄 Loading admin routes...');
  const adminRoutes = require('./routes/admin');
  app.use('/api/admin', authenticateToken, requireAdminPermission, adminRoutes);
  console.log('✅ Admin routes loaded');
} catch (error) {
  console.error('❌ Error loading admin routes:', error.message);
}

try {
  console.log('🔄 Loading org chart routes...');
  const orgChartRoutes = require('./routes/orgChart');
  app.use('/api/orgchart', authenticateToken, hasAnyPermission, orgChartRoutes);
  console.log('✅ Org chart routes loaded');
} catch (error) {
  console.error('❌ Error loading org chart routes:', error.message);
}

try {
  console.log('🔄 Loading user routes...');
  const userRoutes = require('./routes/user');
  app.use('/api/users', authenticateToken, hasAnyPermission, userRoutes);
  console.log('✅ User routes loaded');
} catch (error) {
  console.error('❌ Error loading user routes:', error.message);
}

try {
  console.log('🔄 Loading file routes...');
  const fileRoutes = require('./routes/files');
  app.use('/api/files', authenticateToken, requireFilePermission, fileRoutes);
  console.log('✅ File routes loaded');
} catch (error) {
  console.error('❌ Error loading file routes:', error.message);
}

try {
  console.log('🔄 Loading file favorites routes...');
  const fileFavRoutes = require('./routes/fileFav');
  app.use('/api/file-favorites', authenticateToken, requireFilePermission, fileFavRoutes);
  console.log('✅ File favorites routes loaded');
} catch (error) {
  console.error('❌ Error loading file favorites routes:', error.message);
}

try {
  console.log('🔄 Loading BOQ routes...');
  const boqRoutes = require('./routes/boq');
  app.use('/api/boq', authenticateToken, hasAnyPermission, boqRoutes);
  console.log('✅ BOQ routes loaded');
} catch (error) {
  console.error('❌ Error loading BOQ routes:', error.message);
}

try {
  console.log('🔄 Loading RFI routes...');
  const rfiRoutes = require('./routes/rfi');
  app.use('/api/rfi', authenticateToken, hasAnyPermission, rfiRoutes);
  console.log('✅ RFI routes loaded');
} catch (error) {
  console.error('❌ Error loading RFI routes:', error.message);
}

try {
  console.log('🔄 Loading LinkedIn Finder routes...');
  console.log('🔄 Attempting to require linkedinFinder...');
  const linkedInFinderRoutes = require('./routes/linkedinFinder');
  console.log('🔄 Routes loaded, type:', typeof linkedInFinderRoutes);
  console.log('🔄 Routes object keys:', Object.keys(linkedInFinderRoutes));
  // Use real LinkedIn Finder routes with authentication
  app.use('/api/linkedin-finder', authenticateToken, hasAnyPermission, linkedInFinderRoutes);
  console.log('✅ LinkedIn Finder routes loaded (with Mistral AI)');
} catch (error) {
  console.error('❌ Error loading LinkedIn Finder routes:', error.message);
  console.error('❌ Error stack:', error.stack);
}


const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔗 Test the server: http://localhost:${PORT}/api/health`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
