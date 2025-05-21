const { pool, poolConnect } = require('../config/database');

const eventController = {
    // Get all events
    getAllEvents: async (req, res) => {
        try {
            await poolConnect;
            const { type } = req.query;
    
            let query = 'SELECT * FROM portalEvents';
            const request = pool.request();
    
            // If a type is specified, filter by type
            if (type) {
                query += ' WHERE type = @type';
                request.input('type', type);
            }
    
            const result = await request.query(query);
            res.json(result.recordset);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Get event by ID
    getEventById: async (req, res) => {
        try {
            await poolConnect;
            const result = await pool.request()
                .input('id', req.params.id)
                .query('SELECT * FROM portalEvents WHERE id = @id');
            
            if (result.recordset.length === 0) {
                return res.status(404).json({ message: 'Event not found' });
            }
            
            res.json(result.recordset[0]);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Create new event
    createEvent: async (req, res) => {
        try {
            const { title, description, date, time, location, organizer, type, attendees } = req.body;
            
            await poolConnect;
            const result = await pool.request()
                .input('title', title)
                .input('description', description)
                .input('date', date)
                .input('time', time)
                .input('location', location)
                .input('organizer', organizer)
                .input('type', type)
                .input('attendees', attendees)
                .query(`
                    INSERT INTO portalEvents (title, description, date, time, location, organizer, type, attendees)
                    VALUES (@title, @description, @date, @time, @location, @organizer, @type, @attendees);
                    SELECT SCOPE_IDENTITY() as id;
                `);
            
            res.status(201).json({ 
                id: result.recordset[0].id,
                message: 'Event created successfully' 
            });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Update event
    updateEvent: async (req, res) => {
        try {
            const { title, description, date, time, location, organizer, type, attendees } = req.body;
            
            await poolConnect;
            const result = await pool.request()
                .input('id', req.params.id)
                .input('title', title)
                .input('description', description)
                .input('date', date)
                .input('time', time)
                .input('location', location)
                .input('organizer', organizer)
                .input('type', type)
                .input('attendees', attendees)
                .query(`
                    UPDATE portalEvents 
                    SET title = @title,
                        description = @description,
                        date = @date,
                        time = @time,
                        location = @location,
                        organizer = @organizer,
                        type = @type,
                        attendees = @attendees,
                        updated_at = GETDATE()
                    WHERE id = @id
                `);
            
            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Event not found' });
            }
            
            res.json({ message: 'Event updated successfully' });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Delete event
    deleteEvent: async (req, res) => {
        try {
            await poolConnect;
            const result = await pool.request()
                .input('id', req.params.id)
                .query('DELETE FROM portalEvents WHERE id = @id');
            
            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Event not found' });
            }
            
            res.json({ message: 'Event deleted successfully' });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    }
};

module.exports = eventController; 