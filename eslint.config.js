import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['node_modules', 'dist', '.vercel', '.coherence'] },
  ...tseslint.configs.recommended,
)
