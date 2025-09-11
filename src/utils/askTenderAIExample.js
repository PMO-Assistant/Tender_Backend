/**
 * Example usage of the AskTenderAI Module
 * 
 * This file demonstrates how to use the askTenderAI function
 * with database introspection for natural language queries.
 */

const { getConnectedPool } = require('../config/database');
const { getDatabaseContext } = require('./databaseIntrospection');
const { askTenderAI } = require('./askTenderAI');

/**
 * Example 1: Basic usage with introspection
 */
async function exampleBasicUsage() {
    try {
        console.log('🚀 Example 1: Basic usage with introspection');
        
        // Get database context
        const pool = await getConnectedPool();
        const dbContext = await getDatabaseContext(pool);
        
        // Ask a question
        const question = "How many users are there?";
        console.log(`\n🤔 Question: ${question}`);
        
        const result = await askTenderAI(question, dbContext);
        
        if (result.success) {
            console.log('✅ Success!');
            console.log(`📊 Result count: ${result.resultCount}`);
            console.log('📋 Data:', result.data);
            if (result.fallbackUsed) {
                console.log('⚠️ Note: Fallback query was used');
            }
        } else {
            console.log('❌ Error:', result.error);
        }
        
        return result;
        
    } catch (error) {
        console.error('❌ Error in example:', error);
        throw error;
    }
}

/**
 * Example 2: Multiple questions with the same context
 */
async function exampleMultipleQuestions() {
    try {
        console.log('\n🚀 Example 2: Multiple questions with the same context');
        
        // Get database context once
        const pool = await getConnectedPool();
        const dbContext = await getDatabaseContext(pool);
        
        const questions = [
            "What's the biggest tender?",
            "Show me recent contacts",
            "How many companies do we have?",
            "List all users"
        ];
        
        for (const question of questions) {
            console.log(`\n🤔 Question: ${question}`);
            
            const result = await askTenderAI(question, dbContext);
            
            if (result.success) {
                console.log(`✅ Success! Found ${result.resultCount} results`);
                if (result.fallbackUsed) {
                    console.log('⚠️ Used fallback query');
                }
            } else {
                console.log(`❌ Error: ${result.error}`);
            }
        }
        
    } catch (error) {
        console.error('❌ Error in example:', error);
        throw error;
    }
}

/**
 * Example 3: Error handling and edge cases
 */
async function exampleErrorHandling() {
    try {
        console.log('\n🚀 Example 3: Error handling and edge cases');
        
        const pool = await getConnectedPool();
        const dbContext = await getDatabaseContext(pool);
        
        const testCases = [
            "", // Empty question
            "DROP TABLE users", // Dangerous query
            "What is the meaning of life?", // Philosophical question
            "SELECT * FROM non_existent_table" // Invalid table
        ];
        
        for (const question of testCases) {
            console.log(`\n🤔 Question: "${question}"`);
            
            const result = await askTenderAI(question, dbContext);
            
            if (result.success) {
                console.log(`✅ Success! Found ${result.resultCount} results`);
            } else {
                console.log(`❌ Error: ${result.error}`);
            }
        }
        
    } catch (error) {
        console.error('❌ Error in example:', error);
        throw error;
    }
}

/**
 * Example 4: Performance monitoring
 */
async function examplePerformanceMonitoring() {
    try {
        console.log('\n🚀 Example 4: Performance monitoring');
        
        const pool = await getConnectedPool();
        const dbContext = await getDatabaseContext(pool);
        
        const questions = [
            "How many tenders are there?",
            "What's the biggest tender?",
            "Show me all users",
            "List recent contacts"
        ];
        
        const results = [];
        
        for (const question of questions) {
            const startTime = Date.now();
            
            const result = await askTenderAI(question, dbContext);
            
            const executionTime = Date.now() - startTime;
            
            results.push({
                question,
                success: result.success,
                resultCount: result.resultCount || 0,
                executionTime,
                fallbackUsed: result.fallbackUsed
            });
            
            console.log(`\n🤔 "${question}"`);
            console.log(`⏱️ Execution time: ${executionTime}ms`);
            console.log(`📊 Results: ${result.resultCount || 0}`);
            console.log(`✅ Success: ${result.success}`);
            if (result.fallbackUsed) {
                console.log('⚠️ Fallback used');
            }
        }
        
        // Summary
        const totalTime = results.reduce((sum, r) => sum + r.executionTime, 0);
        const avgTime = totalTime / results.length;
        const successCount = results.filter(r => r.success).length;
        
        console.log('\n📊 Performance Summary:');
        console.log(`- Total questions: ${questions.length}`);
        console.log(`- Successful queries: ${successCount}`);
        console.log(`- Average execution time: ${avgTime.toFixed(2)}ms`);
        console.log(`- Total execution time: ${totalTime}ms`);
        
        return results;
        
    } catch (error) {
        console.error('❌ Error in example:', error);
        throw error;
    }
}

/**
 * Example 5: Integration with existing API
 */
async function exampleAPIIntegration() {
    try {
        console.log('\n🚀 Example 5: API Integration');
        
        // Simulate API request
        const apiRequest = {
            question: "Show me the top 5 tenders by value",
            useIntrospection: true
        };
        
        console.log(`📝 API Request:`, apiRequest);
        
        // Get database context
        const pool = await getConnectedPool();
        const dbContext = await getDatabaseContext(pool);
        
        // Process request
        const result = await askTenderAI(apiRequest.question, dbContext);
        
        // Simulate API response
        const apiResponse = {
            success: result.success,
            data: result.data,
            error: result.error,
            metadata: {
                question: apiRequest.question,
                resultCount: result.resultCount,
                fallbackUsed: result.fallbackUsed,
                timestamp: new Date().toISOString()
            }
        };
        
        console.log('📤 API Response:', apiResponse);
        
        return apiResponse;
        
    } catch (error) {
        console.error('❌ Error in example:', error);
        throw error;
    }
}

// Export examples for use in other files
module.exports = {
    exampleBasicUsage,
    exampleMultipleQuestions,
    exampleErrorHandling,
    examplePerformanceMonitoring,
    exampleAPIIntegration
};

// Run examples if this file is executed directly
if (require.main === module) {
    (async () => {
        try {
            console.log('🚀 Running AskTenderAI examples...\n');
            
            // Example 1: Basic usage
            await exampleBasicUsage();
            
            // Example 2: Multiple questions
            await exampleMultipleQuestions();
            
            // Example 3: Error handling
            await exampleErrorHandling();
            
            // Example 4: Performance monitoring
            await examplePerformanceMonitoring();
            
            // Example 5: API integration
            await exampleAPIIntegration();
            
            console.log('\n✅ All examples completed successfully!');
            
        } catch (error) {
            console.error('❌ Error running examples:', error);
        }
    })();
} 