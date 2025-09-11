const nodemailer = require('nodemailer');
require('dotenv').config();

// Create SMTP transporter
const createTransporter = () => {
  return nodemailer.createTransporter({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    tls: {
      ciphers: 'SSLv3'
    }
  });
};

// Email templates
const emailTemplates = {
  taskCreated: {
    subject: 'New Task Assigned: {taskTitle}',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #3B82F6; color: white; padding: 20px; text-align: center;">
          <h1 style="margin: 0;">New Task Assigned</h1>
        </div>
        <div style="padding: 20px; background-color: #f8fafc;">
          <h2 style="color: #1e293b; margin-top: 0;">{taskTitle}</h2>
          <p style="color: #64748b; font-size: 16px;">You have been assigned a new task by {creatorName}.</p>
          
          <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
            <h3 style="color: #1e293b; margin-top: 0;">Task Details</h3>
            <p><strong>Description:</strong> {taskDescription}</p>
            <p><strong>Priority:</strong> <span style="color: {priorityColor};">{priority}</span></p>
            <p><strong>Due Date:</strong> {dueDate}</p>
            <p><strong>Project:</strong> {projectName}</p>
          </div>
          
          <div style="text-align: center; margin: 20px 0;">
            <a href="{taskUrl}" style="background-color: #3B82F6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">View Task</a>
          </div>
          
          <p style="color: #64748b; font-size: 14px; margin-top: 20px;">
            This is an automated notification from the Tender Management System.
          </p>
        </div>
      </div>
    `
  },
  
  taskUpdated: {
    subject: 'Task Updated: {taskTitle}',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #10B981; color: white; padding: 20px; text-align: center;">
          <h1 style="margin: 0;">Task Updated</h1>
        </div>
        <div style="padding: 20px; background-color: #f8fafc;">
          <h2 style="color: #1e293b; margin-top: 0;">{taskTitle}</h2>
          <p style="color: #64748b; font-size: 16px;">{updaterName} has updated this task.</p>
          
          <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
            <h3 style="color: #1e293b; margin-top: 0;">Updated Details</h3>
            <p><strong>Description:</strong> {taskDescription}</p>
            <p><strong>Status:</strong> <span style="color: {statusColor};">{status}</span></p>
            <p><strong>Priority:</strong> <span style="color: {priorityColor};">{priority}</span></p>
            <p><strong>Due Date:</strong> {dueDate}</p>
            <p><strong>Project:</strong> {projectName}</p>
          </div>
          
          <div style="text-align: center; margin: 20px 0;">
            <a href="{taskUrl}" style="background-color: #10B981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">View Task</a>
          </div>
          
          <p style="color: #64748b; font-size: 14px; margin-top: 20px;">
            This is an automated notification from the Tender Management System.
          </p>
        </div>
      </div>
    `
  },
  
  taskCompleted: {
    subject: 'Task Completed: {taskTitle}',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #059669; color: white; padding: 20px; text-align: center;">
          <h1 style="margin: 0;">Task Completed</h1>
        </div>
        <div style="padding: 20px; background-color: #f8fafc;">
          <h2 style="color: #1e293b; margin-top: 0;">{taskTitle}</h2>
          <p style="color: #64748b; font-size: 16px;">{completerName} has marked this task as completed.</p>
          
          <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
            <h3 style="color: #1e293b; margin-top: 0;">Task Details</h3>
            <p><strong>Description:</strong> {taskDescription}</p>
            <p><strong>Completed By:</strong> {completerName}</p>
            <p><strong>Completed At:</strong> {completedAt}</p>
            <p><strong>Project:</strong> {projectName}</p>
          </div>
          
          <div style="text-align: center; margin: 20px 0;">
            <a href="{taskUrl}" style="background-color: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">View Task</a>
          </div>
          
          <p style="color: #64748b; font-size: 14px; margin-top: 20px;">
            This is an automated notification from the Tender Management System.
          </p>
        </div>
      </div>
    `
  },
  
  taskDeleted: {
    subject: 'Task Deleted: {taskTitle}',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #DC2626; color: white; padding: 20px; text-align: center;">
          <h1 style="margin: 0;">Task Deleted</h1>
        </div>
        <div style="padding: 20px; background-color: #f8fafc;">
          <h2 style="color: #1e293b; margin-top: 0;">{taskTitle}</h2>
          <p style="color: #64748b; font-size: 16px;">{deleterName} has deleted this task.</p>
          
          <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
            <h3 style="color: #1e293b; margin-top: 0;">Task Information</h3>
            <p><strong>Description:</strong> {taskDescription}</p>
            <p><strong>Deleted By:</strong> {deleterName}</p>
            <p><strong>Deleted At:</strong> {deletedAt}</p>
            <p><strong>Project:</strong> {projectName}</p>
          </div>
          
          <p style="color: #64748b; font-size: 14px; margin-top: 20px;">
            This is an automated notification from the Tender Management System.
          </p>
        </div>
      </div>
    `
  }
};

// Helper function to get priority color
const getPriorityColor = (priority) => {
  const colors = {
    'low': '#6B7280',
    'medium': '#3B82F6',
    'high': '#F59E0B',
    'urgent': '#DC2626'
  };
  return colors[priority?.toLowerCase()] || colors.medium;
};

// Helper function to get status color
const getStatusColor = (status) => {
  const colors = {
    'todo': '#6B7280',
    'in-progress': '#3B82F6',
    'review': '#F59E0B',
    'completed': '#059669'
  };
  return colors[status?.toLowerCase()] || colors.todo;
};

// Send email notification
const sendEmailNotification = async (to, templateType, data) => {
  try {
    console.log(`[EMAIL SERVICE] Preparing to send ${templateType} email to ${to}`);
    
    const transporter = createTransporter();
    const template = emailTemplates[templateType];
    
    if (!template) {
      throw new Error(`Email template '${templateType}' not found`);
    }
    
    // Replace placeholders in template
    let subject = template.subject;
    let html = template.html;
    
    // Replace common placeholders
    const replacements = {
      ...data,
      priorityColor: getPriorityColor(data.priority),
      statusColor: getStatusColor(data.status),
      taskUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/tasks/${data.taskId}`,
      deletedAt: new Date().toLocaleString(),
      completedAt: new Date().toLocaleString()
    };
    
    Object.keys(replacements).forEach(key => {
      const placeholder = `{${key}}`;
      const value = replacements[key] || '';
      subject = subject.replace(new RegExp(placeholder, 'g'), value);
      html = html.replace(new RegExp(placeholder, 'g'), value);
    });
    
    const mailOptions = {
      from: `"Tender Management System" <${process.env.SMTP_USER}>`,
      to: to,
      subject: subject,
      html: html
    };
    
    console.log(`[EMAIL SERVICE] Sending email with subject: "${subject}"`);
    const result = await transporter.sendMail(mailOptions);
    console.log(`[EMAIL SERVICE] Email sent successfully to ${to}, Message ID: ${result.messageId}`);
    return { success: true, messageId: result.messageId };
    
  } catch (error) {
    console.error(`[EMAIL SERVICE] Error sending email to ${to}:`, error);
    return { success: false, error: error.message };
  }
};

// Send bulk email notifications
const sendBulkEmailNotifications = async (recipients, templateType, data) => {
  const results = [];
  
  console.log(`[EMAIL SERVICE] Sending ${templateType} emails to ${recipients.length} recipients`);
  
  for (const recipient of recipients) {
    console.log(`[EMAIL SERVICE] Processing recipient:`, {
      name: recipient.name,
      email: recipient.email,
      emailType: typeof recipient.email,
      hasEmail: !!recipient.email,
      emailLength: recipient.email ? recipient.email.length : 'null/undefined'
    });
    
    if (recipient.email && recipient.email.trim() !== '') {
      console.log(`[EMAIL SERVICE] Sending email to: ${recipient.name} (${recipient.email})`);
      const result = await sendEmailNotification(recipient.email, templateType, data);
      results.push({
        email: recipient.email,
        name: recipient.name,
        ...result
      });
      
      if (result.success) {
        console.log(`[EMAIL SERVICE] ✅ Email sent successfully to ${recipient.email}`);
      } else {
        console.log(`[EMAIL SERVICE] ❌ Failed to send email to ${recipient.email}: ${result.error}`);
      }
    } else {
      console.log(`[EMAIL SERVICE] ⚠️ Skipping ${recipient.name} - no email address (email: "${recipient.email}")`);
    }
  }
  
  console.log(`[EMAIL SERVICE] Bulk email results:`, results);
  return results;
};

module.exports = {
  sendEmailNotification,
  sendBulkEmailNotifications,
  emailTemplates
};