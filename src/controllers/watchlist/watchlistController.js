const { getConnectedPool } = require('../../config/database');

const watchlistController = {
  // Test watchlist table connection
  testWatchlistTable: async (req, res) => {
    try {
      const pool = await getConnectedPool();
      const result = await pool.request().query(`
        SELECT TOP 1 WhatchlistID, ProjectName 
        FROM tenderWhatchlist 
        ORDER BY WhatchlistID DESC
      `);
      
      res.json({ 
        success: true, 
        message: 'Watchlist table connection successful',
        sample: result.recordset[0] || null
      });
    } catch (error) {
      console.error('Error testing watchlist table:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Get all watchlist items (all statuses, all users)
  getAllWatchlistItems: async (req, res) => {
    try {
      const pool = await getConnectedPool();
      
      // Get all items regardless of who created them or what status they have
      const result = await pool.request().query(`
        SELECT 
          w.WhatchlistID,
          w.ProjectName,
          w.OpenDate,
          w.Value,
          w.Status,
          w.Type,
          w.Source,
          w.Notes,
          w.CreatedAt,
          w.CompanyID,
          w.AddBy,
          c.CompanyName,
          e.Name as AddedByName
        FROM tenderWhatchlist w
        LEFT JOIN tenderCompany c ON w.CompanyID = c.CompanyID
        LEFT JOIN tenderEmployee e ON w.AddBy = e.UserID
        ORDER BY w.CreatedAt DESC
      `);
      
      // Log status breakdown for debugging
      const statusBreakdown = result.recordset.reduce((acc, item) => {
        const status = item.Status || 'No Status';
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {});
      
      // Log breakdown by user for debugging
      const userBreakdown = result.recordset.reduce((acc, item) => {
        const userId = item.AddBy || 'Unknown';
        acc[userId] = (acc[userId] || 0) + 1;
        return acc;
      }, {});
      
      console.log(`📊 Fetched ${result.recordset.length} watchlist items (all statuses, all users)`);
      console.log(`📊 Status breakdown:`, statusBreakdown);
      console.log(`📊 User breakdown:`, userBreakdown);
      
      res.json(result.recordset);
    } catch (error) {
      console.error('Error fetching watchlist items:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Get a single watchlist item by ID
  getWatchlistItem: async (req, res) => {
    try {
      const pool = await getConnectedPool();
      const { id } = req.params;
      const userId = req.user?.UserID;
      
      const result = await pool.request()
        .input('WhatchlistID', id)
        .input('UserID', userId)
        .query(`
          SELECT 
            w.WhatchlistID,
            w.ProjectName,
            w.OpenDate,
            w.Value,
            w.Status,
            w.Type,
            w.Source,
            w.Notes,
            w.CreatedAt,
            w.CompanyID,
            w.AddBy,
            c.CompanyName,
            e.Name as AddedByName
          FROM tenderWhatchlist w
          LEFT JOIN tenderCompany c ON w.CompanyID = c.CompanyID
          LEFT JOIN tenderEmployee e ON w.AddBy = e.UserID
          WHERE w.WhatchlistID = @WhatchlistID
            AND (w.AddBy = @UserID OR @UserID IS NULL)
        `);
      
      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Watchlist item not found' });
      }
      
      res.json(result.recordset[0]);
    } catch (error) {
      console.error('Error fetching watchlist item:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Create a new watchlist item
  createWatchlistItem: async (req, res) => {
    try {
      const pool = await getConnectedPool();
      const userId = req.user?.UserID;
      const {
        ProjectName,
        OpenDate,
        Value,
        Status,
        Type,
        Source,
        Notes,
        CompanyID
      } = req.body;
      
      // Validate required fields
      if (!ProjectName) {
        return res.status(400).json({ error: 'ProjectName is required' });
      }
      
      const result = await pool.request()
        .input('ProjectName', ProjectName)
        .input('OpenDate', OpenDate || null)
        .input('Value', Value || null)
        .input('Status', Status || 'Identified')
        .input('Type', Type || null)
        .input('Source', Source || null)
        .input('Notes', Notes || null)
        .input('CompanyID', CompanyID || null)
        .input('AddBy', userId)
        .query(`
          INSERT INTO tenderWhatchlist 
            (ProjectName, OpenDate, Value, Status, Type, Source, Notes, CompanyID, AddBy, CreatedAt)
          VALUES 
            (@ProjectName, @OpenDate, @Value, @Status, @Type, @Source, @Notes, @CompanyID, @AddBy, GETDATE())
          SELECT SCOPE_IDENTITY() AS WhatchlistID
        `);
      
      const newId = result.recordset[0]?.WhatchlistID;
      
      // Fetch the newly created item
      const newItem = await pool.request()
        .input('WhatchlistID', newId)
        .query(`
          SELECT 
            w.WhatchlistID,
            w.ProjectName,
            w.OpenDate,
            w.Value,
            w.Status,
            w.Type,
            w.Source,
            w.Notes,
            w.CreatedAt,
            w.CompanyID,
            w.AddBy,
            c.CompanyName,
            e.Name as AddedByName
          FROM tenderWhatchlist w
          LEFT JOIN tenderCompany c ON w.CompanyID = c.CompanyID
          LEFT JOIN tenderEmployee e ON w.AddBy = e.UserID
          WHERE w.WhatchlistID = @WhatchlistID
        `);
      
      res.status(201).json(newItem.recordset[0]);
    } catch (error) {
      console.error('Error creating watchlist item:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Update a watchlist item
  updateWatchlistItem: async (req, res) => {
    try {
      const pool = await getConnectedPool();
      const { id } = req.params;
      const userId = req.user?.UserID;
      const {
        ProjectName,
        OpenDate,
        Value,
        Status,
        Type,
        Source,
        Notes,
        CompanyID
      } = req.body;
      
      // Check if item exists and user has permission
      const checkResult = await pool.request()
        .input('WhatchlistID', id)
        .input('UserID', userId)
        .query(`
          SELECT WhatchlistID 
          FROM tenderWhatchlist 
          WHERE WhatchlistID = @WhatchlistID 
            AND (AddBy = @UserID OR @UserID IS NULL)
        `);
      
      if (checkResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Watchlist item not found or access denied' });
      }
      
      // Update the item
      await pool.request()
        .input('WhatchlistID', id)
        .input('ProjectName', ProjectName)
        .input('OpenDate', OpenDate || null)
        .input('Value', Value || null)
        .input('Status', Status)
        .input('Type', Type || null)
        .input('Source', Source || null)
        .input('Notes', Notes || null)
        .input('CompanyID', CompanyID || null)
        .query(`
          UPDATE tenderWhatchlist 
          SET 
            ProjectName = @ProjectName,
            OpenDate = @OpenDate,
            Value = @Value,
            Status = @Status,
            Type = @Type,
            Source = @Source,
            Notes = @Notes,
            CompanyID = @CompanyID,
            UpdatedAt = GETDATE()
          WHERE WhatchlistID = @WhatchlistID
        `);
      
      // Fetch the updated item
      const updatedItem = await pool.request()
        .input('WhatchlistID', id)
        .query(`
          SELECT 
            w.WhatchlistID,
            w.ProjectName,
            w.OpenDate,
            w.Value,
            w.Status,
            w.Type,
            w.Source,
            w.Notes,
            w.CreatedAt,
            w.CompanyID,
            w.AddBy,
            c.CompanyName,
            e.Name as AddedByName
          FROM tenderWhatchlist w
          LEFT JOIN tenderCompany c ON w.CompanyID = c.CompanyID
          LEFT JOIN tenderEmployee e ON w.AddBy = e.UserID
          WHERE w.WhatchlistID = @WhatchlistID
        `);
      
      res.json(updatedItem.recordset[0]);
    } catch (error) {
      console.error('Error updating watchlist item:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Delete a watchlist item
  deleteWatchlistItem: async (req, res) => {
    try {
      const pool = await getConnectedPool();
      const { id } = req.params;
      const userId = req.user?.UserID;
      
      // Check if item exists and user has permission
      const checkResult = await pool.request()
        .input('WhatchlistID', id)
        .input('UserID', userId)
        .query(`
          SELECT WhatchlistID 
          FROM tenderWhatchlist 
          WHERE WhatchlistID = @WhatchlistID 
            AND (AddBy = @UserID OR @UserID IS NULL)
        `);
      
      if (checkResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Watchlist item not found or access denied' });
      }
      
      // Delete the item
      await pool.request()
        .input('WhatchlistID', id)
        .query(`
          DELETE FROM tenderWhatchlist 
          WHERE WhatchlistID = @WhatchlistID
        `);
      
      res.json({ success: true, message: 'Watchlist item deleted successfully' });
    } catch (error) {
      console.error('Error deleting watchlist item:', error);
      res.status(500).json({ error: error.message });
    }
  }
};

module.exports = watchlistController;


const watchlistController = {
  // Test watchlist table connection
  testWatchlistTable: async (req, res) => {
    try {
      const pool = await getConnectedPool();
      const result = await pool.request().query(`
        SELECT TOP 1 WhatchlistID, ProjectName 
        FROM tenderWhatchlist 
        ORDER BY WhatchlistID DESC
      `);
      
      res.json({ 
        success: true, 
        message: 'Watchlist table connection successful',
        sample: result.recordset[0] || null
      });
    } catch (error) {
      console.error('Error testing watchlist table:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Get all watchlist items (all statuses, all users)
  getAllWatchlistItems: async (req, res) => {
    try {
      const pool = await getConnectedPool();
      
      // Get all items regardless of who created them or what status they have
      const result = await pool.request().query(`
        SELECT 
          w.WhatchlistID,
          w.ProjectName,
          w.OpenDate,
          w.Value,
          w.Status,
          w.Type,
          w.Source,
          w.Notes,
          w.CreatedAt,
          w.CompanyID,
          w.AddBy,
          c.CompanyName,
          e.Name as AddedByName
        FROM tenderWhatchlist w
        LEFT JOIN tenderCompany c ON w.CompanyID = c.CompanyID
        LEFT JOIN tenderEmployee e ON w.AddBy = e.UserID
        ORDER BY w.CreatedAt DESC
      `);
      
      // Log status breakdown for debugging
      const statusBreakdown = result.recordset.reduce((acc, item) => {
        const status = item.Status || 'No Status';
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {});
      
      // Log breakdown by user for debugging
      const userBreakdown = result.recordset.reduce((acc, item) => {
        const userId = item.AddBy || 'Unknown';
        acc[userId] = (acc[userId] || 0) + 1;
        return acc;
      }, {});
      
      console.log(`📊 Fetched ${result.recordset.length} watchlist items (all statuses, all users)`);
      console.log(`📊 Status breakdown:`, statusBreakdown);
      console.log(`📊 User breakdown:`, userBreakdown);
      
      res.json(result.recordset);
    } catch (error) {
      console.error('Error fetching watchlist items:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Get a single watchlist item by ID
  getWatchlistItem: async (req, res) => {
    try {
      const pool = await getConnectedPool();
      const { id } = req.params;
      const userId = req.user?.UserID;
      
      const result = await pool.request()
        .input('WhatchlistID', id)
        .input('UserID', userId)
        .query(`
          SELECT 
            w.WhatchlistID,
            w.ProjectName,
            w.OpenDate,
            w.Value,
            w.Status,
            w.Type,
            w.Source,
            w.Notes,
            w.CreatedAt,
            w.CompanyID,
            w.AddBy,
            c.CompanyName,
            e.Name as AddedByName
          FROM tenderWhatchlist w
          LEFT JOIN tenderCompany c ON w.CompanyID = c.CompanyID
          LEFT JOIN tenderEmployee e ON w.AddBy = e.UserID
          WHERE w.WhatchlistID = @WhatchlistID
            AND (w.AddBy = @UserID OR @UserID IS NULL)
        `);
      
      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Watchlist item not found' });
      }
      
      res.json(result.recordset[0]);
    } catch (error) {
      console.error('Error fetching watchlist item:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Create a new watchlist item
  createWatchlistItem: async (req, res) => {
    try {
      const pool = await getConnectedPool();
      const userId = req.user?.UserID;
      const {
        ProjectName,
        OpenDate,
        Value,
        Status,
        Type,
        Source,
        Notes,
        CompanyID
      } = req.body;
      
      // Validate required fields
      if (!ProjectName) {
        return res.status(400).json({ error: 'ProjectName is required' });
      }
      
      const result = await pool.request()
        .input('ProjectName', ProjectName)
        .input('OpenDate', OpenDate || null)
        .input('Value', Value || null)
        .input('Status', Status || 'Identified')
        .input('Type', Type || null)
        .input('Source', Source || null)
        .input('Notes', Notes || null)
        .input('CompanyID', CompanyID || null)
        .input('AddBy', userId)
        .query(`
          INSERT INTO tenderWhatchlist 
            (ProjectName, OpenDate, Value, Status, Type, Source, Notes, CompanyID, AddBy, CreatedAt)
          VALUES 
            (@ProjectName, @OpenDate, @Value, @Status, @Type, @Source, @Notes, @CompanyID, @AddBy, GETDATE())
          SELECT SCOPE_IDENTITY() AS WhatchlistID
        `);
      
      const newId = result.recordset[0]?.WhatchlistID;
      
      // Fetch the newly created item
      const newItem = await pool.request()
        .input('WhatchlistID', newId)
        .query(`
          SELECT 
            w.WhatchlistID,
            w.ProjectName,
            w.OpenDate,
            w.Value,
            w.Status,
            w.Type,
            w.Source,
            w.Notes,
            w.CreatedAt,
            w.CompanyID,
            w.AddBy,
            c.CompanyName,
            e.Name as AddedByName
          FROM tenderWhatchlist w
          LEFT JOIN tenderCompany c ON w.CompanyID = c.CompanyID
          LEFT JOIN tenderEmployee e ON w.AddBy = e.UserID
          WHERE w.WhatchlistID = @WhatchlistID
        `);
      
      res.status(201).json(newItem.recordset[0]);
    } catch (error) {
      console.error('Error creating watchlist item:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Update a watchlist item
  updateWatchlistItem: async (req, res) => {
    try {
      const pool = await getConnectedPool();
      const { id } = req.params;
      const userId = req.user?.UserID;
      const {
        ProjectName,
        OpenDate,
        Value,
        Status,
        Type,
        Source,
        Notes,
        CompanyID
      } = req.body;
      
      // Check if item exists and user has permission
      const checkResult = await pool.request()
        .input('WhatchlistID', id)
        .input('UserID', userId)
        .query(`
          SELECT WhatchlistID 
          FROM tenderWhatchlist 
          WHERE WhatchlistID = @WhatchlistID 
            AND (AddBy = @UserID OR @UserID IS NULL)
        `);
      
      if (checkResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Watchlist item not found or access denied' });
      }
      
      // Update the item
      await pool.request()
        .input('WhatchlistID', id)
        .input('ProjectName', ProjectName)
        .input('OpenDate', OpenDate || null)
        .input('Value', Value || null)
        .input('Status', Status)
        .input('Type', Type || null)
        .input('Source', Source || null)
        .input('Notes', Notes || null)
        .input('CompanyID', CompanyID || null)
        .query(`
          UPDATE tenderWhatchlist 
          SET 
            ProjectName = @ProjectName,
            OpenDate = @OpenDate,
            Value = @Value,
            Status = @Status,
            Type = @Type,
            Source = @Source,
            Notes = @Notes,
            CompanyID = @CompanyID,
            UpdatedAt = GETDATE()
          WHERE WhatchlistID = @WhatchlistID
        `);
      
      // Fetch the updated item
      const updatedItem = await pool.request()
        .input('WhatchlistID', id)
        .query(`
          SELECT 
            w.WhatchlistID,
            w.ProjectName,
            w.OpenDate,
            w.Value,
            w.Status,
            w.Type,
            w.Source,
            w.Notes,
            w.CreatedAt,
            w.CompanyID,
            w.AddBy,
            c.CompanyName,
            e.Name as AddedByName
          FROM tenderWhatchlist w
          LEFT JOIN tenderCompany c ON w.CompanyID = c.CompanyID
          LEFT JOIN tenderEmployee e ON w.AddBy = e.UserID
          WHERE w.WhatchlistID = @WhatchlistID
        `);
      
      res.json(updatedItem.recordset[0]);
    } catch (error) {
      console.error('Error updating watchlist item:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Delete a watchlist item
  deleteWatchlistItem: async (req, res) => {
    try {
      const pool = await getConnectedPool();
      const { id } = req.params;
      const userId = req.user?.UserID;
      
      // Check if item exists and user has permission
      const checkResult = await pool.request()
        .input('WhatchlistID', id)
        .input('UserID', userId)
        .query(`
          SELECT WhatchlistID 
          FROM tenderWhatchlist 
          WHERE WhatchlistID = @WhatchlistID 
            AND (AddBy = @UserID OR @UserID IS NULL)
        `);
      
      if (checkResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Watchlist item not found or access denied' });
      }
      
      // Delete the item
      await pool.request()
        .input('WhatchlistID', id)
        .query(`
          DELETE FROM tenderWhatchlist 
          WHERE WhatchlistID = @WhatchlistID
        `);
      
      res.json({ success: true, message: 'Watchlist item deleted successfully' });
    } catch (error) {
      console.error('Error deleting watchlist item:', error);
      res.status(500).json({ error: error.message });
    }
  }
};

module.exports = watchlistController;

