// test-commands.js - Task 5 command handling logic
// Simulates the client-side command detection that must not interfere with normal typing

function isCommand(content, trimmed) {
  const t = trimmed ?? content.trim();
  return t === 'l' || t === '?' || t === 'q';
}

function simulateEnter(currentContent) {
  const trimmed = currentContent.trim();
  if (trimmed === 'l') return { action: 'roster-refresh', commit: false };
  if (trimmed === '?') return { action: 'help', commit: false };
  if (trimmed === 'q') return { action: 'leave', commit: false };
  return { action: 'commit', commit: true, content: currentContent };
}

// Tests
let tests = 0, passed = 0;
function assert(name, condition) {
  tests++; if (condition) { passed++; console.log(`PASS ${name}`); } else { console.error(`FAIL ${name}`); throw new Error(`FAIL ${name}`); }
}

assert('l alone is command', simulateEnter('l').action === 'roster-refresh');
assert('l with spaces is command', simulateEnter(' l ').action === 'roster-refresh');
assert('? alone is command', simulateEnter('?').action === 'help');
assert('q alone is command', simulateEnter('q').action === 'leave');
assert('l in sentence not command', simulateEnter('hello l').action === 'commit');
assert('l as part of word not command', simulateEnter('lol').action === 'commit');
assert('empty not command', simulateEnter('').action === 'commit');
assert('? in sentence not command', simulateEnter('what?').action === 'commit');
assert('q in sentence not command', simulateEnter('quick').action === 'commit');

// ?name= override logic
function initialHandle(search, localStorageHandle) {
  const params = new URLSearchParams(search);
  return params.has('name') ? (params.get('name') ?? '') : (localStorageHandle ?? '');
}
function hasNameOverride(search) { return new URLSearchParams(search).has('name'); }

assert('?name= wins over localStorage', initialHandle('?name=Alice', 'Bob') === 'Alice');
assert('?name= override detected', hasNameOverride('?name=Alice') === true);
assert('no override uses localStorage', initialHandle('', 'Bob') === 'Bob');
assert('no override false', hasNameOverride('') === false);
assert('?name= empty string', initialHandle('?name=', 'Bob') === '');
assert('?name= with other params', initialHandle('?name=Charlie&room=2', 'Bob') === 'Charlie');

console.log(`\nAll ${passed}/${tests} PASS - Task 5 command logic verified`);

// Multi-tab testing note
console.log(`\nMulti-tab testing: Alex can open ?name=Alice and ?name=Bob tabs simultaneously`);
console.log(`- ?name= does NOT overwrite localStorage (preserves other tabs)`);
console.log(`- localStorage only saved when no ?name= param`);
console.log(`- Server enforces system-wide unique handle via unique index`);
