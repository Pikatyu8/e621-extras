const fs = require('fs');

const targetFile = process.argv[2] || 'dist/e621-extras.user.js';
if (!fs.existsSync(targetFile)) {
  console.error(`File not found: ${targetFile}`);
  process.exit(1);
}

let code = fs.readFileSync(targetFile, 'utf8');

const searchPattern = /const script = doc\.createElement\("script"\);\s*script\.textContent = polyfillString;\s*doc\.head\.insertAdjacentElement\("afterbegin", script\);\s*iframe\.srcdoc = doc\.documentElement\.outerHTML;/;

const replacement = `const cspNonce = Array.from(document.scripts).map(s => s.nonce).find(Boolean)
        || document.querySelector('meta[name="csp-nonce"]')?.content
        || document.querySelector('[nonce]')?.nonce
        || '';

      const script = doc.createElement("script");
      script.textContent = polyfillString;
      doc.head.insertAdjacentElement("afterbegin", script);

      if (cspNonce) {
        doc.querySelectorAll('script').forEach(s => s.setAttribute('nonce', cspNonce));
      }

      iframe.srcdoc = doc.documentElement.outerHTML;`;

if (searchPattern.test(code)) {
  code = code.replace(searchPattern, replacement);
  fs.writeFileSync(targetFile, code, 'utf8');
  console.log('The CSP Nonce patch has been successfully integrated into ' + targetFile);
} else {
  console.warn('Signature not found. Please check the file structure.');
}