
const JUDGE0_URL = 'https://ce.judge0.com'

const LANGUAGE_IDS = {
  python: 100,
  javascript: 102,
  cpp: 105,
  java: 91
}

async function executeCode({ sourceCode, language, stdin = '' }) {
  const languageId = LANGUAGE_IDS[language]

  if (!languageId) {
    throw new Error(`Unsupported language: ${language}`)
  }

  if (typeof sourceCode !== 'string' || !sourceCode.trim()) {
    throw new Error('Source code is required')
  }

  const response = await fetch(
    `${JUDGE0_URL}/submissions?base64_encoded=false&wait=true`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source_code: sourceCode,
        language_id: languageId,
        stdin
      }),
      signal: AbortSignal.timeout(15000)
    }
  )

  if (!response.ok) {
    throw new Error(`Judge0 request failed: ${response.status}`)
  }

  return response.json()
}

module.exports = {
  executeCode,
  LANGUAGE_IDS
}


