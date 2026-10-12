/**
 * 雙軌 schema 產生器（FR-018、FR-024）
 * ====================================
 * Prisma 7.9 的 datasource.provider 不支援 env(...)（見 research.md R-3），
 * 故拼接 prisma/base.prisma（唯一一份 model 定義）與
 * prisma/headers/{sqlite,postgres}.prisma（各自的 datasource + generator），
 * 產出 prisma/generated/schema.{sqlite,postgres}.prisma，兩份皆須通過 `prisma validate`。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const PRISMA_DIR = path.join(ROOT, 'prisma');
const OUT_DIR = path.join(PRISMA_DIR, 'generated');

const PROVIDERS = ['sqlite', 'postgres'] as const;

function buildOne(provider: (typeof PROVIDERS)[number]): string {
  const header = readFileSync(path.join(PRISMA_DIR, 'headers', `${provider}.prisma`), 'utf8');
  const base = readFileSync(path.join(PRISMA_DIR, 'base.prisma'), 'utf8');
  const content = `${header}\n${base}`;
  const outPath = path.join(OUT_DIR, `schema.${provider}.prisma`);
  writeFileSync(outPath, content, 'utf8');
  return outPath;
}

function validate(schemaPath: string): void {
  execFileSync('npx', ['prisma', 'validate', `--schema=${schemaPath}`], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const provider of PROVIDERS) {
    const outPath = buildOne(provider);
    validate(outPath);
    console.log(`[build-schema] ${path.relative(ROOT, outPath)} 已產生並通過 prisma validate`);
  }
}

main();
