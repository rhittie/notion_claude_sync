#!/usr/bin/env node

/**
 * Setup Git Hooks for Notion Sync
 * Installs post-push hook to auto-sync on git push
 */

const fs = require('fs');
const path = require('path');

const hookContent = `#!/bin/sh
# Auto-sync to Notion after commit
cd "$(git rev-parse --show-toplevel)"
echo "🔄 Syncing to Notion..." >> notion-sync.log
node tools/notion-sync/sync-to-notion.js >> notion-sync.log 2>&1
echo "✅ Sync complete at $(date)" >> notion-sync.log
`;

const hooksDir = path.join('.git', 'hooks');
const hookPath = path.join(hooksDir, 'post-commit');

// Check if we're in a git repo
if (!fs.existsSync('.git')) {
  console.error('❌ Not in a git repository. Run this from your project root.');
  process.exit(1);
}

// Create hooks directory if it doesn't exist
if (!fs.existsSync(hooksDir)) {
  fs.mkdirSync(hooksDir, { recursive: true });
}

// Write the hook
fs.writeFileSync(hookPath, hookContent);
fs.chmodSync(hookPath, '755');

console.log('✅ Git hook installed: .git/hooks/post-commit');
console.log('   Notion will sync automatically after each git commit.');
console.log('   Logs written to: notion-sync.log');
