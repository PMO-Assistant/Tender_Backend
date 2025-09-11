// Simple controller using stored procedure
const { getConnectedPool } = require('../../config/database');

const tenderController = {
    // Get tender report data using stored procedure
    getTenderReportData: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            const { dateRange = 'all', category = 'all' } = req.query;
            
            console.log('📊 getTenderReportData called with:', { dateRange, category });
            
            // Use the stored procedure for efficient data retrieval
            const result = await pool.request()
                .input('DateRange', dateRange)
                .input('Category', category)
                .execute('sp_GetTenderReportData');
            
            console.log(`📊 Stored procedure returned ${result.recordset.length} months of data`);
            
            // The stored procedure returns two result sets:
            // 1. Monthly data (chart data)
            // 2. Summary statistics
            
            const chartData = result.recordset.map(row => ({
                date: row.MonthKey,
                value: row.TotalValue,
                tenderCount: row.TenderCount,
                awardedValue: row.AwardedValue,
                awardedCount: row.AwardedCount,
                averageValue: row.AverageValue
            }));
            
            // Get the summary data from the second result set
            const summaryResult = await pool.request()
                .input('DateRange', dateRange)
                .input('Category', category)
                .execute('sp_GetTenderReportData');
            
            // Skip the first result set (chart data) and get the second (summary)
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
                            firstTenderDate: summaryData.FirstTenderDate,
                            lastTenderDate: summaryData.LastTenderDate
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


