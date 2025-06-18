const crypto = require('crypto');
const memoryStore = new Map(); // In-memory token store
const TOKEN_EXPIRY_MS = 3 * 60 * 1000; // 3 minutes

// Encode a token safely for URL (Base64URL format)
function base64urlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Periodically clear expired tokens
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of memoryStore.entries()) {
    if (value.expiresAt < now) {
      memoryStore.delete(key);
    }
  }
}, 60 * 1000);

const fileOpenerController = {
  generateOpenLink: async (req, res) => {
    try {
      const user = req.user; // Assumes MSAL token validated upstream (middleware)
      const { driveId, fileId, fileName } = req.body;

      if (!driveId || !fileId || !fileName) {
        return res.status(400).json({ message: 'Missing required fields' });
      }

      const rawToken = user.token; // original MS Graph token
      const tokenId = crypto.randomUUID(); // generate a unique ID

      // Store it temporarily in memory
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

  resolveToken: (tokenId) => {
    const entry = memoryStore.get(tokenId);
    if (!entry || entry.expiresAt < Date.now()) {
      return null;
    }
    return entry.token;
  }
};

module.exports = fileOpenerController;
