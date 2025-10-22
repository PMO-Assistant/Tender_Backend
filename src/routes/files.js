const express = require('express');
const router = express.Router();
const { fileController, upload } = require('../controllers/files/fileController');

// Get all folders
router.get('/folders', fileController.getAllFolders);

// Check table structure (no auth required)
router.get('/check-table-structure', fileController.checkTableStructure);

// Test database connectivity
router.get('/test-db', fileController.testDatabase);

// Test file upload
router.post('/test-upload', upload.single('file'), fileController.testFileUpload);

// Get files by folder ID
router.get('/folders/:folderId/files', fileController.getFilesByFolder);

// Ensure task folder exists (check and create if needed)
router.post('/ensure-task-folder', fileController.ensureTaskFolder);

// Ensure tender folder exists (check and create if needed) and return tender + subfolder IDs
router.post('/ensure-tender-folder', fileController.ensureTenderFolder);

// Create subfolder in tender folder
router.post('/folders/:parentFolderId/subfolder', fileController.createSubfolder);

// Delete folder (only user-created folders)
router.delete('/folders/:folderId', fileController.deleteFolder);

// Get files by document ID and connection table
router.get('/document/:connectionTable/:docId', fileController.getFilesByDocument);

// Get all files for the authenticated user
router.get('/', fileController.getAllFiles);

// New search endpoint (must be before /:fileId route)
router.get('/search', fileController.searchFiles);

// Search with custom filter endpoint
router.post('/search-filter', fileController.searchFilesWithFilter);

// Get file by ID
router.get('/:fileId', fileController.getFileById);

// Get file metadata by ID
router.get('/:fileId/metadata', fileController.getFileMetadata);

// Upload file
router.post('/upload', upload.single('file'), fileController.uploadFile);

// Download file
router.get('/:fileId/download', fileController.downloadFile);

// Update file name
router.put('/:fileId/name', fileController.updateFileName);

// Generate SAS URL for file viewing (for Excel files)
router.get('/:fileId/sas-url', fileController.generateFileSASUrl);

// Delete file
router.delete('/:fileId', fileController.deleteFile);

// Get file preview URL
router.get('/:fileId/preview', fileController.getFilePreviewUrl);
