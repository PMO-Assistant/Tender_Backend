const { pool, poolConnect } = require('../config/database');

class Project {
    static async getAll() {
        try {
            await poolConnect;
            const result = await pool.request().query('SELECT * FROM PortalProjects ORDER BY ProjectName');
            return result.recordset;
        } catch (err) {
            throw err;
        }
    }

    static async getById(projectNo) {
        try {
            await poolConnect;
            const result = await pool.request()
                .input('projectNo', projectNo)
                .query('SELECT * FROM PortalProjects WHERE ProjectNo = @projectNo');
            return result.recordset[0];
        } catch (err) {
            throw err;
        }
    }

    static async create(project) {
        try {
            await poolConnect;
            const result = await pool.request()
                .input('projectNo', project.projectNo)
                .input('projectName', project.projectName)
                .input('startDate', project.startDate)
                .input('finishDate', project.finishDate)
                .query(`
                    INSERT INTO PortalProjects (ProjectNo, ProjectName, StartDate, FinishDate)
                    VALUES (@projectNo, @projectName, @startDate, @finishDate)
                `);
            return result.rowsAffected[0] > 0;
        } catch (err) {
            throw err;
        }
    }

    static async update(projectNo, project) {
        try {
            await poolConnect;
            const result = await pool.request()
                .input('projectNo', projectNo)
                .input('projectName', project.projectName)
                .input('startDate', project.startDate)
                .input('finishDate', project.finishDate)
                .query(`
                    UPDATE PortalProjects 
                    SET ProjectName = @projectName,
                        StartDate = @startDate,
                        FinishDate = @finishDate
                    WHERE ProjectNo = @projectNo
                `);
            return result.rowsAffected[0] > 0;
        } catch (err) {
            throw err;
        }
    }

    static async delete(projectNo) {
        try {
            await poolConnect;
            const result = await pool.request()
                .input('projectNo', projectNo)
                .query('DELETE FROM PortalProjects WHERE ProjectNo = @projectNo');
            return result.rowsAffected[0] > 0;
        } catch (err) {
            throw err;
        }
    }

    static async getActiveProjects() {
        try {
            await poolConnect;
            const result = await pool.request().query(`
                SELECT * FROM PortalProjects 
                WHERE Status = 'Active'
                ORDER BY ProjectName
            `);
            return result.recordset;
        } catch (err) {
            throw err;
        }
    }
}

module.exports = Project; 