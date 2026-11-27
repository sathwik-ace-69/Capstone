
const express = require('express')
const authenticateToken = require('../middleware/auth')
const pool = require('../db')
const { executeCode, LANGUAGE_IDS } = require('../services/judge0')

const router = express.Router()

// Run code without permanently saving a submission.
router.post('/run', authenticateToken, async (req, res) => {
  try {
    const { sourceCode, language, stdin = '' } = req.body

    if (typeof sourceCode !== 'string' || !sourceCode.trim()) {
      return res.status(400).json({ message: 'Source code is required' })
    }

    if (!LANGUAGE_IDS[language]) {
      return res.status(400).json({ message: 'Unsupported programming language' })
    }

    if (typeof stdin !== 'string') {
      return res.status(400).json({ message: 'Input must be a string' })
    }

    if (sourceCode.length > 50000 || stdin.length > 10000) {
      return res.status(413).json({
        message: 'Code or input exceeds the allowed size'
      })
    }

    const result = await executeCode({ sourceCode, language, stdin })

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

// Submit code and evaluate it against all test cases.

// Submit code and evaluate it against all test cases.
router.post('/submit', authenticateToken, async (req, res) => {
  let client
  let transactionStarted = false

  try {
    // Only students can submit solutions.
    if (req.user.role !== 'student') {
      return res.status(403).json({
        message: 'Only students can submit solutions'
      })
    }

    const { problemId, sourceCode, language } = req.body

    // Validate problem ID.
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

    if (!uuidRegex.test(problemId || '')) {
      return res.status(400).json({
        message: 'A valid problem ID is required'
      })
    }

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

    if (sourceCode.length > 50000) {
      return res.status(413).json({
        message: 'Code exceeds the allowed size'
      })
    }

    // Verify that the problem exists and is published.
    const problemResult = await pool.query(
      `SELECT id
       FROM problems
       WHERE id = $1 AND status = 'published'`,
      [problemId]
    )

    if (problemResult.rows.length === 0) {
      return res.status(404).json({
        message: 'Published problem not found'
      })
    }

    // Retrieve all test cases, including hidden ones.
    const testCasesResult = await pool.query(
      `SELECT input, expected_output, is_hidden
       FROM test_cases
       WHERE problem_id = $1
       ORDER BY created_at ASC`,
      [problemId]
    )

    const testCases = testCasesResult.rows

    if (testCases.length === 0) {
      return res.status(404).json({
        message: 'No test cases found for this problem'
      })
    }

    let passedTestCases = 0
    let totalExecutionTime = 0
    let maximumMemoryUsed = 0
    let finalStatus = 'Accepted'

    const results = []

    // Execute the solution against each test case.
    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i]

      const result = await executeCode({
        sourceCode,
        language,
        stdin: testCase.input
      })

      // Collect execution metrics whenever Judge0 provides them.
      totalExecutionTime += Math.round(
        Number(result.time || 0) * 1000
      )

      maximumMemoryUsed = Math.max(
        maximumMemoryUsed,
        Number(result.memory || 0)
      )

      const judgeStatus =
        result.status?.description || 'Execution Error'

      // Handle compilation errors, runtime errors, time limits, etc.
      if (judgeStatus !== 'Accepted') {
        finalStatus = judgeStatus

        results.push({
          testCase: i + 1,
          passed: false,
          status: judgeStatus,
          hidden: Boolean(testCase.is_hidden)
        })

        break
      }

      // Compare actual output with expected output.
      const actualOutput = (result.stdout || '')
        .replace(/\r\n/g, '\n')
        .trim()

      const expectedOutput = (testCase.expected_output || '')
        .replace(/\r\n/g, '\n')
        .trim()

      const passed = actualOutput === expectedOutput

      if (passed) {
        passedTestCases++
      } else {
        finalStatus = 'Wrong Answer'
      }

      // Never return hidden test inputs or expected outputs.
      results.push({
        testCase: i + 1,
        passed,
        status: passed ? 'Passed' : 'Failed',
        hidden: Boolean(testCase.is_hidden)
      })

      // Stop after the first failed test case.
      if (!passed) {
        break
      }
    }

    // Start a database transaction for both database writes.
    client = await pool.connect()

    await client.query('BEGIN')
    transactionStarted = true

    // Save the submission.
    const submissionResult = await client.query(
      `INSERT INTO submissions
       (user_id, problem_id, language, source_code, status,
        execution_time, memory_used, passed_test_cases, total_test_cases)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, status, passed_test_cases, total_test_cases, submitted_at`,
      [
        req.user.id,
        problemId,
        language,
        sourceCode,
        finalStatus,
        totalExecutionTime,
        maximumMemoryUsed,
        passedTestCases,
        testCases.length
      ]
    )

    // Update the student's progress.
    if (finalStatus === 'Accepted') {
      await client.query(
        `INSERT INTO user_progress
         (user_id, problem_id, status, solved_at)
         VALUES ($1, $2, 'solved', CURRENT_TIMESTAMP)
         ON CONFLICT (user_id, problem_id)
         DO UPDATE SET
           status = 'solved',
           solved_at = COALESCE(
             user_progress.solved_at,
             CURRENT_TIMESTAMP
           )`,
        [req.user.id, problemId]
      )
    } else {
      await client.query(
        `INSERT INTO user_progress
         (user_id, problem_id, status)
         VALUES ($1, $2, 'attempted')
         ON CONFLICT (user_id, problem_id)
         DO UPDATE SET
           status = CASE
             WHEN user_progress.status = 'solved' THEN 'solved'
             ELSE 'attempted'
           END`,
        [req.user.id, problemId]
      )
    }

    // Both writes succeeded.
    await client.query('COMMIT')
    transactionStarted = false

    return res.status(200).json({
      submission: submissionResult.rows[0],
      verdict: finalStatus,
      passedTestCases,
      totalTestCases: testCases.length,
      executionTime: totalExecutionTime,
      memoryUsed: maximumMemoryUsed,
      results
    })
  } catch (error) {
    // Undo database changes if the transaction failed.
    if (client && transactionStarted) {
      await client.query('ROLLBACK').catch(() => {})
    }

    console.error('Submission evaluation error:', error.message)

    return res.status(500).json({
      message: 'Unable to evaluate submission'
    })
  } finally {
    if (client) {
      client.release()
    }
  }
})


module.exports = router
