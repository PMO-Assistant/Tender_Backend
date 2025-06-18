const crypto = require('crypto');
const memoryStore = new Map(); // In-memory token store
const TOKEN_EXPIRY_MS = 3 * 60 * 1000; // 3 minutes

// Periodically clear expired tokens
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of memoryStore.entries()) {
    if (value.expiresAt < now) {
      memoryStore.delete(key);
    }
  }
}, 60 * 1000);

// Encode a token safely for URL (Base64URL format)
function base64urlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const fileOpenerController = {
  // ✅ Health check
  health: (req, res) => {
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      inMemoryTokens: memoryStore.size
    });
  },

  // ✅ Generate a temporary open link for the Electron app
  generateOpenLink: async (req, res) => {
    try {
      const user = req.user || {}; // optional fallback if no auth middleware
      const { driveId, fileId, fileName, token } = req.body;

      if (!driveId || !fileId || !fileName || (!user.token && !token)) {
        return res.status(400).json({ message: 'Missing required fields' });
      }

      const rawToken = user.token || token;
      const tokenId = crypto.randomUUID();

      memoryStore.set(tokenId, {
        token: rawToken,
        expiresAt: Date.now() + TOKEN_EXPIRY_MS
      });

      const safeFileName = encodeURIComponent(fileName);
      const openLink = `myapp://${driveId}:${fileId}:${safeFileName}:${tokenId}`;

      return res.status(200).json({ openLink });
    } catch (err) {
      console.error('Error generating open link:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  },

  // ✅ Generate only the token ID (if needed independently)
  createAccessCode: (req, res) => {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: 'Token missing' });
    }

    const tokenId = crypto.randomUUID();

    memoryStore.set(tokenId, {
      token,
      expiresAt: Date.now() + TOKEN_EXPIRY_MS
    });

    return res.status(201).json({ tokenId });
  },

  // ✅ Get the token from a tokenId
  resolveAccessCode: (req, res) => {
    const { tokenId } = req.query;

    if (!tokenId) {
      return res.status(400).json({ message: 'tokenId is required' });
    }

    const tokenEntry = memoryStore.get(tokenId);
    if (!tokenEntry || tokenEntry.expiresAt < Date.now()) {
      return res.status(404).json({ message: 'Token not found or expired' });
    }

    return res.status(200).json({
      token: tokenEntry.token,
      expiresAt: tokenEntry.expiresAt
    });
  },

  // ✅ Utility for internal lookup (used in validate route)
  resolveToken: (tokenId) => {
    const entry = memoryStore.get(tokenId);
    if (!entry || entry.expiresAt < Date.now()) {
      return null;
    }
    return entry.token;
  }
};

module.exports = fileOpenerController;
