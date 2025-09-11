const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
require('dotenv').config();

const account = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;

const sharedKeyCredential = new StorageSharedKeyCredential(account, accountKey);
const blobServiceClient = new BlobServiceClient(
    `https://${account}.blob.core.windows.net`,
    sharedKeyCredential
);

const containerClient = blobServiceClient.getContainerClient(containerName);

// List files (optionally by prefix)
exports.listFiles = async (req, res) => {
    try {
        const prefix = req.query.prefix || '';
        const iter = containerClient.listBlobsFlat({ prefix });
        const files = [];

        for await (const blob of iter) {
            files.push({
                name: blob.name,
                size: blob.properties.contentLength,
                type: blob.properties.blobType,
                lastModified: blob.properties.lastModified
            });
        }

        res.json(files);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Upload file
exports.uploadFile = async (req, res) => {
    try {
        const { folder } = req.body;
        const { originalname, buffer, mimetype } = req.file;

        const blobName = folder ? `${folder}/${originalname}` : originalname;
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);
        await blockBlobClient.uploadData(buffer, {
            blobHTTPHeaders: { blobContentType: mimetype },
        });

        res.json({ message: 'File uploaded successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Delete file
exports.deleteFile = async (req, res) => {
    try {
        const { name } = req.params;
        const blockBlobClient = containerClient.getBlockBlobClient(name);
        await blockBlobClient.deleteIfExists();
        res.json({ message: 'File deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Rename (copy + delete)
exports.renameFile = async (req, res) => {
    try {
        const { oldName, newName } = req.body;

        const sourceBlob = containerClient.getBlockBlobClient(oldName);
        const destBlob = containerClient.getBlockBlobClient(newName);

        const copyResult = await destBlob.beginCopyFromURL(sourceBlob.url);
        await sourceBlob.delete();

        res.json({ message: 'File renamed successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Move (same logic as rename, different folder)
exports.moveFile = async (req, res) => {
    try {
        const { currentPath, newPath } = req.body;

        const sourceBlob = containerClient.getBlockBlobClient(currentPath);
        const destBlob = containerClient.getBlockBlobClient(newPath);

        await destBlob.beginCopyFromURL(sourceBlob.url);
        await sourceBlob.delete();

        res.json({ message: 'File moved successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
