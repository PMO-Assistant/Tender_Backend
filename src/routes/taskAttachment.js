const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const { authenticateToken } = require('../middleware/auth');

const {
    upload: uploadHandler,
    uploadAttachment,
    getTaskAttachments,
    downloadAttachment,
    deleteAttachment,
    getTaskTimeline,
    addTimelineEntry: addTimelineEntryAPI,
    generateSASUrl
} = require('../controllers/task/taskAttachmentController');

// Apply authentication middleware to all routes
router.use(authenticateToken);

// Get task attachments
router.get('/:taskId/attachments', getTaskAttachments);

// Get task timeline
router.get('/:taskId/timeline', getTaskTimeline);

// Upload attachment
router.post('/:taskId/attachments', upload.single('file'), uploadAttachment);

// Download attachment
router.get('/:taskId/attachments/:attachmentId/download', downloadAttachment);

// Delete attachment
router.delete('/:taskId/attachments/:attachmentId', deleteAttachment);

// Add timeline entry
router.post('/:taskId/timeline', addTimelineEntryAPI);

// Generate SAS URL for Office Online Viewer
router.get('/:taskId/attachments/:attachmentId/sas-url', generateSASUrl);

module.exports = router; 
 
 