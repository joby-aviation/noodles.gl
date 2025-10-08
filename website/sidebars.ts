import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */
const sidebars: SidebarsConfig = {
  // Organized sidebar structure
  docs: [
    'intro',
    {
      type: 'category',
      label: 'Application Users',
      collapsed: false,
      items: [
        'users/getting-started',
        'users/operators-guide',
        'users/data-guide',
        'users/comparison',
      ],
    },
    {
      type: 'category',
      label: 'Framework Developers',
      collapsed: false,
      items: [
        'developers/overview',
        'developers/creating-operators',
        'developers/field-system',
        'developers/data-flow',
        'developers/paths-containers',
        'developers/contributing',
      ],
    },
  ],
};

export default sidebars;
