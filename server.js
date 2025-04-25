// ✅ Import libraries
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const twilio = require('twilio');

// ✅ Initialize Express app
const app = express();
app.use(cors());
app.use(bodyParser.json());

// ✅ Twilio credentials from environment variables
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;
const client = new twilio(accountSid, authToken);

// ✅ Verification routes (optional, if you’re using them)
const verifiedUsers = {};

app.post('/verify', (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: 'Missing userId' });
    verifiedUsers[userId] = true;
    res.json({ message: 'User verified successfully' });
});

app.post('/check-verification', (req, res) => {
    const { userId } = req.body;
    res.json({ isVerified: !!verifiedUsers[userId] });
});

// ✅ Send-verse route
app.post('/send-verse', (req, res) => {
    const { verse, phoneNumber } = req.body;

    if (!verse || !phoneNumber) {
        return res.status(400).json({ success: false, error: 'Missing verse or phone number' });
    }

    console.log(`📨 Sending to ${phoneNumber}: ${verse}`);

    client.messages.create({
        body: verse,
        from: fromNumber,
        to: phoneNumber
    })
    .then(message => {
        console.log(`✅ Sent! SID: ${message.sid}`);
        res.status(200).json({ success: true, sid: message.sid });
    })
    .catch(error => {
        console.error(`❌ Twilio error: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    });
});

// ✅ Start server (Render requires dynamic port!)
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
});

