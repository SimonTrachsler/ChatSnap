const fs = require('fs');
const path = require('path');

// Minimal 1x1 transparent PNG
const MINI_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const dir = path.join(__dirname, '..', 'assets');
const files = ['icon.png', 'splash-icon.png', 'adaptive-icon.png', 'favicon.png'];

if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
files.forEach((f) => fs.writeFileSync(path.join(dir, f), MINI_PNG));
console.log('Assets erstellt:', files.join(', '));


