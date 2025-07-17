const { pool, poolConnect } = require('../config/database');

const projectController = {
    // Get all projects
    getAllProjects: async (req, res) => {
        try {
            await poolConnect;
            const result = await pool.request().query('SELECT * FROM PortalProjects ORDER BY ProjectName');
            res.json(result.recordset);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Get active projects (based on Status column)
    getActiveProjects: async (req, res) => {
        try {
            await poolConnect;
            const result = await pool.request().query(`
                SELECT * FROM PortalProjects 
                WHERE Status = 'Active'
                ORDER BY ProjectName
            `);
            res.json(result.recordset);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Get project by ID
    getProjectById: async (req, res) => {
        try {
            await poolConnect;
            const result = await pool.request()
                .input('projectNo', req.params.id)
                .query('SELECT * FROM PortalProjects WHERE ProjectNo = @projectNo');
            
            if (result.recordset.length === 0) {
                return res.status(404).json({ message: 'Project not found' });
            }
            
            res.json(result.recordset[0]);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Create new project
    createProject: async (req, res) => {
        try {
            const { projectNo, projectName, startDate, finishDate } = req.body;

            // Validate required fields
            if (!projectNo || !projectName || !startDate) {
                return res.status(400).json({ 
                    message: 'ProjectNo, ProjectName, and StartDate are required' 
                });
            }
            
            await poolConnect;
            const result = await pool.request()
                .input('projectNo', projectNo)
                .input('projectName', projectName)
                .input('startDate', startDate)
                .input('finishDate', finishDate)
                .query(`
                    INSERT INTO PortalProjects (ProjectNo, ProjectName, StartDate, FinishDate)
                    VALUES (@projectNo, @projectName, @startDate, @finishDate)
                `);
            
            res.status(201).json({ 
                projectNo,
                projectName,
                startDate,
                finishDate,
                message: 'Project created successfully'
            });
        } catch (err) {
            console.error('Error creating project:', err);
            if (err.number === 2627) { // Primary key violation
                res.status(409).json({ message: 'Project number already exists' });
            } else {
                res.status(500).json({ message: err.message });
            }
        }
    },

    // Update project
    updateProject: async (req, res) => {
        try {
            const { projectName, startDate, finishDate } = req.body;

            // Validate required fields
            if (!projectName || !startDate) {
                return res.status(400).json({ 
                    message: 'ProjectName and StartDate are required' 
                });
            }
            
            await poolConnect;
            const result = await pool.request()
                .input('projectNo', req.params.id)
                .input('projectName', projectName)
                .input('startDate', startDate)
                .input('finishDate', finishDate)
                .query(`
                    UPDATE PortalProjects 
                    SET ProjectName = @projectName,
                        StartDate = @startDate,
                        FinishDate = @finishDate
                    WHERE ProjectNo = @projectNo
                `);
            
            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Project not found' });
            }
            
            res.json({ message: 'Project updated successfully' });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Delete project
    deleteProject: async (req, res) => {
        try {
            await poolConnect;
            const result = await pool.request()
                .input('projectNo', req.params.id)
                .query('DELETE FROM PortalProjects WHERE ProjectNo = @projectNo');
            
            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Project not found' });
            }
            
            res.json({ message: 'Project deleted successfully' });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    }
};

module.exports = projectController; 