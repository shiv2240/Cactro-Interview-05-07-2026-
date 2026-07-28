/**
 * generate_icons_from_logo.js
 * Resizes icons/logo.png into the required Chrome extension icon sizes.
 * Run: node generate_icons_from_logo.js
 * Requires: npm install sharp
 */

const sharp = require('sharp');
const path = require('path');

const sizes = [16, 48, 128];
const logoPath = path.join(__dirname, 'icons', 'logo.png');

(async () => {
  for (const size of sizes) {
    const outPath = path.join(__dirname, 'icons', `icon${size}.png`);
    await sharp(logoPath)
      .resize(size, size, { fit: 'cover' })
      .toFile(outPath);
    console.log(`✓ Generated icons/icon${size}.png`);
  }
  console.log('\nAll icons generated successfully!');
})();
