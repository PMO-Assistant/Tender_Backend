const Project = require('../models/Project');

const projectController = {
    // Get all projects
    getAllProjects: async (req, res) => {
        try {
            const projects = await Project.getAll();
            res.json(projects);
        } catch (err) {
            console.error('Error in getAllProjects:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Get active projects only
    getActiveProjects: async (req, res) => {
        try {
            const activeProjects = await Project.getActiveProjects();
            res.json(activeProjects);
        } catch (err) {
            console.error('Error in getActiveProjects:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Get project by ID
    getProjectById: async (req, res) => {
        try {
            const project = await Project.getById(req.params.id);
            if (!project) {
                return res.status(404).json({ message: 'Project not found' });
            }
            res.json(project);
        } catch (err) {
            console.error('Error in getProjectById:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Create new project
    createProject: async (req, res) => {
        try {
            const created = await Project.create(req.body);
            if (created) {
                return res.status(201).json({ message: 'Project created successfully' });
            }
            res.status(400).json({ message: 'Failed to create project' });
        } catch (err) {
            console.error('Error in createProject:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Update project
    updateProject: async (req, res) => {
        try {
            const updated = await Project.update(req.params.id, req.body);
            if (updated) {
                return res.json({ message: 'Project updated successfully' });
            }
            res.status(404).json({ message: 'Project not found' });
        } catch (err) {
            console.error('Error in updateProject:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Delete project
    deleteProject: async (req, res) => {
        try {
            const deleted = await Project.delete(req.params.id);
            if (deleted) {
                return res.json({ message: 'Project deleted successfully' });
            }
            res.status(404).json({ message: 'Project not found' });
        } catch (err) {
            console.error('Error in deleteProject:', err);
            res.status(500).json({ message: err.message });
        }
    }
};

module.exports = projectController; 