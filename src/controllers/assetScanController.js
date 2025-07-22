const { pool, poolConnect } = require('../config/database');

const assetScanController = {
    createScans: async (req, res) => {
        try {
            const scans = req.body.scans;

            if (!Array.isArray(scans) || scans.length === 0) {
                return res.status(400).json({ message: 'No scans provided' });
            }

            await poolConnect;

            const request = pool.request();

            const sqlStatements = [];

            scans.forEach((scan, index) => {
                request
                    .input(`AssetID_${index}`, scan.AssetID)
                    .input(`Scanned_${index}`, scan.Scanned)
                    .input(`Location_${index}`, scan.Location)
                    .input(`Responsible_${index}`, scan.Responsible);

                // Insert scan into AssetScan
                sqlStatements.push(`
                    INSERT INTO AssetScans (AssetID, Scanned, Location, Responsible)
                    VALUES (@AssetID_${index}, @Scanned_${index}, @Location_${index}, @Responsible_${index});
                `);

                // Update portalAssets: Last_Updated + Responsible
                sqlStatements.push(`
                    UPDATE portalAssets
                    SET Last_Updated = GETDATE(),
                        Responsible = @Responsible_${index},
                        Location = @Location_${index}
                    WHERE AssetID = @AssetID_${index};
                `);
                
            });

            await request.query(sqlStatements.join('\n'));

            res.status(201).json({ message: 'Scans added and assets updated successfully', count: scans.length });
        } catch (err) {
            console.error('Error creating scans:', err);
            res.status(500).json({ message: err.message });
        }
    },
};

module.exports = assetScanController;
