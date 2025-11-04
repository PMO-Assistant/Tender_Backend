/**
 * Script to apply indexes for tenderFileFav table
 * Run this with: node sql/apply_file_fav_indexes.js
 */

const sql = require('mssql');
const fs = require('fs');
const path = require('path');

// Database configuration - adjust as needed
const config = {
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_NAME || 'YourDatabaseName',
    user: process.env.DB_USER || 'YourUsername',
    password: process.env.DB_PASSWORD || 'YourPassword',
    options: {
        encrypt: false, // Use true if using Azure SQL
        trustServerCertificate: true
    }
};

async function applyIndexes() {
    try {
        console.log('Connecting to database...');
        await sql.connect(config);
        console.log('Connected to database');

        // Read the SQL file
        const sqlFile = path.join(__dirname, 'tenderFileFav_indexes.sql');
        const sqlScript = fs.readFileSync(sqlFile, 'utf8');

        // Split by GO statements if present, otherwise execute as-is
        const statements = sqlScript
            .split(/GO\s*/i)
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--'));

        console.log(`Found ${statements.length} index statements to execute`);

        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i];
            if (statement.trim()) {
                try {
                    console.log(`\nExecuting index ${i + 1}/${statements.length}...`);
                    await sql.query(statement);
                    console.log(`✅ Index ${i + 1} created successfully`);
                } catch (err) {
                    // Check if index already exists
                    if (err.message.includes('already exists')) {
                        console.log(`⚠️  Index ${i + 1} already exists, skipping...`);
                    } else {
                        console.error(`❌ Error creating index ${i + 1}:`, err.message);
                        throw err;
                    }
                }
            }
        }

        console.log('\n✅ All indexes applied successfully!');
    } catch (err) {
        console.error('❌ Error applying indexes:', err);
        process.exit(1);
    } finally {
        await sql.close();
    }
}

// Run the script
applyIndexes();




