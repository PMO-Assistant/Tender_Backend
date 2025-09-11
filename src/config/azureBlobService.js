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

// Upload file
async function uploadFile(fileName, buffer, mimeType) {
    const blockBlobClient = containerClient.getBlockBlobClient(fileName);
    const uploadBlobResponse = await blockBlobClient.uploadData(buffer, {
        blobHTTPHeaders: { blobContentType: mimeType },
    });
    return uploadBlobResponse;
}

// Download file
async function downloadFile(fileName) {
    const blockBlobClient = containerClient.getBlockBlobClient(fileName);
    const downloadBlockBlobResponse = await blockBlobClient.download();
    return downloadBlockBlobResponse.readableStreamBody;
}

// Delete file
async function deleteFile(fileName) {
    const blockBlobClient = containerClient.getBlockBlobClient(fileName);
    await blockBlobClient.deleteIfExists();
}

// Delete folder (delete all blobs with the folder prefix)
async function deleteFolder(folderPath) {
    try {
        // Ensure folder path ends with '/' for proper prefix matching
        const normalizedFolderPath = folderPath.endsWith('/') ? folderPath : folderPath + '/';
        
        // List all blobs with the folder prefix
        const listOptions = {
            prefix: normalizedFolderPath
        };
        
        const blobs = [];
        for await (const blob of containerClient.listBlobsFlat(listOptions)) {
            blobs.push(blob.name);
        }
        
        console.log(`Found ${blobs.length} blobs to delete in folder: ${normalizedFolderPath}`);
        
        // Delete all blobs in the folder
        for (const blobName of blobs) {
            try {
                const blockBlobClient = containerClient.getBlockBlobClient(blobName);
                await blockBlobClient.deleteIfExists();
                console.log(`Deleted blob: ${blobName}`);
            } catch (blobError) {
                console.error(`Failed to delete blob ${blobName}:`, blobError);
                // Continue with other blobs even if one fails
            }
        }
        
        console.log(`Folder deletion completed: ${normalizedFolderPath}`);
        return { success: true, deletedCount: blobs.length };
    } catch (error) {
        console.error(`Error deleting folder ${folderPath}:`, error);
        throw error;
    }
}

module.exports = {
    uploadFile,
    downloadFile,
    deleteFile,
    deleteFolder
};


