// Test script to verify backend-frontend communication
const fetch = require('node-fetch');

const BACKEND_URL = 'https://adco-contracting-8673be3093c5.herokuapp.com';
const FRONTEND_URL = 'https://adcoportal.ie';

async function testBackendConnection() {
    console.log('🔍 Testing Backend-Frontend Communication...\n');
    
    try {
        // Test 1: Health Check
        console.log('1. Testing Health Endpoint...');
        const healthResponse = await fetch(`${BACKEND_URL}/health`);
        const healthData = await healthResponse.json();
        console.log('✅ Health Check:', healthData.status);
        
        // Test 2: CORS Debug
        console.log('\n2. Testing CORS Debug Endpoint...');
        const corsResponse = await fetch(`${BACKEND_URL}/cors-debug`, {
            headers: {
                'Origin': FRONTEND_URL,
                'User-Agent': 'Test-Script/1.0'
            }
        });
        const corsData = await corsResponse.json();
        console.log('✅ CORS Debug:', corsData.message);
        console.log('   Origin:', corsData.origin);
        console.log('   CORS Configuration:', corsData.corsConfiguration);
        
        // Test 3: Root Endpoint
        console.log('\n3. Testing Root Endpoint...');
        const rootResponse = await fetch(`${BACKEND_URL}/`);
        const rootData = await rootResponse.json();
        console.log('✅ Root Endpoint:', rootData.message);
        
        console.log('\n🎉 All backend tests passed!');
        console.log('\n📋 Next Steps:');
        console.log('1. Ensure frontend environment variables are set in Vercel');
        console.log('2. Test frontend connection at:', FRONTEND_URL);
        console.log('3. Check browser console for any CORS errors');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.log('\n🔧 Troubleshooting:');
        console.log('1. Check if backend is deployed to Heroku');
        console.log('2. Verify environment variables in Heroku');
        console.log('3. Check Heroku logs for errors');
    }
}

testBackendConnection(); 