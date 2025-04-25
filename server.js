const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory verification storage (upgrade to database later if needed)
const verifiedUsers = {};

app.post('/verify', (req, res) => {
    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ message: 'Missing userId' });
    }
    verifiedUsers[userId] = true;
    res.json({ message: 'User verified successfully' });
});

app.post('/check-verification', (req, res) => {
    const { userId } = req.body;
    if (verifiedUsers[userId]) {
        res.json({ isVerified: true });
    } else {
        res.json({ isVerified: false });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

