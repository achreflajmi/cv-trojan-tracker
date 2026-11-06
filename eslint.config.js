import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // analysis/ is the Python project (its .venv contains third-party JS); data/ is generated.
  { ignores: ['**/dist/**', '**/node_modules/**', 'coverage/**', 'analysis/**', 'data/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: globals.node },
  },
  prettier,
);
