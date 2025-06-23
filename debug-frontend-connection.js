// Debug script to test frontend-backend communication
const fetch = require('node-fetch');

const BACKEND_URL = 'https://adco-contracting-8673be3093c5.herokuapp.com';
const FRONTEND_URL = 'https://adcoportal.ie';

async function debugFrontendConnection() {
    console.log('🔍 Debugging Frontend-Backend Connection...\n');
    
    try {
        // Test 1: Public endpoint (no auth required)
        console.log('1. Testing Public Endpoint (no auth)...');
        const publicResponse = await fetch(`${BACKEND_URL}/public-test`, {
            headers: {
                'Origin': FRONTEND_URL,
                'User-Agent': 'Test-Script/1.0'
            }
        });
        
        if (publicResponse.ok) {
            const publicData = await publicResponse.json();
            console.log('✅ Public endpoint working:', publicData.message);
        } else {
            console.log('❌ Public endpoint failed:', publicResponse.status);
        }
        
        // Test 2: Health endpoint
        console.log('\n2. Testing Health Endpoint...');
        const healthResponse = await fetch(`${BACKEND_URL}/health`, {
            headers: {
                'Origin': FRONTEND_URL,
                'User-Agent': 'Test-Script/1.0'
            }
        });
        
        if (healthResponse.ok) {
            const healthData = await healthResponse.json();
            console.log('✅ Health endpoint working:', healthData.status);
        } else {
            console.log('❌ Health endpoint failed:', healthResponse.status);
        }
        
        // Test 3: CORS Debug
        console.log('\n3. Testing CORS Configuration...');
        const corsResponse = await fetch(`${BACKEND_URL}/cors-debug`, {
            headers: {
                'Origin': FRONTEND_URL,
                'User-Agent': 'Test-Script/1.0'
            }
        });
        
        if (corsResponse.ok) {
            const corsData = await corsResponse.json();
            console.log('✅ CORS debug working');
            console.log('   Origin:', corsData.origin);
            console.log('   CORS Configuration:', corsData.corsConfiguration);
        } else {
            console.log('❌ CORS debug failed:', corsResponse.status);
        }
        
        // Test 4: Protected endpoint (should fail without token)
        console.log('\n4. Testing Protected Endpoint (should fail without token)...');
        const protectedResponse = await fetch(`${BACKEND_URL}/token-test`, {
            headers: {
                'Origin': FRONTEND_URL,
                'User-Agent': 'Test-Script/1.0'
            }
        });
        
        if (protectedResponse.status === 401) {
            console.log('✅ Protected endpoint correctly rejecting unauthorized requests');
        } else {
            console.log('❌ Protected endpoint unexpected response:', protectedResponse.status);
        }
        
        console.log('\n🎉 Backend connectivity tests completed!');
        console.log('\n📋 Frontend Debugging Steps:');
        console.log('1. Open browser console at:', FRONTEND_URL);
        console.log('2. Test public endpoint:');
        console.log(`   fetch('${BACKEND_URL}/public-test')`);
        console.log('3. Test health endpoint:');
        console.log(`   fetch('${BACKEND_URL}/health')`);
        console.log('4. Check for CORS errors in console');
        console.log('5. Verify authentication flow');
        
    } catch (error) {
        console.error('❌ Debug test failed:', error.message);
        console.log('\n🔧 Troubleshooting:');
        console.log('1. Check if backend is deployed to Heroku');
        console.log('2. Verify environment variables in Heroku');
        console.log('3. Check Heroku logs for errors');
        console.log('4. Verify CORS configuration');
    }
}

debugFrontendConnection(); 
 
 
 
 
 