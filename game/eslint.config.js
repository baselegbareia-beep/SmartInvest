// @ts-check
import path from 'node:path';

import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

const ROOT = import.meta.dirname;
const CORE_DIR = path.join(ROOT, 'src', 'core');
const TUNING_FILE = path.join(ROOT, 'src', 'tuning');

/**
 * Packages that test files (*.test.ts) inside src/core may import in addition.
 * An entry that ends with ':' is a prefix, such as 'node:'.
 */
const ALLOWED_IN_CORE_TESTS = ['vitest', 'node:'];

/**
 * True when `target` (an absolute path without a file extension) is inside
 * src/core or is src/tuning.
 *
 * @param {string} target
 * @returns {boolean}
 */
function isAllowedCoreTarget(target) {
  const withoutExtension = target.replace(/\.(?:[cm]?[jt]s)$/, '');
  if (withoutExtension === TUNING_FILE) return true;
  const relative = path.relative(CORE_DIR, withoutExtension);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * src/core is the pure simulation. A file there may import only other files
 * in src/core and src/tuning.ts: no Phaser, no npm packages, no other part of
 * src. Test files (*.test.ts) may also import ALLOWED_IN_CORE_TESTS.
 *
 * @type {import('eslint').Rule.RuleModule}
 */
const coreImportsRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'src/core may import only from src/core and src/tuning.ts',
    },
    schema: [],
    messages: {
      phaser:
        "src/core must not import '{{source}}'. The simulation is pure: Phaser belongs to the presentation layer outside src/core.",
      bare: "src/core must not import the package '{{source}}'. It may import only from src/core and src/tuning.ts.",
      outside:
        "src/core must not import '{{source}}'. It may import only from src/core and src/tuning.ts.",
    },
  },
  create(context) {
    const isTestFile = /\.test\.[cm]?[jt]s$/.test(context.filename);
    const allowedPackages = isTestFile ? ALLOWED_IN_CORE_TESTS : [];

    /**
     * @param {import('estree').Node | null | undefined} sourceNode
     */
    function check(sourceNode) {
      if (sourceNode?.type !== 'Literal' || typeof sourceNode.value !== 'string') return;
      const source = sourceNode.value;

      if (source === 'phaser' || source.startsWith('phaser/')) {
        context.report({ node: sourceNode, messageId: 'phaser', data: { source } });
        return;
      }

      if (!source.startsWith('.')) {
        const allowed = allowedPackages.some((name) =>
          name.endsWith(':') ? source.startsWith(name) : source === name || source.startsWith(`${name}/`),
        );
        if (!allowed) context.report({ node: sourceNode, messageId: 'bare', data: { source } });
        return;
      }

      // Drop a Vite query such as "?raw" before resolving the path.
      const cleanSource = source.replace(/[?#].*$/, '');
      const target = path.resolve(path.dirname(context.filename), cleanSource);
      if (!isAllowedCoreTarget(target)) {
        context.report({ node: sourceNode, messageId: 'outside', data: { source } });
      }
    }

    return {
      ImportDeclaration(node) {
        check(node.source);
      },
      ExportNamedDeclaration(node) {
        check(node.source);
      },
      ExportAllDeclaration(node) {
        check(node.source);
      },
      ImportExpression(node) {
        check(node.source);
      },
    };
  },
};

const DETERMINISM =
  'src/core is a deterministic simulation: the same state and input must always give the same result.';

export default defineConfig(
  globalIgnores(['dist/', 'node_modules/', 'docs/phaser-skills/', 'test-results/', 'playwright-report/']),

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    // Type-aware linting: every linted file must be covered by tsconfig.json.
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: ROOT,
      },
    },
  },
  {
    rules: {
      eqeqeq: ['error', 'always'],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },

  {
    // The determinism rule for the simulation core.
    files: ['src/core/**'],
    plugins: {
      core: { rules: { imports: coreImportsRule } },
    },
    rules: {
      'core/imports': 'error',
      'no-restricted-globals': [
        'error',
        { name: 'window', message: `No DOM in src/core. ${DETERMINISM}` },
        { name: 'document', message: `No DOM in src/core. ${DETERMINISM}` },
        {
          name: 'performance',
          message: `No clocks (performance.now) in src/core: time advances only by step(). ${DETERMINISM}`,
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: `Keep any randomness as seeded data in the state. ${DETERMINISM}`,
        },
        {
          object: 'Date',
          property: 'now',
          message: `No clocks in src/core: time advances only by step(). ${DETERMINISM}`,
        },
      ],
    },
  },
);
