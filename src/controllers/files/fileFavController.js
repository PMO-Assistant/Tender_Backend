const { getConnectedPool } = require('../../config/database');

const fileFavController = {
    // Add file to favorites
    addToFavorites: async (req, res) => {
        try {
            const { fileId } = req.params;
            const userId = req.user.UserID;

            const pool = await getConnectedPool();

            // Check if already favorited
            const existingResult = await pool.request()
                .input('UserID', userId)
                .input('FileID', fileId)
                .query(`
                    SELECT FileFavID 
                    FROM tenderFileFav 
                    WHERE UserID = @UserID AND FileID = @FileID
                `);

            if (existingResult.recordset.length > 0) {
                return res.status(400).json({ message: 'File is already in favorites' });
            }

            // Add to favorites
            await pool.request()
                .input('UserID', userId)
                .input('FileID', fileId)
                .query(`
                    INSERT INTO tenderFileFav (UserID, FileID)
                    VALUES (@UserID, @FileID)
                `);

            res.json({ message: 'File added to favorites successfully' });
        } catch (error) {
            console.error('Error adding file to favorites:', error);
            res.status(500).json({ message: 'Failed to add file to favorites' });
        }
    },

    // Remove file from favorites
    removeFromFavorites: async (req, res) => {
        try {
            const { fileId } = req.params;
            const userId = req.user.UserID;

            const pool = await getConnectedPool();

            const result = await pool.request()
                .input('UserID', userId)
                .input('FileID', fileId)
                .query(`
                    DELETE FROM tenderFileFav 
                    WHERE UserID = @UserID AND FileID = @FileID;
                    
                    SELECT @@ROWCOUNT as DeletedRows;
                `);

            if (result.recordset[0].DeletedRows === 0) {
                return res.status(404).json({ message: 'File not found in favorites' });
            }

            res.json({ message: 'File removed from favorites successfully' });
        } catch (error) {
            console.error('Error removing file from favorites:', error);
            res.status(500).json({ message: 'Failed to remove file from favorites' });
        }
    },

    // Get user's favorite files
    getFavoriteFiles: async (req, res) => {
        try {
            const userId = req.user.UserID;

            const pool = await getConnectedPool();

            const result = await pool.request()
                .input('UserID', userId)
                .query(`
                    SELECT 
                        f.FileID,
                        f.DisplayName,
                        f.ContentType,
                        f.Size,
                        f.UploadedOn,
                        f.CreatedAt,
                        f.UpdatedAt,
                        f.DocID,
                        f.ConnectionTable,
                        u.Name as UploadedBy,
                        tf.FolderID,
                        tf.FolderName,
                        tf.FolderPath,
                        ff.FileFavID
                    FROM tenderFileFav ff
                    INNER JOIN tenderFile f ON ff.FileID = f.FileID
                    LEFT JOIN tenderEmployee u ON f.AddBy = u.UserID
                    LEFT JOIN tenderFolder tf ON f.FolderID = tf.FolderID
                    WHERE ff.UserID = @UserID 
                      AND f.IsDeleted = 0
                    ORDER BY ff.FileFavID DESC
                `);

            const files = result.recordset.map(file => ({
                id: file.FileID,
                name: file.DisplayName,
                contentType: file.ContentType,
                size: file.Size,
                uploadedOn: file.UploadedOn,
                createdAt: file.CreatedAt,
                updatedAt: file.UpdatedAt,
                uploadedBy: file.UploadedBy,
                folderId: file.FolderID,
                folderName: file.FolderName,
                folderPath: file.FolderPath,
                docId: file.DocID,
                connectionTable: file.ConnectionTable,
                isStarred: true, // Since these are from favorites
                type: getFileType(file.ContentType, file.DisplayName)
            }));

            res.json({ files });
        } catch (error) {
            console.error('Error getting favorite files:', error);
            res.status(500).json({ message: 'Failed to get favorite files' });
        }
    },

    // Check if file is favorited by user
    checkFavoriteStatus: async (req, res) => {
        try {
            const { fileId } = req.params;
            const userId = req.user.UserID;

            const pool = await getConnectedPool();

            const result = await pool.request()
                .input('UserID', userId)
                .input('FileID', fileId)
                .query(`
                    SELECT FileFavID 
                    FROM tenderFileFav 
                    WHERE UserID = @UserID AND FileID = @FileID
                `);

            const isFavorited = result.recordset.length > 0;

            res.json({ isFavorited });
        } catch (error) {
            console.error('Error checking favorite status:', error);
            res.status(500).json({ message: 'Failed to check favorite status' });
        }
    }
};

// Helper function to determine file type
function getFileType(contentType, fileName) {
    const extension = require('path').extname(fileName).toLowerCase();
    
    if (contentType.startsWith('image/')) return 'image';
    if (contentType.startsWith('video/')) return 'video';
    if (contentType.startsWith('audio/')) return 'audio';
    if (contentType.includes('pdf')) return 'pdf';
    if (contentType.includes('excel') || extension === '.xlsx' || extension === '.xls') return 'excel';
    if (contentType.includes('powerpoint') || extension === '.pptx' || extension === '.ppt') return 'powerpoint';
    if (contentType.includes('word') || extension === '.docx' || extension === '.doc') return 'word';
    if (extension === '.zip' || extension === '.rar' || extension === '.7z') return 'archive';
    
    return 'file';
}

module.exports = {
    fileFavController
}; 