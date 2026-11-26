
const express = require('express')
const authenticateToken = require('../middleware/auth')
const { executeCode, LANGUAGE_IDS } = require('../services/judge0')

const router = express.Router()

// Run code without permanently saving a submission.
router.post('/run', authenticateToken, async (req, res) => {
  try {
    const { sourceCode, language, stdin = '' } = req.body

    // Validate the request.
    if (typeof sourceCode !== 'string' || !sourceCode.trim()) {
      return res.status(400).json({
        message: 'Source code is required'
      })
    }

    if (!LANGUAGE_IDS[language]) {
      return res.status(400).json({
        message: 'Unsupported programming language'
      })
    }

    if (typeof stdin !== 'string') {
      return res.status(400).json({
        message: 'Input must be a string'
      })
    }

    // Basic request-size limits.
    if (sourceCode.length > 50000 || stdin.length > 10000) {
      return res.status(413).json({
        message: 'Code or input exceeds the allowed size'
      })
    }

    // Execute using Judge0.
    const result = await executeCode({
      sourceCode,
      language,
      stdin
    })

    return res.status(200).json({
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      compile_output: result.compile_output,
      execution_time: result.time,
      memory_used: result.memory,
      message: result.message
    })
  } catch (error) {
    console.error('Code execution error:', error.message)

    return res.status(502).json({
      message: 'Code execution service is temporarily unavailable'
    })
  }
})

module.exports = router

