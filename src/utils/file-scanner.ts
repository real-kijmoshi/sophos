import * as fs from 'node:fs';
import * as path from 'node:path';

export interface FileEntry {
  path: string;
  relative_path: string;
  size: number;
  extension: string;
  last_modified: Date;
}

export interface ScanResult {
  files: FileEntry[];
  total_size: number;
  directory_tree: string[];
  gitignore_patterns: string[];
}

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp',
  '.mp3', '.mp4', '.avi', '.mov', '.wmv',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.db', '.sqlite', '.sqlite3',
]);

const SECRET_PATTERNS = [
  /\.env$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /credentials/i,
  /secret/i,
  /token/i,
];

export async function scanRepository(rootDir: string): Promise<ScanResult> {
  const gitignorePatterns = loadGitignore(rootDir);
  const files: FileEntry[] = [];
  let totalSize = 0;

  const allFiles: string[] = [];
  const glob = new Bun.Glob('**/*');
  for await (const file of glob.scan({ cwd: rootDir, onlyFiles: true, dot: false })) {
    allFiles.push(file);
  }

  for (const relPath of allFiles) {
    const fullPath = path.join(rootDir, relPath);

    if (isIgnored(relPath, gitignorePatterns)) continue;
    if (isSecretFile(relPath)) continue;

    try {
      const stat = fs.statSync(fullPath);
      const ext = path.extname(relPath).toLowerCase();

      if (BINARY_EXTENSIONS.has(ext)) continue;
      if (stat.size > 1_000_000) continue;

      files.push({
        path: fullPath,
        relative_path: relPath,
        size: stat.size,
        extension: ext,
        last_modified: stat.mtime,
      });
      totalSize += stat.size;
    } catch {
      continue;
    }
  }

  const directoryTree = buildDirectoryTree(rootDir, files.map(f => f.relative_path));

  return {
    files,
    total_size: totalSize,
    directory_tree: directoryTree,
    gitignore_patterns: gitignorePatterns,
  };
}

function loadGitignore(rootDir: string): string[] {
  const gitignorePath = path.join(rootDir, '.gitignore');
  try {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    return content
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
  } catch {
    return ['node_modules', '.git', 'dist', 'build', '__pycache__'];
  }
}

function isIgnored(relativePath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    const cleaned = pattern.replace(/\/$/, '');
    if (relativePath.startsWith(cleaned) || relativePath.includes(`/${cleaned}/`)) {
      return true;
    }
    if (cleaned.includes('*')) {
      const regex = new RegExp('^' + cleaned.replace(/\*/g, '.*') + '$');
      const parts = relativePath.split(path.sep);
      for (const part of parts) {
        if (regex.test(part)) return true;
      }
    }
  }
  return false;
}

function isSecretFile(relativePath: string): boolean {
  const basename = path.basename(relativePath).toLowerCase();
  return SECRET_PATTERNS.some(p => p.test(basename) || p.test(relativePath));
}

function buildDirectoryTree(rootDir: string, files: string[]): string[] {
  const dirs = new Set<string>();
  for (const file of files) {
    const parts = file.split(/[\\/]/);
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'));
    }
  }
  return Array.from(dirs).sort();
}

export function readFileContent(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

export function writeFileContent(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function detectLanguage(filePath: string, content: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    '.ts': 'TypeScript', '.tsx': 'TypeScript',
    '.js': 'JavaScript', '.jsx': 'JavaScript',
    '.py': 'Python',
    '.rs': 'Rust',
    '.go': 'Go',
    '.java': 'Java',
    '.rb': 'Ruby',
    '.php': 'PHP',
    '.c': 'C', '.h': 'C',
    '.cpp': 'C++', '.hpp': 'C++',
    '.cs': 'C#',
    '.swift': 'Swift',
    '.kt': 'Kotlin',
    '.scala': 'Scala',
    '.ex': 'Elixir', '.exs': 'Elixir',
    '.erl': 'Erlang',
    '.hs': 'Haskell',
    '.ml': 'OCaml',
    '.lua': 'Lua',
    '.r': 'R',
    '.jl': 'Julia',
    '.dart': 'Dart',
    '.vue': 'Vue',
    '.svelte': 'Svelte',
    '.html': 'HTML', '.htm': 'HTML',
    '.css': 'CSS', '.scss': 'SCSS', '.less': 'LESS',
    '.json': 'JSON',
    '.yaml': 'YAML', '.yml': 'YAML',
    '.toml': 'TOML',
    '.xml': 'XML',
    '.md': 'Markdown',
    '.sql': 'SQL',
    '.sh': 'Shell', '.bash': 'Shell',
    '.ps1': 'PowerShell',
    '.dockerfile': 'Docker',
  };

  if (ext === '' && path.basename(filePath).toLowerCase() === 'dockerfile') return 'Docker';
  if (ext === '' && path.basename(filePath).toLowerCase() === 'makefile') return 'Make';

  return langMap[ext] || 'Unknown';
}

export function detectFramework(filePath: string, content: string): string[] {
  const frameworks: string[] = [];
  const basename = path.basename(filePath);

  if (basename === 'package.json') {
    try {
      const pkg = JSON.parse(content);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const fwMap: Record<string, string> = {
        'next': 'Next.js', 'react': 'React', 'vue': 'Vue', 'angular': 'Angular',
        'svelte': 'Svelte', 'express': 'Express', 'fastify': 'Fastify',
        'nestjs': 'NestJS', '@nestjs/core': 'NestJS',
        'nuxt': 'Nuxt', '@nuxt/core': 'Nuxt',
        'graphql': 'GraphQL', 'apollo-server': 'Apollo',
        'tailwindcss': 'Tailwind CSS', 'styled-components': 'Styled Components',
        'prisma': 'Prisma', 'typeorm': 'TypeORM', 'sequelize': 'Sequelize',
        'mongoose': 'Mongoose', 'drizzle-orm': 'Drizzle',
        'vitest': 'Vitest', 'jest': 'Jest', 'mocha': 'Mocha',
        'playwright': 'Playwright', 'cypress': 'Cypress',
      };
      for (const [dep, name] of Object.entries(fwMap)) {
        if (deps?.[dep]) frameworks.push(name);
      }
    } catch { /* ignore */ }
  }

  if (basename === 'requirements.txt' || basename === 'pyproject.toml') {
    const pyFrameworks: Record<string, string> = {
      'django': 'Django', 'flask': 'Flask', 'fastapi': 'FastAPI',
      'uvicorn': 'Uvicorn', 'celery': 'Celery', 'sqlalchemy': 'SQLAlchemy',
      'pydantic': 'Pydantic', 'pytest': 'pytest', 'starlette': 'Starlette',
    };
    for (const [dep, name] of Object.entries(pyFrameworks)) {
      if (content.toLowerCase().includes(dep)) frameworks.push(name);
    }
  }

  if (basename === 'Cargo.toml') {
    const rustFrameworks: Record<string, string> = {
      'actix-web': 'Actix Web', 'axum': 'Axum', 'tokio': 'Tokio',
      'serde': 'Serde', 'diesel': 'Diesel', 'sqlx': 'SQLx',
      'warp': 'Warp', 'rocket': 'Rocket',
    };
    for (const [dep, name] of Object.entries(rustFrameworks)) {
      if (content.includes(dep)) frameworks.push(name);
    }
  }

  if (basename === 'go.mod') {
    const goFrameworks: Record<string, string> = {
      'gin-gonic/gin': 'Gin', 'echo': 'Echo', 'fiber': 'Fiber',
      'gorilla/mux': 'Gorilla Mux', 'gorm': 'GORM',
    };
    for (const [dep, name] of Object.entries(goFrameworks)) {
      if (content.includes(dep)) frameworks.push(name);
    }
  }

  return frameworks;
}
