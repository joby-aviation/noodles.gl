import type { languages } from 'monaco-editor'

/**
 * Monarch syntax highlighting definition for Overpass QL
 * Based on the Overpass API query language specification
 * https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL
 */
export const overpassQL: languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.overpass',

  keywords: [
    // Output format
    'out',
    'geom',
    'body',
    'skel',
    'ids',
    'tags',
    'meta',
    'center',
    'bb',
    'count',
    'qt',
    // Element types
    'node',
    'way',
    'relation',
    'area',
    'rel',
    'nwr',
    // Filters and queries
    'around',
    'if',
    'foreach',
    'for',
    'complete',
    'retro',
    'compare',
    'timeline',
    'adiff',
    // Set operations
    'union',
    'difference',
    'intersection',
    // Recursion
    'recurse',
    // Special
    'is_in',
    'poly',
    'pivot',
    'convert',
    'make',
    'timeline',
  ],

  operators: [
    '=',
    '!=',
    '~',
    '!~',
    '<',
    '>',
    '<=',
    '>=',
    '(',
    ')',
    '[',
    ']',
    '{',
    '}',
    ';',
    ',',
    ':',
    '.',
    '->',
    '<',
    '>',
    '>>',
    '<<',
    '<-',
  ],

  // Common tag keys for autocompletion hints
  tagKeys: [
    'amenity',
    'building',
    'highway',
    'natural',
    'landuse',
    'leisure',
    'shop',
    'tourism',
    'name',
    'ref',
    'addr:street',
    'addr:city',
    'addr:housenumber',
  ],

  brackets: [
    { open: '{', close: '}', token: 'delimiter.curly' },
    { open: '[', close: ']', token: 'delimiter.bracket' },
    { open: '(', close: ')', token: 'delimiter.parenthesis' },
  ],

  tokenizer: {
    root: [
      // Settings (at the beginning of query)
      [/\[out:(json|xml|csv|custom|popup)\]/, 'keyword.setting'],
      [/\[timeout:\d+\]/, 'keyword.setting'],
      [/\[maxsize:\d+\]/, 'keyword.setting'],
      [/\[date:"[^"]*"\]/, 'keyword.setting'],
      [/\[diff:"[^"]*","[^"]*"\]/, 'keyword.setting'],
      [/\[adiff:"[^"]*","[^"]*"\]/, 'keyword.setting'],
      [/\[bbox:[^\]]+\]/, 'keyword.setting'],

      // Comments
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@comment'],

      // Template variables (e.g., {{bbox}})
      [/\{\{[^}]+\}\}/, 'variable.template'],

      // Element types with tag filters
      [/(node|way|relation|area|nwr|rel)(\s*)(\[)/, ['keyword', 'white', { token: 'delimiter.bracket', next: '@tagFilter' }]],

      // Keywords
      [/\b(out|union|difference|intersection|foreach|if|for|complete|retro|compare)\b/, 'keyword'],

      // Output modifiers
      [/\b(geom|body|skel|ids|tags|meta|center|bb|count|qt)\b/, 'keyword.modifier'],

      // Recursion operators
      [/(<|>|>>|<<|<-)/, 'operator.recursion'],

      // Numbers (including coordinates)
      [/-?\d+\.?\d*/, 'number'],

      // Strings (tag values)
      [/"([^"\\]|\\.)*"/, 'string'],
      [/'([^'\\]|\\.)*'/, 'string'],

      // Operators
      [/[=!<>~]+/, 'operator'],

      // Set names (variables like .setname)
      [/\.[a-zA-Z_][a-zA-Z0-9_]*/, 'variable.set'],

      // Delimiters (non-paired)
      [/[;,:]/, 'delimiter'],

      // Brackets (paired delimiters)
      [/[()[\]{}]/, '@brackets'],

      // Whitespace
      [/\s+/, 'white'],

      // Identifiers (fallback)
      [/[a-zA-Z_][a-zA-Z0-9_:]*/, 'identifier'],
    ],

    comment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[/*]/, 'comment'],
    ],

    tagFilter: [
      // Tag key
      [/"([^"\\]|\\.)*"/, 'type.identifier', '@tagValue'],
      [/'([^'\\]|\\.)*'/, 'type.identifier', '@tagValue'],

      // Operators within tag filters
      [/[~!]?[=<>]+/, 'operator'],

      // Regex tag values
      [/~"([^"\\]|\\.)*"/, 'regexp'],
      [/~'([^'\\]|\\.)*'/, 'regexp'],

      // Close bracket
      [/\]/, 'delimiter.bracket', '@pop'],

      // Multiple filters
      [/\[/, 'delimiter.bracket'],

      // Whitespace
      [/\s+/, 'white'],
    ],

    tagValue: [
      // Tag value (string)
      [/"([^"\\]|\\.)*"/, 'string', '@pop'],
      [/'([^'\\]|\\.)*'/, 'string', '@pop'],

      // Regex pattern
      [/~"([^"\\]|\\.)*"/, 'regexp', '@pop'],
      [/~'([^'\\]|\\.)*'/, 'regexp', '@pop'],

      // Operators
      [/[~!]?[=<>]+/, 'operator'],

      // Close bracket (no value provided)
      [/\]/, 'delimiter.bracket', '@popall'],

      // Whitespace
      [/\s+/, 'white'],
    ],
  },
}

/**
 * Configuration for Overpass QL language features
 */
export const overpassQLConfig: languages.LanguageConfiguration = {
  comments: {
    lineComment: '//',
    blockComment: ['/*', '*/'],
  },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  folding: {
    markers: {
      start: new RegExp('^\\s*//\\s*#?region\\b'),
      end: new RegExp('^\\s*//\\s*#?endregion\\b'),
    },
  },
}
