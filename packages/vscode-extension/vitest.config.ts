import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { vscode: fileURLToPath(new URL('./test/mock-vscode.ts', import.meta.url)) } },
});
