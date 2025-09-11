const { getConnectedPool } = require('../../config/database');

// Delete notifications older than 24 hours
async function cleanupOldNotifications(pool) {
	try {
		await pool.request().query(`
			DELETE FROM tenderNotification
			WHERE CreatedAt < DATEADD(hour, -24, GETDATE())
			  AND Status = 1
		`);
	} catch (err) {
		console.error('[NOTIFICATION] Cleanup failed:', err.message);
	}
}

const notificationController = {
	// Test endpoint to verify database connectivity
	testConnection: async (req, res) => {
		try {
			console.log('[NOTIFICATION] Testing database connection...');
			const pool = await getConnectedPool();
			
			// Test basic query
			const result = await pool.request().query('SELECT 1 as test');
			console.log('[NOTIFICATION] Database connection test result:', result.recordset);
			
			// Test notification table structure
			const tableResult = await pool.request().query(`
				SELECT TOP 1 
					COLUMN_NAME,
					DATA_TYPE,
					IS_NULLABLE
				FROM INFORMATION_SCHEMA.COLUMNS 
				WHERE TABLE_NAME = 'tenderNotification'
				ORDER BY ORDINAL_POSITION
			`);
			
			console.log('[NOTIFICATION] Table structure:', tableResult.recordset);
			
			res.json({ 
				message: 'Database connection test successful',
				connection: 'OK',
				tableStructure: tableResult.recordset
			});
		} catch (error) {
			console.error('[NOTIFICATION] Database connection test failed:', error);
			res.status(500).json({
				error: 'Database connection failed',
				message: error.message,
				stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
			});
		}
	},

	// Get notifications for a user
	getUserNotifications: async (req, res) => {
		try {
			const userId = req.user.UserID;
			// Only log on first request to reduce console spam
			if (!req.user._notificationsLogged) {
				console.log(`[NOTIFICATION] Fetching notifications for user: ${userId}`);
				req.user._notificationsLogged = true;
			}
			
			const pool = await getConnectedPool();
			
			// Cleanup old notifications (older than 24 hours, only those already opened)
			await cleanupOldNotifications(pool);
			
			const result = await pool.request()
				.input('UserID', userId)
				.query(`
					SELECT 
						NotificationID,
						Notification,
						Type,
						Status,
						CreatedAt,
						Link
					FROM tenderNotification 
					WHERE UserID = @UserID
					ORDER BY CreatedAt DESC
				`);

			// Only log count, not sample data to reduce console spam
			if (!req.user._notificationCountLogged) {
				console.log(`[NOTIFICATION] Found ${result.recordset.length} notifications for user ${userId}`);
				req.user._notificationCountLogged = true;
			}
			
			res.json({ notifications: result.recordset });
		} catch (error) {
			console.error('[NOTIFICATION] Error fetching notifications:', error);
			res.status(500).json({
				error: 'Internal server error',
				message: 'Failed to fetch notifications',
				details: process.env.NODE_ENV === 'development' ? error.message : undefined
			});
		}
	},

	// Mark notification as read
	markAsRead: async (req, res) => {
		try {
			const { notificationId } = req.params;
			const userId = req.user.UserID;
			const pool = await getConnectedPool();
			
			const result = await pool.request()
				.input('NotificationID', notificationId)
				.input('UserID', userId)
				.query(`
					UPDATE tenderNotification 
					SET Status = 1 
					WHERE NotificationID = @NotificationID AND UserID = @UserID
				`);

			if (result.rowsAffected[0] === 0) {
				return res.status(404).json({
					error: 'Notification not found',
					message: 'Notification does not exist or you do not have access to it'
				});
			}

			res.json({ success: true, message: 'Notification marked as read' });
		} catch (error) {
			console.error('Error marking notification as read:', error);
			res.status(500).json({
				error: 'Internal server error',
				message: 'Failed to mark notification as read'
			});
		}
	},

	// Mark all notifications as read
	markAllAsRead: async (req, res) => {
		try {
			const userId = req.user.UserID;
			const pool = await getConnectedPool();
			
			await pool.request()
				.input('UserID', userId)
				.query(`
					UPDATE tenderNotification 
					SET Status = 1 
					WHERE UserID = @UserID AND Status = 0
				`);

			res.json({ success: true, message: 'All notifications marked as read' });
		} catch (error) {
			console.error('Error marking all notifications as read:', error);
			res.status(500).json({
				error: 'Internal server error',
				message: 'Failed to mark notifications as read'
			});
		}
	},

	// Delete a notification
	deleteNotification: async (req, res) => {
		try {
			const { notificationId } = req.params;
			const userId = req.user.UserID;
			const pool = await getConnectedPool();
			
			const result = await pool.request()
				.input('NotificationID', notificationId)
				.input('UserID', userId)
				.query(`
					DELETE FROM tenderNotification 
					WHERE NotificationID = @NotificationID AND UserID = @UserID
				`);

			if (result.rowsAffected[0] === 0) {
				return res.status(404).json({
					error: 'Notification not found',
					message: 'Notification does not exist or you do not have access to it'
				});
			}

			res.json({ success: true, message: 'Notification deleted' });
		} catch (error) {
			console.error('Error deleting notification:', error);
			res.status(500).json({
				error: 'Internal server error',
				message: 'Failed to delete notification'
			});
		}
	}
};

module.exports = notificationController;

