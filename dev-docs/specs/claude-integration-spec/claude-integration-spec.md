# Claude AI Integration Spec

## Overview

This document specifies the integration of Claude AI (Anthropic's LLM) into Noodles.gl to provide an intelligent chat assistant that can help users create visualizations, modify projects, debug issues, and analyze data.

## Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────────────┐
│  GitHub Actions (CI/CD)                                 │
│  • Runs on every push to main                           │
│  • Generates comprehensive code/docs index              │
│  • Deploys to GitHub Pages                              │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│  GitHub Pages                                            │
│  • Serves main app bundle                               │
│  • Serves context bundles (cached, content-addressed)   │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│  Noodles.gl Web App                                     │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Chat Panel (new component)                       │  │
│  │  • Claude API integration (user's API key)        │  │
│  │  • MCP-like tool interface (client-side)          │  │
│  │  • Project state integration                      │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Key Principles

1. **Zero Infrastructure Cost**: Everything runs on GitHub Pages
2. **User-Provided API Keys**: Users bring their own Anthropic API keys
3. **Comprehensive Context**: Full source code, docs, and examples indexed
4. **Client-Side Execution**: All tool implementations run in browser
5. **Aggressive Caching**: Context bundles are immutable and cached indefinitely

---

## 1. GitHub Actions Workflow

### Workflow File: `.github/workflows/generate-context.yml`

```yaml
name: Generate Claude Context

on:
  push:
    branches: [main]
    paths:
      - 'noodles-editor/src/**'
      - 'docs/**'
      - 'noodles-editor/public/noodles/**'
  workflow_dispatch:

jobs:
  generate-context:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'yarn'

      - name: Install dependencies
        run: yarn install:all

      - name: Generate context bundles
        run: |
          cd noodles-editor
          yarn generate:context

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./noodles-editor/dist
          destination_dir: app/context
          keep_files: true
```

### Context Generation Script

**Location**: `noodles-editor/scripts/generate-context.ts`

This script should:

1. **Parse Source Code**
   - Use TypeScript compiler API to parse all `.ts/.tsx` files
   - Extract AST information (classes, functions, types, comments)
   - Build symbol table with cross-references

2. **Index Documentation**
   - Parse all `.md` files from `/docs`
   - Build full-text search index using `flexsearch` or `lunr.js`
   - Extract headings, code examples, links

3. **Process Examples**
   - Load all `.json` files from `/noodles-editor/public/noodles`
   - Analyze node types, connections, patterns
   - Generate natural language descriptions

4. **Generate Operator Registry**
   - Extract all operator classes from `operators.ts`
   - Build schema for each operator (inputs, outputs, types)
   - Include JSDoc comments and usage examples

5. **Create Content-Addressed Bundles**
   - Hash each bundle's content
   - Write files with hash in filename: `code-index.[hash].json`
   - Update `manifest.json` with current hashes

---

## 2. Index File Formats

### 2.1 Manifest File

**Location**: `/app/context/manifest.json`

```json
{
  "version": "1.0.0",
  "generated": "2025-10-09T20:00:00Z",
  "commit": "4bce57c",
  "bundles": {
    "codeIndex": {
      "file": "code-index.abc123def.json",
      "size": 2847293,
      "hash": "abc123def"
    },
    "operatorRegistry": {
      "file": "operator-registry.def456ghi.json",
      "size": 102847,
      "hash": "def456ghi"
    },
    "docsIndex": {
      "file": "docs-index.ghi789jkl.json",
      "size": 187294,
      "hash": "ghi789jkl"
    },
    "examples": {
      "file": "examples.jkl012mno.json",
      "size": 95847,
      "hash": "jkl012mno"
    }
  }
}
```

### 2.2 Code Index

**Format**: `code-index.[hash].json`

```typescript
interface CodeIndex {
  version: string;
  files: Record<string, FileIndex>;
  searchIndex: SearchIndex;
  symbolMap: Record<string, SymbolReference[]>;
}

interface FileIndex {
  path: string;
  fullText: string;
  lines: string[];
  hash: string;
  lastModified: string;
  symbols: Symbol[];
  imports: Import[];
  exports: Export[];
}

interface Symbol {
  name: string;
  type: 'class' | 'function' | 'interface' | 'type' | 'const' | 'enum';
  line: number;
  endLine: number;
  docstring?: string;
  signature?: string;
  properties?: Property[];
  methods?: Method[];
  extends?: string[];
  implements?: string[];
}

interface Property {
  name: string;
  type: string;
  line: number;
  optional: boolean;
  docstring?: string;
}

interface Method {
  name: string;
  signature: string;
  line: number;
  endLine: number;
  docstring?: string;
  parameters: Parameter[];
  returnType: string;
}

interface Parameter {
  name: string;
  type: string;
  optional: boolean;
  defaultValue?: string;
}

interface Import {
  module: string;
  imports: string[];
  line: number;
}

interface Export {
  name: string;
  type: string;
  line: number;
}

interface SearchIndex {
  // Serialized flexsearch index
  // Supports full-text search across all source files
  index: any;
}

interface SymbolReference {
  file: string;
  line: number;
  context: string;
}
```

**Example**:

```json
{
  "version": "1.0.0",
  "files": {
    "src/noodles/operators.ts": {
      "path": "src/noodles/operators.ts",
      "fullText": "import { Field } from './fields';\n...",
      "lines": ["import { Field } from './fields';", "..."],
      "hash": "xyz789",
      "lastModified": "2025-10-09T19:30:00Z",
      "symbols": [
        {
          "name": "GeoJsonLayerOp",
          "type": "class",
          "line": 1234,
          "endLine": 1350,
          "docstring": "/**\n * Renders GeoJSON data as a deck.gl layer\n */",
          "signature": "export class GeoJsonLayerOp extends Operator",
          "extends": ["Operator"],
          "properties": [
            {
              "name": "type",
              "type": "string",
              "line": 1235,
              "optional": false,
              "docstring": "/** Operator type identifier */"
            }
          ],
          "methods": [
            {
              "name": "execute",
              "signature": "execute(inputs: GeoJsonLayerInputs): Observable<GeoJsonLayer>",
              "line": 1250,
              "endLine": 1280,
              "docstring": "/**\n * Executes the operator with given inputs\n */",
              "parameters": [
                {
                  "name": "inputs",
                  "type": "GeoJsonLayerInputs",
                  "optional": false
                }
              ],
              "returnType": "Observable<GeoJsonLayer>"
            }
          ]
        }
      ],
      "imports": [
        {
          "module": "./fields",
          "imports": ["Field", "NumberField"],
          "line": 1
        }
      ],
      "exports": [
        {
          "name": "GeoJsonLayerOp",
          "type": "class",
          "line": 1234
        }
      ]
    }
  },
  "searchIndex": {
    "index": "/* serialized flexsearch index */"
  },
  "symbolMap": {
    "GeoJsonLayerOp": [
      {
        "file": "src/noodles/operators.ts",
        "line": 1234,
        "context": "export class GeoJsonLayerOp extends Operator"
      },
      {
        "file": "src/noodles/components/OperatorNode.tsx",
        "line": 45,
        "context": "case 'GeoJsonLayerOp': return <GeoJsonIcon />;"
      }
    ]
  }
}
```

### 2.3 Operator Registry

**Format**: `operator-registry.[hash].json`

```typescript
interface OperatorRegistry {
  version: string;
  operators: Record<string, OperatorSchema>;
  categories: Record<string, string[]>;
}

interface OperatorSchema {
  name: string;
  type: string;
  category: 'data' | 'layer' | 'renderer' | 'accessor' | 'utility' | 'container';
  description: string;
  docstring?: string;
  inputs: Record<string, FieldSchema>;
  outputs: Record<string, FieldSchema>;
  sourceFile: string;
  sourceLine: number;
  examples: string[];
  relatedOperators: string[];
}

interface FieldSchema {
  name: string;
  type: string; // 'number' | 'string' | 'boolean' | 'accessor' | 'data' | etc.
  description?: string;
  required: boolean;
  defaultValue?: any;
  validation?: {
    min?: number;
    max?: number;
    options?: any[];
    pattern?: string;
  };
  uiHints?: {
    control: 'slider' | 'input' | 'select' | 'checkbox' | 'code' | 'color';
    label?: string;
    step?: number;
  };
}
```

**Example**:

```json
{
  "version": "1.0.0",
  "operators": {
    "GeoJsonLayerOp": {
      "name": "GeoJsonLayerOp",
      "type": "GeoJsonLayerOp",
      "category": "layer",
      "description": "Renders GeoJSON data as a deck.gl layer with support for points, lines, and polygons",
      "docstring": "/**\n * Renders GeoJSON data as a deck.gl layer...\n */",
      "inputs": {
        "data": {
          "name": "data",
          "type": "data",
          "description": "GeoJSON FeatureCollection or Feature",
          "required": true
        },
        "getFillColor": {
          "name": "getFillColor",
          "type": "accessor",
          "description": "Fill color accessor for polygons",
          "required": false,
          "defaultValue": "[255, 0, 0, 255]"
        },
        "getLineColor": {
          "name": "getLineColor",
          "type": "accessor",
          "description": "Line color accessor",
          "required": false,
          "defaultValue": "[0, 0, 0, 255]"
        },
        "pointType": {
          "name": "pointType",
          "type": "string",
          "description": "Point rendering type",
          "required": false,
          "defaultValue": "circle",
          "validation": {
            "options": ["circle", "circle+text", "icon"]
          },
          "uiHints": {
            "control": "select",
            "label": "Point Type"
          }
        },
        "getPointRadius": {
          "name": "getPointRadius",
          "type": "number",
          "description": "Radius of point circles in pixels",
          "required": false,
          "defaultValue": 2,
          "validation": {
            "min": 0,
            "max": 100
          },
          "uiHints": {
            "control": "slider",
            "step": 1
          }
        }
      },
      "outputs": {
        "layer": {
          "name": "layer",
          "type": "layer",
          "description": "Deck.gl GeoJsonLayer instance",
          "required": true
        }
      },
      "sourceFile": "src/noodles/operators.ts",
      "sourceLine": 1234,
      "examples": ["geojson-example", "bart-stations"],
      "relatedOperators": ["ScatterplotLayerOp", "PathLayerOp", "PolygonLayerOp"]
    },
    "DuckDbOp": {
      "name": "DuckDbOp",
      "type": "DuckDbOp",
      "category": "data",
      "description": "Execute DuckDB SQL queries with support for external APIs and reactive references",
      "inputs": {
        "query": {
          "name": "query",
          "type": "string",
          "description": "SQL query. Use {{/path.out.field}} for reactive references",
          "required": true,
          "uiHints": {
            "control": "code",
            "label": "SQL Query"
          }
        }
      },
      "outputs": {
        "data": {
          "name": "data",
          "type": "data",
          "description": "Query results as array of objects",
          "required": true
        }
      },
      "sourceFile": "src/noodles/operators.ts",
      "sourceLine": 3500,
      "examples": ["duckdb-query", "api-integration"],
      "relatedOperators": ["JSONOp", "FileOp", "CodeOp"]
    }
  },
  "categories": {
    "data": ["FileOp", "JSONOp", "DuckDbOp", "CSVOp"],
    "layer": ["GeoJsonLayerOp", "ScatterplotLayerOp", "HeatmapLayerOp"],
    "renderer": ["DeckRendererOp", "OutOp"],
    "accessor": ["AccessorOp", "ColorRampOp"],
    "utility": ["ExpressionOp", "CodeOp", "NumberOp"],
    "container": ["ContainerOp"]
  }
}
```

### 2.4 Documentation Index

**Format**: `docs-index.[hash].json`

```typescript
interface DocsIndex {
  version: string;
  topics: Record<string, DocTopic>;
  searchIndex: any; // Serialized flexsearch index
}

interface DocTopic {
  id: string;
  title: string;
  section: 'users' | 'developers' | 'intro';
  file: string;
  content: string;
  headings: Heading[];
  codeExamples: CodeExample[];
  relatedTopics: string[];
}

interface Heading {
  level: number;
  text: string;
  anchor: string;
}

interface CodeExample {
  language: string;
  code: string;
  description?: string;
}
```

**Example**:

```json
{
  "version": "1.0.0",
  "topics": {
    "getting-started": {
      "id": "getting-started",
      "title": "Getting Started",
      "section": "users",
      "file": "docs/users/getting-started.md",
      "content": "# Getting Started\n\nNoodles.gl is a node-based editor...",
      "headings": [
        { "level": 1, "text": "Getting Started", "anchor": "getting-started" },
        { "level": 2, "text": "Installation", "anchor": "installation" }
      ],
      "codeExamples": [],
      "relatedTopics": ["operators-guide", "data-guide"]
    },
    "creating-operators": {
      "id": "creating-operators",
      "title": "Creating Operators",
      "section": "developers",
      "file": "docs/developers/creating-operators.md",
      "content": "# Creating Operators\n\nOperators are the core building blocks...",
      "headings": [
        { "level": 1, "text": "Creating Operators", "anchor": "creating-operators" },
        { "level": 2, "text": "Basic Structure", "anchor": "basic-structure" },
        { "level": 2, "text": "Execute Method", "anchor": "execute-method" }
      ],
      "codeExamples": [
        {
          "language": "typescript",
          "code": "export class MyCustomOp extends Operator {\n  execute(inputs: any) {\n    return of(inputs.value * 2);\n  }\n}",
          "description": "Basic operator implementation"
        }
      ],
      "relatedTopics": ["field-system", "data-flow"]
    }
  },
  "searchIndex": {
    "index": "/* serialized flexsearch index */"
  }
}
```

### 2.5 Examples Index

**Format**: `examples.[hash].json`

```typescript
interface ExamplesIndex {
  version: string;
  examples: Record<string, Example>;
}

interface Example {
  id: string;
  name: string;
  description: string;
  category: string;
  project: NoodlesProject; // Full project JSON
  annotations: Record<string, NodeAnnotation>;
  tags: string[];
  dataSourceTypes: string[];
  layerTypes: string[];
  techniques: string[];
}

interface NodeAnnotation {
  nodeId: string;
  description: string;
  purpose: string;
  configurationNotes?: string;
}
```

**Example**:

```json
{
  "version": "1.0.0",
  "examples": {
    "geojson-example": {
      "id": "geojson-example",
      "name": "GeoJSON BART Stations",
      "description": "Visualizes San Francisco BART stations using GeoJSON data with styled points and labels",
      "category": "geospatial",
      "project": {
        "nodes": [ /* full node array */ ],
        "edges": [ /* full edge array */ ],
        "viewport": { /* viewport config */ }
      },
      "annotations": {
        "/data-source": {
          "nodeId": "/data-source",
          "description": "FileOp that loads GeoJSON from a URL",
          "purpose": "Data ingestion",
          "configurationNotes": "URL points to a remote GeoJSON file with BART station locations"
        },
        "/geojson-layer": {
          "nodeId": "/geojson-layer",
          "description": "GeoJsonLayerOp that renders the BART stations",
          "purpose": "Visualization",
          "configurationNotes": "Configured with pointType='circle+text' to show station names"
        },
        "/fill-color-accessor": {
          "nodeId": "/fill-color-accessor",
          "description": "AccessorOp that provides fill color for station points",
          "purpose": "Styling",
          "configurationNotes": "Returns a static gray color: [160, 160, 180, 200]"
        }
      },
      "tags": ["geojson", "transit", "maps", "points", "labels"],
      "dataSourceTypes": ["FileOp", "GeoJSON"],
      "layerTypes": ["GeoJsonLayerOp"],
      "techniques": ["accessor-functions", "color-styling", "text-labels"]
    },
    "aggregation-example": {
      "id": "aggregation-example",
      "name": "Hexagonal Aggregation",
      "description": "Demonstrates spatial aggregation using hexagonal bins",
      "category": "analysis",
      "project": { /* ... */ },
      "annotations": { /* ... */ },
      "tags": ["aggregation", "heatmap", "hexagons", "analysis"],
      "dataSourceTypes": ["FileOp"],
      "layerTypes": ["HexagonLayerOp"],
      "techniques": ["spatial-aggregation", "color-scales"]
    }
  }
}
```

---

## 3. Client-Side Implementation

### 3.1 Context Loader

**Location**: `noodles-editor/src/claude/ContextLoader.ts`

```typescript
import { Document } from 'flexsearch';

export interface LoadProgress {
  stage: 'manifest' | 'code' | 'operators' | 'docs' | 'examples' | 'complete';
  loaded: number;
  total: number;
  bytesLoaded: number;
  bytesTotal: number;
}

export class ContextLoader {
  private baseUrl = '/app/context';
  private manifest: Manifest | null = null;
  private codeIndex: CodeIndex | null = null;
  private operatorRegistry: OperatorRegistry | null = null;
  private docsIndex: DocsIndex | null = null;
  private examples: ExamplesIndex | null = null;

  private searchIndexes: {
    code?: Document;
    docs?: Document;
  } = {};

  /**
   * Load all context bundles with progress tracking
   */
  async load(onProgress?: (progress: LoadProgress) => void): Promise<void> {
    // 1. Load manifest
    onProgress?.({
      stage: 'manifest',
      loaded: 0,
      total: 5,
      bytesLoaded: 0,
      bytesTotal: 0
    });

    this.manifest = await this.fetchJSON<Manifest>(`${this.baseUrl}/manifest.json`);

    // 2. Load bundles (check cache first)
    const bundles = this.manifest.bundles;
    const totalBytes = Object.values(bundles).reduce((sum, b) => sum + b.size, 0);
    let bytesLoaded = 0;

    // Load code index
    onProgress?.({
      stage: 'code',
      loaded: 1,
      total: 5,
      bytesLoaded,
      bytesTotal: totalBytes
    });

    this.codeIndex = await this.fetchCachedBundle<CodeIndex>(
      bundles.codeIndex.file,
      bundles.codeIndex.hash
    );
    bytesLoaded += bundles.codeIndex.size;

    // Load operator registry
    onProgress?.({
      stage: 'operators',
      loaded: 2,
      total: 5,
      bytesLoaded,
      bytesTotal: totalBytes
    });

    this.operatorRegistry = await this.fetchCachedBundle<OperatorRegistry>(
      bundles.operatorRegistry.file,
      bundles.operatorRegistry.hash
    );
    bytesLoaded += bundles.operatorRegistry.size;

    // Load docs index
    onProgress?.({
      stage: 'docs',
      loaded: 3,
      total: 5,
      bytesLoaded,
      bytesTotal: totalBytes
    });

    this.docsIndex = await this.fetchCachedBundle<DocsIndex>(
      bundles.docsIndex.file,
      bundles.docsIndex.hash
    );
    bytesLoaded += bundles.docsIndex.size;

    // Load examples
    onProgress?.({
      stage: 'examples',
      loaded: 4,
      total: 5,
      bytesLoaded,
      bytesTotal: totalBytes
    });

    this.examples = await this.fetchCachedBundle<ExamplesIndex>(
      bundles.examples.file,
      bundles.examples.hash
    );
    bytesLoaded += bundles.examples.size;

    // 3. Build search indexes
    await this.buildSearchIndexes();

    onProgress?.({
      stage: 'complete',
      loaded: 5,
      total: 5,
      bytesLoaded: totalBytes,
      bytesTotal: totalBytes
    });
  }

  /**
   * Fetch bundle with browser cache support (IndexedDB)
   */
  private async fetchCachedBundle<T>(filename: string, hash: string): Promise<T> {
    // Try IndexedDB cache first
    const cached = await this.getCachedBundle<T>(hash);
    if (cached) {
      return cached;
    }

    // Fetch from network
    const data = await this.fetchJSON<T>(`${this.baseUrl}/${filename}`);

    // Store in IndexedDB
    await this.setCachedBundle(hash, data);

    return data;
  }

  private async fetchJSON<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    }
    return response.json();
  }

  private async getCachedBundle<T>(hash: string): Promise<T | null> {
    // Use IndexedDB to cache bundles persistently
    const db = await this.openDB();
    const tx = db.transaction('bundles', 'readonly');
    const store = tx.objectStore('bundles');
    const result = await store.get(hash);
    return result?.data || null;
  }

  private async setCachedBundle<T>(hash: string, data: T): Promise<void> {
    const db = await this.openDB();
    const tx = db.transaction('bundles', 'readwrite');
    const store = tx.objectStore('bundles');
    await store.put({ hash, data, timestamp: Date.now() });
  }

  private async openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('noodles-context', 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('bundles')) {
          db.createObjectStore('bundles', { keyPath: 'hash' });
        }
      };
    });
  }

  private async buildSearchIndexes(): Promise<void> {
    if (!this.codeIndex || !this.docsIndex) {
      throw new Error('Indexes not loaded');
    }

    // Deserialize and rebuild flexsearch indexes
    this.searchIndexes.code = new Document({
      document: {
        id: 'path',
        index: ['content']
      }
    });

    // Re-index code
    for (const [path, file] of Object.entries(this.codeIndex.files)) {
      this.searchIndexes.code.add({
        path,
        content: file.fullText
      });
    }

    // Re-index docs
    this.searchIndexes.docs = new Document({
      document: {
        id: 'id',
        index: ['title', 'content']
      }
    });

    for (const [id, topic] of Object.entries(this.docsIndex.topics)) {
      this.searchIndexes.docs.add({
        id,
        title: topic.title,
        content: topic.content
      });
    }
  }

  // Getters for loaded data
  getCodeIndex(): CodeIndex | null { return this.codeIndex; }
  getOperatorRegistry(): OperatorRegistry | null { return this.operatorRegistry; }
  getDocsIndex(): DocsIndex | null { return this.docsIndex; }
  getExamples(): ExamplesIndex | null { return this.examples; }
  getSearchIndexes() { return this.searchIndexes; }
}
```

### 3.2 MCP Tools Implementation

**Location**: `noodles-editor/src/claude/MCPTools.ts`

```typescript
import { ContextLoader } from './ContextLoader';
import type { NoodlesProject } from '../noodles/noodles';

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface SearchCodeParams {
  pattern: string;
  path?: string;
  contextLines?: number;
  maxResults?: number;
}

export interface SearchCodeResult {
  file: string;
  line: number;
  endLine?: number;
  context: string[];
  symbol?: string;
}

export class MCPTools {
  constructor(private contextLoader: ContextLoader) {}

  /**
   * Search source code using regex or fuzzy matching
   */
  async searchCode(params: SearchCodeParams): Promise<ToolResult> {
    try {
      const codeIndex = this.contextLoader.getCodeIndex();
      const searchIndex = this.contextLoader.getSearchIndexes().code;

      if (!codeIndex || !searchIndex) {
        return { success: false, error: 'Code index not loaded' };
      }

      const results: SearchCodeResult[] = [];
      const contextLines = params.contextLines ?? 3;
      const maxResults = params.maxResults ?? 20;

      // Use flexsearch for full-text search
      const searchResults = searchIndex.search(params.pattern);

      for (const result of searchResults.slice(0, maxResults)) {
        const filePath = result as string;
        const file = codeIndex.files[filePath];

        if (!file) continue;
        if (params.path && !filePath.includes(params.path)) continue;

        // Find matching lines in file
        const regex = new RegExp(params.pattern, 'gi');
        file.lines.forEach((line, idx) => {
          if (regex.test(line)) {
            const startLine = Math.max(0, idx - contextLines);
            const endLine = Math.min(file.lines.length - 1, idx + contextLines);

            results.push({
              file: filePath,
              line: idx + 1, // 1-indexed
              context: file.lines.slice(startLine, endLine + 1),
              symbol: this.findSymbolAtLine(file, idx + 1)
            });
          }
        });
      }

      return {
        success: true,
        data: results
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get source code for a specific file and line range
   */
  async getSourceCode(params: {
    file: string;
    startLine?: number;
    endLine?: number;
  }): Promise<ToolResult> {
    try {
      const codeIndex = this.contextLoader.getCodeIndex();
      if (!codeIndex) {
        return { success: false, error: 'Code index not loaded' };
      }

      const fileIndex = codeIndex.files[params.file];
      if (!fileIndex) {
        return { success: false, error: `File not found: ${params.file}` };
      }

      const startLine = params.startLine ?? 1;
      const endLine = params.endLine ?? fileIndex.lines.length;

      return {
        success: true,
        data: {
          file: params.file,
          startLine,
          endLine,
          lines: fileIndex.lines.slice(startLine - 1, endLine),
          fullText: fileIndex.lines.slice(startLine - 1, endLine).join('\n')
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get schema for a specific operator type
   */
  async getOperatorSchema(params: { type: string }): Promise<ToolResult> {
    try {
      const registry = this.contextLoader.getOperatorRegistry();
      if (!registry) {
        return { success: false, error: 'Operator registry not loaded' };
      }

      const schema = registry.operators[params.type];
      if (!schema) {
        return {
          success: false,
          error: `Operator type not found: ${params.type}`
        };
      }

      return { success: true, data: schema };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * List all available operators, optionally filtered by category
   */
  async listOperators(params: { category?: string }): Promise<ToolResult> {
    try {
      const registry = this.contextLoader.getOperatorRegistry();
      if (!registry) {
        return { success: false, error: 'Operator registry not loaded' };
      }

      let operators = Object.values(registry.operators);

      if (params.category) {
        operators = operators.filter(op => op.category === params.category);
      }

      return {
        success: true,
        data: operators.map(op => ({
          type: op.type,
          name: op.name,
          category: op.category,
          description: op.description
        }))
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Search documentation
   */
  async getDocumentation(params: {
    query: string;
    section?: 'users' | 'developers';
  }): Promise<ToolResult> {
    try {
      const docsIndex = this.contextLoader.getDocsIndex();
      const searchIndex = this.contextLoader.getSearchIndexes().docs;

      if (!docsIndex || !searchIndex) {
        return { success: false, error: 'Docs index not loaded' };
      }

      const searchResults = searchIndex.search(params.query);
      const results = searchResults
        .map((id: any) => docsIndex.topics[id as string])
        .filter(topic => !params.section || topic.section === params.section);

      return { success: true, data: results };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get an example project by ID
   */
  async getExample(params: { id: string }): Promise<ToolResult> {
    try {
      const examples = this.contextLoader.getExamples();
      if (!examples) {
        return { success: false, error: 'Examples not loaded' };
      }

      const example = examples.examples[params.id];
      if (!example) {
        return { success: false, error: `Example not found: ${params.id}` };
      }

      return { success: true, data: example };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * List all available examples
   */
  async listExamples(params: { category?: string; tag?: string }): Promise<ToolResult> {
    try {
      const examples = this.contextLoader.getExamples();
      if (!examples) {
        return { success: false, error: 'Examples not loaded' };
      }

      let results = Object.values(examples.examples);

      if (params.category) {
        results = results.filter(ex => ex.category === params.category);
      }

      if (params.tag) {
        results = results.filter(ex => ex.tags.includes(params.tag));
      }

      return {
        success: true,
        data: results.map(ex => ({
          id: ex.id,
          name: ex.name,
          description: ex.description,
          category: ex.category,
          tags: ex.tags
        }))
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Find a symbol (class, function, type) by name
   */
  async findSymbol(params: { name: string }): Promise<ToolResult> {
    try {
      const codeIndex = this.contextLoader.getCodeIndex();
      if (!codeIndex) {
        return { success: false, error: 'Code index not loaded' };
      }

      const references = codeIndex.symbolMap[params.name] || [];

      if (references.length === 0) {
        return { success: false, error: `Symbol not found: ${params.name}` };
      }

      // Get full symbol details from first reference (definition)
      const mainRef = references[0];
      const file = codeIndex.files[mainRef.file];
      const symbol = file?.symbols.find(s => s.name === params.name);

      return {
        success: true,
        data: {
          symbol,
          references,
          sourceCode: symbol
            ? file.lines.slice(symbol.line - 1, symbol.endLine).join('\n')
            : null
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Analyze the current project for issues and suggestions
   */
  async analyzeProject(params: {
    project: NoodlesProject;
    analysisType: 'validation' | 'performance' | 'suggestions';
  }): Promise<ToolResult> {
    try {
      const { project, analysisType } = params;

      switch (analysisType) {
        case 'validation':
          return this.validateProject(project);
        case 'performance':
          return this.analyzePerformance(project);
        case 'suggestions':
          return this.generateSuggestions(project);
        default:
          return { success: false, error: `Unknown analysis type: ${analysisType}` };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private validateProject(project: NoodlesProject): ToolResult {
    const issues: any[] = [];
    const registry = this.contextLoader.getOperatorRegistry();

    if (!registry) {
      return { success: false, error: 'Registry not loaded' };
    }

    // Check for disconnected nodes
    const connectedNodes = new Set<string>();
    project.edges.forEach(edge => {
      connectedNodes.add(edge.source);
      connectedNodes.add(edge.target);
    });

    project.nodes.forEach(node => {
      if (!connectedNodes.has(node.id) && node.type !== 'OutOp') {
        issues.push({
          type: 'disconnected',
          severity: 'warning',
          nodeId: node.id,
          message: `Node ${node.id} is not connected to the graph`
        });
      }

      // Validate operator exists
      const schema = registry.operators[node.type];
      if (!schema) {
        issues.push({
          type: 'unknown-operator',
          severity: 'error',
          nodeId: node.id,
          message: `Unknown operator type: ${node.type}`
        });
      } else {
        // Check required inputs
        Object.entries(schema.inputs).forEach(([key, field]) => {
          if (field.required && !node.data.inputs[key]) {
            const hasConnection = project.edges.some(
              edge => edge.target === node.id && edge.targetHandle?.includes(key)
            );

            if (!hasConnection) {
              issues.push({
                type: 'missing-input',
                severity: 'error',
                nodeId: node.id,
                field: key,
                message: `Required input '${key}' is not provided`
              });
            }
          }
        });
      }
    });

    return { success: true, data: { issues } };
  }

  private analyzePerformance(project: NoodlesProject): ToolResult {
    const suggestions: any[] = [];

    // Check for large data operations
    const dataOps = project.nodes.filter(n =>
      ['FileOp', 'DuckDbOp', 'JSONOp'].includes(n.type)
    );

    if (dataOps.length > 5) {
      suggestions.push({
        type: 'performance',
        severity: 'info',
        message: `Found ${dataOps.length} data operations. Consider consolidating with DuckDbOp.`
      });
    }

    // Check for deeply nested containers
    const maxDepth = this.calculateMaxDepth(project);
    if (maxDepth > 3) {
      suggestions.push({
        type: 'performance',
        severity: 'warning',
        message: `Container nesting depth is ${maxDepth}. Consider flattening structure.`
      });
    }

    return { success: true, data: { suggestions } };
  }

  private generateSuggestions(project: NoodlesProject): ToolResult {
    const suggestions: any[] = [];
    const registry = this.contextLoader.getOperatorRegistry();

    if (!registry) {
      return { success: false, error: 'Registry not loaded' };
    }

    // Suggest related operators
    project.nodes.forEach(node => {
      const schema = registry.operators[node.type];
      if (schema?.relatedOperators.length > 0) {
        const usedTypes = new Set(project.nodes.map(n => n.type));
        const unusedRelated = schema.relatedOperators.filter(
          op => !usedTypes.has(op)
        );

        if (unusedRelated.length > 0) {
          suggestions.push({
            type: 'related-operators',
            severity: 'info',
            nodeId: node.id,
            message: `Consider using related operators: ${unusedRelated.join(', ')}`
          });
        }
      }
    });

    return { success: true, data: { suggestions } };
  }

  private calculateMaxDepth(project: NoodlesProject): number {
    let maxDepth = 0;
    project.nodes.forEach(node => {
      const depth = (node.id.match(/\//g) || []).length;
      maxDepth = Math.max(maxDepth, depth);
    });
    return maxDepth;
  }

  private findSymbolAtLine(file: any, line: number): string | undefined {
    return file.symbols.find(
      (s: any) => s.line <= line && s.endLine >= line
    )?.name;
  }
}
```

### 3.3 Claude API Client

**Location**: `noodles-editor/src/claude/ClaudeClient.ts`

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { MCPTools, ToolResult } from './MCPTools';
import type { NoodlesProject } from '../noodles/noodles';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeResponse {
  message: string;
  projectModifications?: ProjectModification[];
  toolCalls?: ToolCall[];
}

export interface ProjectModification {
  type: 'add_node' | 'update_node' | 'delete_node' | 'add_edge' | 'delete_edge';
  data: any;
}

export interface ToolCall {
  name: string;
  params: any;
  result: ToolResult;
}

export class ClaudeClient {
  private client: Anthropic;
  private tools: MCPTools;
  private conversationHistory: Message[] = [];

  constructor(apiKey: string, tools: MCPTools) {
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    this.tools = tools;
  }

  /**
   * Send a message to Claude with current project context
   */
  async sendMessage(params: {
    message: string;
    project: NoodlesProject;
    conversationHistory?: Message[];
  }): Promise<ClaudeResponse> {
    const { message, project, conversationHistory = [] } = params;

    // Build system prompt with project context
    const systemPrompt = this.buildSystemPrompt(project);

    // Prepare messages
    const messages: Anthropic.MessageParam[] = [
      ...conversationHistory.map(m => ({
        role: m.role,
        content: m.content
      })),
      {
        role: 'user' as const,
        content: message
      }
    ];

    // Define tools for Claude
    const tools: Anthropic.Tool[] = [
      {
        name: 'search_code',
        description: 'Search the Noodles.gl source code for patterns, classes, functions, or implementations',
        input_schema: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
              description: 'Search pattern (regex supported)'
            },
            path: {
              type: 'string',
              description: 'Optional: limit search to specific path'
            },
            contextLines: {
              type: 'number',
              description: 'Number of context lines to include (default: 3)'
            }
          },
          required: ['pattern']
        }
      },
      {
        name: 'get_source_code',
        description: 'Get the source code for a specific file and line range',
        input_schema: {
          type: 'object',
          properties: {
            file: {
              type: 'string',
              description: 'File path relative to project root'
            },
            startLine: {
              type: 'number',
              description: 'Start line (1-indexed)'
            },
            endLine: {
              type: 'number',
              description: 'End line (1-indexed)'
            }
          },
          required: ['file']
        }
      },
      {
        name: 'get_operator_schema',
        description: 'Get the complete schema for an operator type including inputs, outputs, and documentation',
        input_schema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              description: 'Operator type (e.g., "GeoJsonLayerOp")'
            }
          },
          required: ['type']
        }
      },
      {
        name: 'list_operators',
        description: 'List all available operator types, optionally filtered by category',
        input_schema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: 'Optional: filter by category (data, layer, renderer, accessor, utility, container)'
            }
          }
        }
      },
      {
        name: 'get_documentation',
        description: 'Search the Noodles.gl documentation for topics',
        input_schema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query'
            },
            section: {
              type: 'string',
              description: 'Optional: limit to section (users, developers)'
            }
          },
          required: ['query']
        }
      },
      {
        name: 'get_example',
        description: 'Get a complete example project by ID',
        input_schema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Example ID (e.g., "geojson-example")'
            }
          },
          required: ['id']
        }
      },
      {
        name: 'list_examples',
        description: 'List all available example projects',
        input_schema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: 'Optional: filter by category'
            },
            tag: {
              type: 'string',
              description: 'Optional: filter by tag'
            }
          }
        }
      },
      {
        name: 'find_symbol',
        description: 'Find a symbol (class, function, type) by name and get its implementation',
        input_schema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Symbol name to find'
            }
          },
          required: ['name']
        }
      },
      {
        name: 'analyze_project',
        description: 'Analyze the current project for validation issues, performance problems, or suggestions',
        input_schema: {
          type: 'object',
          properties: {
            project: {
              type: 'object',
              description: 'The current project JSON'
            },
            analysisType: {
              type: 'string',
              enum: ['validation', 'performance', 'suggestions'],
              description: 'Type of analysis to perform'
            }
          },
          required: ['project', 'analysisType']
        }
      }
    ];

    // Send to Claude
    let response = await this.client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 8192,
      system: systemPrompt,
      messages,
      tools
    });

    const toolCalls: ToolCall[] = [];
    let finalText = '';

    // Handle tool use loop
    while (response.stop_reason === 'tool_use') {
      // Execute tools
      const toolResults: Anthropic.MessageParam = {
        role: 'user',
        content: []
      };

      for (const content of response.content) {
        if (content.type === 'tool_use') {
          const result = await this.executeTool(content.name, content.input);
          toolCalls.push({
            name: content.name,
            params: content.input,
            result
          });

          (toolResults.content as any[]).push({
            type: 'tool_result',
            tool_use_id: content.id,
            content: JSON.stringify(result)
          });
        } else if (content.type === 'text') {
          finalText += content.text;
        }
      }

      // Continue conversation with tool results
      messages.push({
        role: 'assistant',
        content: response.content
      });
      messages.push(toolResults);

      response = await this.client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 8192,
        system: systemPrompt,
        messages,
        tools
      });
    }

    // Extract final text response
    for (const content of response.content) {
      if (content.type === 'text') {
        finalText += content.text;
      }
    }

    // Parse project modifications from response
    const projectModifications = this.extractProjectModifications(finalText);

    return {
      message: finalText,
      projectModifications,
      toolCalls
    };
  }

  private buildSystemPrompt(project: NoodlesProject): string {
    return `You are an AI assistant integrated into Noodles.gl, a node-based editor for creating geospatial visualizations and data presentations.

## Your Capabilities

You have access to tools that let you:
1. Search the Noodles.gl source code to understand operator implementations
2. Get complete operator schemas with input/output types
3. Access comprehensive documentation for users and developers
4. View example projects with annotations
5. Analyze the current project for issues and opportunities

## Current Project Context

The user is working on a project with:
- ${project.nodes.length} nodes (operators)
- ${project.edges.length} connections (edges)

Node types in use: ${[...new Set(project.nodes.map(n => n.type))].join(', ')}

Current project structure:
\`\`\`json
${JSON.stringify(project, null, 2)}
\`\`\`

## Guidelines for Helping Users

1. **Understanding requests**: When users ask to create visualizations, first understand:
   - What data source they're using (URL, file, inline)
   - What kind of visualization they want (map, chart, timeline)
   - What operators would be best suited

2. **Using tools effectively**:
   - Use \`list_operators\` to find relevant operator types
   - Use \`get_operator_schema\` to understand required inputs
   - Use \`get_example\` to see similar patterns
   - Use \`search_code\` when you need to understand implementation details

3. **Modifying projects**: When suggesting changes, provide:
   - Clear explanations of what you're doing
   - Complete node and edge specifications
   - Proper operator paths (e.g., "/my-layer" for root, "/container/my-layer" for nested)

4. **Project modifications format**: When making changes, output a JSON block like:
   \`\`\`json
   {
     "modifications": [
       {
         "type": "add_node",
         "data": {
           "id": "/my-node",
           "type": "GeoJsonLayerOp",
           "data": { "inputs": {...}, "locked": false },
           "position": { "x": 0, "y": 0 }
         }
       },
       {
         "type": "add_edge",
         "data": {
           "id": "/source.out.data->/target.par.data",
           "source": "/source",
           "target": "/target",
           "sourceHandle": "out.data",
           "targetHandle": "par.data"
         }
       }
     ]
   }
   \`\`\`

5. **Debugging**: When users report issues:
   - Use \`analyze_project\` to validate the project
   - Check for missing connections or required inputs
   - Look at operator implementations if needed

## Operator Types Overview

Common operators you'll work with:
- **Data Sources**: FileOp, JSONOp, DuckDbOp, CSVOp
- **Layers**: GeoJsonLayerOp, ScatterplotLayerOp, HexagonLayerOp, HeatmapLayerOp, PathLayerOp
- **Renderers**: DeckRendererOp (renders layers), OutOp (final output)
- **Accessors**: AccessorOp (data transformations for layers), ColorRampOp
- **Utilities**: ExpressionOp, CodeOp, NumberOp, ContainerOp
- **Basemaps**: MaplibreBasemapOp

## Key Concepts

- **Operators** are nodes that process data. They have an \`execute\` method that takes inputs and produces outputs.
- **Fields** define input/output schemas and UI hints. Connect fields via edges.
- **Paths** identify operators: \`/name\` for root, \`/container/name\` for nested.
- **Reactive references**: Use \`op('/path').par.field\` in CodeOp/ExpressionOp or \`{{/path.out.field}}\` in DuckDbOp.
- **Theatre.js timeline**: Any operator input can be keyframed for animation.

Be helpful, thorough, and always validate your suggestions against the actual operator schemas!`;
  }

  private async executeTool(name: string, params: any): Promise<ToolResult> {
    const methodMap: Record<string, (params: any) => Promise<ToolResult>> = {
      search_code: (p) => this.tools.searchCode(p),
      get_source_code: (p) => this.tools.getSourceCode(p),
      get_operator_schema: (p) => this.tools.getOperatorSchema(p),
      list_operators: (p) => this.tools.listOperators(p),
      get_documentation: (p) => this.tools.getDocumentation(p),
      get_example: (p) => this.tools.getExample(p),
      list_examples: (p) => this.tools.listExamples(p),
      find_symbol: (p) => this.tools.findSymbol(p),
      analyze_project: (p) => this.tools.analyzeProject(p)
    };

    const method = methodMap[name];
    if (!method) {
      return {
        success: false,
        error: `Unknown tool: ${name}`
      };
    }

    return method(params);
  }

  private extractProjectModifications(text: string): ProjectModification[] {
    // Look for JSON code blocks containing modifications
    const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/g;
    const matches = [...text.matchAll(jsonBlockRegex)];

    for (const match of matches) {
      try {
        const json = JSON.parse(match[1]);
        if (json.modifications && Array.isArray(json.modifications)) {
          return json.modifications;
        }
      } catch (e) {
        // Not valid JSON or not a modifications block
        continue;
      }
    }

    return [];
  }
}
```

---

### 3.4 Visual Debugging Tools

Claude's vision capabilities enable it to see and analyze the actual rendered visualization, providing powerful debugging and visual analysis features.

#### Overview

The visual debugging system allows Claude to:
- Capture screenshots of the deck.gl canvas
- Track browser console errors and warnings
- Access deck.gl rendering statistics
- Inspect layer states and performance metrics
- Combine visual analysis with code/project analysis

This makes Claude significantly more effective at debugging visual issues like "my layer isn't showing" or "colors are wrong".

#### Architecture

```
┌──────────────────────────────────────────────────────┐
│  Noodles.gl App                                      │
│                                                       │
│  ┌─────────────────┐         ┌──────────────────┐   │
│  │ Deck.gl Canvas  │────────>│ Screenshot       │   │
│  │ (rendering)     │  toDataURL│ Capture         │   │
│  └─────────────────┘         └──────────────────┘   │
│                                        │             │
│  ┌─────────────────┐                  │             │
│  │ Console         │                  │             │
│  │ Error Tracking  │                  │             │
│  └─────────────────┘                  │             │
│           │                            │             │
│           └────────────────────────────┘             │
│                      │                               │
│                      ▼                               │
│              ┌────────────────┐                      │
│              │ Visual Tools   │                      │
│              │ (MCPTools)     │                      │
│              └────────┬───────┘                      │
│                       │                              │
└───────────────────────┼──────────────────────────────┘
                        │
                        ▼
                ┌───────────────────┐
                │ Claude API        │
                │ (with vision)     │
                └───────────────────┘
```

#### Implementation

**Location**: Add to `noodles-editor/src/claude/MCPTools.ts`

```typescript
export class MCPTools {
  private canvasRef: HTMLCanvasElement | null = null;
  private consoleErrors: ConsoleError[] = [];

  constructor(private contextLoader: ContextLoader) {
    this.setupConsoleTracking();
  }

  /**
   * Set reference to deck.gl canvas for screenshot capture
   */
  setCanvasRef(canvas: HTMLCanvasElement | null) {
    this.canvasRef = canvas;
  }

  /**
   * Capture screenshot of the current visualization
   */
  async captureVisualization(params: {
    includeUI?: boolean;
    format?: 'png' | 'jpeg';
    quality?: number;
  }): Promise<ToolResult> {
    try {
      if (!this.canvasRef) {
        return {
          success: false,
          error: 'Canvas not available. Make sure deck.gl is initialized.'
        };
      }

      const format = params.format || 'png';
      const quality = params.quality || 0.95;

      // Capture canvas
      const dataUrl = this.canvasRef.toDataURL(`image/${format}`, quality);
      const base64 = dataUrl.split(',')[1];

      return {
        success: true,
        data: {
          screenshot: base64,
          format,
          width: this.canvasRef.width,
          height: this.canvasRef.height,
          timestamp: Date.now(),
          pixelRatio: window.devicePixelRatio
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Screenshot capture failed'
      };
    }
  }

  /**
   * Get recent console errors and warnings
   */
  async getConsoleErrors(params: {
    since?: number; // Timestamp
    level?: 'error' | 'warn' | 'all';
    maxResults?: number;
  }): Promise<ToolResult> {
    try {
      const since = params.since || Date.now() - (5 * 60 * 1000); // Default: last 5 minutes
      const level = params.level || 'all';
      const maxResults = params.maxResults || 50;

      let filtered = this.consoleErrors.filter(err => err.timestamp >= since);

      if (level !== 'all') {
        filtered = filtered.filter(err => err.level === level);
      }

      // Sort by timestamp (newest first)
      filtered.sort((a, b) => b.timestamp - a.timestamp);

      return {
        success: true,
        data: {
          errors: filtered.slice(0, maxResults),
          totalCount: filtered.length,
          since,
          level
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve console errors'
      };
    }
  }

  /**
   * Get deck.gl rendering statistics
   */
  async getRenderStats(): Promise<ToolResult> {
    try {
      const stats = (window as any).__deckStats;

      if (!stats) {
        return {
          success: false,
          error: 'Deck.gl stats not available. Ensure onAfterRender is configured.'
        };
      }

      // Also get general performance metrics
      const memory = (performance as any).memory;
      const navigation = performance.getEntriesByType('navigation')[0] as any;

      return {
        success: true,
        data: {
          deck: {
            fps: stats.fps,
            lastFrameTime: stats.lastFrameTime,
            layerCount: stats.layerCount,
            drawCalls: stats.drawCalls,
            timestamp: stats.timestamp
          },
          memory: memory ? {
            usedJSHeapSize: memory.usedJSHeapSize,
            totalJSHeapSize: memory.totalJSHeapSize,
            jsHeapSizeLimit: memory.jsHeapSizeLimit,
            usedPercent: Math.round((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100)
          } : null,
          page: {
            loadTime: navigation?.loadEventEnd - navigation?.fetchStart,
            domContentLoaded: navigation?.domContentLoadedEventEnd - navigation?.fetchStart
          }
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve render stats'
      };
    }
  }

  /**
   * Inspect a specific layer in the visualization
   */
  async inspectLayer(params: { layerId: string }): Promise<ToolResult> {
    try {
      const deckInstance = (window as any).__deckInstance;

      if (!deckInstance) {
        return {
          success: false,
          error: 'Deck.gl instance not available'
        };
      }

      // Find layer by ID
      const layers = deckInstance.layerManager?.getLayers() || [];
      const layer = layers.find((l: any) => l.id === params.layerId);

      if (!layer) {
        return {
          success: false,
          error: `Layer not found: ${params.layerId}`
        };
      }

      // Extract layer information
      const layerInfo = {
        id: layer.id,
        type: layer.constructor.name,
        visible: layer.props.visible,
        opacity: layer.props.opacity,
        pickable: layer.props.pickable,
        dataLength: Array.isArray(layer.props.data) ? layer.props.data.length : 'unknown',
        bounds: layer.getBounds?.(),
        state: {
          needsRedraw: layer.state?.needsRedraw,
          loaded: layer.state?.loaded,
          error: layer.state?.error
        },
        props: Object.keys(layer.props).reduce((acc: any, key) => {
          const value = layer.props[key];
          // Only include serializable props
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            acc[key] = value;
          }
          return acc;
        }, {})
      };

      return {
        success: true,
        data: layerInfo
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to inspect layer'
      };
    }
  }

  /**
   * Set up console error/warning tracking
   */
  private setupConsoleTracking() {
    // Intercept console.error
    const originalError = console.error;
    console.error = (...args: any[]) => {
      this.consoleErrors.push({
        level: 'error',
        message: args.map(arg =>
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' '),
        stack: new Error().stack,
        timestamp: Date.now()
      });

      // Limit stored errors
      if (this.consoleErrors.length > 100) {
        this.consoleErrors = this.consoleErrors.slice(-100);
      }

      originalError.apply(console, args);
    };

    // Intercept console.warn
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => {
      this.consoleErrors.push({
        level: 'warn',
        message: args.map(arg =>
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' '),
        stack: new Error().stack,
        timestamp: Date.now()
      });

      if (this.consoleErrors.length > 100) {
        this.consoleErrors = this.consoleErrors.slice(-100);
      }

      originalWarn.apply(console, args);
    };

    // Track unhandled errors
    window.addEventListener('error', (event) => {
      this.consoleErrors.push({
        level: 'error',
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack,
        timestamp: Date.now()
      });
    });

    // Track unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.consoleErrors.push({
        level: 'error',
        message: `Unhandled Promise Rejection: ${event.reason}`,
        stack: event.reason?.stack,
        timestamp: Date.now()
      });
    });
  }
}

interface ConsoleError {
  level: 'error' | 'warn';
  message: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  stack?: string;
  timestamp: number;
}
```

#### Exposing Deck.gl Stats

**Location**: `noodles-editor/src/render/DeckRenderer.tsx` (or wherever Deck is initialized)

```typescript
import { Deck } from '@deck.gl/core';

// When initializing deck.gl
const deck = new Deck({
  canvas: canvasRef.current,
  // ... other config
  onAfterRender: (params) => {
    // Expose stats globally for MCPTools
    (window as any).__deckStats = {
      fps: Math.round(1000 / params.renderTime),
      lastFrameTime: params.renderTime,
      layerCount: params.layerManager.getLayers().length,
      drawCalls: params.stats?.drawCalls || 0,
      timestamp: Date.now()
    };
  }
});

// Expose deck instance globally
(window as any).__deckInstance = deck;

// Pass canvas ref to MCPTools
useEffect(() => {
  if (canvasRef.current && mcpTools) {
    mcpTools.setCanvasRef(canvasRef.current);
  }
}, [canvasRef.current, mcpTools]);
```

#### Enhanced Claude Client with Vision

**Location**: Update `noodles-editor/src/claude/ClaudeClient.ts`

```typescript
export class ClaudeClient {
  // ... existing code ...

  async sendMessage(params: {
    message: string;
    project: NoodlesProject;
    screenshot?: string; // Base64-encoded image
    autoCapture?: boolean; // Auto-capture on visual keywords
    conversationHistory?: Message[];
  }): Promise<ClaudeResponse> {
    const { message, project, conversationHistory = [] } = params;

    // Auto-capture screenshot if message suggests visual issue
    let screenshot = params.screenshot;
    const visualKeywords = ['see', 'look', 'show', 'appear', 'display', 'visual', 'render', 'color', 'layer'];
    const shouldAutoCapture = params.autoCapture !== false &&
      visualKeywords.some(kw => message.toLowerCase().includes(kw));

    if (shouldAutoCapture && !screenshot) {
      const result = await this.tools.captureVisualization({});
      if (result.success) {
        screenshot = result.data.screenshot;
      }
    }

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt(project);

    // Prepare message content (with optional screenshot)
    const userContent: any[] = [{ type: 'text', text: message }];

    if (screenshot) {
      userContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: screenshot
        }
      });
    }

    const messages: Anthropic.MessageParam[] = [
      ...conversationHistory.map(m => ({
        role: m.role,
        content: m.content
      })),
      {
        role: 'user' as const,
        content: userContent
      }
    ];

    // Add visual debugging tools
    const visualTools: Anthropic.Tool[] = [
      {
        name: 'capture_visualization',
        description: 'Capture a screenshot of the current deck.gl visualization to see what the user is seeing. Use this when users report visual issues or ask about appearance.',
        input_schema: {
          type: 'object',
          properties: {
            includeUI: {
              type: 'boolean',
              description: 'Whether to include UI elements (default: false, canvas only)'
            },
            format: {
              type: 'string',
              enum: ['png', 'jpeg'],
              description: 'Image format (default: png)'
            }
          }
        }
      },
      {
        name: 'get_console_errors',
        description: 'Get recent browser console errors and warnings. Use this when debugging issues or when users report errors.',
        input_schema: {
          type: 'object',
          properties: {
            since: {
              type: 'number',
              description: 'Timestamp to get errors since (default: last 5 minutes)'
            },
            level: {
              type: 'string',
              enum: ['error', 'warn', 'all'],
              description: 'Filter by error level (default: all)'
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of errors to return (default: 50)'
            }
          }
        }
      },
      {
        name: 'get_render_stats',
        description: 'Get deck.gl rendering statistics (FPS, memory usage, draw calls) and performance metrics. Use for performance debugging.',
        input_schema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'inspect_layer',
        description: 'Get detailed information about a specific deck.gl layer including visibility, data, and state.',
        input_schema: {
          type: 'object',
          properties: {
            layerId: {
              type: 'string',
              description: 'ID of the layer to inspect'
            }
          },
          required: ['layerId']
        }
      }
    ];

    // Combine with existing tools
    const allTools = [...this.getStandardTools(), ...visualTools];

    // Send to Claude (rest of implementation same as before)
    let response = await this.client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 8192,
      system: systemPrompt,
      messages,
      tools: allTools
    });

    // ... rest of existing tool execution loop ...
  }

  private buildSystemPrompt(project: NoodlesProject): string {
    return `You are an AI assistant integrated into Noodles.gl, a node-based editor for creating geospatial visualizations and data presentations.

## Your Capabilities

You have access to tools that let you:
1. Search the Noodles.gl source code to understand operator implementations
2. Get complete operator schemas with input/output types
3. Access comprehensive documentation for users and developers
4. View example projects with annotations
5. Analyze the current project for issues and opportunities
6. **Capture screenshots of the visualization** (NEW!)
7. **Track console errors and warnings** (NEW!)
8. **Access rendering performance metrics** (NEW!)
9. **Inspect individual layers** (NEW!)

## Visual Debugging

You have vision capabilities! When users report visual issues or ask about appearance:

1. **Use \`capture_visualization\`** to see what they're seeing
   - Automatically triggered on keywords like "see", "look", "show", "display"
   - Compare screenshot with project configuration
   - Identify missing layers, incorrect colors, positioning issues

2. **Use \`get_console_errors\`** to check for runtime errors
   - Look for deck.gl errors, data loading issues, accessor errors
   - Correlate errors with visual problems

3. **Use \`get_render_stats\`** for performance issues
   - Check FPS (target: >30fps, ideal: 60fps)
   - Monitor memory usage (warn if >80%)
   - Count draw calls (optimize if excessive)

4. **Use \`inspect_layer\`** to debug specific layers
   - Check visibility, opacity, data presence
   - Verify layer state (loaded, error states)

### Visual Debugging Workflow

When user says "My layer isn't showing":
1. Capture screenshot → see what's actually rendered
2. Check console errors → look for loading/accessor errors
3. Inspect layer → verify visibility, data, configuration
4. Analyze project → check connections, required inputs
5. Explain findings with reference to screenshot

When user says "Performance is slow":
1. Get render stats → check FPS, draw calls
2. Analyze project → count layers, data points
3. Suggest optimizations (aggregation, filtering, LOD)

When user says "Colors are wrong":
1. Capture screenshot → see actual colors
2. Inspect layer → check accessor configuration
3. Check project → verify color accessor connections
4. Explain color pipeline and suggest fixes

### Important Guidelines

- **Always explain what you see in screenshots**: "I can see your map is rendering with 15 black points concentrated in the center..."
- **Correlate visual with code**: "The screenshot shows no points, and I see your GeoJsonLayerOp has no data connection..."
- **Be specific about visual issues**: Don't just say "layer not visible", say "I can see the map basemap but no data layer is rendering"
- **Use multiple tools together**: Screenshot + console errors + project analysis = comprehensive debugging

## Current Project Context

The user is working on a project with:
- ${project.nodes.length} nodes (operators)
- ${project.edges.length} connections (edges)

Node types in use: ${[...new Set(project.nodes.map(n => n.type))].join(', ')}

Current project structure:
\`\`\`json
${JSON.stringify(project, null, 2)}
\`\`\`

## Guidelines for Helping Users

(... existing guidelines ...)

Be helpful, thorough, and use your vision capabilities to provide comprehensive visual debugging!`;
  }

  private async executeTool(name: string, params: any): Promise<ToolResult> {
    const methodMap: Record<string, (params: any) => Promise<ToolResult>> = {
      // Existing tools
      search_code: (p) => this.tools.searchCode(p),
      get_source_code: (p) => this.tools.getSourceCode(p),
      get_operator_schema: (p) => this.tools.getOperatorSchema(p),
      list_operators: (p) => this.tools.listOperators(p),
      get_documentation: (p) => this.tools.getDocumentation(p),
      get_example: (p) => this.tools.getExample(p),
      list_examples: (p) => this.tools.listExamples(p),
      find_symbol: (p) => this.tools.findSymbol(p),
      analyze_project: (p) => this.tools.analyzeProject(p),

      // Visual debugging tools
      capture_visualization: (p) => this.tools.captureVisualization(p),
      get_console_errors: (p) => this.tools.getConsoleErrors(p),
      get_render_stats: (p) => this.tools.getRenderStats(p),
      inspect_layer: (p) => this.tools.inspectLayer(p)
    };

    const method = methodMap[name];
    if (!method) {
      return {
        success: false,
        error: `Unknown tool: ${name}`
      };
    }

    return method(params);
  }

  private getStandardTools(): Anthropic.Tool[] {
    // Return the original tools array from section 3.3
    return [
      // ... all the existing tools ...
    ];
  }
}
```

#### Updated Chat Panel UI

**Location**: Update `noodles-editor/src/claude/ChatPanel.tsx`

```typescript
export const ChatPanel: React.FC<ChatPanelProps> = ({ onClose, isPopout }) => {
  const [autoCapture, setAutoCapture] = useState(true);
  const [lastScreenshot, setLastScreenshot] = useState<string | null>(null);

  // ... existing state ...

  const handleSend = async () => {
    if (!input.trim() || !claudeClient || !project) return;

    // ... existing message setup ...

    try {
      const response = await claudeClient.sendMessage({
        message: input,
        project,
        autoCapture, // Pass auto-capture preference
        conversationHistory: messages
      });

      // ... handle response ...
    } catch (error) {
      // ... handle error ...
    }
  };

  const handleManualCapture = async () => {
    if (!mcpTools) return;

    const result = await mcpTools.captureVisualization({});
    if (result.success) {
      setLastScreenshot(result.data.screenshot);
      // Show preview or add to next message
      alert('Screenshot captured! It will be included with your next message.');
    }
  };

  return (
    <div className="chat-panel">
      {/* ... existing header ... */}

      <div className="chat-panel-options">
        <label className="chat-option">
          <input
            type="checkbox"
            checked={autoCapture}
            onChange={(e) => setAutoCapture(e.target.checked)}
          />
          <span>Auto-capture screenshots</span>
          <span className="chat-option-hint">
            Automatically capture when you ask about visuals
          </span>
        </label>
        <button
          onClick={handleManualCapture}
          className="capture-btn"
          title="Capture current visualization"
        >
          📸 Capture Now
        </button>
      </div>

      {/* ... rest of UI ... */}
    </div>
  );
};
```

**Location**: Add to `noodles-editor/src/claude/ChatPanel.css`

```css
.chat-panel-options {
  padding: 8px 16px;
  border-bottom: 1px solid var(--color-border, #333);
  background: var(--color-bg-primary, #252525);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.chat-option {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-secondary, #aaa);
  cursor: pointer;
}

.chat-option input[type="checkbox"] {
  cursor: pointer;
}

.chat-option-hint {
  font-size: 11px;
  color: var(--color-text-tertiary, #666);
  margin-left: 4px;
}

.capture-btn {
  background: var(--color-bg-hover, #333);
  border: 1px solid var(--color-border, #444);
  color: var(--color-text-primary, #e0e0e0);
  border-radius: 4px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s;
}

.capture-btn:hover {
  background: var(--color-accent, #4a9eff);
  border-color: var(--color-accent, #4a9eff);
  color: white;
}
```

#### Example Use Cases

**Example 1: Layer Not Visible**

```
User: "My GeoJSON layer isn't showing up, can you help?"

Claude:
1. Calls capture_visualization() → sees only basemap, no data layer
2. Calls get_console_errors() → finds "Cannot read property 'coordinates' of undefined"
3. Calls analyze_project() → sees GeoJsonLayerOp has no data connection
4. Calls inspect_layer('/geojson-layer') → confirms layer exists but has no data

Response: "I can see your basemap is rendering correctly in the screenshot, but
there's no data layer visible. I found a console error indicating the GeoJSON data
has undefined coordinates. Looking at your project, I see the GeoJsonLayerOp at
/geojson-layer isn't connected to a data source. Let me add a FileOp and connect it..."
```

**Example 2: Performance Issue**

```
User: "The map is really laggy when I pan"

Claude:
1. Calls get_render_stats() → sees FPS at 12, draw calls at 500+
2. Calls analyze_project() → finds 100,000 points in ScatterplotLayerOp
3. Calls capture_visualization() → sees dense point cloud

Response: "I can see you're rendering 100,000 individual points, which is causing
performance issues (currently only 12 FPS). The screenshot shows the points are
very dense and overlapping. I recommend switching to HexagonLayerOp for spatial
aggregation, which will reduce draw calls significantly and improve performance
to 60 FPS..."
```

**Example 3: Color Issue**

```
User: "All my points are showing up as black instead of colored"

Claude:
1. Calls capture_visualization() → sees map with black points
2. Calls inspect_layer('/points') → sees getFillColor is undefined
3. Calls analyze_project() → no ColorRamp or AccessorOp connected

Response: "I can see in the screenshot that your points are indeed rendering as
black. Looking at the layer configuration, the getFillColor accessor isn't set up.
You need to either:
1. Add an AccessorOp to compute colors from your data
2. Or add a ColorRampOp to map a data property to colors
Let me add a ColorRamp node for you..."
```

#### Performance Considerations

**Screenshot Size**:
- PNG screenshots: ~50-200KB (depends on resolution/content)
- Added to API request, increases cost slightly
- Enable compression for large canvases

**Auto-Capture Strategy**:
- Only capture on relevant keywords (see, look, show, etc.)
- User can disable auto-capture
- Rate limit: max 1 screenshot per message

**Console Error Tracking**:
- Keep last 100 errors in memory (~50KB)
- Minimal performance impact
- Cleared on page reload

**Stats Collection**:
- Updated every frame (negligible overhead)
- Small memory footprint (<1KB)

#### Testing Checklist

Visual debugging specific tests:

- [ ] Screenshot capture works on various canvas sizes
- [ ] Screenshot includes correct content (deck.gl layers visible)
- [ ] Console errors are tracked correctly
- [ ] Error tracking doesn't break original console behavior
- [ ] Deck.gl stats are updated correctly
- [ ] Stats persist across re-renders
- [ ] Layer inspection returns accurate information
- [ ] Auto-capture triggers on correct keywords
- [ ] Manual capture button works
- [ ] Screenshots are properly encoded in API requests
- [ ] Claude can see and analyze screenshots
- [ ] Visual debugging improves issue resolution time

#### Update to Package Dependencies

Add to `noodles-editor/package.json`:

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.27.0",
    "flexsearch": "^0.7.43"
    // No additional dependencies needed for visual debugging
  }
}
```

---

## 4. Chat Panel UI

### 4.1 Component Structure

**Location**: `noodles-editor/src/claude/ChatPanel.tsx`

```typescript
import React, { useState, useEffect, useRef } from 'react';
import { ClaudeClient, Message, ClaudeResponse } from './ClaudeClient';
import { ContextLoader } from './ContextLoader';
import { MCPTools } from './MCPTools';
import { useNoodlesStore } from '../noodles/store';
import type { NoodlesProject } from '../noodles/noodles';
import './ChatPanel.css';

interface ChatPanelProps {
  onClose?: () => void;
  isPopout?: boolean;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ onClose, isPopout = false }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [contextLoading, setContextLoading] = useState(true);
  const [apiKey, setApiKey] = useState<string>('');
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [claudeClient, setClaudeClient] = useState<ClaudeClient | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const project = useNoodlesStore(state => state.project);
  const updateProject = useNoodlesStore(state => state.updateProject);

  // Initialize context loader and Claude client
  useEffect(() => {
    const init = async () => {
      // Load API key from localStorage
      const storedKey = localStorage.getItem('noodles-claude-api-key');
      if (!storedKey) {
        setShowApiKeyModal(true);
        setContextLoading(false);
        return;
      }

      setApiKey(storedKey);

      // Load context
      const loader = new ContextLoader();
      await loader.load((progress) => {
        console.log('Loading context:', progress);
      });

      // Initialize tools and client
      const tools = new MCPTools(loader);
      const client = new ClaudeClient(storedKey, tools);
      setClaudeClient(client);
      setContextLoading(false);
    };

    init();
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !claudeClient || !project) return;

    const userMessage: Message = {
      role: 'user',
      content: input
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await claudeClient.sendMessage({
        message: input,
        project,
        conversationHistory: messages
      });

      const assistantMessage: Message = {
        role: 'assistant',
        content: response.message
      };

      setMessages(prev => [...prev, assistantMessage]);

      // Apply project modifications if any
      if (response.projectModifications && response.projectModifications.length > 0) {
        applyProjectModifications(response.projectModifications, project);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: Message = {
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const applyProjectModifications = (modifications: any[], currentProject: NoodlesProject) => {
    let updatedProject = { ...currentProject };

    modifications.forEach(mod => {
      switch (mod.type) {
        case 'add_node':
          updatedProject.nodes.push(mod.data);
          break;
        case 'update_node':
          updatedProject.nodes = updatedProject.nodes.map(node =>
            node.id === mod.data.id ? { ...node, ...mod.data } : node
          );
          break;
        case 'delete_node':
          updatedProject.nodes = updatedProject.nodes.filter(
            node => node.id !== mod.data.id
          );
          break;
        case 'add_edge':
          updatedProject.edges.push(mod.data);
          break;
        case 'delete_edge':
          updatedProject.edges = updatedProject.edges.filter(
            edge => edge.id !== mod.data.id
          );
          break;
      }
    });

    updateProject(updatedProject);
  };

  const handleApiKeySubmit = (key: string) => {
    localStorage.setItem('noodles-claude-api-key', key);
    setApiKey(key);
    setShowApiKeyModal(false);

    // Re-initialize with new key
    window.location.reload();
  };

  const handlePopout = () => {
    // Open chat panel in new window
    const popout = window.open(
      '/chat-panel',
      'Noodles.gl Chat',
      'width=600,height=800,resizable=yes'
    );

    if (popout && onClose) {
      onClose();
    }
  };

  if (showApiKeyModal) {
    return <ApiKeyModal onSubmit={handleApiKeySubmit} />;
  }

  if (contextLoading) {
    return (
      <div className="chat-panel">
        <div className="chat-panel-loading">
          <div className="spinner" />
          <p>Loading context...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`chat-panel ${isPopout ? 'chat-panel-popout' : ''}`}>
      <div className="chat-panel-header">
        <h3>Claude Assistant</h3>
        <div className="chat-panel-actions">
          {!isPopout && (
            <button
              className="chat-panel-action-btn"
              onClick={handlePopout}
              title="Pop out"
            >
              ⧉
            </button>
          )}
          <button
            className="chat-panel-action-btn"
            onClick={() => setShowApiKeyModal(true)}
            title="Change API Key"
          >
            ⚙
          </button>
          {onClose && (
            <button
              className="chat-panel-action-btn"
              onClick={onClose}
              title="Close"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="chat-panel-messages">
        {messages.length === 0 && (
          <div className="chat-panel-welcome">
            <h4>Welcome to Noodles.gl Claude Assistant!</h4>
            <p>I can help you:</p>
            <ul>
              <li>Create visualizations from scratch</li>
              <li>Modify existing nodes and connections</li>
              <li>Debug issues in your project</li>
              <li>Suggest operators and patterns</li>
              <li>Analyze data and create queries</li>
            </ul>
            <p>Try asking: "Create a heatmap showing density of these points"</p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={idx} className={`chat-message chat-message-${msg.role}`}>
            <div className="chat-message-role">
              {msg.role === 'user' ? 'You' : 'Claude'}
            </div>
            <div className="chat-message-content">
              <MessageContent content={msg.content} />
            </div>
          </div>
        ))}

        {loading && (
          <div className="chat-message chat-message-assistant">
            <div className="chat-message-role">Claude</div>
            <div className="chat-message-content">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-panel-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Ask Claude for help..."
          disabled={loading}
          rows={3}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="chat-send-btn"
        >
          Send
        </button>
      </div>
    </div>
  );
};

// Render message content with markdown support
const MessageContent: React.FC<{ content: string }> = ({ content }) => {
  // Simple markdown rendering (or use a library like react-markdown)
  const renderContent = () => {
    // Basic code block support
    const parts = content.split(/(```[\s\S]*?```)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('```')) {
        const code = part.replace(/```(\w+)?\n?/, '').replace(/```$/, '');
        return (
          <pre key={idx}>
            <code>{code}</code>
          </pre>
        );
      }
      return <p key={idx}>{part}</p>;
    });
  };

  return <div>{renderContent()}</div>;
};

// API Key Modal
const ApiKeyModal: React.FC<{ onSubmit: (key: string) => void }> = ({ onSubmit }) => {
  const [key, setKey] = useState('');

  return (
    <div className="api-key-modal-overlay">
      <div className="api-key-modal">
        <h3>Enter Anthropic API Key</h3>
        <p>
          To use the Claude assistant, you need an API key from{' '}
          <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer">
            Anthropic Console
          </a>
        </p>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-ant-..."
          className="api-key-input"
        />
        <div className="api-key-modal-actions">
          <button
            onClick={() => onSubmit(key)}
            disabled={!key.trim()}
            className="api-key-submit-btn"
          >
            Save
          </button>
        </div>
        <p className="api-key-note">
          Your API key is stored locally in your browser and never sent to Noodles.gl servers.
        </p>
      </div>
    </div>
  );
};
```

### 4.2 Styles

**Location**: `noodles-editor/src/claude/ChatPanel.css`

```css
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-secondary, #1e1e1e);
  border-left: 1px solid var(--color-border, #333);
}

.chat-panel-popout {
  border-left: none;
}

.chat-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border, #333);
  background: var(--color-bg-primary, #252525);
}

.chat-panel-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary, #e0e0e0);
}

.chat-panel-actions {
  display: flex;
  gap: 8px;
}

.chat-panel-action-btn {
  background: transparent;
  border: none;
  color: var(--color-text-secondary, #aaa);
  cursor: pointer;
  font-size: 16px;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background 0.2s;
}

.chat-panel-action-btn:hover {
  background: var(--color-bg-hover, #333);
  color: var(--color-text-primary, #e0e0e0);
}

.chat-panel-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-secondary, #aaa);
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--color-border, #333);
  border-top-color: var(--color-accent, #4a9eff);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.chat-panel-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.chat-panel-welcome {
  color: var(--color-text-secondary, #aaa);
  font-size: 13px;
}

.chat-panel-welcome h4 {
  color: var(--color-text-primary, #e0e0e0);
  margin-bottom: 12px;
}

.chat-panel-welcome ul {
  margin: 12px 0;
  padding-left: 20px;
}

.chat-message {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.chat-message-role {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-secondary, #aaa);
}

.chat-message-user .chat-message-role {
  color: var(--color-accent, #4a9eff);
}

.chat-message-content {
  background: var(--color-bg-primary, #252525);
  padding: 12px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-primary, #e0e0e0);
}

.chat-message-user .chat-message-content {
  background: var(--color-accent-bg, #1a3a52);
}

.chat-message-content pre {
  background: var(--color-bg-code, #1a1a1a);
  padding: 12px;
  border-radius: 4px;
  overflow-x: auto;
  margin: 8px 0;
}

.chat-message-content code {
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
}

.typing-indicator {
  display: flex;
  gap: 4px;
  padding: 8px 0;
}

.typing-indicator span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-secondary, #aaa);
  animation: typing 1.4s infinite;
}

.typing-indicator span:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-indicator span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing {
  0%, 60%, 100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-8px);
  }
}

.chat-panel-input {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--color-border, #333);
  background: var(--color-bg-primary, #252525);
}

.chat-panel-input textarea {
  flex: 1;
  background: var(--color-bg-secondary, #1e1e1e);
  border: 1px solid var(--color-border, #333);
  border-radius: 6px;
  padding: 8px 12px;
  color: var(--color-text-primary, #e0e0e0);
  font-size: 13px;
  font-family: inherit;
  resize: none;
}

.chat-panel-input textarea:focus {
  outline: none;
  border-color: var(--color-accent, #4a9eff);
}

.chat-send-btn {
  background: var(--color-accent, #4a9eff);
  color: white;
  border: none;
  border-radius: 6px;
  padding: 8px 20px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.chat-send-btn:hover:not(:disabled) {
  background: var(--color-accent-hover, #3a8eef);
}

.chat-send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* API Key Modal */

.api-key-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.api-key-modal {
  background: var(--color-bg-primary, #252525);
  border-radius: 8px;
  padding: 24px;
  max-width: 500px;
  width: 90%;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.api-key-modal h3 {
  margin: 0 0 12px 0;
  color: var(--color-text-primary, #e0e0e0);
}

.api-key-modal p {
  color: var(--color-text-secondary, #aaa);
  font-size: 13px;
  line-height: 1.6;
  margin-bottom: 16px;
}

.api-key-modal a {
  color: var(--color-accent, #4a9eff);
  text-decoration: none;
}

.api-key-modal a:hover {
  text-decoration: underline;
}

.api-key-input {
  width: 100%;
  background: var(--color-bg-secondary, #1e1e1e);
  border: 1px solid var(--color-border, #333);
  border-radius: 6px;
  padding: 10px 12px;
  color: var(--color-text-primary, #e0e0e0);
  font-size: 13px;
  font-family: 'Fira Code', 'Consolas', monospace;
  margin-bottom: 16px;
}

.api-key-input:focus {
  outline: none;
  border-color: var(--color-accent, #4a9eff);
}

.api-key-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.api-key-submit-btn {
  background: var(--color-accent, #4a9eff);
  color: white;
  border: none;
  border-radius: 6px;
  padding: 10px 24px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.api-key-submit-btn:hover:not(:disabled) {
  background: var(--color-accent-hover, #3a8eef);
}

.api-key-submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.api-key-note {
  margin-top: 16px;
  font-size: 11px;
  color: var(--color-text-tertiary, #666);
  font-style: italic;
}
```

---

## 5. Integration with Project State

### 5.1 Store Integration

The chat panel integrates with Noodles.gl's existing store (likely Redux or Zustand). Project modifications from Claude are applied via the store's update methods, which will:

1. Trigger the global undo system (PR #4)
2. Update the reactive flow graph
3. Re-render affected operators

### 5.2 Undo Integration

**Location**: To be determined based on PR #4 implementation

```typescript
// Example integration with global undo
import { useUndoStore } from '../undo/store';

const applyProjectModifications = (modifications: any[], currentProject: NoodlesProject) => {
  const undoStore = useUndoStore.getState();

  // Create undo snapshot before applying changes
  undoStore.pushSnapshot({
    type: 'claude-modification',
    description: 'Claude AI modifications',
    previousState: currentProject,
    modifications
  });

  // Apply modifications
  let updatedProject = { ...currentProject };
  modifications.forEach(mod => {
    // ... apply modifications
  });

  updateProject(updatedProject);
};
```

---

## 6. Deployment and Build Configuration

### 6.1 Package Dependencies

Add to `noodles-editor/package.json`:

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.27.0",
    "flexsearch": "^0.7.43"
  },
  "devDependencies": {
    "@types/flexsearch": "^0.7.6",
    "typescript": "^5.0.0"
  },
  "scripts": {
    "generate:context": "tsx scripts/generate-context.ts"
  }
}
```

### 6.2 Vite Configuration

Update `noodles-editor/vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Ensure context bundles are copied to dist
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.includes('context/')) {
            return 'context/[name].[hash][extname]';
          }
          return 'assets/[name].[hash][extname]';
        }
      }
    }
  }
});
```

### 6.3 TypeScript Configuration

Update `noodles-editor/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "allowJs": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react-jsx"
  },
  "include": ["src", "scripts"],
  "exclude": ["node_modules", "dist"]
}
```

---

## 7. Testing Strategy

### 7.1 Unit Tests

Test coverage for:

1. **Context Loader**
   - Bundle fetching and caching
   - IndexedDB operations
   - Search index building

2. **MCP Tools**
   - Each tool implementation
   - Error handling
   - Edge cases (missing data, invalid queries)

3. **Claude Client**
   - Message handling
   - Tool execution loop
   - Project modification extraction

### 7.2 Integration Tests

1. **End-to-end chat flow**
   - User sends message
   - Claude uses tools
   - Project is modified
   - Undo works correctly

2. **Context generation**
   - Verify all source files are indexed
   - Verify operator schemas are complete
   - Verify search works correctly

### 7.3 Manual Testing Checklist

- [ ] API key flow (initial setup, change key)
- [ ] Chat panel open/close
- [ ] Popout window
- [ ] Create visualization from scratch
- [ ] Modify existing project
- [ ] Debug validation issues
- [ ] Analyze project
- [ ] Undo Claude modifications
- [ ] Offline functionality (cached context)
- [ ] Large project performance

---

## 8. Security and Privacy

### 8.1 API Key Storage

- Stored in browser localStorage
- Never sent to Noodles.gl servers
- Only used for direct Anthropic API calls
- User can change/delete at any time

### 8.2 Data Privacy

- All tool execution happens client-side
- Project data only sent to Anthropic (user's API, user's decision)
- No telemetry or usage tracking

### 8.3 Content Security

- Validate all project modifications before applying
- Sanitize any user-generated content in chat
- Prevent XSS via proper React rendering

---

## 9. Performance Considerations

### 9.1 Bundle Size

- Context bundles: ~5MB total
- Cached indefinitely (content-addressed)
- Only re-downloaded on actual changes
- Lazy-loaded when chat panel opens

### 9.2 Search Performance

- FlexSearch provides fast full-text search
- Indexes built once on load, kept in memory
- Web Workers for heavy operations (future optimization)

### 9.3 API Costs

- User pays for their own API usage
- Typical conversation: $0.01-0.05 per message
- Tool use adds minimal cost (small responses)

---

## 10. Future Enhancements

### 10.1 Phase 2 Features

1. **Voice Input**: Integrate Web Speech API for voice commands
2. **Project Templates**: Claude can suggest and apply templates
3. **Code Generation**: Generate custom operators on the fly
4. **Collaboration**: Share conversations and modifications
5. **Analytics Integration**: Claude helps interpret DuckDB results

### 10.2 Advanced Tools

1. **File Upload**: Allow users to upload data files for analysis
2. **Image Analysis**: Claude can analyze visualization screenshots
3. **Performance Profiling**: Detailed performance analysis tools
4. **Git Integration**: Claude helps with version control

### 10.3 Community Features

1. **Shared Examples**: Community-contributed examples in index
2. **Operator Marketplace**: Claude helps find and install operators
3. **Best Practices**: Claude suggests patterns based on community data

---

## 11. Success Metrics

### 11.1 Key Performance Indicators

1. **Adoption**: % of users who enable Claude integration
2. **Usage**: Average messages per session
3. **Success Rate**: % of conversations that result in project modifications
4. **User Satisfaction**: Feedback ratings (thumbs up/down)

### 11.2 Technical Metrics

1. **Context Load Time**: Target < 3 seconds
2. **Response Time**: Target < 5 seconds per message
3. **Tool Success Rate**: % of tool calls that succeed
4. **Bundle Cache Hit Rate**: % of loads from cache

---

## Appendix A: Example Interactions

### Example 1: Create Heatmap

**User**: "Create a heatmap showing density of taxi pickups in Manhattan"

**Claude**:
1. Uses `list_operators` to find HeatmapLayerOp
2. Uses `get_operator_schema` to understand inputs
3. Uses `get_example` to see heatmap pattern
4. Responds with modification JSON to:
   - Add FileOp for data source
   - Add HeatmapLayerOp with proper configuration
   - Connect to existing DeckRendererOp

### Example 2: Debug Issue

**User**: "My layer isn't showing up, can you help?"

**Claude**:
1. Uses `analyze_project` with type 'validation'
2. Finds missing required input connection
3. Explains issue and suggests fix
4. Optionally applies fix if user agrees

### Example 3: Data Analysis

**User**: "Can you write a DuckDB query to find the top 10 routes by distance?"

**Claude**:
1. Uses `search_code` to find DuckDB examples
2. Uses `get_operator_schema` for DuckDbOp
3. Generates appropriate SQL query
4. Creates/updates DuckDbOp node with query

---

## Appendix B: File Structure

```
noodles-gl-public/
├── .github/
│   └── workflows/
│       └── generate-context.yml
├── noodles-editor/
│   ├── scripts/
│   │   └── generate-context.ts
│   ├── src/
│   │   ├── claude/
│   │   │   ├── ClaudeClient.ts
│   │   │   ├── ContextLoader.ts
│   │   │   ├── MCPTools.ts
│   │   │   ├── ChatPanel.tsx
│   │   │   ├── ChatPanel.css
│   │   │   └── types.ts
│   │   └── ...
│   ├── public/
│   │   └── context/ (generated by GitHub Actions)
│   │       ├── manifest.json
│   │       ├── code-index.[hash].json
│   │       ├── operator-registry.[hash].json
│   │       ├── docs-index.[hash].json
│   │       └── examples.[hash].json
│   └── package.json
└── docs/
    └── ...
```

---

## Appendix C: Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
- [ ] Set up GitHub Actions workflow
- [ ] Implement context generation script
- [ ] Create index file formats
- [ ] Deploy initial context to GitHub Pages

### Phase 2: Client Implementation (Week 2-3)
- [ ] Implement ContextLoader
- [ ] Implement MCPTools
- [ ] Create basic Claude API client
- [ ] Test tool execution

### Phase 3: UI Development (Week 3-4)
- [ ] Build ChatPanel component
- [ ] Create API key management flow
- [ ] Implement message rendering
- [ ] Add popout functionality

### Phase 4: Integration (Week 4-5)
- [ ] Integrate with project store
- [ ] Connect to undo system (after PR #4)
- [ ] Test project modifications
- [ ] Handle edge cases

### Phase 5: Polish & Launch (Week 5-6)
- [ ] Performance optimization
- [ ] Error handling improvements
- [ ] Documentation
- [ ] User testing
- [ ] Launch beta

---

**End of Specification**
