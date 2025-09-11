const { getConnectedPool } = require('../../config/database');

const fileCommentController = {
    // Get all file comments
    getAllComments: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            const result = await pool.request().query('SELECT * FROM tenderFileComment');
            res.json(result.recordset);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Get comment by ID
    getCommentById: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            const result = await pool.request()
                .input('FileCommentID', req.params.id)
                .query('SELECT * FROM tenderFileComment WHERE FileCommentID = @FileCommentID');

            if (result.recordset.length === 0) {
                return res.status(404).json({ message: 'Comment not found' });
            }

            res.json(result.recordset[0]);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Get comments by FileID
    getCommentsByFileId: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            const result = await pool.request()
                .input('FileID', req.params.fileId)
                .query(`
                    SELECT c.FileCommentID, c.CommentedBy, c.Comment, c.FileID, c.CreatedAt,
                           u.Name AS CommentedByName
                    FROM tenderFileComment c
                    LEFT JOIN tenderEmployee u ON u.UserID = c.CommentedBy
                    WHERE c.FileID = @FileID
                    ORDER BY c.CreatedAt DESC
                `);
            res.json({ comments: result.recordset });
        } catch (err) {
            console.error('Error getting comments by file:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Create a new comment
    createComment: async (req, res) => {
        try {
            const { Comment, FileID } = req.body;
            const authUserId = req.user?.UserID ? parseInt(req.user.UserID, 10) : null;
            const bodyUserId = req.body?.CommentedBy ? parseInt(req.body.CommentedBy, 10) : null;
            const CommentedBy = authUserId || bodyUserId || null;

            if (!Comment || !String(Comment).trim()) {
                return res.status(400).json({ message: 'Comment is required' });
            }
            const fileIdInt = parseInt(FileID, 10);
            if (!fileIdInt || Number.isNaN(fileIdInt)) {
                return res.status(400).json({ message: 'Valid FileID is required' });
            }

            const pool = await getConnectedPool();
            await pool.request()
                .input('CommentedBy', CommentedBy)
                .input('Comment', String(Comment).trim())
                .input('FileID', fileIdInt)
                .query(`
                    INSERT INTO tenderFileComment (CommentedBy, Comment, FileID, CreatedAt)
                    VALUES (@CommentedBy, @Comment, @FileID, GETDATE())
                `);

            res.status(201).json({ message: 'Comment added successfully' });
        } catch (err) {
            console.error('Error creating comment:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Update comment
    updateComment: async (req, res) => {
        try {
            const { CommentedBy, Comment, FileID } = req.body;

            const pool = await getConnectedPool();
            const result = await pool.request()
                .input('FileCommentID', req.params.id)
                .input('CommentedBy', CommentedBy)
                .input('Comment', Comment)
                .input('FileID', FileID)
                .query(`
                    UPDATE tenderFileComment
                    SET CommentedBy = @CommentedBy,
                        Comment = @Comment,
                        FileID = @FileID
                    WHERE FileCommentID = @FileCommentID
                `);

            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Comment not found' });
            }

            res.json({ message: 'Comment updated successfully' });
        } catch (err) {
            console.error('Error updating comment:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Delete comment
    deleteComment: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            const result = await pool.request()
                .input('FileCommentID', req.params.id)
                .query('DELETE FROM tenderFileComment WHERE FileCommentID = @FileCommentID');

            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Comment not found' });
            }

            res.json({ message: 'Comment deleted successfully' });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    }
};

module.exports = fileCommentController;
