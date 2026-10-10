const globals = require('globals');

const extensionGlobals = { chrome: 'readonly', E621X: 'readonly', E621_CONSTANTS: 'readonly' };

module.exports = [
  {
    files: ['scripts/**/*.js', 'popup/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...extensionGlobals, module: 'readonly' }
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'warn',
      'no-empty': 'error',          // forbids swallowed errors: catch (e) {}
      eqeqeq: ['error', 'smart']
    }
  },
  {
    files: ['background.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.serviceworker, ...extensionGlobals } },
    rules: { 'no-undef': 'error', 'no-empty': 'error' }
  },
  {
    files: ['tests/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: globals.node }
  }
];