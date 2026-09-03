// `expo start` writes expo-env.d.ts (gitignored). CI never runs `expo start`,
// so create the same file before typechecking. Mirrors @expo/cli's template.
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'expo-env.d.ts');
if (!fs.existsSync(file)) {
  fs.writeFileSync(
    file,
    '/// <reference types="expo/types" />\n\n// NOTE: This file should not be edited and should be in your git ignore',
  );
}
