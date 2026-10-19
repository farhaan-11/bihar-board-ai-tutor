/**
 * test-shadow-compare.js
 *
 * compareWithPython() ka test (shadow mode, step5.retrieveContent.js).
 * Python ki jagah nakli jawab dete hain, taaki "alag chunks" aur "Python kharab" wali
 * branch bhi chal sake. Koi server, Python, ya LLM nahi chahiye.
 *
 * Chalane ka tareeka (backend folder se):
 *   node scripts/test-shadow-compare.js
 */

import 'dotenv/config';
import assert from 'node:assert/strict';

import { compareWithPython } from '../src/ask/step5.retrieveContent.js';

// console.log aur console.warn ko rok ke sab likha hua yaad rakhta hu
const realLog = console.log;
const realWarn = console.warn;

// ['a', 'b'] -> [{ id: 'a' }, { id: 'b' }]
const makeResults = (ids) => {
  const list = [];
  for (const id of ids) {
    list.push({ id });
  }
  return list;
};

const runCase = async (nodeIds, fetchPython) => {
  const logs = [];
  const warns = [];
  console.log = (...parts) => logs.push(parts.join(' '));
  console.warn = (...parts) => warns.push(parts.join(' '));

  const nodeResult = { results: makeResults(nodeIds) };
  const before = JSON.stringify(nodeResult);

  let threw = false;
  try {
    await compareWithPython('test sawaal', {}, nodeResult, fetchPython);
  } catch (error) {
    threw = true;
  }

  console.log = realLog;
  console.warn = realWarn;

  return { logs, warns, threw, nodeUntouched: JSON.stringify(nodeResult) === before };
};

// nakli Python: jo ids do wahi lautata hai
const pythonGives = (ids) => {
  const fetchPython = async () => {
    return { results: makeResults(ids) };
  };
  return fetchPython;
};

let passed = 0;
const check = (name, condition) => {
  assert.equal(condition, true, name);
  passed++;
  realLog(`  ok  ${name}`);
};

// 1. dono same
let r = await runCase(['a', 'b', 'c'], pythonGives(['a', 'b', 'c']));
check('same ids: "same ids" log aata hai', r.logs.length === 1 && r.logs[0].includes('same ids'));
check('same ids: koi warning nahi', r.warns.length === 0);
check('same ids: error bahar nahi aaya', r.threw === false);
check('same ids: Node ka result chhua nahi gaya', r.nodeUntouched === true);

// 2. alag chunk
r = await runCase(['a', 'b', 'c'], pythonGives(['a', 'b', 'x']));
check('alag chunk: DIFF warning aati hai', r.warns.length === 1 && r.warns[0].includes('DIFF'));
check('alag chunk: error bahar nahi aaya', r.threw === false);
check('alag chunk: Node ka result chhua nahi gaya', r.nodeUntouched === true);

// 3. chunk wahi, order alag
r = await runCase(['a', 'b', 'c'], pythonGives(['b', 'a', 'c']));
check('order alag: DIFF warning aati hai', r.warns.length === 1 && r.warns[0].includes('DIFF'));

// 4. ginti alag
r = await runCase(['a', 'b', 'c'], pythonGives(['a', 'b']));
check('ginti alag: DIFF warning aati hai', r.warns.length === 1 && r.warns[0].includes('DIFF'));

// 5. dono khaali (jaise focus mein galat chapter)
r = await runCase([], pythonGives([]));
check('dono khaali: "same ids" log aata hai', r.logs.length === 1 && r.logs[0].includes('same ids'));
check('dono khaali: koi warning nahi', r.warns.length === 0);

// 6. Python ne error phenka (band, timeout, galat key, sab aise hi aate hain)
const pythonDown = async () => {
  throw new Error('Python retriever status 503, code UPSTREAM_UNREACHABLE');
};
r = await runCase(['a', 'b'], pythonDown);
check('Python error: "python failed" log aata hai', r.logs.length === 1 && r.logs[0].includes('python failed'));
check('Python error: log mein asli wajah dikhti hai', r.logs[0].includes('UPSTREAM_UNREACHABLE'));
check('Python error: koi warning nahi', r.warns.length === 0);
check('Python error: error bahar nahi aaya (student ko kuch nahi dikhega)', r.threw === false);
check('Python error: Node ka result chhua nahi gaya', r.nodeUntouched === true);

// 7. Python ka jawab toota hua (results hi nahi)
const pythonBroken = async () => ({ message: 'kuch aur aa gaya' });
r = await runCase(['a'], pythonBroken);
check('toota jawab: "python failed" log aata hai', r.logs.length === 1 && r.logs[0].includes('python failed'));
check('toota jawab: error bahar nahi aaya', r.threw === false);

realLog(`\n${passed} jaanch pass.`);
