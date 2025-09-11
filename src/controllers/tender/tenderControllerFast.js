// Simple and fast tender report controller
// This version avoids timeouts and uses direct SQL queries
const { getConnectedPool } = require('../../config/database');

const tenderController = {
    // Get tender report data using simple SQL queries
    getTenderReportData: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            const { dateRange = 'all', category = 'all' } = req.query;
            
            console.log('📊 getTenderReportData called with:', { dateRange, category });
            
            // Calculate start date based on date range (limit to reasonable ranges)
            let startDate = new Date();
            if (dateRange === '30d') {
                startDate.setDate(startDate.getDate() - 30);
            } else if (dateRange === '90d') {
                startDate.setDate(startDate.getDate() - 90);
            } else if (dateRange === '6m') {
                startDate.setMonth(startDate.getMonth() - 6);
            } else if (dateRange === '1y') {
                startDate.setFullYear(startDate.getFullYear() - 1);
            } else {
                // For 'all', limit to last 5 years to avoid timeouts
                startDate.setFullYear(startDate.getFullYear() - 5);
            }
            
            const startDateStr = startDate.toISOString().split('T')[0];
            
            // Build category filter
            const categoryFilter = category !== 'all' ? `AND t.Type = '${category}'` : '';
            
            // Simple query that groups by month directly
            const result = await pool.request()
                .query(`
                    SELECT 
                        FORMAT(COALESCE(t.ReturnDate, t.OpenDate, t.CreatedAt), 'yyyy-MM') AS MonthKey,
                        COALESCE(SUM(t.Value), 0) AS TotalValue,
                        COUNT(t.TenderID) AS TenderCount,
                        COALESCE(SUM(CASE WHEN t.Status LIKE '%awarded%' OR t.Status LIKE '%won%' OR t.Status LIKE '%success%' THEN t.Value ELSE 0 END), 0) AS AwardedValue,
                        COUNT(CASE WHEN t.Status LIKE '%awarded%' OR t.Status LIKE '%won%' OR t.Status LIKE '%success%' THEN t.TenderID END) AS AwardedCount,
                        CASE 
                            WHEN COUNT(t.TenderID) > 0 THEN COALESCE(SUM(t.Value), 0) / COUNT(t.TenderID)
                            ELSE 0 
                        END AS AverageValue
                    FROM tenderTender t
                    WHERE t.IsDeleted = 0
                    ${categoryFilter}
                    AND COALESCE(t.ReturnDate, t.OpenDate, t.CreatedAt) >= '${startDateStr}'
                    AND COALESCE(t.ReturnDate, t.OpenDate, t.CreatedAt) IS NOT NULL
                    GROUP BY FORMAT(COALESCE(t.ReturnDate, t.OpenDate, t.CreatedAt), 'yyyy-MM')
                    ORDER BY MonthKey
                `);
            
            console.log(`📊 Query returned ${result.recordset.length} months of data`);
            
            // Convert to chart data format
            const chartData = result.recordset.map(row => ({
                date: row.MonthKey,
                value: row.TotalValue,
                tenderCount: row.TenderCount,
                awardedValue: row.AwardedValue,
                awardedCount: row.AwardedCount,
                averageValue: row.AverageValue
            }));
            
            // Get summary statistics
            const summaryResult = await pool.request()
                .query(`
                    SELECT 
                        COALESCE(SUM(t.Value), 0) AS TotalValue,
                        COUNT(t.TenderID) AS TotalTenders,
                        COALESCE(SUM(CASE WHEN t.Status LIKE '%awarded%' OR t.Status LIKE '%won%' OR t.Status LIKE '%success%' THEN t.Value ELSE 0 END), 0) AS TotalAwardedValue,
                        COUNT(CASE WHEN t.Status LIKE '%awarded%' OR t.Status LIKE '%won%' OR t.Status LIKE '%success%' THEN t.TenderID END) AS TotalAwardedTenders,
                        CASE 
                            WHEN COUNT(t.TenderID) > 0 THEN COALESCE(SUM(t.Value), 0) / COUNT(t.TenderID)
                            ELSE 0 
                        END AS AverageValue
                    FROM tenderTender t
                    WHERE t.IsDeleted = 0
                    ${categoryFilter}
                    AND COALESCE(t.ReturnDate, t.OpenDate, t.CreatedAt) >= '${startDateStr}'
                    AND COALESCE(t.ReturnDate, t.OpenDate, t.CreatedAt) IS NOT NULL
                `);
            
            const summaryData = summaryResult.recordset[0];
            
            console.log('📊 Chart data sample:', chartData.slice(0, 3));
            console.log('📊 Summary data:', summaryData);
            
            res.json({
                success: true,
                data: {
                    tenders: [], // We don't need individual tender data for the chart
                    chartData: chartData,
                    summary: {
                        totalValue: summaryData.TotalValue,
                        totalTenders: summaryData.TotalTenders,
                        totalAwardedValue: summaryData.TotalAwardedValue,
                        totalAwardedTenders: summaryData.TotalAwardedTenders,
                        averageValue: summaryData.AverageValue,
                        valueChange: 0, // We'll calculate this if needed
                        dateRange: {
                            firstTenderDate: startDateStr,
                            lastTenderDate: new Date().toISOString().split('T')[0]
                        }
                    }
                }
            });
            
        } catch (err) {
            console.error('Error getting tender report data:', err);
            res.status(500).json({ 
                success: false, 
                message: err.message 
            });
        }
    },

    // Get tender categories
    getTenderCategories: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            const result = await pool.request()
                .query(`
                    SELECT DISTINCT Type as category
                    FROM tenderTender 
                    WHERE IsDeleted = 0 AND Type IS NOT NULL
                    ORDER BY Type
                `);
            
            res.json({
                success: true,
                data: result.recordset.map(row => row.category)
            });
        } catch (err) {
            console.error('Error getting tender categories:', err);
            res.status(500).json({ 
                success: false, 
                message: err.message 
            });
        }
    }
};

module.exports = tenderController;


