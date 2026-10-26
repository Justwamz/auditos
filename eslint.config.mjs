import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';

export default [
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**'] },
  ...tseslint.configs.recommended,
  security.configs.recommended,
  { rules: { 'security/detect-object-injection': 'off' } },
];
