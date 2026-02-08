const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Test DB connection
app.get('/health', async (req, res) => {
  try {
    const client = await pool.connect();
    client.release();
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ status: 'error', database: 'failed', error: error.message });
  }
});

// Create tickets table (runs once)
app.post('/setup', async (req, res) => {
  try {
    const client = await pool.connect();
    
    // Create tickets table from our spec
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

// Create a ticket
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

// List tickets
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
