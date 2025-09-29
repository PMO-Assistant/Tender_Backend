const { getConnectedPool } = require('../../config/database');
const { authenticateToken } = require('../../middleware/auth');

// Test database connection and table
const testWatchlistTable = async (req, res) => {
  try {
    console.log('Testing watchlist table...');
    
    const pool = await getConnectedPool();
    
    // Test if table exists and is accessible
    const testQuery = 'SELECT COUNT(*) as count FROM tenderWhatchlist';
    const result = await pool.request().query(testQuery);
    
    console.log('Table test result:', result);
    res.json({ 
      success: true, 
      message: 'Watchlist table is accessible',
      count: result.recordset[0].count
    });
  } catch (error) {
    console.error('Error testing watchlist table:', error);
    res.status(500).json({ 
      success: false,
      error: 'Watchlist table test failed',
      details: error.message
    });
  }
};

// Get all watchlist items
const getAllWatchlistItems = async (req, res) => {
  try {
    const pool = await getConnectedPool();
    
    const query = `
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
        c.CompanyName as CompanyName
      FROM tenderWhatchlist w
      LEFT JOIN tenderCompany c ON w.CompanyID = c.CompanyID
      ORDER BY w.CreatedAt DESC
    `;
    
    const result = await pool.request().query(query);
    res.json(result.recordset);
  } catch (error) {
    console.error('Error fetching watchlist:', error);
    res.status(500).json({ error: 'Failed to fetch watchlist items' });
  }
};

// Get single watchlist item
const getWatchlistItem = async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await getConnectedPool();
    
    const query = `
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
        c.CompanyName as CompanyName
      FROM tenderWhatchlist w
      LEFT JOIN tenderCompany c ON w.CompanyID = c.CompanyID
      WHERE w.WhatchlistID = @id
    `;
    
    const request = pool.request();
    request.input('id', parseInt(id));
    const result = await request.query(query);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Watchlist item not found' });
    }
    
    res.json(result.recordset[0]);
  } catch (error) {
    console.error('Error fetching watchlist item:', error);
    res.status(500).json({ error: 'Failed to fetch watchlist item' });
  }
};

// Create new watchlist item
const createWatchlistItem = async (req, res) => {
  try {
    const {
      ProjectName,
      OpenDate,
      Value,
      Status,
      Type,
      Source,
      Notes,
      CompanyID,
      AddBy
    } = req.body;

    console.log('Creating watchlist item with data:', req.body);
    
    // Get the authenticated user ID from the token
    const authenticatedUserId = req.user?.UserID || req.user?.id || 7; // Fallback to 7 (Enos Pinheiro)
    const finalAddBy = (AddBy && AddBy > 0) ? AddBy : authenticatedUserId;
    
    console.log('User ID from token:', req.user);
    console.log('Final AddBy value:', finalAddBy);
    
    console.log('Parsed values:', {
      ProjectName,
      OpenDate: OpenDate ? new Date(OpenDate) : null,
      Value: Value ? parseFloat(Value) : null,
      Status,
      Type,
      Source,
      Notes,
      CompanyID: CompanyID ? parseInt(CompanyID) : null,
      AddBy: finalAddBy
    });

    // Validate required fields
    if (!ProjectName || !Status || !Type || !Source || !finalAddBy || finalAddBy <= 0) {
      console.error('Missing required fields:', { ProjectName, Status, Type, Source, AddBy: finalAddBy });
      return res.status(400).json({ error: 'Missing required fields or invalid user ID' });
    }

    const pool = await getConnectedPool();
    const request = pool.request();

    const query = `
      INSERT INTO tenderWhatchlist (
        ProjectName,
        OpenDate,
        Value,
        Status,
        Type,
        Source,
        Notes,
        CompanyID,
        AddBy,
        CreatedAt
      )
      VALUES (
        @ProjectName,
        @OpenDate,
        @Value,
        @Status,
        @Type,
        @Source,
        @Notes,
        @CompanyID,
        @AddBy,
        SYSUTCDATETIME()
      )
      
      SELECT SCOPE_IDENTITY() as WhatchlistID
    `;

    // Add parameters
    request.input('ProjectName', ProjectName);
    request.input('OpenDate', OpenDate ? new Date(OpenDate) : null);
    request.input('Value', Value ? parseFloat(Value) : null);
    request.input('Status', Status);
    request.input('Type', Type);
    request.input('Source', Source);
    request.input('Notes', Notes);
    request.input('CompanyID', CompanyID ? parseInt(CompanyID) : null);
    request.input('AddBy', parseInt(finalAddBy));

    console.log('Executing query with params:', {
      ProjectName,
      OpenDate: OpenDate ? new Date(OpenDate) : null,
      Value: Value ? parseFloat(Value) : null,
      Status,
      Type,
      Source,
      Notes,
      CompanyID: CompanyID ? parseInt(CompanyID) : null,
      AddBy: parseInt(finalAddBy)
    });

    const result = await request.query(query);
    console.log('Query result:', result);

    res.status(201).json({ 
      WhatchlistID: result.recordset[0].WhatchlistID,
      message: 'Watchlist item created successfully' 
    });
  } catch (error) {
    console.error('Error creating watchlist item:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      number: error.number,
      state: error.state,
      severity: error.severity
    });
    res.status(500).json({ error: 'Failed to create watchlist item' });
  }
};

// Update watchlist item
const updateWatchlistItem = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    console.log('Updating watchlist item:', id, 'with data:', updateData);

    const pool = await getConnectedPool();
    const request = pool.request();

    // Build dynamic UPDATE query based on provided fields
    const updateFields = [];
    const allowedFields = ['ProjectName', 'OpenDate', 'Value', 'Status', 'Type', 'Source', 'Notes', 'CompanyID'];
    
    for (const [key, value] of Object.entries(updateData)) {
      if (allowedFields.includes(key) && value !== undefined) {
        updateFields.push(`${key} = @${key}`);
        
        // Handle different data types
        if (key === 'OpenDate') {
          request.input(key, value ? new Date(value) : null);
        } else if (key === 'Value') {
          request.input(key, value !== null && value !== '' ? parseFloat(value) : null);
        } else if (key === 'CompanyID') {
          request.input(key, value ? parseInt(value) : null);
        } else {
          request.input(key, value);
        }
      }
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const query = `
      UPDATE tenderWhatchlist 
      SET ${updateFields.join(', ')}
      WHERE WhatchlistID = @id
    `;

    request.input('id', parseInt(id));

    console.log('Executing query:', query);
    console.log('With parameters:', Object.keys(updateData).filter(key => allowedFields.includes(key)));

    await request.query(query);

    res.json({ message: 'Watchlist item updated successfully' });
  } catch (error) {
    console.error('Error updating watchlist item:', error);
    res.status(500).json({ error: 'Failed to update watchlist item' });
  }
};

// Delete watchlist item
const deleteWatchlistItem = async (req, res) => {
  try {
    const { id } = req.params;
    
    const pool = await getConnectedPool();
    const request = pool.request();
    
    const query = 'DELETE FROM tenderWhatchlist WHERE WhatchlistID = @id';
    request.input('id', parseInt(id));
    await request.query(query);
    
    res.json({ message: 'Watchlist item deleted successfully' });
  } catch (error) {
    console.error('Error deleting watchlist item:', error);
    res.status(500).json({ error: 'Failed to delete watchlist item' });
  }
};

module.exports = {
  testWatchlistTable,
  getAllWatchlistItems,
  getWatchlistItem,
  createWatchlistItem,
  updateWatchlistItem,
  deleteWatchlistItem
};


