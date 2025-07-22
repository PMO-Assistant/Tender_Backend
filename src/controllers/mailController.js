const { pool, poolConnect } = require('../config/database');
const { sendMail } = require('../utils/mailer');

/**
 * Notify Enos Pinheiro specifically
 */
async function notifyEnos(req, res) {
  try {
    await poolConnect;

    const result = await pool.request()
      .input('name', 'Enos Pinheiro')
      .query('SELECT name, email FROM portalEmployees WHERE name = @name');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Enos Pinheiro not found' });
    }

    const enos = result.recordset[0];

    const subject = req.body.subject || 'Notification';
    const message = req.body.message || 'Hello Enos, this is your notification.';

    const html = `
      <p>Hi ${enos.name},</p>
      <p>${message}</p>
      <p>Best regards,<br/>ADCO Team</p>
    `;

    const info = await sendMail(enos.email, subject, html);

    res.json({
      message: `Notification sent to ${enos.name}`,
      email: enos.email,
      messageId: info.messageId
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
}

/**
 * Notify any employee by name
 */
async function notifyByName(req, res) {
  try {
    const { name, subject, message } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Name is required' });
    }

    await poolConnect;

    const result = await pool.request()
      .input('name', name)
      .query('SELECT name, email FROM portalEmployees WHERE name = @name');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: `Employee "${name}" not found` });
    }

    const employee = result.recordset[0];

    const html = `
      <p>Hi ${employee.name},</p>
      <p>${message || 'You have a new notification.'}</p>
      <p>Best regards,<br/>ADCO Team</p>
    `;

    const info = await sendMail(employee.email, subject || 'Notification', html);

    res.json({
      message: `Notification sent to ${employee.name}`,
      email: employee.email,
      messageId: info.messageId
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
}

/**
 * Check overdue assets and send notifications
 */
async function checkAndNotifyOverdueAssets(req, res = null) {
  try {
    await poolConnect;

    const result = await pool.request().query(`
      SELECT 
        AssetID,
        Description,
        Responsible,
        ScanFrequency,
        Last_Updated
      FROM portalAssets
      WHERE Status != 'Inactive'
    `);

    const assets = result.recordset;
    const now = new Date();

    const overdueByResponsible = {};

    assets.forEach(asset => {
      const { AssetID, Description, Responsible, ScanFrequency, Last_Updated } = asset;
      const last = new Date(Last_Updated);
      let dueDate;

      switch ((ScanFrequency || '').toLowerCase()) {
        case 'weekly':
          dueDate = new Date(last);
          dueDate.setDate(last.getDate() + 7);
          break;
        case 'monthly':
          dueDate = new Date(last);
          dueDate.setMonth(last.getMonth() + 1);
          break;
        case 'daily':
          dueDate = new Date(last);
          dueDate.setDate(last.getDate() + 1);
          break;
        default:
          return; // skip unknown frequencies
      }

      if (now > dueDate) {
        if (!overdueByResponsible[Responsible]) {
          overdueByResponsible[Responsible] = [];
        }
        overdueByResponsible[Responsible].push({
          AssetID,
          Description,
          Last_Updated,
          ScanFrequency,
        });
      }
    });

    for (const [responsible, assets] of Object.entries(overdueByResponsible)) {
      const htmlRows = assets.map((a, index) => `
  <tr style="background-color: ${index % 2 === 0 ? '#f9f9f9' : '#ffffff'};">
    <td style="padding: 6px; border: 1px solid #ccc; text-align: center;">${a.AssetID}</td>
    <td style="padding: 6px; border: 1px solid #ccc;">${a.Description}</td>
    <td style="padding: 6px; border: 1px solid #ccc; text-align: center;">${a.ScanFrequency}</td>
    <td style="padding: 6px; border: 1px solid #ccc; text-align: center;">${new Date(a.Last_Updated).toLocaleDateString()}</td>
  </tr>
`).join('');


      const html = `
  <div style="font-family: Arial, sans-serif; color: #2b2b2b; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #fff;">
    
    <div style="text-align: center; margin-bottom: 20px;">
      <img src="https://www.adcoportal.ie/ADCO%20Logo.png" alt="ADCO Logo" style="max-height: 60px;" />
    </div>

    <h2 style="color: #2b2b2b; text-align: center; background-color: #fdcc09; padding: 10px; border-radius: 4px;">
      Overdue Assets Notification
    </h2>
    
    <p>Dear <strong>${responsible}</strong>,</p>

    <p>The following assets assigned to you are 
    <span style="color: #d9534f; font-weight: bold;">overdue</span> for scanning:</p>

    <table style="border-collapse: collapse; width: 100%; margin-top: 20px;">
      <thead>
        <tr style="background-color: #2b2b2b; color: #fff;">
          <th style="padding: 8px; border: 1px solid #ccc;">Asset ID</th>
          <th style="padding: 8px; border: 1px solid #ccc;">Description</th>
          <th style="padding: 8px; border: 1px solid #ccc;">Scan Frequency</th>
          <th style="padding: 8px; border: 1px solid #ccc;">Last Updated</th>
        </tr>
      </thead>
      <tbody>
        ${htmlRows}
      </tbody>
    </table>

    <div style="text-align: center; margin-top: 30px;">
      <a href="https://www.adcoportal.ie/assets-tracking" 
         style="display: inline-block; padding: 12px 24px; background-color: #fdcc09; color: #2b2b2b; text-decoration: none; font-weight: bold; border-radius: 4px;">
        Scan Assets Now
      </a>
    </div>

    <p style="margin-top: 30px; font-size: 0.9em; color: #777;">Best regards,<br/>ADCO Team</p>
  </div>
`;



      const subject = `Overdue Assets Notification`;

      const info = await sendMail(responsible, subject, html);

      console.log(`✅ Sent overdue notification to ${responsible}: ${info.messageId}`);
    }

    if (Object.keys(overdueByResponsible).length === 0) {
      console.log("✅ No overdue assets detected.");
    }

    if (res) {
      res.json({ message: 'Overdue asset check completed.' });
    }

  } catch (err) {
    console.error("❌ Error in checkAndNotifyOverdueAssets:", err);
    if (res) {
      res.status(500).json({ message: 'Error checking overdue assets', error: err.message });
    }
  }
}

module.exports = {
  notifyEnos,
  notifyByName,
  checkAndNotifyOverdueAssets
};
