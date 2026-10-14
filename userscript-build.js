const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const popupHtml = fs.readFileSync('popup/popup.html', 'utf8');
const popupCss = fs.readFileSync('popup/popup.css', 'utf8');
const constantsJs = fs.readFileSync('scripts/constants.js', 'utf8');
const popupJs = fs.readFileSync('popup/popup.js', 'utf8');

fs.writeFileSync('popup/popup.html.bak', popupHtml);

try {
  let inlinedHtml = popupHtml
    .replace(/<link rel="stylesheet" href="[^"]+">/, `<style>\n${popupCss}\n</style>`)
    .replace(/<script src="\.\.\/scripts\/constants\.js"><\/script>/, `<script>\n${constantsJs}\n</script>`)
    .replace(/<script src="popup\.js"><\/script>/, `<script>\n${popupJs}\n</script>`);

  fs.writeFileSync('popup/popup.html', inlinedHtml);

  console.log('Converting to userscript...');
  execSync('npx to-userscript convert . -o dist/e621-extras.user.js -f', { stdio: 'inherit' });
  console.log('Done! File saved to dist/e621-extras.user.js');

} finally {
  if (fs.existsSync('popup/popup.html.bak')) {
    fs.renameSync('popup/popup.html.bak', 'popup/popup.html');
  }
}