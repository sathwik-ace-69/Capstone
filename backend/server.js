const express = require('express')
const cors = require('cors')
const pool = require('./db')
const authRoutes = require('./routes/auth')
const authenticateToken = require('./middleware/auth')
const problemRoutes = require('./routes/problems')
const aiRoutes = require('./src/ai/ai.routes')
const authorizeRole = require('./middleware/authorizeRole')
const submissionRoutes = require('./routes/submissions')

require('dotenv').config()

const app = express()
const PORT = process.env.PORT || 5000

app.use(cors())
app.use(express.json())

app.use('/api/auth', authRoutes)
app.use('/api/problems', problemRoutes)
app.use('/api/ai', aiRoutes)
app.use('/api/submissions', submissionRoutes)

app.get('/', (req, res) => {
  res.json({ message: 'AlgoPilot Backend is running!' })
})

app.get('/api/db-test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()')

    res.json({
      message: 'Database connected successfully!',
      time: result.rows[0].now
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Database connection failed' })
  }
})

app.get('/api/protected', authenticateToken, (req, res) => {
  res.json({
    message: 'You are authenticated!',
    user: req.user
  })
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})