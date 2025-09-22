const { getConnectedPool } = require('../../config/database');
const { sendEmailNotification, sendBulkEmailNotifications } = require('../../config/emailService');

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
      console.log('[NOTIFICATION] tenderNotification table does not exist, creating it...');
      
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
      
      console.log('[NOTIFICATION] tenderNotification table created successfully');
    } else {
      console.log('[NOTIFICATION] tenderNotification table already exists');
    }
  } catch (error) {
    console.error('[NOTIFICATION] Error ensuring notification table:', error);
  }
}

// Helper function to get user details for email notifications
async function getUserDetails(pool, userId) {
  try {
    const result = await pool.request()
      .input('UserID', userId)
      .query(`
        SELECT UserID, Name, Email, Status
        FROM tenderEmployee
        WHERE UserID = @UserID AND Status = 1
      `);
    
    const rawUser = result.recordset[0] || null;
    if (rawUser) {
      // Normalize field names
      const user = {
        ...rawUser,
        email: rawUser.Email || rawUser.email || null,
        name: rawUser.Name || rawUser.name || 'Unknown'
      };
      console.log(`[EMAIL] Found user: ${user.name} (${user.email})`);
      return user;
    } else {
      console.log(`[EMAIL] User not found or inactive: ${userId}`);
      return null;
    }
  } catch (error) {
    console.error('Error fetching user details:', error);
    return null;
  }
}

// Helper function to send email notifications for task changes
async function sendTaskEmailNotifications(pool, taskId, userId, templateType, taskData) {
  try {
    // Get task creator details
    const creator = await getUserDetails(pool, userId);
    if (!creator) {
      console.error('Creator not found for email notification');
      return;
    }

    // Get all assignees for this task
    const assigneesResult = await pool.request()
      .input('TaskID', taskId)
      .query(`
        SELECT DISTINCT e.UserID, e.Name, e.Email, e.Status
        FROM tenderTaskAssignee tta
        INNER JOIN tenderEmployee e ON tta.UserID = e.UserID
        WHERE tta.TaskID = @TaskID AND e.Status = 1
      `);
    
    const assignees = assigneesResult.recordset;
    console.log(`[EMAIL] Raw assignees data for task ${taskId}:`, assignees);
    
    // Normalize email field (handle different casing)
    const normalizedAssignees = assignees.map(assignee => ({
      ...assignee,
      email: assignee.Email || assignee.email || null,
      name: assignee.Name || assignee.name || 'Unknown'
    }));
    
    console.log(`[EMAIL] Normalized assignees for task ${taskId}:`, normalizedAssignees.map(a => `${a.name} (${a.email})`));
    
    // Debug each assignee's email field
    normalizedAssignees.forEach((assignee, index) => {
      console.log(`[EMAIL] Assignee ${index + 1}:`, {
        UserID: assignee.UserID,
        Name: assignee.name,
        Email: assignee.email,
        EmailType: typeof assignee.email,
        EmailLength: assignee.email ? assignee.email.length : 'null/undefined'
      });
    });
    
    if (normalizedAssignees.length === 0) {
      console.log('[EMAIL] No active assignees found for email notification');
      return;
    }

    // Prepare email data
    const emailData = {
      taskId: taskId,
      taskTitle: taskData.title || taskData.description || 'Untitled Task',
      taskDescription: taskData.description || 'No description',
      priority: taskData.priority || 'medium',
      status: taskData.status || 'todo',
      dueDate: taskData.dueDate ? new Date(taskData.dueDate).toLocaleDateString() : 'No due date',
      projectName: taskData.projectName || 'No project',
      creatorName: creator.Name,
      updaterName: creator.Name,
      completerName: creator.Name,
      deleterName: creator.Name
    };

    // Send email notifications to all assignees
    console.log(`[EMAIL] Sending ${templateType} emails to ${normalizedAssignees.length} assignees for task ${taskId}`);
    const emailResults = await sendBulkEmailNotifications(normalizedAssignees, templateType, emailData);
    
    console.log(`[EMAIL] Email results for task ${taskId}:`, emailResults);
    return emailResults;
    
  } catch (error) {
    console.error('Error sending email notifications:', error);
    // Don't fail the task operation if email fails
  }
}

// Helper function to send notifications for task changes
async function sendTaskNotification(pool, taskId, userId, notificationText, type, link = '/tasks') {
  try {
    console.log(`[NOTIFICATION] Sending ${type} notification for task ${taskId} from user ${userId}`)
    console.log(`[NOTIFICATION] Text: ${notificationText}`)
    console.log(`[NOTIFICATION] Link: ${link}`)
    
    // Ensure notification table exists
    await ensureNotificationTable(pool);
    
    // Get the user making the change
    const userResult = await pool.request()
      .input('UserID', userId)
      .query('SELECT Name FROM tenderEmployee WHERE UserID = @UserID');
    
    const userName = userResult.recordset[0]?.Name || 'Someone';
    console.log(`[NOTIFICATION] User name: ${userName}`)
    
    // Get task details to find all users to notify
    const taskResult = await pool.request()
      .input('TaskID', taskId)
      .query('SELECT AddBy FROM tenderTask WHERE TaskID = @TaskID');
    
    if (taskResult.recordset.length === 0) {
      console.log(`[NOTIFICATION] Task ${taskId} not found, skipping notification`)
      return;
    }
    
    const task = taskResult.recordset[0];
    console.log(`[NOTIFICATION] Task creator: AddBy=${task.AddBy}`)
    
    // Get assignees from new table
    const assigneesResult = await pool.request()
      .input('TaskID', taskId)
      .query('SELECT UserID FROM tenderTaskAssignee WHERE TaskID = @TaskID');
    
    console.log(`[NOTIFICATION] Found ${assigneesResult.recordset.length} assignees for task ${taskId}`)
    
    // Collect all users to notify (creator + assignees)
    const usersToNotify = [task.AddBy];
    assigneesResult.recordset.forEach(row => {
      if (row.UserID && !usersToNotify.includes(row.UserID)) {
        usersToNotify.push(row.UserID);
      }
    });
    
    // Remove duplicates but keep the updater (so they see a record of their action)
    const uniqueUsers = [...new Set(usersToNotify)].filter(id => id !== null);
    console.log(`[NOTIFICATION] Users to notify: ${uniqueUsers.join(', ')}`)
    
    if (uniqueUsers.length > 0) {
      // Replace {userName} placeholder in notification text
      const finalNotificationText = notificationText.replace('{userName}', userName);
      console.log(`[NOTIFICATION] Final text: ${finalNotificationText}`)
      
      for (const notifyUserId of uniqueUsers) {
        try {
          console.log(`[NOTIFICATION] Creating notification for user ${notifyUserId}`)

          // Prevent duplicate notifications for the same user/action while unread
          const existing = await pool.request()
            .input('UserID', notifyUserId)
            .input('Type', type)
            .input('Link', link)
            .query(`
              SELECT TOP 1 NotificationID
              FROM tenderNotification
              WHERE UserID = @UserID AND Type = @Type AND Link = @Link AND Status = 0
              ORDER BY CreatedAt DESC
            `);

          if (existing.recordset.length > 0) {
            console.log(`[NOTIFICATION] Skipping duplicate notification for user ${notifyUserId} (type=${type}, link=${link})`)
            continue;
          }

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
          console.log(`[NOTIFICATION] Notification created successfully for user ${notifyUserId}, result:`, insertResult)
        } catch (insertError) {
          console.error(`[NOTIFICATION] Failed to create notification for user ${notifyUserId}:`, insertError)
        }
      }
      
      // Send email notifications to users with emails
      try {
        // Get user details with emails for email notifications
        const usersWithEmails = [];
        for (const notifyUserId of uniqueUsers) {
          try {
            console.log(`[EMAIL] Querying user details for UserID: ${notifyUserId}`);
            const userDetailResult = await pool.request()
              .input('UserID', notifyUserId)
              .query('SELECT UserID, Name, Email, Status FROM tenderEmployee WHERE UserID = @UserID');
            
            console.log(`[EMAIL] Raw user query result for ${notifyUserId}:`, userDetailResult.recordset);
            
            const userDetail = userDetailResult.recordset[0];
            if (userDetail) {
              console.log(`[EMAIL] User detail found:`, {
                UserID: userDetail.UserID,
                Name: userDetail.Name,
                Email: userDetail.Email,
                Status: userDetail.Status,
                NameType: typeof userDetail.Name,
                EmailType: typeof userDetail.Email
              });
              
              if (userDetail.Email && (userDetail.Status === 1 || userDetail.Status === true || userDetail.Status === 'True')) {
                usersWithEmails.push({
                  UserID: userDetail.UserID,
                  Name: userDetail.Name,
                  Email: userDetail.Email
                });
                console.log(`[EMAIL] Added user to email list: ${userDetail.Name} (${userDetail.Email})`);
              } else {
                console.log(`[EMAIL] Skipping user ${notifyUserId}: Email=${userDetail.Email}, Status=${userDetail.Status}`);
              }
            } else {
              console.log(`[EMAIL] No user found for UserID: ${notifyUserId}`);
            }
          } catch (emailError) {
            console.error(`[EMAIL] Error getting email for user ${notifyUserId}:`, emailError);
          }
        }
        
        console.log(`[EMAIL] Users with emails: ${usersWithEmails.length}`)
        
        if (usersWithEmails.length > 0) {
          // Get task details for email
          const taskDetailResult = await pool.request()
            .input('TaskID', taskId)
            .query('SELECT Description, Priority, Status, DueDate, Tender FROM tenderTask WHERE TaskID = @TaskID');
          
          const taskDetail = taskDetailResult.recordset[0];
          if (taskDetail) {
            const emailData = {
              taskId: taskId,
              taskTitle: taskDetail.Description || 'Untitled Task',
              taskDescription: taskDetail.Description || 'No description',
              priority: taskDetail.Priority || 'medium',
              status: taskDetail.Status || 'todo',
              dueDate: taskDetail.DueDate ? new Date(taskDetail.DueDate).toLocaleDateString() : 'No due date',
              projectName: taskDetail.Tender || 'No project',
              creatorName: userName,
              updaterName: userName,
              completerName: userName,
              deleterName: userName
            };
            
            // Determine email template type based on notification type
            let emailTemplateType = 'taskUpdated';
            if (type === 'task_created') emailTemplateType = 'taskCreated';
            else if (type === 'task_completed') emailTemplateType = 'taskCompleted';
            else if (type === 'task_deleted') emailTemplateType = 'taskDeleted';
            
            console.log(`[EMAIL] Sending ${emailTemplateType} emails to ${usersWithEmails.length} users`);
            const emailResults = await sendBulkEmailNotifications(usersWithEmails, emailTemplateType, emailData);
            console.log(`[EMAIL] Email results:`, emailResults);
          }
        }
      } catch (emailError) {
        console.error('[EMAIL] Error sending email notifications:', emailError);
        // Don't fail the notification if email fails
      }
      
      console.log(`[NOTIFICATION] All notifications sent successfully`)
    } else {
      console.log(`[NOTIFICATION] No users to notify`)
    }
  } catch (notificationError) {
    console.error('Error sending task notification:', notificationError);
    console.error('Error stack:', notificationError.stack);
    // Don't fail the main operation if notifications fail
  }
}

const taskController = {
  // Test email notification endpoint
  testEmailNotification: async (req, res) => {
    try {
      const { email, templateType = 'taskCreated' } = req.body;
      
      if (!email) {
        return res.status(400).json({
          error: 'Email required',
          message: 'Please provide an email address to test'
        });
      }

      const testData = {
        taskId: 999,
        taskTitle: 'Test Task',
        taskDescription: 'This is a test task to verify email notifications are working correctly.',
        priority: 'high',
        status: 'todo',
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString(), // 7 days from now
        projectName: 'Test Project',
        creatorName: 'Test User',
        updaterName: 'Test User',
        completerName: 'Test User',
        deleterName: 'Test User'
      };

      const result = await sendEmailNotification(email, templateType, testData);
      
      if (result.success) {
        res.json({
          success: true,
          message: `Test email sent successfully to ${email}`,
          messageId: result.messageId
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Failed to send test email',
          error: result.error
        });
      }
    } catch (error) {
      console.error('Error testing email notification:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to test email notification'
      });
    }
  },

  // Test email notification with real user data
  testEmailWithUsers: async (req, res) => {
    try {
      const pool = await getConnectedPool();
      
      // Get all users from tenderEmployee table (without Status filter first)
      const usersResult = await pool.request()
        .query(`
          SELECT UserID, Name, Email, Status
          FROM tenderEmployee
          ORDER BY UserID
        `);
      
      const rawUsers = usersResult.recordset;
      console.log(`[EMAIL TEST] All users from tenderEmployee:`, rawUsers);
      
      // Filter users with emails and active status
      const users = rawUsers.filter(user => {
        const hasEmail = user.Email && user.Email.trim() !== '';
        const isActive = user.Status === 1 || user.Status === true || user.Status === 'True';
        console.log(`[EMAIL TEST] User ${user.UserID}: Email=${user.Email}, Status=${user.Status}, hasEmail=${hasEmail}, isActive=${isActive}`);
        return hasEmail && isActive;
      });
      
      console.log(`[EMAIL TEST] Found ${users.length} active users with emails:`, users.map(u => `${u.Name} (${u.Email})`));
      
      if (users.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'No active users with email addresses found',
          allUsers: rawUsers
        });
      }

      // Test with the first user
      const testUser = users[0];
      const testData = {
        taskId: 999,
        taskTitle: 'Test Task - Real User Data',
        taskDescription: 'This is a test task using real user data from the tenderEmployee table.',
        priority: 'high',
        status: 'todo',
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString(),
        projectName: 'Test Project',
        creatorName: testUser.Name,
        updaterName: testUser.Name,
        completerName: testUser.Name,
        deleterName: testUser.Name
      };

      console.log(`[EMAIL TEST] Testing email to: ${testUser.Name} (${testUser.Email})`);
      const result = await sendEmailNotification(testUser.Email, 'taskCreated', testData);
      
      if (result.success) {
        res.json({
          success: true,
          message: `Test email sent successfully to ${testUser.Name} (${testUser.Email})`,
          messageId: result.messageId,
          testUser: {
            name: testUser.Name,
            email: testUser.Email,
            userId: testUser.UserID
          },
          allUsers: users.map(u => ({
            userId: u.UserID,
            name: u.Name,
            email: u.Email
          }))
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Failed to send test email',
          error: result.error,
          testUser: {
            name: testUser.Name,
            email: testUser.Email,
            userId: testUser.UserID
          }
        });
      }
    } catch (error) {
      console.error('Error testing email with users:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to test email with user data'
      });
    }
  },

  // Test endpoint to verify basic functionality
  testTaskEndpoint: async (req, res) => {
    try {
      res.json({ 
        message: 'Task endpoint is working',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: 'Test failed' });
    }
  },

  // Debug endpoint to check tenderEmployee table
  debugEmployeeTable: async (req, res) => {
    try {
      const pool = await getConnectedPool();
      
      // Get all users from tenderEmployee table
      const usersResult = await pool.request()
        .query(`
          SELECT TOP 5 UserID, Name, Email, Status
          FROM tenderEmployee
          ORDER BY UserID
        `);
      
      const users = usersResult.recordset;
      console.log(`[DEBUG] tenderEmployee sample data:`, users);
      
      // Test specific user IDs that are failing
      const testUserIds = [2, 7]; // From the logs
      const testUsers = [];
      
      for (const userId of testUserIds) {
        try {
          const testResult = await pool.request()
            .input('UserID', userId)
            .query('SELECT UserID, Name, Email, Status FROM tenderEmployee WHERE UserID = @UserID');
          
          console.log(`[DEBUG] Test query for UserID ${userId}:`, testResult.recordset);
          testUsers.push({
            userId: userId,
            result: testResult.recordset
          });
        } catch (testError) {
          console.error(`[DEBUG] Error testing UserID ${userId}:`, testError);
          testUsers.push({
            userId: userId,
            error: testError.message
          });
        }
      }
      
      res.json({
        success: true,
        message: 'Employee table debug data',
        users: users,
        userCount: users.length,
        testUsers: testUsers
      });
    } catch (error) {
      console.error('Error debugging employee table:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to debug employee table'
      });
    }
  },

  // Test notification system
  testNotificationSystem: async (req, res) => {
    try {
      const pool = await getConnectedPool();
      
      // Check if tenderNotification table exists and its structure
      const tableCheck = await pool.request().query(`
        SELECT TABLE_NAME 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_NAME = 'tenderNotification'
      `);
      
      if (tableCheck.recordset.length === 0) {
        return res.status(500).json({ 
          error: 'tenderNotification table does not exist',
          message: 'Please create the notification table first'
        });
      }
      
      // Check table structure
      const structureCheck = await pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'tenderNotification' 
        ORDER BY ORDINAL_POSITION
      `);
      
      // Try to insert a test notification
      const testResult = await pool.request()
        .input('UserID', 1) // Assuming user 1 exists
        .input('Notification', 'Test notification from task system')
        .input('Type', 'test')
        .input('Status', 0)
        .input('Link', '/test')
        .query(`
          INSERT INTO tenderNotification (UserID, Notification, Type, Status, CreatedAt, Link)
          VALUES (@UserID, @Notification, @Type, @Status, GETDATE(), @Link)
        `);
      
      res.json({
        message: 'Notification system test successful',
        tableExists: true,
        tableStructure: structureCheck.recordset,
        testInsertResult: testResult,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Notification system test failed:', error);
      res.status(500).json({ 
        error: 'Notification system test failed',
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  },

  // Get all tasks for the logged-in user (where they are involved)
  getAllTasks: async (req, res) => {
    try {
      const userId = req.user.UserID;
      const pool = await getConnectedPool();
      
      const result = await pool.request()
        .input('UserID', userId)
        .query(`
          SELECT 
            t.TaskID,
            t.AddBy,
            t.CreatedAt,
            t.UpdatedAt,
            t.CompletedAt,
            t.CompletedBy,
            t.Description,
            t.StartDate,
            t.DueDate,
            t.Priority,
            t.Tender,
            t.WhatchlistID,
            -- Status field (default to 'todo' if not set)
            COALESCE(t.Status, 'todo') as Status,
            -- Creator info
            creator.Name as CreatorName,
            creator.Email as CreatorEmail,
            -- Completed by info
            completedBy.Name as CompletedByName,
            completedBy.Email as CompletedByEmail,
            -- Project info (tender or watchlist)
            tender.ProjectName as TenderName,
            watchlist.ProjectName as WatchlistName
          FROM tenderTask t
          LEFT JOIN tenderEmployee creator ON t.AddBy = creator.UserID
          LEFT JOIN tenderEmployee completedBy ON t.CompletedBy = completedBy.UserID
          LEFT JOIN tenderTender tender ON t.Tender = tender.TenderID
          LEFT JOIN tenderWhatchlist watchlist ON t.WhatchlistID = watchlist.WhatchlistID
          WHERE t.AddBy = @UserID 
             OR t.TaskID IN (
               SELECT TaskID FROM tenderTaskAssignee WHERE UserID = @UserID
             )
          ORDER BY t.CreatedAt DESC
        `);

      const tasks = result.recordset.map(row => ({
        TaskID: row.TaskID,
        AddBy: row.AddBy,
        CreatedAt: row.CreatedAt,
        UpdatedAt: row.UpdatedAt,
        CompletedAt: row.CompletedAt,
        CompletedBy: row.CompletedBy,
        Description: row.Description,
        StartDate: row.StartDate,
        DueDate: row.DueDate,
        Priority: row.Priority,
        Tender: row.Tender,
        WhatchlistID: row.WhatchlistID,
        Status: row.Status,
        CreatorName: row.CreatorName,
        CreatorEmail: row.CreatorEmail,
        CompletedByName: row.CompletedByName,
        CompletedByEmail: row.CompletedByEmail,
        TenderName: row.TenderName || null,
        WatchlistName: row.WatchlistName || null
      }));

      res.json({ tasks });
    } catch (error) {
      console.error('Error fetching tasks:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: 'Failed to fetch tasks' 
      });
    }
  },

  // Get tasks by tender/project ID
  getTasksByTenderId: async (req, res) => {
    try {
      const { tenderId } = req.params;
      const pool = await getConnectedPool();
      
      console.log('Fetching tasks for tender ID:', tenderId);
      
      // First, let's check if the tender exists
      const tenderCheck = await pool.request()
        .input('TenderID', tenderId)
        .query('SELECT TenderID, ProjectName FROM tenderTender WHERE TenderID = @TenderID');
      
      console.log('Tender check result:', tenderCheck.recordset);
      
      // Check if there are any tasks at all
      const allTasksCheck = await pool.request()
        .query('SELECT COUNT(*) as total FROM tenderTask');
      
      console.log('Total tasks in database:', allTasksCheck.recordset[0].total);
      
      // Check if there are any tasks for this specific tender
      const tenderTasksCheck = await pool.request()
        .input('TenderID', tenderId)
        .query('SELECT COUNT(*) as total FROM tenderTask WHERE Tender = @TenderID');
      
      console.log('Tasks for tender', tenderId, ':', tenderTasksCheck.recordset[0].total);
      
      const result = await pool.request()
        .input('TenderID', tenderId)
        .query(`
          SELECT 
            t.TaskID,
            t.AddBy,
            t.CreatedAt,
            t.UpdatedAt,
            t.CompletedAt,
            t.CompletedBy,
            t.Description,
            t.StartDate,
            t.DueDate,
            t.Priority,
            t.Tender,
            t.WhatchlistID,
            -- Status field (default to 'todo' if not set)
            COALESCE(t.Status, 'todo') as Status,
            -- Creator info
            creator.Name as CreatorName,
            creator.Email as CreatorEmail,
            -- Completed by info
            completedBy.Name as CompletedByName,
            completedBy.Email as CompletedByEmail,
            -- Tender info
            tender.ProjectName as TenderName,
            watchlist.ProjectName as WatchlistName
          FROM tenderTask t
          LEFT JOIN tenderEmployee creator ON t.AddBy = creator.UserID
          LEFT JOIN tenderEmployee completedBy ON t.CompletedBy = completedBy.UserID
          LEFT JOIN tenderTender tender ON t.Tender = tender.TenderID
          LEFT JOIN tenderWhatchlist watchlist ON t.WhatchlistID = watchlist.WhatchlistID
          WHERE t.Tender = @TenderID
          ORDER BY t.CreatedAt DESC
        `);

      console.log('Query result count:', result.recordset.length);

      const tasks = result.recordset.map(row => ({
        TaskID: row.TaskID,
        AddBy: row.AddBy,
        CreatedAt: row.CreatedAt,
        UpdatedAt: row.UpdatedAt,
        CompletedAt: row.CompletedAt,
        CompletedBy: row.CompletedBy,
        Description: row.Description,
        StartDate: row.StartDate,
        DueDate: row.DueDate,
        Priority: row.Priority,
        Tender: row.Tender,
        WhatchlistID: row.WhatchlistID,
        Status: row.Status,
        CreatorName: row.CreatorName,
        CreatorEmail: row.CreatorEmail,
        CompletedByName: row.CompletedByName,
        CompletedByEmail: row.CompletedByEmail,
        TenderName: row.TenderName || null,
        WatchlistName: row.WatchlistName || null
      }));

      console.log('Returning tasks:', tasks.length);
      res.json({ tasks });
    } catch (error) {
      console.error('Error fetching tasks by tender ID:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: 'Failed to fetch tasks for this tender' 
      });
    }
  },

  // Get task by ID (only if user is involved)
  getTaskById: async (req, res) => {
    try {
      const { taskId } = req.params;
      const userId = req.user.UserID;
      const pool = await getConnectedPool();
      
      const result = await pool.request()
        .input('TaskID', taskId)
        .input('UserID', userId)
        .query(`
          SELECT 
            t.TaskID,
            t.AddBy,
            t.CreatedAt,
            t.UpdatedAt,
            t.CompletedAt,
            t.CompletedBy,
            t.Description,
            t.StartDate,
            t.DueDate,
            t.Priority,
            t.Tender,
            t.WhatchlistID,
            -- Status field (default to 'todo' if not set)
            COALESCE(t.Status, 'todo') as Status,
            -- Creator info
            creator.Name as CreatorName,
            creator.Email as CreatorEmail,
            -- Completed by info
            completedBy.Name as CompletedByName,
            completedBy.Email as CompletedByEmail,
            -- Tender info
            tender.ProjectName as TenderName,
            watchlist.ProjectName as WatchlistName
          FROM tenderTask t
          LEFT JOIN tenderEmployee creator ON t.AddBy = creator.UserID
          LEFT JOIN tenderEmployee completedBy ON t.CompletedBy = completedBy.UserID
          LEFT JOIN tenderTender tender ON t.Tender = tender.TenderID
          LEFT JOIN tenderWhatchlist watchlist ON t.WhatchlistID = watchlist.WhatchlistID
          WHERE t.TaskID = @TaskID
            AND t.AddBy = @UserID
        `);

      if (result.recordset.length === 0) {
        return res.status(404).json({
          error: 'Task not found',
          message: 'Task does not exist or you do not have access to it'
        });
      }

      const task = result.recordset[0];
      console.log('=== BACKEND TASK DEBUG ===');
      console.log('Raw task data:', task);
      console.log('Tender:', task.Tender);
      console.log('WhatchlistID:', task.WhatchlistID);
      console.log('TenderName:', task.TenderName);
      console.log('WatchlistName:', task.WatchlistName);
      console.log('=== END BACKEND DEBUG ===');
      
      res.json({
        task: {
          TaskID: task.TaskID,
          AddBy: task.AddBy,
          CreatedAt: task.CreatedAt,
          UpdatedAt: task.UpdatedAt,
          CompletedAt: task.CompletedAt,
          CompletedBy: task.CompletedBy,
          Description: task.Description,
          StartDate: task.StartDate,
          DueDate: task.DueDate,
          Priority: task.Priority,
          Tender: task.Tender,
          WhatchlistID: task.WhatchlistID,
          Status: task.Status,
          CreatorName: task.CreatorName,
          CreatorEmail: task.CreatorEmail,
          CompletedByName: task.CompletedByName,
          CompletedByEmail: task.CompletedByEmail,
          TenderName: task.TenderName || null,
          WatchlistName: task.WatchlistName || null
        }
      });
    } catch (error) {
      console.error('Error fetching task:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to fetch task'
      });
    }
  },

  // Create new task
  createTask: async (req, res) => {
    try {
      const {
        Description,
        StartDate,
        DueDate,
        Priority,
        Tender,
        WhatchlistID
      } = req.body;

      // Validate required fields
      if (!Description) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Description is required'
        });
      }

      // Validate that task is assigned to either tender or watchlist (not both)
      if (Tender && WhatchlistID) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Task cannot be assigned to both tender and watchlist project'
        });
      }

      if (!Tender && !WhatchlistID) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Task must be assigned to either a tender or watchlist project'
        });
      }

      const pool = await getConnectedPool();
      const userId = req.user.UserID;

      // Check if tender exists (only if provided)
      if (Tender) {
        const tenderCheck = await pool.request()
          .input('TenderID', Tender)
          .query('SELECT TenderID FROM tenderTender WHERE TenderID = @TenderID');

        if (tenderCheck.recordset.length === 0) {
          return res.status(400).json({
            error: 'Invalid tender',
            message: 'The specified tender does not exist'
          });
        }
      }

      // Check if watchlist project exists (only if provided)
      if (WhatchlistID) {
        const watchlistCheck = await pool.request()
          .input('WhatchlistID', WhatchlistID)
          .query('SELECT WhatchlistID FROM tenderWhatchlist WHERE WhatchlistID = @WhatchlistID');

        if (watchlistCheck.recordset.length === 0) {
          return res.status(400).json({
            error: 'Invalid watchlist project',
            message: 'The specified watchlist project does not exist'
          });
        }
      }

      // Insert new task without assignees
      const result = await pool.request()
        .input('AddBy', userId)
        .input('Description', Description)
        .input('StartDate', StartDate || null)
        .input('DueDate', DueDate || null)
        .input('Priority', Priority || 'Medium')
        .input('Tender', Tender || null)
        .input('WhatchlistID', WhatchlistID || null)
        .input('Status', 'todo')
        .query(`
          INSERT INTO tenderTask (AddBy, Description, StartDate, DueDate, Priority, Tender, WhatchlistID, Status)
          OUTPUT INSERTED.TaskID
          VALUES (@AddBy, @Description, @StartDate, @DueDate, @Priority, @Tender, @WhatchlistID, @Status)
        `);

      const taskId = result.recordset[0].TaskID;

      // Add timeline entry for task creation
      try {
        await pool.request()
          .input('TaskID', taskId)
          .input('AddBy', userId)
          .input('Type', 'task_created')
          .input('Content', `Task "${Description}" created`)
          .query(`
            INSERT INTO tenderTaskTimeline (TaskID, AddBy, Type, Content)
            VALUES (@TaskID, @AddBy, @Type, @Content)
          `);
      } catch (e) {
        // ignore timeline errors
      }

      // Send notifications to task creator
      try {
        // Get creator name for notification
        const creatorResult = await pool.request()
          .input('UserID', userId)
          .query('SELECT Name FROM tenderEmployee WHERE UserID = @UserID');
        
        const creatorName = creatorResult.recordset[0]?.Name || 'Someone';
        const projectName = Tender ? ` for tender ${Tender}` : (WhatchlistID ? ` for watchlist project ${WhatchlistID}` : '');
        
        // Create notification text
        const notificationText = `Task "${Description}" created${projectName}`;
        
        // Send notification to creator
        await sendTaskNotification(pool, taskId, userId, notificationText, 'task_created', `/tasks/${taskId}`);
      } catch (notificationError) {
        console.error('Error sending task creation notifications:', notificationError);
        // Don't fail the task creation if notifications fail
      }

      // Send email notifications for new task creation (if assignees exist)
      try {
        const taskData = {
          title: Description,
          description: Description,
          priority: Priority || 'medium',
          status: 'todo',
          dueDate: DueDate,
          projectName: 'No project'
        };

        // Get project info if available
        if (Tender) {
          const tenderResult = await pool.request()
            .input('TenderID', Tender)
            .query('SELECT ProjectName FROM tenderTender WHERE TenderID = @TenderID');
          
          if (tenderResult.recordset.length > 0) {
            taskData.projectName = tenderResult.recordset[0].ProjectName;
          }
        } else if (WhatchlistID) {
          const watchlistResult = await pool.request()
            .input('WhatchlistID', WhatchlistID)
            .query('SELECT ProjectName FROM tenderWhatchlist WHERE WhatchlistID = @WhatchlistID');
          
          if (watchlistResult.recordset.length > 0) {
            taskData.projectName = watchlistResult.recordset[0].ProjectName;
          }
        }

        // Email notifications are now handled in sendTaskNotification
      } catch (emailError) {
        console.error('Error sending email notifications for task creation:', emailError);
        // Don't fail the task creation if email fails
      }

      res.status(201).json({
        success: true,
        message: 'Task created successfully',
        taskId: taskId
      });
    } catch (error) {
      console.error('Error creating task:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to create task'
      });
    }
  },

  // Update task
  updateTask: async (req, res) => {
    try {
      const { taskId } = req.params;
      const {
        Description,
        StartDate,
        DueDate,
        Priority,
        Tender,
        WhatchlistID
      } = req.body;

      const pool = await getConnectedPool();
      const userId = req.user.UserID;

      // Check if task exists and user has access
      const existingTask = await pool.request()
        .input('TaskID', taskId)
        .input('UserID', userId)
        .query(`
          SELECT TaskID, AddBy, StartDate, DueDate, Priority, Description FROM tenderTask 
          WHERE TaskID = @TaskID 
            AND (AddBy = @UserID OR TaskID IN (
              SELECT TaskID FROM tenderTaskAssignee WHERE UserID = @UserID
            ))
        `);

      if (existingTask.recordset.length === 0) {
        return res.status(404).json({
          error: 'Task not found',
          message: 'Task does not exist or you do not have permission to edit it'
        });
      }

      // Build dynamic UPDATE query based on provided fields
      const updateFields = []
      const request = pool.request().input('TaskID', taskId)

      if (Description !== undefined) {
        updateFields.push('Description = @Description')
        request.input('Description', Description)
      }
      if (StartDate !== undefined) {
        updateFields.push('StartDate = @StartDate')
        request.input('StartDate', StartDate)
      }
      if (DueDate !== undefined) {
        updateFields.push('DueDate = @DueDate')
        request.input('DueDate', DueDate)
      }
      if (Priority !== undefined) {
        updateFields.push('Priority = @Priority')
        request.input('Priority', Priority)
      }
      if (Tender !== undefined) {
        updateFields.push('Tender = @Tender')
        request.input('Tender', Tender)
      }
      if (WhatchlistID !== undefined) {
        updateFields.push('WhatchlistID = @WhatchlistID')
        request.input('WhatchlistID', WhatchlistID)
      }

      // Always update UpdatedAt
      updateFields.push('UpdatedAt = SYSDATETIME()')

      if (updateFields.length > 1) { // More than just UpdatedAt
        await request.query(`
          UPDATE tenderTask 
          SET ${updateFields.join(', ')}
          WHERE TaskID = @TaskID
        `)
      }

      // Add timeline entry for task update
      try {
        await pool.request()
          .input('TaskID', taskId)
          .input('AddBy', userId)
          .input('Type', 'task_updated')
          .input('Content', `Task details updated`)
          .query(`
            INSERT INTO tenderTaskTimeline (TaskID, AddBy, Type, Content)
            VALUES (@TaskID, @AddBy, @Type, @Content)
          `);
      } catch (e) {
        // ignore timeline errors
      }

      // Send notifications for task update
      try {
        // Get updater name for notification
        const updaterResult = await pool.request()
          .input('UserID', userId)
          .query('SELECT Name FROM tenderEmployee WHERE UserID = @UserID');
        
        const updaterName = updaterResult.recordset[0]?.Name || 'Someone';
        
        // Get project name if assigned to a project
        let projectName = '';
        if (Tender) {
          const tenderResult = await pool.request()
            .input('TenderID', Tender)
            .query('SELECT ProjectName FROM tenderTender WHERE TenderID = @TenderID');
          projectName = tenderResult.recordset[0]?.ProjectName || '';
        } else if (WhatchlistID) {
          const watchlistResult = await pool.request()
            .input('WhatchlistID', WhatchlistID)
            .query('SELECT ProjectName FROM tenderWhatchlist WHERE WhatchlistID = @WhatchlistID');
          projectName = watchlistResult.recordset[0]?.ProjectName || '';
        }

        // Create notification text
        const notificationText = projectName 
          ? `{userName} updated task "${Description}" for ${projectName}`
          : `{userName} updated task "${Description}"`;

        // Send notifications to task creator and assignees
        await sendTaskNotification(pool, taskId, userId, notificationText, 'task_updated', `/tasks/${taskId}`);
      } catch (notificationError) {
        console.error('Error sending task update notifications:', notificationError);
        // Don't fail the task update if notifications fail
      }

      res.json({
        success: true,
        message: 'Task updated successfully'
      });
    } catch (error) {
      console.error('Error updating task:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to update task'
      });
    }
  },

  // Update task status
  updateTaskStatus: async (req, res) => {
    try {
      const { taskId } = req.params;
      const { status } = req.body;
      const pool = await getConnectedPool();
      const userId = req.user.UserID;

      // Validate status
      const validStatuses = ['todo', 'in-progress', 'review', 'completed'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          error: 'Invalid status',
          message: 'Status must be one of: todo, in-progress, review, completed'
        });
      }

      // Check if task exists and user has access, and get task details
      const existingTask = await pool.request()
        .input('TaskID', taskId)
        .input('UserID', userId)
        .query(`
          SELECT TaskID, AddBy, Description, CompletedAt FROM tenderTask 
          WHERE TaskID = @TaskID 
            AND (AddBy = @UserID OR TaskID IN (
              SELECT TaskID FROM tenderTaskAssignee WHERE UserID = @UserID
            ))
        `);

      if (existingTask.recordset.length === 0) {
        return res.status(404).json({
          error: 'Task not found',
          message: 'Task does not exist or you do not have permission to update it'
        });
      }

      const task = existingTask.recordset[0];

      // Get updater name for timeline and notifications
      const updaterResult = await pool.request()
        .input('UserID', userId)
        .query('SELECT Name FROM tenderEmployee WHERE UserID = @UserID');
      
      const updaterName = updaterResult.recordset[0]?.Name || 'Someone';

      // Update task status
      if (status === 'completed') {
        // Complete the task
        await pool.request()
          .input('TaskID', taskId)
          .input('CompletedBy', userId)
          .input('Status', status)
          .query(`
            UPDATE tenderTask 
            SET CompletedAt = SYSDATETIME(),
                CompletedBy = @CompletedBy,
                Status = @Status,
                UpdatedAt = SYSDATETIME()
            WHERE TaskID = @TaskID
          `);
      } else {
        // Update status and set StartDate if moving to in-progress
        let startDateUpdate = '';
        if (status === 'in-progress') {
          startDateUpdate = ', StartDate = SYSDATETIME()';
        }

        // Check if task was previously completed and is being reopened
        const wasCompleted = task.CompletedAt !== null;
        
        await pool.request()
          .input('TaskID', taskId)
          .input('Status', status)
          .query(`
            UPDATE tenderTask 
            SET CompletedAt = NULL,
                CompletedBy = NULL,
                Status = @Status,
                UpdatedAt = SYSDATETIME()${startDateUpdate}
            WHERE TaskID = @TaskID
          `);
        
        // If task was completed and is being reopened, send special notification
        if (wasCompleted) {
          await sendTaskNotification(pool, taskId, userId, 
            `{userName} reopened task "${task.Description}"`, 'task_reopened', '/tasks');
        }
      }

      // Add timeline entry for status change
      const statusLabels = {
        'todo': 'To Do',
        'in-progress': 'In Progress',
        'review': 'Review',
        'completed': 'Completed'
      };

      await pool.request()
        .input('TaskID', taskId)
        .input('AddBy', userId)
        .input('Type', 'status_changed')
        .input('Content', `${updaterName} changed status to: ${statusLabels[status]}`)
        .query(`
          INSERT INTO tenderTaskTimeline (TaskID, AddBy, Type, Content)
          VALUES (@TaskID, @AddBy, @Type, @Content)
        `);

      // Send notifications to task creator and assignees about status change
      try {
        // Collect all users to notify (creator + assignees)
        const usersToNotify = [task.AddBy];
        
        // Get assignees from new table
        const assigneesResult = await pool.request()
          .input('TaskID', taskId)
          .query('SELECT UserID FROM tenderTaskAssignee WHERE TaskID = @TaskID');
        
        assigneesResult.recordset.forEach(row => {
          if (row.UserID && !usersToNotify.includes(row.UserID)) {
            usersToNotify.push(row.UserID);
          }
        });
        
        // Remove duplicates but keep the updater (so they see a record of their action)
        const uniqueUsers = [...new Set(usersToNotify)].filter(id => id !== null);
        
        console.log(`[TASK STATUS UPDATE] Task ${taskId}: ${task.Description}`)
        console.log(`[TASK STATUS UPDATE] Updater: ${userId} (${updaterName})`)
        console.log(`[TASK STATUS UPDATE] Users to notify: ${uniqueUsers.join(', ')}`)
        console.log(`[TASK STATUS UPDATE] Status changing to: ${status}`)
        
        if (uniqueUsers.length > 0) {
          const notificationText = `{userName} updated task "${task.Description}" status to ${statusLabels[status]}`;
          
          for (const notifyUserId of uniqueUsers) {
            console.log(`[TASK STATUS UPDATE] Sending notification to user ${notifyUserId}`)
            await sendTaskNotification(pool, taskId, userId, notificationText, 'task_status_update', `/tasks/${taskId}`);
          }
          console.log(`[TASK STATUS UPDATE] All notifications sent successfully`)
        } else {
          console.log(`[TASK STATUS UPDATE] No users to notify`)
        }
      } catch (notificationError) {
        console.error('Error sending status update notifications:', notificationError);
        // Don't fail the status update if notifications fail
      }

      // Send email notifications for status update
      try {
        // Get task details for email
        const taskDetailsResult = await pool.request()
          .input('TaskID', taskId)
          .query(`
            SELECT t.Description, t.Priority, t.DueDate, t.Status,
                   tender.ProjectName
            FROM tenderTask t
            LEFT JOIN tenderTender tender ON t.Tender = tender.TenderID
          LEFT JOIN tenderWhatchlist watchlist ON t.WhatchlistID = watchlist.WhatchlistID
            WHERE t.TaskID = @TaskID
          `);
        
        if (taskDetailsResult.recordset.length > 0) {
          const taskDetails = taskDetailsResult.recordset[0];
          
          const taskData = {
            title: taskDetails.Description,
            description: taskDetails.Description,
            priority: taskDetails.Priority || 'medium',
            status: status,
            dueDate: taskDetails.DueDate,
            projectName: taskDetails.ProjectName || 'No project'
          };

          // Determine email template based on status
          let emailTemplate = 'taskUpdated';
          if (status === 'completed') {
            emailTemplate = 'taskCompleted';
          }

          // Email notifications are now handled in sendTaskNotification
        }
      } catch (emailError) {
        console.error('Error sending email notifications for status update:', emailError);
        // Don't fail the status update if email fails
      }

      res.json({
        success: true,
        message: 'Task status updated successfully'
      });
    } catch (error) {
      console.error('Error updating task status:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to update task status'
      });
    }
  },

  // Get task assignees from tenderTaskAssignee
  getTaskAssignees: async (req, res) => {
    try {
      const { taskId } = req.params;
      const pool = await getConnectedPool();
      const userId = req.user.UserID;

      // Ensure user has access to the task
      const access = await pool.request()
        .input('TaskID', taskId)
        .input('UserID', userId)
        .query(`
          SELECT TaskID FROM tenderTask
          WHERE TaskID = @TaskID
            AND (AddBy = @UserID OR TaskID IN (
              SELECT TaskID FROM tenderTaskAssignee WHERE UserID = @UserID
            ))
        `);
      if (access.recordset.length === 0) {
        return res.status(404).json({ error: 'Task not found or access denied' });
      }

      const result = await pool.request()
        .input('TaskID', taskId)
        .query(`
          SELECT a.UserID, e.Name, e.Email, a.AssignedDate, a.Role
          FROM tenderTaskAssignee a
          INNER JOIN tenderEmployee e ON a.UserID = e.UserID
          WHERE a.TaskID = @TaskID
          ORDER BY e.Name
        `);

      res.json({ assignees: result.recordset });
    } catch (error) {
      console.error('Error getting task assignees:', error);
      res.status(500).json({ error: 'Internal server error', message: 'Failed to get task assignees' });
    }
  },

  // Add assignee
  addTaskAssignee: async (req, res) => {
    try {
      const { taskId } = req.params;
      const { userId: newUserId, role } = req.body;
      const pool = await getConnectedPool();
      const userId = req.user.UserID;

      if (!newUserId) {
        return res.status(400).json({ error: 'Validation failed', message: 'userId is required' });
      }

      // Ensure task exists and requester has access
      const access = await pool.request()
        .input('TaskID', taskId)
        .input('UserID', userId)
        .query(`
          SELECT TaskID, Description FROM tenderTask
          WHERE TaskID = @TaskID
            AND (AddBy = @UserID OR TaskID IN (
              SELECT TaskID FROM tenderTaskAssignee WHERE UserID = @UserID
            ))
        `);
      if (access.recordset.length === 0) {
        return res.status(404).json({ error: 'Task not found or access denied' });
      }

      // Get user names for better timeline messages
      const userNames = await pool.request()
        .input('RequesterID', userId)
        .input('NewAssigneeID', newUserId)
        .query(`
          SELECT 
            (SELECT Name FROM tenderEmployee WHERE UserID = @RequesterID) as RequesterName,
            (SELECT Name FROM tenderEmployee WHERE UserID = @NewAssigneeID) as NewAssigneeName
        `);

      const requesterName = userNames.recordset[0]?.RequesterName || 'Unknown User';
      const newAssigneeName = userNames.recordset[0]?.NewAssigneeName || 'Unknown User';

      // Insert (idempotent due to PK)
      await pool.request()
        .input('TaskID', taskId)
        .input('UserID', newUserId)
        .input('Role', role || null)
        .query(`
          IF NOT EXISTS (SELECT 1 FROM tenderTaskAssignee WHERE TaskID = @TaskID AND UserID = @UserID)
          BEGIN
            INSERT INTO tenderTaskAssignee (TaskID, UserID, Role)
            VALUES (@TaskID, @UserID, @Role)
          END
        `);

      // Timeline + notification
      try {
        await pool.request()
          .input('TaskID', taskId)
          .input('AddBy', userId)
          .input('Type', 'assignee_added')
          .input('Content', `${requesterName} added ${newAssigneeName} to this task`)
          .query(`
            INSERT INTO tenderTaskTimeline (TaskID, AddBy, Type, Content)
            VALUES (@TaskID, @AddBy, @Type, @Content)
          `);

        const desc = access.recordset[0].Description || '';
        await sendTaskNotification(pool, taskId, userId, `{userName} added an assignee to "${desc}"`, 'task_assignment', `/tasks/${taskId}`);
      } catch (e) {
        // ignore
      }

      // Send email notification to the newly assigned user
      try {
        // Get task details for email
        const taskDetailsResult = await pool.request()
          .input('TaskID', taskId)
          .query(`
            SELECT t.Description, t.Priority, t.DueDate, t.Status,
                   tender.ProjectName
            FROM tenderTask t
            LEFT JOIN tenderTender tender ON t.Tender = tender.TenderID
          LEFT JOIN tenderWhatchlist watchlist ON t.WhatchlistID = watchlist.WhatchlistID
            WHERE t.TaskID = @TaskID
          `);
        
        if (taskDetailsResult.recordset.length > 0) {
          const taskDetails = taskDetailsResult.recordset[0];
          
          const taskData = {
            title: taskDetails.Description,
            description: taskDetails.Description,
            priority: taskDetails.Priority || 'medium',
            status: taskDetails.Status || 'todo',
            dueDate: taskDetails.DueDate,
            projectName: taskDetails.ProjectName || 'No project'
          };

          // Send email only to the newly assigned user
          const newAssignee = await getUserDetails(pool, newUserId);
          if (newAssignee && newAssignee.email) {
            await sendEmailNotification(newAssignee.email, 'taskCreated', {
              ...taskData,
              taskId: taskId,
              creatorName: requesterName
            });
          }
        }
      } catch (emailError) {
        console.error('Error sending email notification for new assignee:', emailError);
        // Don't fail the assignment if email fails
      }

      res.status(201).json({ success: true });
    } catch (error) {
      console.error('Error adding task assignee:', error);
      res.status(500).json({ error: 'Internal server error', message: 'Failed to add task assignee' });
    }
  },

  // Remove assignee
  removeTaskAssignee: async (req, res) => {
    try {
      const { taskId, userId: removeUserId } = req.params;
      const pool = await getConnectedPool();
      const userId = req.user.UserID;

      // Access check
      const access = await pool.request()
        .input('TaskID', taskId)
        .input('UserID', userId)
        .query(`
          SELECT TaskID, Description FROM tenderTask
          WHERE TaskID = @TaskID
            AND (AddBy = @UserID OR TaskID IN (
              SELECT TaskID FROM tenderTaskAssignee WHERE UserID = @UserID
            ))
        `);
      if (access.recordset.length === 0) {
        return res.status(404).json({ error: 'Task not found or access denied' });
      }

      // Get user names for better timeline messages
      const userNames = await pool.request()
        .input('RequesterID', userId)
        .input('RemoveAssigneeID', removeUserId)
        .query(`
          SELECT 
            (SELECT Name FROM tenderEmployee WHERE UserID = @RequesterID) as RequesterName,
            (SELECT Name FROM tenderEmployee WHERE UserID = @RemoveAssigneeID) as RemoveAssigneeName
        `);

      const requesterName = userNames.recordset[0]?.RequesterName || 'Unknown User';
      const removeAssigneeName = userNames.recordset[0]?.RemoveAssigneeName || 'Unknown User';

      await pool.request()
        .input('TaskID', taskId)
        .input('UserID', removeUserId)
        .query(`
          DELETE FROM tenderTaskAssignee WHERE TaskID = @TaskID AND UserID = @UserID
        `);

      // Timeline + notification
      try {
        await pool.request()
          .input('TaskID', taskId)
          .input('AddBy', userId)
          .input('Type', 'assignee_removed')
          .input('Content', `${requesterName} removed ${removeAssigneeName} from this task`)
          .query(`
            INSERT INTO tenderTaskTimeline (TaskID, AddBy, Type, Content)
            VALUES (@TaskID, @AddBy, @Type, @Content)
          `);

        const desc = access.recordset[0].Description || '';
        await sendTaskNotification(pool, taskId, userId, `{userName} removed an assignee from "${desc}"`, 'task_assignment', `/tasks/${taskId}`);
      } catch (e) {
        // ignore
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error removing task assignee:', error);
      res.status(500).json({ error: 'Internal server error', message: 'Failed to remove task assignee' });
    }
  },

  // Complete task
  completeTask: async (req, res) => {
    try {
      const { taskId } = req.params;
      const pool = await getConnectedPool();
      const userId = req.user.UserID;

      // Check if task exists and user has access, and get task details
      const existingTask = await pool.request()
        .input('TaskID', taskId)
        .input('UserID', userId)
        .query(`
          SELECT TaskID, AddBy, Description, CompletedAt FROM tenderTask 
          WHERE TaskID = @TaskID 
            AND (AddBy = @UserID OR TaskID IN (
              SELECT TaskID FROM tenderTaskAssignee WHERE UserID = @UserID
            ))
        `);

      if (existingTask.recordset.length === 0) {
        return res.status(404).json({
          error: 'Task not found',
          message: 'Task does not exist or you do not have permission to complete it'
        });
      }

      const task = existingTask.recordset[0];

      if (task.CompletedAt) {
        return res.status(400).json({
          error: 'Task already completed',
          message: 'This task has already been completed'
        });
      }

      // Complete task
      await pool.request()
        .input('TaskID', taskId)
        .input('CompletedBy', userId)
        .query(`
          UPDATE tenderTask 
          SET CompletedAt = SYSDATETIME(),
              CompletedBy = @CompletedBy,
              Status = 'completed',
              UpdatedAt = SYSDATETIME()
          WHERE TaskID = @TaskID
        `);

      // Add timeline entry for task completion
      try {
        await pool.request()
          .input('TaskID', taskId)
          .input('AddBy', userId)
          .input('Type', 'task_completed')
          .input('Content', `${completerName} completed this task`)
          .query(`
            INSERT INTO tenderTaskTimeline (TaskID, AddBy, Type, Content)
            VALUES (@TaskID, @AddBy, @Type, @Content)
          `);
      } catch (e) {
        // ignore timeline errors
      }

      // Send notifications to task creator and other assignees about completion
      try {
        // Get completer name
        const completerResult = await pool.request()
          .input('UserID', userId)
          .query('SELECT Name FROM tenderEmployee WHERE UserID = @UserID');
        
        const completerName = completerResult.recordset[0]?.Name || 'Someone';
        
        // Collect all users to notify (creator + assignees from new table)
        const usersToNotify = [task.AddBy];
        
        // Get assignees from new table
        const assigneesResult = await pool.request()
          .input('TaskID', taskId)
          .query('SELECT UserID FROM tenderTaskAssignee WHERE TaskID = @TaskID');
        
        assigneesResult.recordset.forEach(row => {
          if (row.UserID && !usersToNotify.includes(row.UserID)) {
            usersToNotify.push(row.UserID);
          }
        });
        
        // Remove duplicates but keep the completer (so they see a record of their action)
        const uniqueUsers = [...new Set(usersToNotify)].filter(id => id !== null);
        
        if (uniqueUsers.length > 0) {
          const notificationText = `{userName} completed task "${task.Description}"`;
          
          for (const notifyUserId of uniqueUsers) {
            await sendTaskNotification(pool, taskId, userId, notificationText, 'task_completed', `/tasks/${taskId}`);
          }
        }
      } catch (notificationError) {
        console.error('Error sending task completion notifications:', notificationError);
        // Don't fail the task completion if notifications fail
      }

      res.json({
        success: true,
        message: 'Task completed successfully'
      });
    } catch (error) {
      console.error('Error completing task:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to complete task'
      });
    }
  },

  // Delete task
  deleteTask: async (req, res) => {
    try {
      const { taskId } = req.params;
      const pool = await getConnectedPool();
      const userId = req.user.UserID;

      // Check if task exists and user is the creator, and get task details
      const existingTask = await pool.request()
        .input('TaskID', taskId)
        .input('UserID', userId)
        .query(`
          SELECT TaskID, AddBy, Description FROM tenderTask 
          WHERE TaskID = @TaskID AND AddBy = @UserID
        `);

      if (existingTask.recordset.length === 0) {
        return res.status(404).json({
          error: 'Task not found',
          message: 'Task does not exist or you do not have permission to delete it'
        });
      }

      const task = existingTask.recordset[0];

      // Send notifications to assignees about task deletion
      try {
        // Get assignees from new table
        const assigneesResult = await pool.request()
          .input('TaskID', taskId)
          .query('SELECT UserID FROM tenderTaskAssignee WHERE TaskID = @TaskID');
        
        const assigneesToNotify = assigneesResult.recordset.map(row => row.UserID).filter(id => id !== null);
        
        if (assigneesToNotify.length > 0) {
          const notificationText = `{userName} deleted task "${task.Description}"`;
          
          for (const assigneeId of assigneesToNotify) {
            await sendTaskNotification(pool, taskId, userId, notificationText, 'task_deleted', `/tasks/${taskId}`);
          }
        }
      } catch (notificationError) {
        console.error('Error sending task deletion notifications:', notificationError);
        // Don't fail the task deletion if notifications fail
      }

      // Send email notifications for task deletion
      try {
        // Get task details for email (before deletion)
        const taskDetailsResult = await pool.request()
          .input('TaskID', taskId)
          .query(`
            SELECT t.Description, t.Priority, t.DueDate, t.Status,
                   tender.ProjectName
            FROM tenderTask t
            LEFT JOIN tenderTender tender ON t.Tender = tender.TenderID
          LEFT JOIN tenderWhatchlist watchlist ON t.WhatchlistID = watchlist.WhatchlistID
            WHERE t.TaskID = @TaskID
          `);
        
        if (taskDetailsResult.recordset.length > 0) {
          const taskDetails = taskDetailsResult.recordset[0];
          
          const taskData = {
            title: taskDetails.Description,
            description: taskDetails.Description,
            priority: taskDetails.Priority || 'medium',
            status: taskDetails.Status || 'todo',
            dueDate: taskDetails.DueDate,
            projectName: taskDetails.ProjectName || 'No project'
          };

          // Email notifications are now handled in sendTaskNotification
        }
      } catch (emailError) {
        console.error('Error sending email notifications for task deletion:', emailError);
        // Don't fail the task deletion if email fails
      }

      // First, get all files associated with this task
      const filesResult = await pool.request()
        .input('TaskID', taskId)
        .query(`
          SELECT FileID, BlobPath, DisplayName
          FROM tenderFile
          WHERE DocID = @TaskID AND ConnectionTable = 'tenderTask' AND IsDeleted = 0
        `);

      const files = filesResult.recordset;
      console.log(`Found ${files.length} files to delete for task ${taskId}`);

      // Delete each file from blob storage and database
      for (const file of files) {
        try {
          // Delete from Azure Blob Storage
          if (file.BlobPath) {
            const { deleteFile: deleteBlobFile } = require('../../config/azureBlobService');
            await deleteBlobFile(file.BlobPath);
            console.log(`File deleted from blob storage: ${file.BlobPath}`);
          }
        } catch (blobError) {
          console.error(`Warning: Failed to delete file ${file.DisplayName} from blob storage:`, blobError);
          // Continue with other files even if one fails
        }

        // Delete from database
        await pool.request()
          .input('FileID', file.FileID)
          .query(`
            DELETE FROM tenderFile
            WHERE FileID = @FileID
          `);
        console.log(`File deleted from database: ${file.DisplayName} (ID: ${file.FileID})`);
      }

      // Delete any folders associated with this task
      const foldersResult = await pool.request()
        .input('TaskID', taskId)
        .query(`
          SELECT FolderID, FolderPath
          FROM tenderFolder
          WHERE DocID = @TaskID AND ConnectionTable = 'tenderTask' AND IsActive = 1
        `);

      const folders = foldersResult.recordset;
      console.log(`Found ${folders.length} folders to delete for task ${taskId}`);

      // Delete folders from blob storage and database
      for (const folder of folders) {
        try {
          // Delete folder from Azure Blob Storage
          if (folder.FolderPath) {
            const { deleteFolder: deleteBlobFolder } = require('../../config/azureBlobService');
            await deleteBlobFolder(folder.FolderPath);
            console.log(`Folder deleted from blob storage: ${folder.FolderPath}`);
          }
        } catch (blobError) {
          console.error(`Warning: Failed to delete folder ${folder.FolderPath} from blob storage:`, blobError);
          // Continue with other folders even if one fails
        }

        // Delete folder from database
        await pool.request()
          .input('FolderID', folder.FolderID)
          .query(`
            DELETE FROM tenderFolder
            WHERE FolderID = @FolderID
          `);
        console.log(`Folder deleted from database: ${folder.FolderPath} (ID: ${folder.FolderID})`);
      }

      // Also clean up any potential task-specific folders in blob storage
      // This handles cases where folders might exist in blob storage but not be tracked in the database
      try {
        const { deleteFolder: deleteBlobFolder } = require('../../config/azureBlobService');
        const taskFolderPath = `tasks/${taskId}`;
        await deleteBlobFolder(taskFolderPath);
        console.log(`Task-specific folder cleaned up from blob storage: ${taskFolderPath}`);
      } catch (blobError) {
        console.log(`No task-specific folder found in blob storage: tasks/${taskId}`);
        // This is not an error - the folder might not exist
      }

      // Delete task assignees from new table
      await pool.request()
        .input('TaskID', taskId)
        .query('DELETE FROM tenderTaskAssignee WHERE TaskID = @TaskID');

      // Delete task attachments
      await pool.request()
        .input('TaskID', taskId)
        .query('DELETE FROM tenderTaskAttachment WHERE TaskID = @TaskID');

      // Delete task timeline entries
      await pool.request()
        .input('TaskID', taskId)
        .query('DELETE FROM tenderTaskTimeline WHERE TaskID = @TaskID');

      // Delete task
      await pool.request()
        .input('TaskID', taskId)
        .query('DELETE FROM tenderTask WHERE TaskID = @TaskID');

      console.log(`Task ${taskId} and all associated files, folders, and attachments deleted successfully`);
      res.json({
        success: true,
        message: 'Task and all associated files, folders, and attachments deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting task:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to delete task'
      });
    }
  },

  // Get available users for assignment
  getAvailableUsers: async (req, res) => {
    try {
      const pool = await getConnectedPool();
      
      const result = await pool.request()
        .query(`
          SELECT 
            UserID,
            Name,
            Email
          FROM tenderEmployee 
          WHERE Status = 1
          ORDER BY Name
        `);

      const users = result.recordset.map(row => ({
        UserID: row.UserID,
        Name: row.Name,
        Email: row.Email
      }));

      res.json({ users });
    } catch (error) {
      console.error('Error fetching available users:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to fetch available users'
      });
    }
  },

  // Get available tenders for task creation
  getAvailableTenders: async (req, res) => {
    try {
      const pool = await getConnectedPool();
      
      const result = await pool.request()
        .query(`
          SELECT 
            TenderID,
            ProjectName
          FROM tenderTender 
          WHERE IsDeleted = 0
          ORDER BY ProjectName
        `);

      const tenders = result.recordset.map(row => ({
        TenderID: row.TenderID,
        TenderName: row.ProjectName
      }));

      res.json({ tenders });
    } catch (error) {
      console.error('Error fetching available tenders:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to fetch available tenders'
      });
    }
  },

  // Get available watchlist projects for task creation
  getAvailableWatchlistProjects: async (req, res) => {
    try {
      const pool = await getConnectedPool();
      
      const result = await pool.request()
        .query(`
          SELECT 
            WhatchlistID,
            ProjectName,
            Status,
            Type,
            OpenDate
          FROM tenderWhatchlist
          ORDER BY CreatedAt DESC
        `);

      const watchlistProjects = result.recordset.map(row => ({
        WhatchlistID: row.WhatchlistID,
        ProjectName: row.ProjectName,
        Status: row.Status,
        Type: row.Type,
        OpenDate: row.OpenDate
      }));

      res.json({ watchlistProjects });
    } catch (error) {
      console.error('Error fetching available watchlist projects:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to fetch available watchlist projects'
      });
    }
  },

  getTasksByWatchlistId: async (req, res) => {
    try {
      const { watchlistId } = req.params;
      const pool = await getConnectedPool();
      const userId = req.user.UserID;

      // Get tasks assigned to the specific watchlist project
      const result = await pool.request()
        .input('WhatchlistID', watchlistId)
        .input('UserID', userId)
        .query(`
          SELECT 
            t.TaskID,
            t.AddBy,
            t.CreatedAt,
            t.UpdatedAt,
            t.CompletedAt,
            t.CompletedBy,
            t.Description,
            t.StartDate,
            t.DueDate,
            t.Priority,
            t.WhatchlistID,
            t.Status,
            e.Name as CreatorName,
            e.Email as CreatorEmail,
            completed.Name as CompletedByName,
            completed.Email as CompletedByEmail,
            watchlist.ProjectName as WatchlistName
          FROM tenderTask t
          LEFT JOIN tenderEmployee e ON t.AddBy = e.UserID
          LEFT JOIN tenderEmployee completed ON t.CompletedBy = completed.UserID
          LEFT JOIN tenderWhatchlist watchlist ON t.WhatchlistID = watchlist.WhatchlistID
          WHERE t.WhatchlistID = @WhatchlistID
            AND (t.AddBy = @UserID OR t.TaskID IN (
              SELECT TaskID FROM tenderTaskAssignee WHERE UserID = @UserID
            ))
          ORDER BY t.CreatedAt DESC
        `);

      console.log('Backend: Raw task data:', result.recordset);
      console.log('Backend: First task Description:', result.recordset[0]?.Description);

      const tasks = result.recordset.map(task => ({
        TaskID: task.TaskID,
        AddBy: task.AddBy,
        CreatedAt: task.CreatedAt,
        UpdatedAt: task.UpdatedAt,
        CompletedAt: task.CompletedAt,
        CompletedBy: task.CompletedBy,
        Description: task.Description,
        StartDate: task.StartDate,
        DueDate: task.DueDate,
        Priority: task.Priority,
        WhatchlistID: task.WhatchlistID,
        Status: task.Status,
        CreatorName: task.CreatorName,
        CreatorEmail: task.CreatorEmail,
        CompletedByName: task.CompletedByName,
        CompletedByEmail: task.CompletedByEmail,
        WatchlistName: task.WatchlistName
      }));

      res.json({
        success: true,
        tasks: tasks
      });

    } catch (error) {
      console.error('Error fetching tasks by watchlist ID:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch tasks for watchlist',
        message: 'Failed to fetch tasks for watchlist project'
      });
    }
  }
};

module.exports = taskController;
