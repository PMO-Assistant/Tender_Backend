const { getConnectedPool } = require('../../config/database');
const { uploadFile, downloadFile, deleteFile } = require('../../config/azureBlobService');
const { BlobServiceClient } = require('@azure/storage-blob');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { StorageSharedKeyCredential } = require('@azure/storage-blob');

// Helper function to ensure notification table exists
async function ensureNotificationTable(pool) {
  try {
    // Check if table exists
    const tableCheck = await pool.request().query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_NAME = 'tenderNotification'
    `);
    
    if (tableCheck.recordset.length === 0) {
      console.log('[ATTACHMENT NOTIFICATION] tenderNotification table does not exist, creating it...');
      
      // Create the table
      await pool.request().query(`
        CREATE TABLE tenderNotification (
          NotificationID INT IDENTITY(1,1) PRIMARY KEY,
          UserID INT NOT NULL,
          Notification NVARCHAR(500) NOT NULL,
          Type NVARCHAR(100) NOT NULL,
          Status INT DEFAULT 0,
          CreatedAt DATETIME DEFAULT GETDATE(),
          Link NVARCHAR(500) DEFAULT '/tasks',
          FOREIGN KEY (UserID) REFERENCES tenderEmployee(UserID)
        )
      `);
      
      console.log('[ATTACHMENT NOTIFICATION] tenderNotification table created successfully');
    } else {
      console.log('[ATTACHMENT NOTIFICATION] tenderNotification table already exists');
    }
  } catch (error) {
    console.error('[ATTACHMENT NOTIFICATION] Error ensuring notification table:', error);
  }
}

// Helper function to send notifications for task changes
async function sendTaskNotification(pool, taskId, userId, notificationText, type, link = '/tasks') {
  try {
    console.log(`[ATTACHMENT NOTIFICATION] Sending ${type} notification for task ${taskId} from user ${userId}`)
    console.log(`[ATTACHMENT NOTIFICATION] Text: ${notificationText}`)
    console.log(`[ATTACHMENT NOTIFICATION] Link: ${link}`)
    
    // Ensure notification table exists
    await ensureNotificationTable(pool);
    
    // Get the user making the change
    const userResult = await pool.request()
      .input('UserID', userId)
      .query('SELECT Name FROM tenderEmployee WHERE tenderEmployee.UserID = @UserID');
    
    const userName = userResult.recordset[0]?.Name || 'Someone';
    console.log(`[ATTACHMENT NOTIFICATION] User name: ${userName}`)
    
    // Get task details to find all users to notify
    const taskResult = await pool.request()
      .input('TaskID', taskId)
      .query('SELECT AddBy FROM tenderTask WHERE TaskID = @TaskID');
    
    if (taskResult.recordset.length === 0) {
      console.log(`[ATTACHMENT NOTIFICATION] Task ${taskId} not found, skipping notification`)
      return;
    }
    
    const task = taskResult.recordset[0];
    console.log(`[ATTACHMENT NOTIFICATION] Task creator: AddBy=${task.AddBy}`)
    
    // Get assignees from new table
    const assigneesResult = await pool.request()
      .input('TaskID', taskId)
      .query('SELECT UserID FROM tenderTaskAssignee WHERE TaskID = @TaskID');
    
    console.log(`[ATTACHMENT NOTIFICATION] Found ${assigneesResult.recordset.length} assignees for task ${taskId}`)
    
    // Collect all users to notify (creator + assignees)
    const usersToNotify = [task.AddBy];
    assigneesResult.recordset.forEach(row => {
      if (row.UserID && !usersToNotify.includes(row.UserID)) {
        usersToNotify.push(row.UserID);
      }
    });
    
    // Remove duplicates but keep the updater (so they see a record of their action)
    const uniqueUsers = [...new Set(usersToNotify)].filter(id => id !== null);
    console.log(`[ATTACHMENT NOTIFICATION] Users to notify: ${uniqueUsers.join(', ')}`)
    
    if (uniqueUsers.length > 0) {
      // Replace {userName} placeholder in notification text
      const finalNotificationText = notificationText.replace('{userName}', userName);
      console.log(`[ATTACHMENT NOTIFICATION] Final text: ${finalNotificationText}`)
      
      for (const notifyUserId of uniqueUsers) {
        try {
          console.log(`[ATTACHMENT NOTIFICATION] Creating notification for user ${notifyUserId}`)
          const insertResult = await pool.request()
            .input('UserID', notifyUserId)
            .input('Notification', finalNotificationText)
            .input('Type', type)
            .input('Status', 0) // Unread
            .input('Link', link)
            .query(`
              INSERT INTO tenderNotification (UserID, Notification, Type, Status, CreatedAt, Link)
              VALUES (@UserID, @Notification, @Type, @Status, GETDATE(), @Link)
            `);
          console.log(`[ATTACHMENT NOTIFICATION] Notification created successfully for user ${notifyUserId}, result:`, insertResult)
        } catch (insertError) {
          console.error(`[ATTACHMENT NOTIFICATION] Failed to create notification for user ${notifyUserId}:`, insertError)
        }
      }
      console.log(`[ATTACHMENT NOTIFICATION] All notifications sent successfully`)
    } else {
      console.log(`[ATTACHMENT NOTIFICATION] No users to notify`)
    }
  } catch (notificationError) {
    console.error('Error sending task notification:', notificationError);
    console.error('Error stack:', notificationError.stack);
    // Don't fail the main operation if notifications fail
  }
}

// Configure multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        // Allow common file types
        const allowedTypes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/plain', 'text/csv', 'application/zip', 'application/x-zip-compressed'
        ];
        
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'), false);
        }
    }
});

// Add timeline entry
async function addTimelineEntry(taskId, userId, type, content) {
    const pool = await getConnectedPool();
    await pool.request()
        .input('TaskID', taskId)
        .input('AddBy', userId)
        .input('Type', type)
        .input('Content', content)
        .query(`
            INSERT INTO tenderTaskTimeline (TaskID, AddBy, Type, Content)
            VALUES (@TaskID, @AddBy, @Type, @Content)
        `);
}

// Upload attachment
async function uploadAttachment(req, res) {
    try {
        const { taskId } = req.params;
        const userId = req.user.UserID;

        console.log('Uploading attachment for task:', taskId, 'user:', userId);

        if (!req.file) {
            return res.status(400).json({
                error: 'No file provided',
                message: 'Please select a file to upload'
            });
        }

        console.log('File received:', req.file.originalname, 'size:', req.file.size);

        const pool = await getConnectedPool();

        // Check if task exists and user has access, and get task description
        const taskCheck = await pool.request()
            .input('TaskID', taskId)
            .input('UserID', userId)
            .query(`
                SELECT TaskID, Description FROM tenderTask
                WHERE TaskID = @TaskID
                  AND (AddBy = @UserID OR TaskID IN (
                    SELECT TaskID FROM tenderTaskAssignee WHERE UserID = @UserID
                  ))
            `);

        console.log('Task check result:', taskCheck.recordset.length, 'records');

        if (taskCheck.recordset.length === 0) {
            return res.status(404).json({
                error: 'Task not found',
                message: 'Task does not exist or you do not have permission to upload attachments'
            });
        }

        const task = taskCheck.recordset[0];
        const taskDescription = task.Description || `Task ${taskId}`;

        // Ensure task folder exists (will create it if it doesn't)
        let folderId = 13; // fallback default
        try {
            // Get the Tasks folder ID first
            const tasksFolderResult = await pool.request()
                .query(`
                    SELECT FolderID 
                    FROM tenderFolder 
                    WHERE FolderName = 'Tasks' AND FolderType = 'main'
                `);

            if (tasksFolderResult.recordset.length > 0) {
                const tasksFolderId = tasksFolderResult.recordset[0].FolderID;
                const taskFolderName = `${taskId} - ${taskDescription}`;

                // Check if folder exists
                const existingFolderResult = await pool.request()
                    .input('DocID', parseInt(taskId))
                    .input('ConnectionTable', 'tenderTask')
                    .input('ParentFolderID', tasksFolderId)
                    .query(`
                        SELECT FolderID, FolderPath, FolderName
                        FROM tenderFolder
                        WHERE DocID = @DocID 
                          AND ConnectionTable = @ConnectionTable 
                          AND ParentFolderID = @ParentFolderID
                    `);

                if (existingFolderResult.recordset.length > 0) {
                    // Folder exists, use it
                    folderId = existingFolderResult.recordset[0].FolderID;
                    console.log('Using existing task folder ID:', folderId);
                } else {
                    // Folder doesn't exist, create it
                    const taskFolderPath = `/Tasks/${taskFolderName}`;
                    const insertResult = await pool.request()
                        .input('FolderName', taskFolderName)
                        .input('FolderPath', taskFolderPath)
                        .input('FolderType', 'sub')
                        .input('ParentFolderID', tasksFolderId)
                        .input('AddBy', userId)
                        .input('DocID', parseInt(taskId))
                        .input('ConnectionTable', 'tenderTask')
                        .query(`
                            INSERT INTO tenderFolder (FolderName, FolderPath, FolderType, ParentFolderID, AddBy, DocID, ConnectionTable)
                            OUTPUT INSERTED.FolderID
                            VALUES (@FolderName, @FolderPath, @FolderType, @ParentFolderID, @AddBy, @DocID, @ConnectionTable)
                        `);

                    folderId = insertResult.recordset[0].FolderID;
                    console.log('Created new task folder with ID:', folderId);
                }
            }
        } catch (folderError) {
            console.warn('Could not ensure task folder, using default folder ID 13:', folderError);
            // Continue with default folder ID
        }

        // Generate filename with proper virtual folder structure
        const originalName = req.file.originalname;
        const fileName = `tasks/${taskId}/ATTACHMENTS/${originalName}`;

        console.log('Uploading to Azure with filename:', fileName);

        // Upload to Azure Blob Storage
        await uploadFile(fileName, req.file.buffer, req.file.mimetype);

        console.log('File uploaded to Azure successfully');

        // Save attachment info to database
        const result = await pool.request()
            .input('TaskID', taskId)
            .input('BlobPath', fileName)
            .input('DisplayName', originalName)
            .input('Size', req.file.size)
            .input('ContentType', req.file.mimetype)
            .input('AddBy', userId)
            .input('FolderID', folderId) // Use the folder ID from ensureTaskFolder
            .input('DocID', taskId)
            .input('ConnectionTable', 'tenderTask')
            .query(`
                INSERT INTO tenderFile (BlobPath, DisplayName, Size, ContentType, AddBy, FolderID, DocID, ConnectionTable, UploadedOn, CreatedAt, Status, IsDeleted)
                OUTPUT INSERTED.FileID
                VALUES (@BlobPath, @DisplayName, @Size, @ContentType, @AddBy, @FolderID, @DocID, @ConnectionTable, SYSDATETIME(), SYSDATETIME(), 1, 0)
            `);

        const fileId = result.recordset[0].FileID;

        console.log('File saved to database with ID:', fileId);

        // Add timeline entry
        await addTimelineEntry(taskId, userId, 'attachment_added', 
            `Added attachment: ${originalName}`);

        // Send notifications about attachment upload
        await sendTaskNotification(pool, taskId, userId, 
            `{userName} uploaded an attachment: ${originalName}`, 'task_attachment_added', '/tasks');

        res.status(201).json({
            success: true,
            message: 'Attachment uploaded successfully',
            attachment: {
                id: fileId,
                fileName: fileName,
                originalName: originalName,
                fileSize: req.file.size,
                mimeType: req.file.mimetype,
                uploadedBy: userId
            }
        });

    } catch (error) {
        console.error('Error uploading attachment:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to upload attachment'
        });
    }
}

// Get task attachments
async function getTaskAttachments(req, res) {
    try {
        const { taskId } = req.params;
        const userId = req.user.UserID;

        console.log('Getting attachments for task:', taskId, 'user:', userId);

        const pool = await getConnectedPool();

        // First, let's check what columns are actually available in the tenderFile table
        try {
            const structureResult = await pool.request().query(`
                SELECT COLUMN_NAME, DATA_TYPE 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME = 'tenderFile' 
                ORDER BY ORDINAL_POSITION
            `);
            console.log('tenderFile table structure:', structureResult.recordset);
        } catch (error) {
            console.log('Could not check table structure:', error.message);
        }

        // Check if task exists and user has access
        const taskCheck = await pool.request()
            .input('TaskID', taskId)
            .input('UserID', userId)
            .query(`
                SELECT TaskID FROM tenderTask
                WHERE TaskID = @TaskID
                  AND (AddBy = @UserID OR TaskID IN (
                    SELECT TaskID FROM tenderTaskAssignee WHERE UserID = @UserID
                  ))
            `);

        console.log('Task check result:', taskCheck.recordset.length, 'records');

        if (taskCheck.recordset.length === 0) {
            return res.status(404).json({
                error: 'Task not found',
                message: 'Task does not exist or you do not have permission to view attachments'
            });
        }

        // Get attachments with uploader info
        const result = await pool.request()
            .input('TaskID', taskId)
            .query(`
                SELECT 
                    f.FileID,
                    f.BlobPath,
                    f.DisplayName,
                    f.Size,
                    f.ContentType,
                    f.UploadedOn,
                    f.CreatedAt,
                    f.AddBy,
                    e.Name as UploaderName,
                    e.Email as UploaderEmail
                FROM tenderFile f
                LEFT JOIN tenderEmployee e ON f.AddBy = e.UserID
                WHERE f.DocID = @TaskID 
                  AND f.ConnectionTable = 'tenderTask'
                  AND f.IsDeleted = 0
                ORDER BY f.CreatedAt DESC
            `);

        console.log('Attachments found:', result.recordset.length);
        if (result.recordset.length > 0) {
            console.log('First attachment record:', result.recordset[0]);
            console.log('Available columns:', Object.keys(result.recordset[0]));
        }

        const attachments = result.recordset.map(row => ({
            id: row.FileID,
            fileName: row.BlobPath,
            originalName: row.DisplayName,
            fileSize: row.Size,
            mimeType: row.ContentType,
            uploadedBy: row.AddBy,
            uploaderName: row.UploaderName,
            uploaderEmail: row.UploaderEmail,
            createdAt: row.CreatedAt || row.UploadedOn
        }));

        res.json({ attachments });

    } catch (error) {
        console.error('Error getting task attachments:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to get task attachments'
        });
    }
}

// Download attachment
async function downloadAttachment(req, res) {
    try {
        const { taskId, attachmentId } = req.params;
        const userId = req.user.UserID;

        const pool = await getConnectedPool();

        // Check if task exists and user has access
        const taskCheck = await pool.request()
            .input('TaskID', taskId)
            .input('UserID', userId)
            .query(`
                SELECT TaskID FROM tenderTask
                WHERE TaskID = @TaskID
                  AND (AddBy = @UserID OR TaskID IN (
                    SELECT TaskID FROM tenderTaskAssignee WHERE UserID = @UserID
                  ))
            `);

        if (taskCheck.recordset.length === 0) {
            return res.status(404).json({
                error: 'Task not found',
                message: 'Task does not exist or you do not have permission to download attachments'
            });
        }

        // Get attachment info
        const attachmentResult = await pool.request()
            .input('FileID', attachmentId)
            .input('TaskID', taskId)
            .query(`
                SELECT BlobPath, DisplayName, ContentType, AddBy
                FROM tenderFile
                WHERE FileID = @FileID 
                  AND DocID = @TaskID 
                  AND ConnectionTable = 'tenderTask'
                  AND IsDeleted = 0
            `);

        if (attachmentResult.recordset.length === 0) {
            return res.status(404).json({
                error: 'Attachment not found',
                message: 'Attachment does not exist'
            });
        }

        const attachment = attachmentResult.recordset[0];

        // Download from Azure Blob Storage
        const stream = await downloadFile(attachment.BlobPath);

        // Set response headers
        res.setHeader('Content-Type', attachment.ContentType);
        res.setHeader('Content-Disposition', `attachment; filename="${attachment.DisplayName}"`);

        // Pipe the stream to response
        stream.pipe(res);

    } catch (error) {
        console.error('Error downloading attachment:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to download attachment'
        });
    }
}

// Delete attachment
async function deleteAttachment(req, res) {
    try {
        const { taskId, attachmentId } = req.params;
        const userId = req.user.UserID;

        const pool = await getConnectedPool();

        // Check if task exists and user has access
        const taskCheck = await pool.request()
            .input('TaskID', taskId)
            .input('UserID', userId)
            .query(`
                SELECT TaskID FROM tenderTask
                WHERE TaskID = @TaskID
                  AND (AddBy = @UserID OR TaskID IN (
                    SELECT TaskID FROM tenderTaskAssignee WHERE UserID = @UserID
                  ))
            `);

        if (taskCheck.recordset.length === 0) {
            return res.status(404).json({
                error: 'Task not found',
                message: 'Task does not exist or you do not have permission to delete attachments'
            });
        }

        // Get attachment info
        const attachmentResult = await pool.request()
            .input('FileID', attachmentId)
            .input('TaskID', taskId)
            .query(`
                SELECT BlobPath, DisplayName
                FROM tenderFile
                WHERE FileID = @FileID 
                  AND DocID = @TaskID 
                  AND ConnectionTable = 'tenderTask'
                  AND IsDeleted = 0
            `);

        if (attachmentResult.recordset.length === 0) {
            return res.status(404).json({
                error: 'Attachment not found',
                message: 'Attachment does not exist'
            });
        }

        const attachment = attachmentResult.recordset[0];

        // Delete from Azure Blob Storage
        await deleteFile(attachment.BlobPath);

        // Soft delete from database
        await pool.request()
            .input('FileID', attachmentId)
            .query(`
                UPDATE tenderFile
                SET IsDeleted = 1, DeletedAt = SYSDATETIME()
                WHERE FileID = @FileID
            `);

        // Add timeline entry
        await addTimelineEntry(taskId, userId, 'attachment_deleted', 
            `Deleted attachment: ${attachment.DisplayName}`);

        // Send notifications about attachment deletion
        await sendTaskNotification(pool, taskId, userId, 
            `{userName} deleted an attachment: ${attachment.DisplayName}`, 'task_attachment_deleted', '/tasks');

        res.json({
            success: true,
            message: 'Attachment deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting attachment:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to delete attachment'
        });
    }
}

// Get task timeline
async function getTaskTimeline(req, res) {
    try {
        const { taskId } = req.params;
        const userId = req.user.UserID;

        const pool = await getConnectedPool();

        // Check if task exists and user has access
        const taskCheck = await pool.request()
            .input('TaskID', taskId)
            .input('UserID', userId)
            .query(`
                SELECT TaskID FROM tenderTask
                WHERE TaskID = @TaskID
                  AND (AddBy = @UserID OR TaskID IN (
                    SELECT TaskID FROM tenderTaskAssignee WHERE UserID = @UserID
                  ))
            `);

        if (taskCheck.recordset.length === 0) {
            return res.status(404).json({
                error: 'Task not found',
                message: 'Task does not exist or you do not have permission to view timeline'
            });
        }

        // Get timeline entries
        const result = await pool.request()
            .input('TaskID', taskId)
            .query(`
                SELECT 
                    t.TimelineID,
                    t.CreatedAt,
                    t.Type,
                    t.Content,
                    t.AddBy,
                    e.Name as UserName,
                    e.Email as UserEmail
                FROM tenderTaskTimeline t
                LEFT JOIN tenderEmployee e ON t.AddBy = e.UserID
                WHERE t.TaskID = @TaskID
                ORDER BY t.CreatedAt DESC
            `);

        const timeline = result.recordset.map(row => ({
            id: row.TimelineID,
            createdAt: row.CreatedAt,
            type: row.Type,
            content: row.Content,
            addBy: row.AddBy,
            userName: row.UserName,
            userEmail: row.UserEmail
        }));

        res.json({ timeline });

    } catch (error) {
        console.error('Error getting task timeline:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to get task timeline'
        });
    }
}

// Add timeline entry
async function addTimelineEntryAPI(req, res) {
    try {
        const { taskId } = req.params;
        const userId = req.user.UserID;
        const { type, content, contactName, contactEmail, contactPhone } = req.body;

        if (!type || !content) {
            return res.status(400).json({
                error: 'Missing required fields',
                message: 'Type and content are required'
            });
        }

        const pool = await getConnectedPool();

        // Check if task exists and user has access
        const taskCheck = await pool.request()
            .input('TaskID', taskId)
            .input('UserID', userId)
            .query(`
                SELECT TaskID FROM tenderTask
                WHERE TaskID = @TaskID
                  AND (AddBy = @UserID OR TaskID IN (
                    SELECT TaskID FROM tenderTaskAssignee WHERE UserID = @UserID
                  ))
            `);

        if (taskCheck.recordset.length === 0) {
            return res.status(404).json({
                error: 'Task not found',
                message: 'Task does not exist or you do not have permission to add timeline entries'
            });
        }

        // Add timeline entry
        await addTimelineEntry(taskId, userId, type, content);

        // Send notifications based on timeline entry type
        let notificationText = '';
        let notificationType = 'task_timeline_update';
        
        switch (type) {
          case 'comment':
            notificationText = `{userName} added a comment to the task`;
            notificationType = 'task_comment_added';
            break;
          case 'contact_added':
            notificationText = `{userName} added a contact to the task`;
            notificationType = 'task_contact_added';
            break;
          case 'status_changed':
            notificationText = `{userName} updated task status`;
            notificationType = 'task_status_update';
            break;
          default:
            notificationText = `{userName} updated the task`;
            notificationType = 'task_timeline_update';
        }
        
        await sendTaskNotification(pool, taskId, userId, notificationText, notificationType, `/tasks/${taskId}`);

        res.status(201).json({
            success: true,
            message: 'Timeline entry added successfully'
        });

    } catch (error) {
        console.error('Error adding timeline entry:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to add timeline entry'
        });
    }
}

// Generate SAS URL for Office Online Viewer
async function generateSASUrl(req, res) {
    try {
        const { taskId, attachmentId } = req.params;
        const userId = req.user.UserID;

        console.log('generateSASUrl called with:', { taskId, attachmentId, userId });

        // First, get the attachment details from database
        const pool = await getConnectedPool();
        const attachmentResult = await pool.request()
            .input('attachmentId', attachmentId)
            .input('taskId', taskId)
            .input('userId', userId)
            .query(`
                SELECT tta.FileName, tta.OriginalName, tta.MimeType
                FROM tenderTaskAttachment tta
                INNER JOIN tenderTask tt ON tta.TaskID = tt.TaskID
                WHERE tta.AttachmentID = @attachmentId 
                AND tta.TaskID = @taskId
                AND (tt.AddBy = @userId OR tt.TaskID IN (
                  SELECT TaskID FROM tenderTaskAssignee WHERE UserID = @userId
                ))
            `);

        console.log('Database query result:', attachmentResult.recordset.length, 'records');

        if (attachmentResult.recordset.length === 0) {
            console.log('No attachment found or access denied');
            return res.status(404).json({ error: 'Attachment not found or access denied' });
        }

        const attachment = attachmentResult.recordset[0];
        console.log('Attachment found:', attachment);
        
        // Check if it's an Excel file
        const isExcelFile = attachment.MimeType.includes('spreadsheet') || 
                           attachment.MimeType.includes('excel') ||
                           attachment.OriginalName.toLowerCase().endsWith('.xlsx') ||
                           attachment.OriginalName.toLowerCase().endsWith('.xls');

        console.log('Is Excel file:', isExcelFile, 'MimeType:', attachment.MimeType, 'OriginalName:', attachment.OriginalName);

        if (!isExcelFile) {
            return res.status(400).json({ error: 'File is not an Excel file' });
        }

        // Generate SAS URL for the blob
        const account = process.env.AZURE_STORAGE_ACCOUNT_NAME;
        const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
        const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;

        if (!account || !accountKey || !containerName) {
            console.error('Azure Storage configuration missing:', { account, accountKey: accountKey ? 'SET' : 'MISSING', containerName });
            return res.status(500).json({ error: 'Azure Storage configuration missing' });
        }

        const sharedKeyCredential = new StorageSharedKeyCredential(account, accountKey);
        const blobServiceClient = new BlobServiceClient(
            `https://${account}.blob.core.windows.net`,
            sharedKeyCredential
        );
        const containerClient = blobServiceClient.getContainerClient(containerName);
        const blobClient = containerClient.getBlobClient(attachment.FileName);

        console.log('Checking blob existence for:', attachment.FileName);

        // Check if blob exists
        const exists = await blobClient.exists();
        console.log('Blob exists:', exists);

        if (!exists) {
            return res.status(404).json({ error: 'File not found in storage' });
        }

        // Generate SAS URL with 1 hour expiry
        const sasUrl = await blobClient.generateSasUrl({
            permissions: 'r', // Read only
            expiresOn: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
            protocol: 'https'
        });

        console.log('SAS URL generated successfully');

        // Return the SAS URL
        res.json({ 
            sasUrl: sasUrl,
            fileName: attachment.OriginalName,
            mimeType: attachment.MimeType
        });

    } catch (error) {
        console.error('Error generating SAS URL:', error);
        res.status(500).json({ error: 'Failed to generate SAS URL' });
    }
}

module.exports = {
    upload,
    uploadAttachment,
    getTaskAttachments,
    downloadAttachment,
    deleteAttachment,
    getTaskTimeline,
    addTimelineEntry: addTimelineEntryAPI,
    generateSASUrl // Add the new function to exports
}; 
 