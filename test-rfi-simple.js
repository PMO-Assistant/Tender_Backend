const axios = require('axios');

async function testRFIEndpoints() {
  const baseURL = 'http://localhost:3001/api/rfi';
  const tenderId = 1336;
  
  // Test token (you'll need to replace with a real JWT token)
  const testToken = 'test-token';
  
  console.log('🧪 Testing RFI Endpoints...\n');

  try {
    // 1. Test GET RFIs (should return empty array initially)
    console.log('1️⃣ Testing GET RFIs...');
    const getResponse = await axios.get(`${baseURL}/${tenderId}`, {
      headers: { 'Authorization': `Bearer ${testToken}` }
    });
    console.log('✅ GET RFIs:', getResponse.data);
    console.log('');

    // 2. Test CREATE text RFI
    console.log('2️⃣ Testing CREATE text RFI...');
    const createResponse = await axios.post(`${baseURL}/${tenderId}/text`, {
      type: 'General Question',
      content: '<h3>Test RFI</h3><p>This is a test RFI with Q&A format.</p><h4>Question:</h4><p>What is the project timeline?</p><h4>Answer:</h4><p>The project timeline is 6 months.</p>'
    }, {
      headers: { 
        'Authorization': `Bearer ${testToken}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('✅ CREATE RFI:', createResponse.data);
    const rfiId = createResponse.data.rfiId;
    console.log('');

    // 3. Test GET specific RFI
    console.log('3️⃣ Testing GET specific RFI...');
    const getSpecificResponse = await axios.get(`${baseURL}/${tenderId}/${rfiId}`, {
      headers: { 'Authorization': `Bearer ${testToken}` }
    });
    console.log('✅ GET specific RFI:', getSpecificResponse.data);
    console.log('');

    // 4. Test UPDATE RFI
    console.log('4️⃣ Testing UPDATE RFI...');
    const updateResponse = await axios.put(`${baseURL}/${tenderId}/${rfiId}`, {
      type: 'Updated Question',
      content: '<h3>Updated RFI</h3><p>This RFI has been updated.</p>'
    }, {
      headers: { 
        'Authorization': `Bearer ${testToken}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('✅ UPDATE RFI:', updateResponse.data);
    console.log('');

    // 5. Test GET RFIs again (should now show the created RFI)
    console.log('5️⃣ Testing GET RFIs again...');
    const getResponse2 = await axios.get(`${baseURL}/${tenderId}`, {
      headers: { 'Authorization': `Bearer ${testToken}` }
    });
    console.log('✅ GET RFIs (after create):', getResponse2.data);
    console.log('');

    // 6. Test DELETE RFI
    console.log('6️⃣ Testing DELETE RFI...');
    const deleteResponse = await axios.delete(`${baseURL}/${tenderId}/${rfiId}`, {
      headers: { 'Authorization': `Bearer ${testToken}` }
    });
    console.log('✅ DELETE RFI:', deleteResponse.data);
    console.log('');

    // 7. Test GET RFIs final (should be empty again)
    console.log('7️⃣ Testing GET RFIs final...');
    const getResponse3 = await axios.get(`${baseURL}/${tenderId}`, {
      headers: { 'Authorization': `Bearer ${testToken}` }
    });
    console.log('✅ GET RFIs (after delete):', getResponse3.data);

    console.log('\n🎉 All RFI endpoint tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

testRFIEndpoints();

