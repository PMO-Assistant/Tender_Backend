const express = require('express');
const router = express.Router();
const fileOpenerController = require('../controllers/fileOpenerController');

// Health check endpoint
router.get('/health', fileOpenerController.health);

// Route to create a new file access code
router.post('/access-code', fileOpenerController.createAccessCode);

// Route to resolve/validate an access code
router.get('/resolve', fileOpenerController.resolveAccessCode);

// Generate a temporary open link for a file
router.post('/generate-link', fileOpenerController.generateOpenLink);

// Utility endpoint to check if token exists and is valid
router.get('/validate/:tokenId', (req, res) => {
    const token = fileOpenerController.resolveToken(req.params.tokenId);
    if (!token) {
        return res.status(404).json({ message: 'Token not found or expired' });
    }
    res.status(200).json({ valid: true });
});

module.exports = router; 