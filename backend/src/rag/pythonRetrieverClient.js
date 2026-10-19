/**
 * pythonRetrieverClient.js — calls the Python retrieval service (POST /retrieve).
 * Only used when USE_PYTHON_RETRIEVER=true. Fails loudly, never falls back silently.
 */

import { ProviderUnavailableError } from '../utils/providerErrors.js';

const TIMEOUT_MS = 8000;

// Python error code -> the error type ZUNO already understands
const ERROR_TYPES = {
  RATE_LIMITED: 'rate_limit',
  SERVICE_MISCONFIGURED: 'auth_error',
  UNAUTHORIZED: 'auth_error',
  UPSTREAM_UNREACHABLE: 'network_error',
};

export const retrieveFromPython = async (query, options = {}) => {
  // Read env inside the function, so it works even if dotenv loads late.
  const url = `${process.env.PYTHON_RETRIEVER_URL}/retrieve`;

  const body = { query, topK: options.topK || 5 };

  // Focus mode: Node calls it chapter_no, Python calls it chapterNo
  if (options.metadataFilter) {
    body.chapter = {
      subject: options.metadataFilter.subject,
      section: options.metadataFilter.section,
      chapterNo: options.metadataFilter.chapter_no,
    };
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': process.env.INTERNAL_API_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // Python is down, or it took more than 8 seconds
    throw new ProviderUnavailableError('network_error', error.message);
  }

  if (!response.ok) {
    let code = null;
    try {
      const data = await response.json();
      code = data.error.code;
    } catch {
      // body was not our error shape, keep code as null
    }
    const errorType = ERROR_TYPES[code] || 'parse_error';
    throw new ProviderUnavailableError(errorType, `Python retriever status ${response.status}, code ${code}`);
  }

  return response.json();
};
