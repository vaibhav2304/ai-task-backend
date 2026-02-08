const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Health check
app.get('/health', async (req, res) => {
  try {
    const client = await pool.connect();
    client.release();
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ status: 'error', database: 'failed', error: error.message });
  }
});

// Setup tables
app.post('/setup', async (req, res) => {
  try {
    const client = await pool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id SERIAL PRIMARY KEY,
        ticket_number VARCHAR(20) UNIQUE NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(50) DEFAULT 'new',
        priority VARCHAR(20) DEFAULT 'medium',
        source VARCHAR(50),
        source_identifier VARCHAR(255),
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        metadata JSONB DEFAULT '{}'
      )
    `);
    client.release();
    res.json({ status: 'ok', message: 'Tickets table created' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tickets API
app.post('/api/tickets', async (req, res) => {
  try {
    const { title, description, source = 'manual' } = req.body;
    const ticketNumber = `TK-${Date.now()}`;
    
    const client = await pool.connect();
    const result = await client.query(
      `INSERT INTO tickets (ticket_number, title, description, source) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [ticketNumber, title, description, source]
    );
    client.release();
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/tickets', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM tickets ORDER BY created_at DESC');
    client.release();
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// NEW: Poll Slack DMs for "new task"
app.get('/poll-slack', async (req, res) => {
  try {
    // Get your DMs
    const dmsResp = await axios.get('https://slack.com/api/conversations.list', {
      headers: { Authorization: `Bearer ${process.env.SLACK_USER_TOKEN}` }
    });
    
    const dms = dmsResp.data.channels.filter(c => c.is_im);
    let newTickets = 0;

    for (const dm of dms.slice(0, 3)) { // Check last 3 DMs
      const msgsResp = await axios.get('https://slack.com/api/conversations.history', {
        headers: { Authorization: `Bearer ${process.env.SLACK_USER_TOKEN}` },
        params: { channel: dm.id, limit: 10 }
      });

      for (const msg of msgsResp.data.messages) {
        if (msg.text && msg.text.toLowerCase().includes('new task')) {
          // Create ticket
          const ticketNumber = `TK-${Date.now()}`;
          const client = await pool.connect();
          await client.query(
            `INSERT INTO tickets (ticket_number, title, description, source, source_identifier, created_by) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [ticketNumber, msg.text.substring(0, 100), msg.text, 'slack-dm', dm.name, msg.user]
          );
          client.release();
          
          newTickets++;
        }
      }
    }

    res.json({ scanned: dms.length, newTickets });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
